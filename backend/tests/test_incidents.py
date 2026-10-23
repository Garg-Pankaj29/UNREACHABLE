"""Unit tests for SQLite-backed incidents, obstruction overlays, and real-time streaming."""
import hashlib
import json
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from app.core.config import SAMPLE_DATA_PATH
from app.main import app
from app.models.routing import AccessClassification, RouteRequest
from app.services.access_engine import access_engine
from app.services.data_service import data_service
from app.services.incident_service import IncidentService, incident_service


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


class TestIncidents(unittest.TestCase):
    """Test suite verifying SQLite-backed incidents and route overlay behavior."""

    def setUp(self):
        self.client = TestClient(app)
        # Clear any preexisting incidents to guarantee a pristine state
        for r_id in list(incident_service.get_blocked_roads()):
            incident_service.clear_road(r_id)

    def tearDown(self):
        # Guarantee cleanup after each test
        for r_id in list(incident_service.get_blocked_roads()):
            incident_service.clear_road(r_id)

    def test_incident_block_and_clear_routing(self):
        """Verify: block -> route changes or becomes infeasible; clear -> original restored."""
        # 1. Baseline Route Calculation
        req = RouteRequest(
            origin_station_id="station-01",
            destination_building_id="bldg-206",
            vehicle_id="fire",
        )
        r1 = access_engine.calculate_route(req)
        self.assertTrue(r1.route_found, "Initial route to bldg-206 must be found")
        self.assertIn("road-106", r1.segments_traversed, "road-106 is the primary access corridor to bldg-206")
        r1_dist = r1.total_distance_m
        r1_class = r1.classification

        # 2. Block road-106 via POST /api/incidents
        resp = self.client.post("/api/incidents", json={"road_id": "road-106", "action": "block"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("road-106", resp.json()["blocked_roads"])
        self.assertTrue(incident_service.is_road_blocked("road-106"))

        # In-memory overlay verification
        road_features = data_service.get_road_features()["features"]
        blocked_feat = next((f for f in road_features if (f.get("properties", {}).get("id") or f.get("id")) == "road-106"), None)
        self.assertIsNotNone(blocked_feat)
        self.assertIn("Active emergency incident", str(blocked_feat["properties"].get("obstruction")))

        # 3. Re-evaluate Route when blocked
        r2 = access_engine.calculate_route(req)
        # Since road-106 is the only connecting corridor to bldg-206 in sample data, route becomes infeasible / not found
        self.assertTrue(
            not r2.route_found or r2.classification == AccessClassification.INACCESSIBLE or "road-106" not in r2.segments_traversed,
            "Route must change or become infeasible when access road is blocked",
        )

        # 4. Clear road-106 via POST /api/incidents
        clear_resp = self.client.post("/api/incidents", json={"road_id": "road-106", "action": "clear"})
        self.assertEqual(clear_resp.status_code, 200)
        self.assertNotIn("road-106", clear_resp.json()["blocked_roads"])
        self.assertFalse(incident_service.is_road_blocked("road-106"))

        # 5. Route Original Restored
        r3 = access_engine.calculate_route(req)
        self.assertTrue(r3.route_found, "Route must be found again after incident clearance")
        self.assertEqual(r3.classification, r1_class, "Original classification must be restored")
        self.assertEqual(r3.total_distance_m, r1_dist, "Original route distance must be restored")
        self.assertEqual(r3.segments_traversed, r1.segments_traversed, "Original traversed segments must be restored")

    def test_incidents_survive_restart(self):
        """Verify: incidents survive simulated process restart by reloading from SQLite."""
        # 1. Block road via API
        resp = self.client.post("/api/incidents", json={"road_id": "road-102", "action": "block"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("road-102", resp.json()["blocked_roads"])

        # 2. Simulate complete backend restart by creating a new IncidentService instance pointing to same db
        new_service = IncidentService(db_path=incident_service.db_path)
        self.assertTrue(new_service.is_road_blocked("road-102"), "Blocked road must persist in SQLite and reload on restart")
        self.assertIn("road-102", new_service.get_blocked_roads())

        # 3. Clean up
        incident_service.clear_road("road-102")
        recheck_service = IncidentService(db_path=incident_service.db_path)
        self.assertFalse(recheck_service.is_road_blocked("road-102"), "Cleared road must persist as cleared in SQLite")

    def test_never_writes_geojson(self):
        """Verify: applied as in-memory obstruction overlays (never write the GeoJSON)."""
        initial_hash = file_sha256(SAMPLE_DATA_PATH)

        # Block multiple roads
        self.client.post("/api/incidents", json={"road_id": "road-101", "action": "block"})
        self.client.post("/api/incidents", json={"road_id": "road-103", "action": "block"})

        # GeoJSON file on disk MUST NOT be modified
        after_block_hash = file_sha256(SAMPLE_DATA_PATH)
        self.assertEqual(initial_hash, after_block_hash, "GeoJSON file on disk was modified! It must remain untouched.")

        # Clear roads
        self.client.post("/api/incidents", json={"road_id": "road-101", "action": "clear"})
        self.client.post("/api/incidents", json={"road_id": "road-103", "action": "clear"})

        after_clear_hash = file_sha256(SAMPLE_DATA_PATH)
        self.assertEqual(initial_hash, after_clear_hash, "GeoJSON file on disk was modified! It must remain untouched.")

    def test_stream_endpoint(self):
        """Verify: SSE /api/stream connects and emits init event."""
        with self.client.stream("GET", "/api/stream") as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/event-stream", response.headers["content-type"])
            lines = []
            for line in response.iter_lines():
                if line:
                    lines.append(line)
                if len(lines) >= 2:
                    break
            self.assertTrue(any("event: init" in l for l in lines) or any("unit_position" in l for l in lines))


if __name__ == "__main__":
    unittest.main()

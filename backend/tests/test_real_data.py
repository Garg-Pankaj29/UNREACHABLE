"""Test suite verifying integrity, performance, and deterministic constraints of real OSM data."""

import json
import os
import time
import unittest
from pathlib import Path

from app.core.config import REAL_CACHE_DIR, REAL_DATA_PATH, SAMPLE_DATA_PATH
from app.models.routing import AccessClassification, RouteRequest
from app.services.access_engine import AccessEngine
from app.services.data_service import DataService
from app.services.graph_service import RoadGraph


class TestRealData(unittest.TestCase):
    """Verifies data/real/neighbourhood.geojson schema, connectivity, and routing performance."""

    @classmethod
    def setUpClass(cls):
        if not REAL_DATA_PATH.exists():
            raise unittest.SkipTest(f"Real dataset not found at {REAL_DATA_PATH}")
        with open(REAL_DATA_PATH, "r", encoding="utf-8") as f:
            cls.geojson = json.load(f)
        cls.features = cls.geojson.get("features", [])
        cls.data_service = DataService(data_path=REAL_DATA_PATH)
        cls.engine = AccessEngine(ds=cls.data_service)

    def tearDown(self):
        os.environ["DATA_MODE"] = "demo"

    def test_unique_ids(self):
        """Every feature in real dataset must have a unique identifier."""
        ids = [f.get("id") or f.get("properties", {}).get("id") for f in self.features]
        self.assertGreater(len(ids), 0)
        self.assertEqual(len(ids), len(set(ids)), f"Found duplicate IDs: {len(ids) - len(set(ids))}")

    def test_no_malformed_geometry(self):
        """Geometries must conform to GeoJSON specification without missing or malformed coordinates."""
        for f in self.features:
            fid = f.get("id")
            geom = f.get("geometry")
            self.assertIsNotNone(geom, f"Missing geometry in feature {fid}")
            gtype = geom.get("type")
            coords = geom.get("coordinates")
            self.assertIn(gtype, ("Point", "LineString", "Polygon"), f"Invalid geometry type {gtype} in {fid}")
            self.assertTrue(coords, f"Empty coordinates in feature {fid}")

            if gtype == "Point":
                self.assertEqual(len(coords), 2, f"Point in {fid} must have 2 coordinates")
                self.assertTrue(all(isinstance(c, (int, float)) for c in coords))
            elif gtype == "LineString":
                self.assertGreaterEqual(len(coords), 2, f"LineString in {fid} must have >= 2 points")
                self.assertTrue(all(len(c) == 2 for c in coords))
            elif gtype == "Polygon":
                self.assertGreaterEqual(len(coords), 1, f"Polygon in {fid} must have >= 1 linear ring")
                self.assertGreaterEqual(len(coords[0]), 4, f"Outer ring in {fid} must have >= 4 coordinates")

    def test_largest_connected_component_covers_over_80_percent_of_roads(self):
        """Road network topology must form a coherent connected component covering >80% of road corridors."""
        road_features = [f for f in self.features if f.get("properties", {}).get("feature_type") == "road"]
        rg = RoadGraph.from_geojson_features(road_features)
        total_roads = len(rg.road_to_nodes)
        self.assertGreater(total_roads, 0)

        visited = set()
        components = []
        for node in rg.adjacency:
            if node not in visited:
                comp_nodes = set()
                queue = [node]
                visited.add(node)
                while queue:
                    curr = queue.pop(0)
                    comp_nodes.add(curr)
                    for edge in rg.adjacency.get(curr, []):
                        nbr = edge.to_node
                        if nbr not in visited:
                            visited.add(nbr)
                            queue.append(nbr)
                comp_roads = {
                    r_id for r_id, r_nodes in rg.road_to_nodes.items()
                    if any(n in comp_nodes for n in r_nodes)
                }
                components.append(comp_roads)

        max_roads = max(len(c) for c in components) if components else 0
        coverage_pct = (max_roads / total_roads) * 100.0
        self.assertGreater(coverage_pct, 80.0, f"Largest connected component is {coverage_pct:.1f}%, expected >80%")

    def test_station_to_building_route_under_2_seconds(self):
        """Routing query from emergency station to destination building must return in under 2 seconds."""
        stations = [f for f in self.features if f.get("properties", {}).get("feature_type") == "station"]
        buildings = [f for f in self.features if f.get("properties", {}).get("feature_type") == "building"]

        self.assertGreater(len(stations), 0, "No station features found in real dataset")
        self.assertGreater(len(buildings), 0, "No building features found in real dataset")

        st_id = stations[0]["id"]
        bldg_id = buildings[0]["id"]

        req = RouteRequest(
            origin_station_id=st_id,
            destination_building_id=bldg_id,
            vehicle_id="fire",
        )

        t0 = time.time()
        resp = self.engine.calculate_route(req)
        elapsed = time.time() - t0

        self.assertLess(elapsed, 2.0, f"Route calculation took {elapsed:.3f}s, expected < 2.0s")
        self.assertIsNotNone(resp.classification)

    def test_unknown_share_greater_than_zero(self):
        """Real OSM data has unmeasured widths, so unknown status share must be > 0."""
        stats = self.data_service.get_stats(vehicle_id="fire")
        self.assertGreater(stats.roads.unknown, 0, "Real road unknown count must be > 0")
        self.assertGreater(stats.buildings.unknown, 0, "Real building unknown count must be > 0")

    def test_unknown_is_never_classified_feasible(self):
        """Unknown access must never be classified as feasible."""
        from app.models.vehicle import get_vehicle_profile
        vehicle = get_vehicle_profile("fire")
        for f in self.features:
            props = f.get("properties", {})
            if props.get("feature_type") == "road" and props.get("width_m") is None:
                asmt = self.engine.evaluate_segment(
                    road_id=f["id"],
                    vehicle=vehicle,
                    props=props,
                )
                self.assertNotEqual(
                    asmt.status,
                    AccessClassification.ACCESSIBLE,
                    f"Road {f['id']} with null width classified as feasible/accessible!",
                )

    def test_health_reports_data_mode_and_counts(self):
        """API router /health must report data_mode and feature counts."""
        from fastapi.testclient import TestClient
        from app.main import app

        # Test demo mode
        os.environ["DATA_MODE"] = "demo"
        client = TestClient(app)
        res_demo = client.get("/api/health")
        self.assertEqual(res_demo.status_code, 200)
        data_demo = res_demo.json()
        self.assertEqual(data_demo.get("data_mode"), "demo")
        self.assertIn("counts", data_demo)
        self.assertGreater(data_demo["counts"].get("roads", 0), 0)

        # Test real mode
        os.environ["DATA_MODE"] = "real"
        res_real = client.get("/api/health")
        self.assertEqual(res_real.status_code, 200)
        data_real = res_real.json()
        self.assertEqual(data_real.get("data_mode"), "real")
        self.assertIn("counts", data_real)
        self.assertEqual(data_real["counts"].get("roads"), 530)
        self.assertEqual(data_real["counts"].get("buildings"), 52)

        # Restore default mode
        os.environ["DATA_MODE"] = "demo"

    def test_cached_spof_and_audit_work_order(self):
        """Precomputed cache files must exist and be served from cache."""
        for v in ("fire", "amb", "rapid"):
            crit_file = REAL_CACHE_DIR / f"critical_roads_{v}.json"
            wo_file = REAL_CACHE_DIR / f"audit_work_order_{v}.json"
            self.assertTrue(crit_file.exists(), f"Missing cache file: {crit_file}")
            self.assertTrue(wo_file.exists(), f"Missing cache file: {wo_file}")

        from fastapi.testclient import TestClient
        from app.main import app
        os.environ["DATA_MODE"] = "real"
        client = TestClient(app)

        t0 = time.time()
        crit_res = client.get("/api/analysis/critical-roads?vehicle_id=fire&limit=5")
        t_crit = time.time() - t0
        self.assertEqual(crit_res.status_code, 200)
        self.assertLess(t_crit, 0.5, "Cached critical roads took >= 0.5s")
        self.assertGreater(len(crit_res.json()), 0)

        t0 = time.time()
        wo_res = client.get("/api/audit/work-order?vehicle_id=fire")
        t_wo = time.time() - t0
        self.assertEqual(wo_res.status_code, 200)
        self.assertLess(t_wo, 0.5, "Cached audit work order took >= 0.5s")
        self.assertGreater(len(wo_res.json()), 0)

        os.environ["DATA_MODE"] = "demo"


if __name__ == "__main__":
    unittest.main()

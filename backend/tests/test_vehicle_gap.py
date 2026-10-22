"""Tests for vehicle-specific statistics and comparative vehicle gap scorecard."""
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from app.api.routes import get_audit_work_order, get_stats, get_vehicle_gap
from app.services.data_service import DataService, data_service


class TestVehicleGapAndStats(unittest.TestCase):
    """Test vehicle-specific statistics and vehicle gap analysis."""

    def test_default_stats_unchanged(self):
        """GET /api/stats without vehicle_id returns baseline GeoJSON counts."""
        res = get_stats()
        self.assertIsNotNone(res.buildings)
        self.assertIsNotNone(res.roads)
        # Default baseline in sample data
        self.assertEqual(res.buildings.total, 6)
        self.assertEqual(res.buildings.feasible, 3)
        self.assertEqual(res.buildings.constrained, 1)
        self.assertEqual(res.buildings.infeasible, 1)
        self.assertEqual(res.buildings.unknown, 1)

    def test_stats_with_vehicle_id_changes_numbers(self):
        """GET /api/stats?vehicle_id= evaluates apparatus-specific clearance rules."""
        res_fire = get_stats(vehicle_id="fire")
        res_amb = get_stats(vehicle_id="amb")
        res_rapid = get_stats(vehicle_id="rapid")

        # Fire apparatus (>=3.5m) is more constrained than ambulance (>=3.0m)
        self.assertNotEqual(
            res_fire.buildings.feasible,
            res_amb.buildings.feasible,
        )
        self.assertEqual(res_fire.buildings.feasible, 1)
        self.assertEqual(res_amb.buildings.feasible, 3)
        self.assertEqual(res_rapid.buildings.feasible, 3)

    def test_stats_invalid_vehicle_id(self):
        """GET /api/stats with unsupported vehicle_id raises 400 HTTPException."""
        with self.assertRaises(HTTPException) as ctx:
            get_stats(vehicle_id="invalid_drone")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_vehicle_gap_endpoint(self):
        """GET /api/analysis/vehicle-gap returns structured metrics for fire, amb, rapid."""
        res = get_vehicle_gap()

        for v_name in ["fire", "amb", "rapid"]:
            item = getattr(res, v_name)
            self.assertIsNotNone(item.counts)
            self.assertIsNotNone(item.verified_reachable_pct)
            self.assertIsNotNone(item.evidence_coverage_pct)

            counts = item.counts
            total = counts.total
            evidence = counts.feasible + counts.constrained + counts.infeasible

            # Mathematical definitions verification:
            # evidence_coverage_pct = (feasible+constrained+infeasible) / total * 100
            # verified_reachable_pct = feasible / (feasible+constrained+infeasible) * 100
            expected_coverage = round(evidence / total * 100.0, 1)
            expected_reachable = round(counts.feasible / evidence * 100.0, 1)
            self.assertAlmostEqual(item.evidence_coverage_pct, expected_coverage, places=1)
            self.assertAlmostEqual(item.verified_reachable_pct, expected_reachable, places=1)

    def test_hand_computable_tiny_fixture(self):
        """Test vehicle gap formulas on a hand-computable 4-building fixture."""
        fixture = {
            "type": "FeatureCollection",
            "metadata": {"name": "Hand Computable Ward"},
            "features": [
                {
                    "type": "Feature",
                    "id": "station-01",
                    "geometry": {"type": "Point", "coordinates": [77.5930, 12.9715]},
                    "properties": {"id": "station-01", "feature_type": "station", "primary_access_road": "road-1"},
                },
                {
                    "type": "Feature",
                    "id": "road-1",
                    "geometry": {"type": "LineString", "coordinates": [[77.5930, 12.9715], [77.5940, 12.9715]]},
                    "properties": {"id": "road-1", "feature_type": "road", "name": "Wide Rd", "width_m": 4.5, "access_status": "feasible", "obstruction": None},
                },
                {
                    "type": "Feature",
                    "id": "road-2",
                    "geometry": {"type": "LineString", "coordinates": [[77.5940, 12.9715], [77.5950, 12.9715]]},
                    "properties": {"id": "road-2", "feature_type": "road", "name": "Narrow Ln", "width_m": 3.1, "access_status": "constrained", "obstruction": None},
                },
                {
                    "type": "Feature",
                    "id": "road-3",
                    "geometry": {"type": "LineString", "coordinates": [[77.5940, 12.9715], [77.5940, 12.9725]]},
                    "properties": {"id": "road-3", "feature_type": "road", "name": "Blocked Al", "width_m": 2.0, "access_status": "infeasible", "obstruction": "Debris"},
                },
                {
                    "type": "Feature",
                    "id": "bldg-1",
                    "geometry": {"type": "Polygon", "coordinates": [[[77.5935, 12.9716], [77.5938, 12.9716], [77.5938, 12.9718], [77.5935, 12.9716]]]},
                    "properties": {"id": "bldg-1", "feature_type": "building", "name": "Clinic", "connected_road_id": "road-1", "access_status": "feasible"},
                },
                {
                    "type": "Feature",
                    "id": "bldg-2",
                    "geometry": {"type": "Polygon", "coordinates": [[[77.5945, 12.9716], [77.5948, 12.9716], [77.5948, 12.9718], [77.5945, 12.9716]]]},
                    "properties": {"id": "bldg-2", "feature_type": "building", "name": "Shop", "connected_road_id": "road-2", "access_status": "constrained"},
                },
                {
                    "type": "Feature",
                    "id": "bldg-3",
                    "geometry": {"type": "Polygon", "coordinates": [[[77.5941, 12.9720], [77.5944, 12.9720], [77.5944, 12.9722], [77.5941, 12.9720]]]},
                    "properties": {"id": "bldg-3", "feature_type": "building", "name": "Warehouse", "connected_road_id": "road-3", "access_status": "infeasible"},
                },
                {
                    "type": "Feature",
                    "id": "bldg-4",
                    "geometry": {"type": "Polygon", "coordinates": [[[77.5955, 12.9730], [77.5958, 12.9730], [77.5958, 12.9732], [77.5955, 12.9730]]]},
                    "properties": {"id": "bldg-4", "feature_type": "building", "name": "Unknown Shed", "connected_road_id": None, "access_status": "unknown"},
                },
            ],
        }

        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False) as tf:
            json.dump(fixture, tf)
            tf_path = Path(tf.name)

        try:
            ds = DataService(data_path=tf_path)
            gap = ds.get_vehicle_gap()

            # Hand computation:
            # Total buildings = 4 (bldg-1, bldg-2, bldg-3, bldg-4)
            # bldg-4 has no connected road -> unknown
            # Evidence count for all = 4 - 1 = 3 buildings.
            # evidence_coverage_pct = 3 / 4 * 100 = 75.0%

            # Fire (>= 3.5m required):
            # - bldg-1 on road-1 (4.5m) -> feasible
            # - bldg-2 on road-2 (3.1m < 3.5m) -> infeasible
            # - bldg-3 on road-3 (obstruction) -> infeasible
            # Feasible = 1, Constrained = 0, Infeasible = 2, Unknown = 1
            # verified_reachable_pct = 1 / 3 * 100 = 33.3%
            self.assertEqual(gap.fire.counts.feasible, 1)
            self.assertEqual(gap.fire.counts.constrained, 0)
            self.assertEqual(gap.fire.counts.infeasible, 2)
            self.assertEqual(gap.fire.counts.unknown, 1)
            self.assertEqual(gap.fire.counts.total, 4)
            self.assertEqual(gap.fire.evidence_coverage_pct, 75.0)
            self.assertEqual(gap.fire.verified_reachable_pct, 33.3)

            # Ambulance (>= 3.0m required):
            # - bldg-1 on road-1 (4.5m) -> feasible
            # - bldg-2 on road-2 (3.1m >= 3.0m, margin 0.1m < 0.4m) -> constrained
            # - bldg-3 on road-3 (obstruction) -> infeasible
            # Feasible = 1, Constrained = 1, Infeasible = 1, Unknown = 1
            # verified_reachable_pct = 1 / 3 * 100 = 33.3%
            self.assertEqual(gap.amb.counts.feasible, 1)
            self.assertEqual(gap.amb.counts.constrained, 1)
            self.assertEqual(gap.amb.counts.infeasible, 1)
            self.assertEqual(gap.amb.counts.unknown, 1)
            self.assertEqual(gap.amb.counts.total, 4)
            self.assertEqual(gap.amb.evidence_coverage_pct, 75.0)
            self.assertEqual(gap.amb.verified_reachable_pct, 33.3)

            # Rapid (>= 2.4m required):
            # - bldg-1 on road-1 (4.5m) -> feasible
            # - bldg-2 on road-2 (3.1m >= 2.4 + 0.4m) -> feasible
            # - bldg-3 on road-3 (obstruction) -> infeasible
            # Feasible = 2, Constrained = 0, Infeasible = 1, Unknown = 1
            # verified_reachable_pct = 2 / 3 * 100 = 66.7%
            self.assertEqual(gap.rapid.counts.feasible, 2)
            self.assertEqual(gap.rapid.counts.constrained, 0)
            self.assertEqual(gap.rapid.counts.infeasible, 1)
            self.assertEqual(gap.rapid.counts.unknown, 1)
            self.assertEqual(gap.rapid.counts.total, 4)
            self.assertEqual(gap.rapid.evidence_coverage_pct, 75.0)
            self.assertEqual(gap.rapid.verified_reachable_pct, 66.7)

        finally:
            if tf_path.exists():
                tf_path.unlink()

    def test_audit_work_order_endpoint(self):
        """GET /api/audit/work-order returns structured work orders sorted by buildings affected."""
        res = get_audit_work_order(vehicle_id="fire")
        self.assertIsInstance(res, list)
        self.assertGreater(len(res), 0)
        # Check first item schema
        top = res[0]
        self.assertTrue(hasattr(top, "road_id"))
        self.assertTrue(hasattr(top, "name"))
        self.assertTrue(hasattr(top, "reason"))
        self.assertTrue(hasattr(top, "buildings_affected"))
        self.assertTrue(hasattr(top, "data_source"))
        # Verify descending sort order
        counts = [item.buildings_affected for item in res]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_audit_work_order_invalid_vehicle(self):
        """GET /api/audit/work-order with invalid vehicle raises 400."""
        with self.assertRaises(HTTPException) as ctx:
            get_audit_work_order(vehicle_id="unsupported_profile")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()


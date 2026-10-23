"""Tests for Building-Level Emergency Access Assessment."""
import unittest
from app.models.routing import AccessClassification
from app.services.access_engine import access_engine
from app.services.pilot_service import pilot_data_service


class TestBuildingEmergencyAccess(unittest.TestCase):
    """Verifies building proximity, connected road access point, and vehicle routing."""

    def test_sample_building_assessment(self):
        """Assessing a sample building returns road connectivity, setbacks, and honest ingress caveats."""
        resp = access_engine.assess_building_access("bldg-201", vehicle_id="fire")
        self.assertEqual(resp.building_id, "bldg-201")
        self.assertIsNotNone(resp.connected_road_id)
        self.assertIsNotNone(resp.estimated_setback_m)
        self.assertEqual(resp.entrance_status, "road_frontage_only")
        self.assertIn("road network reachability", resp.disclaimer.lower())
        self.assertTrue(len(resp.missing_evidence) >= 1)
        self.assertIsNotNone(resp.route)
        self.assertIn("pedestrian", resp.plain_language_explanation.lower())

    def test_orphan_building_unconfirmed_entrance(self):
        """A building without a fronting road is explicitly marked unconfirmed/unverified."""
        from app.services.access_engine import AccessEngine

        class MockDataService:
            def get_feature_collection(self):
                return {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "id": "bldg-orphan",
                            "geometry": {"type": "Point", "coordinates": [77.5936, 12.9720]},
                            "properties": {
                                "id": "bldg-orphan",
                                "feature_type": "building",
                                "name": "Orphan Structure",
                                "connected_road_id": None,
                            },
                        }
                    ],
                }

        class MockPilotService:
            def is_available(self):
                return False

        engine = AccessEngine(ds=MockDataService(), pilot_ds=MockPilotService())
        resp = engine.assess_building_access("bldg-orphan", vehicle_id="fire")
        self.assertEqual(resp.classification, AccessClassification.UNKNOWN)
        self.assertEqual(resp.entrance_status, "unconfirmed_entrance")
        self.assertEqual(resp.assessment_status, "unverified")
        self.assertIsNone(resp.route)
        self.assertTrue(any("unsurveyed" in m.lower() for m in resp.missing_evidence))

    def test_pilot_building_assessment(self):
        """Assessing a real pilot building identifies the nearest connected road access point and routes from facility."""
        if not pilot_data_service.is_available():
            self.skipTest("Pilot database not available")

        # Park Plaza (osm_bldg_409434941)
        resp = access_engine.assess_building_access(
            "osm_bldg_409434941",
            vehicle_id="fire",
            dataset_mode="pilot",
        )
        self.assertEqual(resp.building_id, "osm_bldg_409434941")
        self.assertEqual(resp.building_name, "Park Plaza")
        self.assertIsNotNone(resp.connected_road_id)
        self.assertIsNotNone(resp.approach_road_name)
        self.assertIsNotNone(resp.estimated_setback_m)
        # Verify proximity is reasonable (within 100m of road network)
        self.assertLess(resp.estimated_setback_m, 100.0)
        self.assertIsNotNone(resp.road_access_coordinates)
        self.assertIsNotNone(resp.building_coordinates)

        # Distinguish road arrival from building entrance access
        self.assertEqual(resp.entrance_status, "road_frontage_only")
        self.assertEqual(resp.assessment_status, "partial_unverified")
        self.assertIn("road-network reachability does not imply building entrance ingress", resp.plain_language_explanation.lower())

        # Check missing evidence list
        self.assertTrue(len(resp.missing_evidence) >= 2)
        self.assertTrue(any("entrance gate" in m.lower() for m in resp.missing_evidence))
        self.assertTrue(any("setback" in m.lower() for m in resp.missing_evidence))

        # Check vehicle-aware route
        self.assertIsNotNone(resp.route)
        self.assertTrue(resp.route.route_found)
        self.assertGreater(resp.route.total_distance_m, 1000.0)
        self.assertIsNotNone(resp.origin_station_id)
        self.assertIsNotNone(resp.origin_station_name)


if __name__ == "__main__":
    unittest.main()

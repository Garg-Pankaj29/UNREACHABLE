"""Tests for real-road emergency routing, vehicle constraints, and colour-coded accessibility."""
import unittest
from app.services.access_engine import AccessEngine
from app.services.pilot_service import pilot_data_service
from app.models.routing import (
    AccessClassification,
    RouteRequest,
)
from app.models.vehicle import get_vehicle_profile


class TestRealRoadEmergencyRouting(unittest.TestCase):
    """Validates real road routing on extracted Chandigarh pilot dataset."""

    def setUp(self):
        self.engine = AccessEngine()
        self.skip_if_no_pilot = not pilot_data_service.is_available()

    def test_real_road_routing_from_facility_to_coordinates(self):
        if self.skip_if_no_pilot:
            self.skipTest("Pilot database not found")

        # Route from Fortis Hospital Mohali to Sector 17 Plaza coordinates
        req = RouteRequest(
            origin_station_id="osm_emergency_node_441046459",  # PGI Emergency Hospital
            destination_coordinates=[76.7794, 30.7415],  # Sector 17 Plaza
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
        )
        resp = self.engine.calculate_route(req)

        self.assertTrue(resp.route_found)
        self.assertGreater(resp.total_distance_m, 1500.0)
        self.assertGreater(len(resp.segments_traversed), 10)
        self.assertIsNotNone(resp.geometry_geojson)
        self.assertEqual(resp.geometry_geojson["type"], "LineString")
        self.assertGreater(len(resp.geometry_geojson["coordinates"]), 10)

        # Confirm segments follow real roads and steps have valid fields
        first_step = resp.steps[0]
        self.assertIsNotNone(first_step.road_name)
        self.assertGreater(first_step.segment_length_m, 0.0)
        self.assertIn(first_step.status, [
            AccessClassification.ACCESSIBLE,
            AccessClassification.CONSTRAINED,
            AccessClassification.UNKNOWN,
            AccessClassification.INACCESSIBLE,
        ])

    def test_honesty_unknown_widths_remain_unknown(self):
        if self.skip_if_no_pilot:
            self.skipTest("Pilot database not found")

        # Evaluate segment with None width
        vehicle = get_vehicle_profile("fire")
        assessment = self.engine.evaluate_segment(
            road_id="osm_way_test",
            vehicle=vehicle,
            props={"name": "Test Way", "width_m": None},
            length_m=100.0,
        )
        self.assertEqual(assessment.status, AccessClassification.UNKNOWN)
        self.assertIn("Unmeasured corridor width", assessment.limiting_factors[0])

    def test_destination_outside_pilot_corridor_is_labeled_honestly(self):
        if self.skip_if_no_pilot:
            self.skipTest("Pilot database not found")

        # Destination in New Delhi (well outside Chandigarh pilot corridor 76.52 - 76.88, 30.62 - 30.82)
        req = RouteRequest(
            origin_station_id="osm_emergency_node_441046459",
            destination_coordinates=[77.2090, 28.6139],
            destination_name="Connaught Place, New Delhi",
            vehicle_id="fire",
            dataset_mode="pilot",
        )
        resp = self.engine.calculate_route(req)

        self.assertFalse(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.UNKNOWN)
        self.assertIn("outside the Chandigarh pilot road network corridor", resp.explanation)
        self.assertIn("Detailed road routing and vehicle accessibility analysis are unavailable", resp.explanation)

    def test_compare_routes_on_pilot_corridor(self):
        if self.skip_if_no_pilot:
            self.skipTest("Pilot database not found")

        cmp_resp = self.engine.compare_routes(
            station_id="osm_emergency_node_441046459",
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
        )
        self.assertIsNotNone(cmp_resp)
        self.assertGreater(cmp_resp.naive.distance_m, 1500.0)
        self.assertGreater(cmp_resp.aware.distance_m, 1500.0)
        self.assertIsNotNone(cmp_resp.verdict)


if __name__ == "__main__":
    unittest.main()

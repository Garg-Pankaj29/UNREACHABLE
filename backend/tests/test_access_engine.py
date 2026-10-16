"""Deterministic test suite for UNREACHABLE emergency vehicle access & routing engine."""
import unittest
from typing import Any, Dict, List

from app.models.routing import AccessClassification, RouteRequest
from app.models.vehicle import VehicleProfile, get_vehicle_profile
from app.services.access_engine import AccessEngine
from app.services.data_service import DataService
from app.services.graph_service import RoadGraph


class MockDataService(DataService):
    """Isolated test data service using synthetic in-memory fixtures."""

    def __init__(self, features: List[Dict[str, Any]]):
        self._custom_features = features
        self._cache = {
            "type": "FeatureCollection",
            "metadata": {"name": "Test Network", "crs": "OGC:CRS84"},
            "features": features,
        }

    def load_data(self) -> Dict[str, Any]:
        return self._cache


class TestAccessEngine(unittest.TestCase):
    """Validates the 10 core deterministic requirements of the Access Engine."""

    def setUp(self):
        # Default engine using the reference sample dataset
        self.engine = AccessEngine()

    def test_01_route_satisfying_configured_constraints(self):
        """1. A route satisfying configured constraints is classified as accessible."""
        req = RouteRequest(
            origin_station_id="station-01",
            destination_building_id="bldg-201",
            vehicle_id="fire",
        )
        resp = self.engine.calculate_route(req)

        self.assertTrue(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.ACCESSIBLE)
        self.assertIn("road-101", resp.segments_traversed)
        self.assertGreater(resp.total_distance_m, 0.0)
        self.assertEqual(len(resp.limiting_segments), 0)

    def test_02_constrained_route(self):
        """2. A route with tight physical clearance is classified as constrained."""
        req = RouteRequest(
            origin_station_id="station-01",
            destination_building_id="bldg-206",
            vehicle_id="fire",
        )
        resp = self.engine.calculate_route(req)

        self.assertTrue(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.CONSTRAINED)
        self.assertIn("road-106", resp.limiting_segments)
        self.assertIn("road-106", resp.segments_traversed)

    def test_03_route_blocked_by_confirmed_obstruction(self):
        """3. A route blocked by physical barrier is classified as inaccessible."""
        req = RouteRequest(
            origin_station_id="station-01",
            destination_building_id="bldg-204",
            vehicle_id="rapid",
        )
        resp = self.engine.calculate_route(req)

        self.assertFalse(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.INACCESSIBLE)
        self.assertIn("road-104", resp.limiting_segments)
        self.assertIn("blocked", resp.explanation.lower())

    def test_04_route_containing_unknown_width_segment(self):
        """4. A route containing an unmeasured road width is classified as unknown."""
        req = RouteRequest(
            origin_station_id="station-01",
            destination_building_id="bldg-205",
            vehicle_id="amb",
        )
        resp = self.engine.calculate_route(req)

        self.assertTrue(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.UNKNOWN)
        self.assertIn("road-105", resp.limiting_segments)
        self.assertIn("unmeasured", resp.explanation.lower())

    def test_05_disconnected_graph(self):
        """5. A destination with no graph connection returns an honest disconnected result."""
        disconnected_features = [
            {
                "type": "Feature",
                "id": "station-iso",
                "geometry": {"type": "Point", "coordinates": [77.1000, 12.1000]},
                "properties": {
                    "id": "station-iso",
                    "feature_type": "station",
                    "name": "Isolated Base",
                    "primary_access_road": "road-A",
                },
            },
            {
                "type": "Feature",
                "id": "road-A",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.1000, 12.1000], [77.1010, 12.1000]],
                },
                "properties": {
                    "id": "road-A",
                    "feature_type": "road",
                    "name": "Island Road A",
                    "width_m": 8.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "road-B",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.2000, 12.2000], [77.2010, 12.2000]],
                },
                "properties": {
                    "id": "road-B",
                    "feature_type": "road",
                    "name": "Island Road B",
                    "width_m": 8.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-remote",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [77.2005, 12.2005],
                            [77.2008, 12.2005],
                            [77.2008, 12.2008],
                            [77.2005, 12.2008],
                            [77.2005, 12.2005],
                        ]
                    ],
                },
                "properties": {
                    "id": "bldg-remote",
                    "feature_type": "building",
                    "name": "Remote Building",
                    "connected_road_id": "road-B",
                },
            },
        ]
        iso_engine = AccessEngine(ds=MockDataService(disconnected_features))
        req = RouteRequest(
            origin_station_id="station-iso",
            destination_building_id="bldg-remote",
            vehicle_id="fire",
        )
        resp = iso_engine.calculate_route(req)

        self.assertFalse(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.UNKNOWN)
        self.assertIn("topological", resp.explanation.lower())

    def test_06_invalid_station_and_building_identifiers(self):
        """6. Invalid identifiers raise appropriate KeyError exceptions."""
        with self.assertRaises(KeyError):
            self.engine.calculate_route(
                RouteRequest(origin_station_id="nonexistent-station", destination_building_id="bldg-201")
            )

        with self.assertRaises(KeyError):
            self.engine.calculate_route(
                RouteRequest(origin_station_id="station-01", destination_building_id="nonexistent-bldg")
            )

    def test_07_unsupported_vehicle_profiles(self):
        """7. Unsupported vehicle profiles raise ValueError."""
        with self.assertRaises(ValueError):
            self.engine.calculate_route(
                RouteRequest(
                    origin_station_id="station-01",
                    destination_building_id="bldg-201",
                    vehicle_id="unsupported_helicopter",
                )
            )

    def test_08_buildings_without_confirmed_access_points(self):
        """8. Buildings with unassigned or missing fronting road return explicit unknown access."""
        no_access_features = [
            {
                "type": "Feature",
                "id": "station-01",
                "geometry": {"type": "Point", "coordinates": [77.5932, 12.9715]},
                "properties": {
                    "id": "station-01",
                    "feature_type": "station",
                    "primary_access_road": "road-101",
                },
            },
            {
                "type": "Feature",
                "id": "road-101",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.5930, 12.9715], [77.5950, 12.9715]],
                },
                "properties": {
                    "id": "road-101",
                    "feature_type": "road",
                    "width_m": 7.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-orphan",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [77.5936, 12.9720],
                            [77.5940, 12.9720],
                            [77.5940, 12.9725],
                            [77.5936, 12.9725],
                            [77.5936, 12.9720],
                        ]
                    ],
                },
                "properties": {
                    "id": "bldg-orphan",
                    "feature_type": "building",
                    "name": "Orphan Building",
                    "connected_road_id": None,  # Missing corridor connection
                },
            },
        ]
        orphan_engine = AccessEngine(ds=MockDataService(no_access_features))
        assessment = orphan_engine.assess_building_access("bldg-orphan", "fire")

        self.assertEqual(assessment.classification, AccessClassification.UNKNOWN)
        self.assertEqual(assessment.entrance_status, "unconfirmed_entrance")
        self.assertIn("no fronting road", assessment.plain_language_explanation.lower())

    def test_09_invalid_or_missing_geometry(self):
        """9. Malformed geometry features are skipped safely without crashes."""
        malformed_features = [
            {
                "type": "Feature",
                "id": "road-malformed-1",
                "geometry": {"type": "Point", "coordinates": [77.59, 12.97]},  # Not a LineString
                "properties": {"id": "road-malformed-1", "feature_type": "road"},
            },
            {
                "type": "Feature",
                "id": "road-malformed-2",
                "geometry": {"type": "LineString", "coordinates": [[77.59, 12.97]]},  # Only 1 point
                "properties": {"id": "road-malformed-2", "feature_type": "road"},
            },
            {
                "type": "Feature",
                "id": "road-valid",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.590, 12.970], [77.592, 12.970]],
                },
                "properties": {
                    "id": "road-valid",
                    "feature_type": "road",
                    "width_m": 6.0,
                    "access_status": "feasible",
                },
            },
        ]
        graph = RoadGraph.from_geojson_features(malformed_features)
        self.assertEqual(graph.total_roads_loaded, 1)
        self.assertIn("road-valid", graph.road_to_nodes)

    def test_10_alternative_path_avoids_blocked_segment(self):
        """10. Engine chooses an unblocked alternative path over a blocked direct path."""
        # Triangle network:
        # Station at Node A (0,0)
        # Direct path to C: Road A->C (blocked)
        # Alternative path: Road A->B (open), Road B->C (open)
        triangle_features = [
            {
                "type": "Feature",
                "id": "station-alt",
                "geometry": {"type": "Point", "coordinates": [77.0, 12.0]},
                "properties": {
                    "id": "station-alt",
                    "feature_type": "station",
                    "primary_access_road": "road-direct",
                },
            },
            {
                "type": "Feature",
                "id": "road-direct",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0, 12.0], [77.02, 12.0]],
                },
                "properties": {
                    "id": "road-direct",
                    "feature_type": "road",
                    "name": "Direct Blocked Road",
                    "width_m": 6.0,
                    "obstruction": "Construction trench",
                    "access_status": "infeasible",
                },
            },
            {
                "type": "Feature",
                "id": "road-detour-1",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0, 12.0], [77.01, 12.01]],
                },
                "properties": {
                    "id": "road-detour-1",
                    "feature_type": "road",
                    "name": "Bypass Lane 1",
                    "width_m": 5.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "road-detour-2",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.01, 12.01], [77.02, 12.0]],
                },
                "properties": {
                    "id": "road-detour-2",
                    "feature_type": "road",
                    "name": "Bypass Lane 2",
                    "width_m": 5.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-target",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [77.019, 12.001],
                            [77.021, 12.001],
                            [77.021, 12.003],
                            [77.019, 12.003],
                            [77.019, 12.001],
                        ]
                    ],
                },
                "properties": {
                    "id": "bldg-target",
                    "name": "Target Hub",
                    "feature_type": "building",
                    "connected_road_id": "road-detour-2",
                },
            },
        ]
        alt_engine = AccessEngine(ds=MockDataService(triangle_features))
        req = RouteRequest(
            origin_station_id="station-alt",
            destination_building_id="bldg-target",
            vehicle_id="fire",
        )
        resp = alt_engine.calculate_route(req)

        self.assertTrue(resp.route_found)
        self.assertEqual(resp.classification, AccessClassification.ACCESSIBLE)
        self.assertNotIn("road-direct", resp.segments_traversed)
        self.assertIn("road-detour-1", resp.segments_traversed)
        self.assertIn("road-detour-2", resp.segments_traversed)


if __name__ == "__main__":
    unittest.main()

"""Deterministic test suite for UNREACHABLE emergency vehicle access & routing engine."""
import unittest
from typing import Any, Dict, List

from app.models.routing import (
    AccessClassification,
    RouteRequest,
    SimulateChange,
    SimulateRequest,
)
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

    def test_11_compare_routes_naive_violates_and_aware_avoids(self):
        """11. Comparison correctly detects when naive route violates clearance and aware route avoids it."""
        triangle_features = [
            {
                "type": "Feature",
                "id": "station-cmp",
                "geometry": {"type": "Point", "coordinates": [77.0, 12.0]},
                "properties": {
                    "id": "station-cmp",
                    "feature_type": "station",
                    "name": "Comparison Station",
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
                    "name": "Direct Bottleneck Lane",
                    "width_m": 2.5,
                    "access_status": "infeasible",
                },
            },
            {
                "type": "Feature",
                "id": "road-bypass-1",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0, 12.0], [77.01, 12.01]],
                },
                "properties": {
                    "id": "road-bypass-1",
                    "feature_type": "road",
                    "name": "Bypass 1",
                    "width_m": 5.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "road-bypass-2",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.01, 12.01], [77.02, 12.0]],
                },
                "properties": {
                    "id": "road-bypass-2",
                    "feature_type": "road",
                    "name": "Bypass 2",
                    "width_m": 5.0,
                    "access_status": "feasible",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-dest",
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
                    "id": "bldg-dest",
                    "name": "Destination Hub",
                    "feature_type": "building",
                    "connected_road_id": "road-direct",
                },
            },
        ]
        cmp_engine = AccessEngine(ds=MockDataService(triangle_features))
        comp = cmp_engine.compare_routes(
            station_id="station-cmp",
            building_id="bldg-dest",
            vehicle_id="fire",
        )

        self.assertTrue(comp.naive_would_fail)
        self.assertGreater(len(comp.naive.violations), 0)
        self.assertEqual(comp.naive.violations[0].road_id, "road-direct")
        self.assertEqual(comp.naive.violations[0].width_m, 2.5)
        self.assertEqual(comp.naive.violations[0].required_m, 3.5)
        self.assertIn("A distance-only route would fail at road-direct", comp.verdict)
        self.assertFalse(comp.aware.road_ids)  # Since only access to destination road is blocked, aware finds no passable path

        self.assertNotIn("road-direct", comp.aware.road_ids)

    def test_12_compare_routes_identical(self):
        """12. Comparison correctly identifies when naive and aware routes are identical."""
        # In sample dataset, station-01 to bldg-201 via road-101 has adequate width (8.5m)
        comp = self.engine.compare_routes(
            station_id="station-01",
            building_id="bldg-201",
            vehicle_id="fire",
        )
        self.assertFalse(comp.naive_would_fail)
        self.assertEqual(len(comp.naive.violations), 0)
        self.assertEqual(comp.naive.road_ids, comp.aware.road_ids)
        self.assertIn("identical", comp.verdict.lower())

    def test_13_simulate_close_road_makes_building_inaccessible(self):
        """13. Closing a road on the only route marks the building not-feasible."""
        # Closing road-101 (primary egress from station-01) blocks bldg-201
        sim_req = SimulateRequest(
            vehicle_id="fire",
            changes=[SimulateChange(road_id="road-101", action="close")],
        )
        res = self.engine.simulate(sim_req)
        changed = [cb for cb in res.changed_buildings if cb.id == "bldg-201"]
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0].before, "accessible")
        self.assertNotEqual(changed[0].after, "accessible")

    def test_14_simulate_does_not_mutate_stats(self):
        """14. Running simulate does not alter a subsequent GET stats call."""
        stats_before = self.engine.data_service.get_stats()
        sim_req = SimulateRequest(
            vehicle_id="fire",
            changes=[
                SimulateChange(road_id="road-101", action="close"),
                SimulateChange(road_id="road-104", action="clear_obstruction"),
            ],
        )
        self.engine.simulate(sim_req)
        stats_after = self.engine.data_service.get_stats()
        self.assertEqual(stats_before.buildings.feasible, stats_after.buildings.feasible)
        self.assertEqual(stats_before.roads.feasible, stats_after.roads.feasible)

    def test_15_simulate_clear_obstruction_improves_access(self):
        """15. Clearing an obstruction improves at least one seeded building's access."""
        # In sample data, road-104 has physical obstruction blocking bldg-204
        sim_req = SimulateRequest(
            vehicle_id="amb",
            changes=[SimulateChange(road_id="road-104", action="clear_obstruction")],
        )
        res = self.engine.simulate(sim_req)
        improved = [cb for cb in res.changed_buildings if cb.id == "bldg-204"]
        self.assertEqual(len(improved), 1)
        self.assertEqual(improved[0].before, "inaccessible")
        self.assertEqual(improved[0].after, "accessible")

    def test_16_audit_work_order_hand_computable_ranking(self):
        """16. Audit work order ranks unknown/unverified roads by hand-computable building dependency count."""
        features = [
            {
                "type": "Feature",
                "id": "station-01",
                "geometry": {"type": "Point", "coordinates": [77.0, 12.0]},
                "properties": {
                    "id": "station-01",
                    "feature_type": "station",
                    "name": "Central Station",
                    "primary_access_road": "road-main",
                },
            },
            {
                "type": "Feature",
                "id": "road-main",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.0, 12.0], [77.01, 12.0]],
                },
                "properties": {
                    "id": "road-main",
                    "feature_type": "road",
                    "name": "Main Highway",
                    "width_m": 8.0,
                    "access_status": "feasible",
                    "verification_status": "ground_verified",
                    "data_source": "Certified Municipal Survey",
                },
            },
            {
                "type": "Feature",
                "id": "road-unverified-high",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.01, 12.0], [77.02, 12.0]],
                },
                "properties": {
                    "id": "road-unverified-high",
                    "feature_type": "road",
                    "name": "North Sector Corridor",
                    "width_m": 4.0,
                    "access_status": "feasible",
                    "verification_status": "unverified_survey",
                    "data_source": "Unverified Cadastre Map",
                },
            },
            {
                "type": "Feature",
                "id": "road-unknown-low",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.01, 12.0], [77.01, 12.01]],
                },
                "properties": {
                    "id": "road-unknown-low",
                    "feature_type": "road",
                    "name": "South Track",
                    "width_m": None,
                    "access_status": "unknown",
                    "verification_status": "uninspected",
                    "data_source": "Satellite Aerial Scan",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-h1",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[77.015, 12.001], [77.018, 12.001], [77.018, 12.004], [77.015, 12.004], [77.015, 12.001]]],
                },
                "properties": {
                    "id": "bldg-h1",
                    "feature_type": "building",
                    "name": "High Priority Facility 1",
                    "connected_road_id": "road-unverified-high",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-h2",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[77.019, 12.001], [77.020, 12.001], [77.020, 12.004], [77.019, 12.004], [77.019, 12.001]]],
                },
                "properties": {
                    "id": "bldg-h2",
                    "feature_type": "building",
                    "name": "High Priority Facility 2",
                    "connected_road_id": "road-unverified-high",
                },
            },
            {
                "type": "Feature",
                "id": "bldg-l1",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[77.011, 12.005], [77.013, 12.005], [77.013, 12.008], [77.011, 12.008], [77.011, 12.005]]],
                },
                "properties": {
                    "id": "bldg-l1",
                    "feature_type": "building",
                    "name": "Low Priority Storage",
                    "connected_road_id": "road-unknown-low",
                },
            },
        ]
        test_engine = AccessEngine(ds=MockDataService(features))
        work_order = test_engine.get_audit_work_order(vehicle_id="fire")

        self.assertEqual(len(work_order), 2)
        self.assertEqual(work_order[0].road_id, "road-unverified-high")
        self.assertEqual(work_order[0].buildings_affected, 2)
        self.assertEqual(work_order[0].data_source, "Unverified Cadastre Map")

        self.assertEqual(work_order[1].road_id, "road-unknown-low")
        self.assertEqual(work_order[1].buildings_affected, 1)
        self.assertEqual(work_order[1].data_source, "Satellite Aerial Scan")


if __name__ == "__main__":
    unittest.main()




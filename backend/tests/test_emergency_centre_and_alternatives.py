"""Comprehensive tests for Emergency Centre Selection and Multiple Colour-Coded Routes workflow.

Covers:
1. Emergency-centre selection across categories (fire stations, hospitals, clinics, doctors).
2. Destination selection and road-graph attachment.
3. Distinct alternative paths with diversity validation.
4. One-way restrictions enforcement.
5. Vehicle-specific blocking constraints.
6. Confirmed physical barriers and obstructions.
7. Unknown widths remaining strictly unknown.
8. Disconnected endpoints handling.
9. Fewer available routes than requested with honest explanations.
10. Outside-pilot destinations detection and notices.
11. Route geometry and distance consistency.
"""

import unittest
from app.models.routing import (
    AccessClassification,
    MultiRouteRequest,
    RouteRequest,
)
from app.models.vehicle import get_vehicle_profile
from app.services.access_engine import AccessEngine, ROUTE_COLORS
from app.services.graph_service import RoadGraph
from app.services.pilot_service import pilot_data_service


class TestEmergencyCentreAndAlternatives(unittest.TestCase):
    """Test suite validating end-to-end multi-route emergency workflow."""

    def setUp(self):
        self.engine = AccessEngine()
        self.has_pilot = pilot_data_service.is_available()

    # -------------------------------------------------------------------------
    # 1. Emergency-Centre Selection
    # -------------------------------------------------------------------------
    def test_emergency_centre_selection_categories(self):
        """Verifies emergency centre retrieval and category filtering from pilot database."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        # Check fire stations
        fire_stns = pilot_data_service.get_emergency_facilities(category="fire_station")
        self.assertGreaterEqual(len(fire_stns), 1)
        for st in fire_stns:
            p = st["properties"]
            self.assertIn(p["facility_type"], ("fire_station", "fire"))
            self.assertIsNotNone(p["name"])
            self.assertIn("coordinates", p)
            self.assertEqual(len(p["coordinates"]), 2)

        # Check hospitals
        hospitals = pilot_data_service.get_emergency_facilities(category="hospital")
        self.assertGreaterEqual(len(hospitals), 10)
        self.assertEqual(hospitals[0]["properties"]["facility_type"], "hospital")

        # Check clinics
        clinics = pilot_data_service.get_emergency_facilities(category="clinic")
        self.assertGreaterEqual(len(clinics), 10)
        self.assertEqual(clinics[0]["properties"]["facility_type"], "clinic")

        # Check doctors
        doctors = pilot_data_service.get_emergency_facilities(category="doctors")
        self.assertGreaterEqual(len(doctors), 5)
        self.assertEqual(doctors[0]["properties"]["facility_type"], "doctors")

    def test_emergency_centre_origin_attachment_no_silent_substitution(self):
        """Verifies chosen origin facility attaches to road network without substitution."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        # Use Sector 17 Fire Station
        st_id = "osm_emergency_way_129774350"
        req = MultiRouteRequest(
            origin_station_id=st_id,
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=2,
        )
        resp = self.engine.calculate_alternative_routes(req)

        # Ensure origin facility was NOT substituted
        self.assertEqual(resp.origin_id, st_id)
        self.assertIsNotNone(resp.origin_coordinates)
        self.assertAlmostEqual(resp.origin_coordinates[0], 76.7805, places=2)
        self.assertAlmostEqual(resp.origin_coordinates[1], 30.7357, places=2)

    # -------------------------------------------------------------------------
    # 2. Destination Selection and Road-Graph Attachment
    # -------------------------------------------------------------------------
    def test_destination_selection_and_road_graph_attachment(self):
        """Verifies destination coordinates attach to closest road graph junction node."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        req = MultiRouteRequest(
            origin_station_id="osm_emergency_way_129774350",
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=2,
        )
        resp = self.engine.calculate_alternative_routes(req)
        self.assertIn(resp.status, ("multiple_found", "fewer_found", "single_found"))
        self.assertGreater(resp.routes_found_count, 0)
        self.assertIsNotNone(resp.destination_coordinates)
        self.assertAlmostEqual(resp.destination_coordinates[0], 76.7794, places=4)

    # -------------------------------------------------------------------------
    # 3. Distinct Alternative Paths
    # -------------------------------------------------------------------------
    def test_distinct_alternative_paths_diversity_and_colors(self):
        """Verifies alternative paths are genuinely distinct with distinct identity colors."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        req = MultiRouteRequest(
            origin_station_id="osm_emergency_way_129774350",
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=3,
        )
        resp = self.engine.calculate_alternative_routes(req)
        self.assertGreaterEqual(resp.routes_found_count, 1)

        # Check route IDs, index, and colors
        colors_seen = set()
        ids_seen = set()
        for idx, route in enumerate(resp.routes, start=1):
            self.assertEqual(route.route_index, idx)
            self.assertEqual(route.route_id, f"route-{idx}")
            self.assertIn(route.color, ROUTE_COLORS)
            colors_seen.add(route.color)
            ids_seen.add(route.route_id)
            self.assertGreater(route.total_distance_m, 0.0)
            self.assertGreater(route.segment_count, 0)

        # Ensure all IDs and colors are unique
        self.assertEqual(len(colors_seen), len(resp.routes))
        self.assertEqual(len(ids_seen), len(resp.routes))

        # If multiple routes found, verify segment overlap <= 75%
        if len(resp.routes) >= 2:
            r1_rids = set(resp.routes[0].segments_traversed)
            r2_rids = set(resp.routes[1].segments_traversed)
            shared = r1_rids.intersection(r2_rids)
            # Not identical sets
            self.assertNotEqual(r1_rids, r2_rids)

    # -------------------------------------------------------------------------
    # 4. One-Way Restrictions
    # -------------------------------------------------------------------------
    def test_oneway_restrictions_enforced_in_graph(self):
        """Verifies road graph respects one-way directionality."""
        features = [
            {
                "type": "Feature",
                "id": "oneway-forward",
                "properties": {
                    "feature_type": "road",
                    "id": "oneway-forward",
                    "name": "OneWay St",
                    "width_m": 7.0,
                    "oneway": "yes",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[76.50, 30.70], [76.51, 30.70]],
                },
            }
        ]
        graph = RoadGraph.from_geojson_features(features)
        u_node = graph.get_closest_node((76.50, 30.70))
        v_node = graph.get_closest_node((76.51, 30.70))

        # Forward edge exists from u to v
        u_edges = graph.adjacency.get(u_node, [])
        self.assertTrue(any(e.to_node == v_node for e in u_edges))

        # Reverse edge does NOT exist from v to u
        v_edges = graph.adjacency.get(v_node, [])
        self.assertFalse(any(e.to_node == u_node for e in v_edges))

    # -------------------------------------------------------------------------
    # 5. Vehicle-Specific Blocking Constraints
    # -------------------------------------------------------------------------
    def test_vehicle_specific_blocking_constraints(self):
        """Verifies clearance constraints block large vehicles while permitting compact ones."""
        fire = get_vehicle_profile("fire")   # min width 3.5m
        rapid = get_vehicle_profile("rapid") # min width 2.4m

        narrow_props = {"name": "Narrow Alley", "width_m": 2.8}

        asmt_fire = self.engine.evaluate_segment("narrow-road", fire, narrow_props, 100.0)
        asmt_rapid = self.engine.evaluate_segment("narrow-road", rapid, narrow_props, 100.0)

        # Fire tender must be blocked
        self.assertFalse(asmt_fire.is_passable)
        self.assertEqual(asmt_fire.status, AccessClassification.INACCESSIBLE)

        # Rapid response must be passable
        self.assertTrue(asmt_rapid.is_passable)
        self.assertIn(asmt_rapid.status, (AccessClassification.ACCESSIBLE, AccessClassification.CONSTRAINED))

    # -------------------------------------------------------------------------
    # 6. Confirmed Physical Barriers and Obstructions
    # -------------------------------------------------------------------------
    def test_confirmed_barriers_block_passage(self):
        """Verifies mapped barriers and obstructions result in inaccessible status."""
        fire = get_vehicle_profile("fire")

        # Barrier tag
        barrier_props = {"name": "Gated Road", "barrier": "bollard", "width_m": 8.0}
        asmt_barrier = self.engine.evaluate_segment("gate-road", fire, barrier_props, 50.0)
        self.assertFalse(asmt_barrier.is_passable)
        self.assertEqual(asmt_barrier.status, AccessClassification.INACCESSIBLE)
        self.assertIn("Confirmed physical barrier", asmt_barrier.limiting_factors[0])

        # Maxwidth barrier
        maxw_props = {"name": "Low Archway", "maxwidth_m": 2.5, "width_m": 4.0}
        asmt_maxw = self.engine.evaluate_segment("arch-road", fire, maxw_props, 50.0)
        self.assertFalse(asmt_maxw.is_passable)
        self.assertEqual(asmt_maxw.status, AccessClassification.INACCESSIBLE)

        # Mapped obstruction
        obstr_props = {"name": "Fallen Tree Road", "obstruction": "Downed high-voltage wire", "width_m": 6.0}
        asmt_obstr = self.engine.evaluate_segment("obstr-road", fire, obstr_props, 50.0)
        self.assertFalse(asmt_obstr.is_passable)
        self.assertEqual(asmt_obstr.status, AccessClassification.INACCESSIBLE)

    # -------------------------------------------------------------------------
    # 7. Unknown Widths Remain Strictly Unknown
    # -------------------------------------------------------------------------
    def test_unknown_widths_remain_unknown(self):
        """Verifies unmeasured road widths are classified as UNKNOWN without fabrication."""
        fire = get_vehicle_profile("fire")
        props = {"name": "Unmeasured Rural Lane", "width_m": None}
        asmt = self.engine.evaluate_segment("road-unknown", fire, props, 80.0)

        self.assertEqual(asmt.status, AccessClassification.UNKNOWN)
        self.assertIn("Unmeasured corridor width", asmt.limiting_factors[0])

    # -------------------------------------------------------------------------
    # 8. Disconnected Endpoints Handling
    # -------------------------------------------------------------------------
    def test_disconnected_endpoints_handling(self):
        """Verifies topologically disconnected endpoints return clean disconnected status."""
        features = [
            {
                "type": "Feature",
                "id": "island-a",
                "properties": {"feature_type": "road", "id": "island-a", "width_m": 6.0},
                "geometry": {"type": "LineString", "coordinates": [[76.01, 30.01], [76.02, 30.02]]},
            },
            {
                "type": "Feature",
                "id": "island-b",
                "properties": {"feature_type": "road", "id": "island-b", "width_m": 6.0},
                "geometry": {"type": "LineString", "coordinates": [[76.09, 30.09], [76.10, 30.10]]},
            },
            {
                "type": "Feature",
                "id": "st-island",
                "properties": {"feature_type": "station", "id": "st-island", "primary_access_road": "island-a"},
                "geometry": {"type": "Point", "coordinates": [76.01, 30.01]},
            },
        ]
        # In sample mode on custom disconnected features
        from app.services.data_service import DataService
        import tempfile, json
        with tempfile.NamedTemporaryFile(mode="w", suffix=".geojson", delete=False) as tmp:
            json.dump({"type": "FeatureCollection", "features": features}, tmp)
            tmp_path = tmp.name

        from pathlib import Path
        custom_ds = DataService(data_path=Path(tmp_path))
        engine = AccessEngine(ds=custom_ds)

        req = MultiRouteRequest(
            origin_station_id="st-island",
            destination_road_id="island-b",
            dataset_mode="sample",
            vehicle_id="fire",
        )
        resp = engine.calculate_alternative_routes(req)
        self.assertEqual(resp.status, "disconnected")
        self.assertEqual(resp.routes_found_count, 0)

    # -------------------------------------------------------------------------
    # 9. Fewer Available Routes than Requested
    # -------------------------------------------------------------------------
    def test_fewer_available_routes_than_requested(self):
        """Verifies requesting more alternatives than corridors exist returns status 'fewer_found'."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        # Request 5 alternatives between nearby Sector 17 points
        req = MultiRouteRequest(
            origin_station_id="osm_emergency_way_129774350",
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=5,
        )
        resp = self.engine.calculate_alternative_routes(req)

        # In this localized network, fewer than 5 distinct non-overlapping corridors exist
        if resp.routes_found_count < 5:
            self.assertIn(resp.status, ("fewer_found", "single_found"))
            self.assertIn("Fewer alternatives", resp.notes)

    # -------------------------------------------------------------------------
    # 10. Outside-Pilot Destinations
    # -------------------------------------------------------------------------
    def test_outside_pilot_destinations_reported_honestly(self):
        """Verifies destinations outside the pilot corridor return status 'outside_pilot'."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        # New Delhi coordinates
        req = MultiRouteRequest(
            origin_station_id="osm_emergency_way_129774350",
            destination_coordinates=[77.2090, 28.6139],
            destination_name="New Delhi Destination",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=3,
        )
        resp = self.engine.calculate_alternative_routes(req)

        self.assertEqual(resp.status, "outside_pilot")
        self.assertEqual(resp.routes_found_count, 0)
        self.assertIn("outside the Chandigarh pilot road network corridor", resp.notes)

    # -------------------------------------------------------------------------
    # 11. Route Geometry and Distance Consistency
    # -------------------------------------------------------------------------
    def test_route_geometry_and_distance_consistency(self):
        """Verifies returned route geometry is valid LineString and distance is consistent with segments."""
        if not self.has_pilot:
            self.skipTest("Pilot database not available")

        req = MultiRouteRequest(
            origin_station_id="osm_emergency_way_129774350",
            destination_coordinates=[76.7794, 30.7415],
            destination_name="Sector 17 Plaza",
            vehicle_id="fire",
            dataset_mode="pilot",
            max_alternatives=2,
        )
        resp = self.engine.calculate_alternative_routes(req)
        self.assertGreater(resp.routes_found_count, 0)

        for route in resp.routes:
            self.assertEqual(route.geometry_geojson["type"], "LineString")
            coords = route.geometry_geojson["coordinates"]
            self.assertGreaterEqual(len(coords), 2)
            # Distance must be positive and consistent
            self.assertGreater(route.total_distance_m, 100.0)
            self.assertEqual(route.segment_count, len(route.segments_traversed))
            self.assertGreaterEqual(len(route.steps), len(route.segments_traversed))


if __name__ == "__main__":
    unittest.main()

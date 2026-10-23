"""Unit tests for OpenStreetMap to UNREACHABLE GeoJSON converter using inline fixtures."""

import unittest
from scripts.osm_to_geojson import convert_osm_to_geojson


class TestOSMConverter(unittest.TestCase):
    """Test suite for osm_to_geojson converter without network access."""

    def setUp(self):
        # Base coordinates around lat 30.77, lon 76.57
        # 1 deg lat ~ 111139m -> 0.00001 deg lat ~ 1.11m
        self.fixture_data = {
            "elements": [
                # Way 1: Main road with shared junction at node 2
                {
                    "type": "way",
                    "id": 1001,
                    "nodes": [1, 2, 3],
                    "geometry": [
                        {"lat": 30.7700, "lon": 76.5700},
                        {"lat": 30.7700, "lon": 76.5710},
                        {"lat": 30.7700, "lon": 76.5720},
                    ],
                    "tags": {
                        "highway": "primary",
                        "name": "Main University Boulevard",
                        "lanes": "2",
                    },
                },
                # Way 2: Branch road connecting at node 2
                {
                    "type": "way",
                    "id": 1002,
                    "nodes": [2, 4],
                    "geometry": [
                        {"lat": 30.7700, "lon": 76.5710},
                        {"lat": 30.7710, "lon": 76.5710},
                    ],
                    "tags": {
                        "highway": "residential",
                        "name": "Hostel Access Lane",
                    },
                },
                # Way 3: Road with explicit width tag
                {
                    "type": "way",
                    "id": 1003,
                    "nodes": [10, 11],
                    "geometry": [
                        {"lat": 30.7720, "lon": 76.5700},
                        {"lat": 30.7720, "lon": 76.5710},
                    ],
                    "tags": {
                        "highway": "secondary",
                        "width": "4.8",
                    },
                },
                # Way 4: Road passing within 2m of a barrier
                {
                    "type": "way",
                    "id": 1004,
                    "nodes": [20, 21],
                    "geometry": [
                        {"lat": 30.7730, "lon": 76.5700},
                        {"lat": 30.7730, "lon": 76.5710},
                    ],
                    "tags": {
                        "highway": "service",
                    },
                },
                # Barrier node close to Way 4 (~1.5m away in latitude)
                {
                    "type": "node",
                    "id": 2001,
                    "lat": 30.773015,  # ~1.6m north of line y=30.7730
                    "lon": 76.5705,
                    "tags": {
                        "barrier": "gate",
                    },
                },
                # Power line crossing near Way 3 (~5m away)
                {
                    "type": "way",
                    "id": 3001,
                    "nodes": [30, 31],
                    "geometry": [
                        {"lat": 30.77195, "lon": 76.5705},
                        {"lat": 30.77205, "lon": 76.5705},
                    ],
                    "tags": {
                        "power": "line",
                        "voltage": "11000",
                    },
                },
                # Building
                {
                    "type": "way",
                    "id": 4001,
                    "nodes": [40, 41, 42, 40],
                    "geometry": [
                        {"lat": 30.7702, "lon": 76.5702},
                        {"lat": 30.7704, "lon": 76.5702},
                        {"lat": 30.7704, "lon": 76.5704},
                        {"lat": 30.7702, "lon": 76.5702},
                    ],
                    "tags": {
                        "building": "university",
                        "building:levels": "4",
                        "name": "Engineering Academic Block",
                    },
                },
                # Hospital / Emergency Station
                {
                    "type": "node",
                    "id": 5001,
                    "lat": 30.77005,
                    "lon": 76.57005,
                    "tags": {
                        "amenity": "hospital",
                        "name": "Campus Health Center",
                    },
                },
            ]
        }

    def test_shared_node_splitting(self):
        """Way 1001 should be split into 2 segments at node 2 because Way 1002 branches off it."""
        res = convert_osm_to_geojson(self.fixture_data)
        features = res["features"]

        road_ids = [f["id"] for f in features if f["properties"]["feature_type"] == "road"]
        self.assertIn("road-osm-1001-1", road_ids)
        self.assertIn("road-osm-1001-2", road_ids)
        self.assertIn("road-osm-1002", road_ids)

        # Check that the junction endpoint is shared between split segment 1 and segment 2
        seg1 = next(f for f in features if f["id"] == "road-osm-1001-1")
        seg2 = next(f for f in features if f["id"] == "road-osm-1001-2")
        branch = next(f for f in features if f["id"] == "road-osm-1002")

        # Endpoint of seg1 should match start of seg2 and start of branch
        self.assertEqual(seg1["geometry"]["coordinates"][-1], [76.5710, 30.7700])
        self.assertEqual(seg2["geometry"]["coordinates"][0], [76.5710, 30.7700])
        self.assertEqual(branch["geometry"]["coordinates"][0], [76.5710, 30.7700])

    def test_width_policy_rules(self):
        """Verify tagged vs estimated vs untagged null width policy."""
        res = convert_osm_to_geojson(self.fixture_data)
        features = res["features"]

        # Tagged width on Way 1003
        r1003 = next(f for f in features if f["id"] == "road-osm-1003")
        self.assertEqual(r1003["properties"]["width_m"], 4.8)
        self.assertEqual(r1003["properties"]["verification"], "osm_tagged")
        self.assertEqual(r1003["properties"]["verification_status"], "osm_tagged")

        # Untagged primary with lanes=2 on Way 1001
        r1001 = next(f for f in features if f["id"] == "road-osm-1001-1")
        self.assertEqual(r1001["properties"]["width_m"], 7.0)
        self.assertEqual(r1001["properties"]["verification"], "estimated_from_lanes")

        # Untagged residential on Way 1002
        r1002 = next(f for f in features if f["id"] == "road-osm-1002")
        self.assertIsNone(r1002["properties"]["width_m"])
        self.assertEqual(r1002["properties"]["verification"], "unverified")

    def test_barrier_proximity_obstruction(self):
        """Barrier within 3m must set obstruction on road segment."""
        res = convert_osm_to_geojson(self.fixture_data)
        features = res["features"]

        r1004 = next(f for f in features if f["id"] == "road-osm-1004")
        self.assertIsNotNone(r1004["properties"]["obstruction"])
        self.assertIn("gate", r1004["properties"]["obstruction"])
        self.assertEqual(r1004["properties"]["access_status"], "infeasible")

    def test_power_line_notes_and_no_obstruction(self):
        """Power lines must add 'possible_overhead_wire' note but NEVER set an obstruction."""
        res = convert_osm_to_geojson(self.fixture_data)
        features = res["features"]

        r1003 = next(f for f in features if f["id"] == "road-osm-1003")
        self.assertIsNone(r1003["properties"]["obstruction"])
        self.assertIsNotNone(r1003["properties"]["notes"])
        self.assertIn("possible_overhead_wire", r1003["properties"]["notes"])

    def test_building_and_station_standard_properties(self):
        """Verify building and station ID format, data_source, and verification properties."""
        res = convert_osm_to_geojson(self.fixture_data)
        features = res["features"]

        # Building
        bldg = next(f for f in features if f["id"] == "bldg-osm-4001")
        self.assertEqual(bldg["properties"]["feature_type"], "building")
        self.assertEqual(bldg["properties"]["floors"], 4)
        self.assertEqual(bldg["properties"]["data_source"], "OpenStreetMap")
        self.assertEqual(bldg["properties"]["verification"], "unverified")
        self.assertIsNotNone(bldg["properties"]["connected_road_id"])

        # Station
        st = next(f for f in features if f["id"] == "station-osm-5001")
        self.assertEqual(st["properties"]["feature_type"], "station")
        self.assertEqual(st["properties"]["data_source"], "OpenStreetMap")
        self.assertEqual(st["properties"]["verification"], "reference_fixture")
        self.assertIsNotNone(st["properties"]["primary_access_road"])


if __name__ == "__main__":
    unittest.main()

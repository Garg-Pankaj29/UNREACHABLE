"""Tests for Phase 1: Real Geographic Data Foundation.

Validates that:
1. Extraction parsing functions (width parsing, distance calculation) work correctly.
2. Missing road widths remain explicitly None/NULL (no fabricated measurements).
3. Exported GeoJSON properties use neutral ("unclassified") access status.
4. Pilot SQLite database contains normalized tables with proper schema when present.
5. Topological road connectivity is preserved for routing.
6. Emergency facilities preserve source facility types and unverified status.
7. Synthetic demonstration data remains intact and distinguishable.
"""

import json
import sqlite3
import unittest
from pathlib import Path

# Add backend directory to path if needed
import sys
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from scripts.extract_pilot_data import haversine_distance_m, parse_float_width, parse_int_lanes

SAMPLE_GEOJSON_PATH = REPO_ROOT / "data" / "sample" / "neighbourhood.geojson"
PILOT_DB_PATH = REPO_ROOT / "data" / "pilot" / "chandigarh_pilot.sqlite"
PILOT_GEOJSON_PATH = REPO_ROOT / "data" / "pilot" / "chandigarh_pilot_features.geojson"


class TestGeographicDataFoundation(unittest.TestCase):
    """Test suite for Phase 1 geographic data pipeline and storage."""

    def test_sample_synthetic_data_preserved(self):
        """Ensure original synthetic demonstration dataset was not modified or overwritten."""
        self.assertTrue(SAMPLE_GEOJSON_PATH.exists(), "Sample neighbourhood.geojson must exist")
        with open(SAMPLE_GEOJSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("type"), "FeatureCollection")
        self.assertIn("metadata", data)
        self.assertIn("Synthetic Demonstration Area", data["metadata"]["name"])
        features = data.get("features", [])
        self.assertEqual(len(features), 13, "Synthetic demo feature count must remain 13")

        # Verify synthetic labels
        station = next((f for f in features if f["id"] == "station-01"), None)
        self.assertIsNotNone(station)
        self.assertEqual(station["properties"]["data_source"], "Synthetic Prototype Model")

    def test_scripts_exist(self):
        """Verify reproducible pipeline scripts exist in backend/scripts."""
        scripts_dir = REPO_ROOT / "backend" / "scripts"
        self.assertTrue((scripts_dir / "download_osm_extract.py").exists())
        self.assertTrue((scripts_dir / "extract_pilot_data.py").exists())
        self.assertTrue((scripts_dir / "validate_pilot_data.py").exists())

    def test_parse_float_width_preserves_none(self):
        """Verify missing or invalid road widths strictly return None (never fabricated defaults)."""
        self.assertIsNone(parse_float_width(None))
        self.assertIsNone(parse_float_width(""))
        self.assertIsNone(parse_float_width("unknown"))
        self.assertIsNone(parse_float_width("unsurveyed"))
        self.assertIsNone(parse_float_width("-1"))
        self.assertIsNone(parse_float_width("0.1"))  # Below reasonable carriageway threshold
        self.assertIsNone(parse_float_width("150"))  # Above reasonable carriageway threshold

        # Valid width strings should be parsed accurately
        self.assertEqual(parse_float_width("3.5"), 3.5)
        self.assertEqual(parse_float_width("7.0 m"), 7.0)
        self.assertEqual(parse_float_width("5.2 meters"), 5.2)
        self.assertEqual(parse_float_width("4;5"), 4.0)
        self.assertEqual(parse_float_width("6.0-7.5"), 6.0)

    def test_parse_int_lanes(self):
        """Verify lane counts parse valid integers or return None."""
        self.assertIsNone(parse_int_lanes(None))
        self.assertIsNone(parse_int_lanes(""))
        self.assertIsNone(parse_int_lanes("unknown"))
        self.assertEqual(parse_int_lanes("2"), 2)
        self.assertEqual(parse_int_lanes("4;2"), 4)

    def test_haversine_distance(self):
        """Verify distance computation is physically plausible."""
        # 1 degree of latitude is approx 111.13 km
        dist = haversine_distance_m(0.0, 0.0, 0.0, 1.0)
        self.assertAlmostEqual(dist, 111195.0, delta=200.0)

        # Zero distance
        self.assertEqual(haversine_distance_m(76.57, 30.76, 76.57, 30.76), 0.0)

    def test_pilot_database_if_present(self):
        """If pilot database has been extracted, verify schema, topology, and non-fabrication."""
        if not PILOT_DB_PATH.exists():
            self.skipTest(f"Pilot DB {PILOT_DB_PATH} not yet extracted. Skipping DB-dependent assertions.")

        conn = sqlite3.connect(PILOT_DB_PATH)
        cur = conn.cursor()

        # 1. PRAGMA integrity_check
        cur.execute("PRAGMA integrity_check;")
        self.assertEqual(cur.fetchall(), [("ok",)], "Database integrity check must return ok")

        # 2. Check all required tables exist
        tables = {"roads", "intersections", "buildings", "emergency_facilities", "places", "dataset_metadata"}
        cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
        existing_tables = {row[0] for row in cur.fetchall()}
        self.assertTrue(tables.issubset(existing_tables), f"Missing tables: {tables - existing_tables}")

        # 3. Check road counts and topology
        cur.execute("SELECT COUNT(*) FROM roads;")
        road_count = cur.fetchone()[0]
        self.assertGreater(road_count, 0, "Roads table must not be empty")

        cur.execute("SELECT COUNT(*) FROM intersections WHERE degree >= 2;")
        connected_junctions = cur.fetchone()[0]
        self.assertGreater(connected_junctions, 0, "Road network must contain topological intersections")

        # 4. Non-fabrication of missing widths: verify NULL widths exist and are preserved
        cur.execute("SELECT COUNT(*) FROM roads WHERE width_m IS NULL;")
        null_widths = cur.fetchone()[0]
        self.assertGreater(null_widths, 0, "Real OSM road extracts have unmeasured widths; must not fabricate defaults")

        # 5. Check emergency facilities
        cur.execute("SELECT COUNT(*) FROM emergency_facilities;")
        fac_count = cur.fetchone()[0]
        self.assertGreater(fac_count, 0, "Emergency facilities table must not be empty")

        cur.execute("SELECT DISTINCT verification_status FROM emergency_facilities;")
        statuses = [r[0] for r in cur.fetchall()]
        self.assertEqual(statuses, ["unverified_osm"], "Imported facilities must be explicitly unverified")

        valid_types = {"hospital", "fire_station", "clinic", "doctors", "ambulance_station"}
        cur.execute("SELECT DISTINCT facility_type FROM emergency_facilities;")
        found_types = {r[0] for r in cur.fetchall()}
        self.assertTrue(found_types.issubset(valid_types), f"Unexpected facility types: {found_types - valid_types}")

        # 6. Check metadata
        cur.execute("SELECT key, value FROM dataset_metadata;")
        meta = dict(cur.fetchall())
        self.assertIn("licence", meta)
        self.assertIn("attribution", meta)
        self.assertIn("ODbL", meta["licence"])
        self.assertIn("OpenStreetMap", meta["attribution"])

        conn.close()

    def test_pilot_geojson_if_present(self):
        """If pilot GeoJSON has been generated, verify syntax, neutral status, and metadata."""
        if not PILOT_GEOJSON_PATH.exists():
            self.skipTest(f"Pilot GeoJSON {PILOT_GEOJSON_PATH} not yet generated. Skipping.")

        with open(PILOT_GEOJSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("type"), "FeatureCollection")
        self.assertIn("metadata", data)
        self.assertIn("OpenStreetMap", data["metadata"]["attribution"])
        features = data.get("features", [])
        self.assertGreater(len(features), 0)

        # Verify exported access status is neutral "unclassified", NOT prematurely deciding "ok"
        for f in features[:50]:
            status = f.get("properties", {}).get("access_status")
            self.assertNotIn(status, ("ok", "infeasible"),
                             "Raw imported OSM features must not carry premature ok/infeasible classifications")

    def test_pilot_service_querying(self):
        """Verify PilotService queries SQLite without loading whole file and returns valid GeoJSON."""
        from app.services.pilot_service import pilot_data_service

        if not pilot_data_service.is_available():
            self.skipTest("Pilot SQLite database not available")

        # 1. Summary
        summary = pilot_data_service.get_summary()
        self.assertTrue(summary.get("available"))
        self.assertEqual(summary["counts"]["roads"], 41373)
        self.assertEqual(summary["counts"]["buildings"], 41013)
        self.assertGreaterEqual(summary["counts"]["emergency_facilities"], 422)

        # 2. Facilities
        facs = pilot_data_service.get_emergency_facilities()
        self.assertGreaterEqual(len(facs), 422)
        for f in facs[:10]:
            self.assertEqual(f["type"], "Feature")
            self.assertIn("facility_type", f["properties"])
            self.assertEqual(f["properties"]["verification_status"], "unverified_osm")
            self.assertEqual(f["geometry"]["type"], "Point")

        # 3. Low-zoom Level-of-Detail (major roads only, fast)
        low_zoom_features = pilot_data_service.get_features(zoom=12)
        self.assertEqual(low_zoom_features["type"], "FeatureCollection")
        self.assertGreater(len(low_zoom_features["features"]), 0)
        # Should not include all 41,000 buildings at low zoom
        building_count = sum(1 for f in low_zoom_features["features"] if f["properties"].get("feature_type") == "building")
        self.assertEqual(building_count, 0, "Low zoom must not load buildings")

        # 4. High-zoom with bbox
        bbox = (76.76, 30.73, 76.79, 30.75)
        high_zoom_features = pilot_data_service.get_features(bbox=bbox, zoom=15)
        self.assertEqual(high_zoom_features["type"], "FeatureCollection")
        self.assertGreater(len(high_zoom_features["features"]), 0)

        # 5. Search
        search_res = pilot_data_service.search(query="Fortis", limit=5)
        self.assertGreater(len(search_res), 0)
        self.assertEqual(search_res[0]["feature_type"], "facility")
        self.assertIn("Fortis", search_res[0]["name"])
        self.assertEqual(search_res[0]["verification_status"], "unverified_osm")

    def test_pilot_api_routes(self):
        """Verify the pilot endpoints return expected structures and data without memory explosion."""
        from app.api.routes import get_pilot_summary, get_pilot_facilities, get_pilot_features, search_pilot_features

        # Summary endpoint
        summary = get_pilot_summary()
        self.assertTrue(summary.get("available"))
        self.assertIn("facility_breakdown", summary)
        self.assertGreaterEqual(summary["counts"]["emergency_facilities"], 422)

        # Facilities endpoint
        fac_resp = get_pilot_facilities()
        self.assertEqual(fac_resp.type, "FeatureCollection")
        self.assertGreaterEqual(len(fac_resp.features), 422)

        # Features endpoint with LOD parameters
        feat_resp = get_pilot_features(bbox="76.76,30.73,76.79,30.75", zoom=15)
        self.assertEqual(feat_resp.type, "FeatureCollection")
        self.assertGreater(len(feat_resp.features), 0)

        # Search endpoint
        search_resp = search_pilot_features(q="Jan Marg", include_online=False)
        self.assertEqual(search_resp.query, "Jan Marg")
        self.assertGreater(search_resp.count, 0)
        self.assertEqual(search_resp.results[0].feature_type, "road")
        self.assertEqual(search_resp.results[0].source, "local_pilot")
        self.assertTrue(search_resp.results[0].inside_pilot_area)

    def test_geocoding_service_pilot_boundary_and_offline(self):
        """Verify boundary classification and graceful offline fallback in GeocodingService."""
        from app.services.geocoding_service import is_in_pilot_corridor, geocoding_service

        # Sector 17, Chandigarh (inside pilot bounds)
        self.assertTrue(is_in_pilot_corridor(76.782589, 30.740065))
        # Amritsar (outside pilot bounds)
        self.assertFalse(is_in_pilot_corridor(74.878716, 31.624201))
        # New Delhi (outside pilot bounds)
        self.assertFalse(is_in_pilot_corridor(77.2090, 28.6139))

        # Graceful handling of empty or blank queries
        res, ok = geocoding_service.geocode("")
        self.assertEqual(res, [])
        self.assertTrue(ok)

    def test_universal_search_with_geocoding_provider(self):
        """Verify universal location search combining local and online geocoder results."""
        from unittest.mock import patch
        from app.api.routes import search_pilot_features

        # Mock geocoder return for a landmark outside pilot bounds
        mock_online_item = {
            "id": "osm-node-123456",
            "name": "Golden Temple, Amritsar",
            "feature_type": "place",
            "sub_type": "attraction",
            "details": "Amritsar, Punjab, India",
            "coordinates": [74.8765, 31.6200],
            "geometry": {"type": "Point", "coordinates": [74.8765, 31.6200]},
            "source": "online_osm",
            "inside_pilot_area": False,
            "coverage_notice": "Outside pilot dataset",
            "verification_status": "unverified_osm",
        }

        with patch("app.api.routes.geocoding_service.geocode") as mock_geocode:
            mock_geocode.return_value = ([mock_online_item], True)
            resp = search_pilot_features(q="Golden Temple", limit=10, include_online=True)

            self.assertEqual(resp.query, "Golden Temple")
            self.assertTrue(resp.online_available)
            self.assertGreater(resp.online_count, 0)
            self.assertEqual(resp.results[0].name, "Golden Temple, Amritsar")
            self.assertFalse(resp.results[0].inside_pilot_area)
            self.assertEqual(resp.results[0].source, "online_osm")

        # Test offline fallback (geocode returns [], False)
        with patch("app.api.routes.geocoding_service.geocode") as mock_geocode_offline:
            mock_geocode_offline.return_value = ([], False)
            resp_offline = search_pilot_features(q="Unknown Location", limit=10, include_online=True)
            self.assertFalse(resp_offline.online_available)
            self.assertEqual(resp_offline.online_count, 0)
            self.assertEqual(resp_offline.count, 0)



if __name__ == "__main__":
    unittest.main()

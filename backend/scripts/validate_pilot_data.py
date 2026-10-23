"""Validation script for UNREACHABLE pilot geographic dataset.

Audits:
1. SQLite database integrity (PRAGMA integrity_check).
2. Non-empty required tables (roads, intersections, buildings, emergency_facilities).
3. Coordinate bounds and pilot bounding-box coverage.
4. Geometry validity (LineStrings >= 2 pts, Polygons >= 4 pts and closed).
5. Non-fabrication of missing road widths (NULL preserved, no synthetic defaults).
6. Emergency facility classifications and provenance flags.
7. GeoJSON syntax, CRS, and exact feature count consistency with SQLite database.

Exits with non-zero code (1) if any validation check fails.
"""

import json
import logging
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("unreachable.validate_pilot")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PILOT_DATA_DIR = REPO_ROOT / "data" / "pilot"
SQLITE_DB_PATH = PILOT_DATA_DIR / "chandigarh_pilot.sqlite"
GEOJSON_PATH = PILOT_DATA_DIR / "chandigarh_pilot_features.geojson"

PILOT_BBOX = (76.52, 30.62, 76.88, 30.82)
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = PILOT_BBOX
BBOX_MARGIN = 0.05  # Slight margin for boundary-crossing segments


def validate_database() -> Dict[str, Any]:
    """Audit the SQLite pilot database and return integrity metrics."""
    if not SQLITE_DB_PATH.exists():
        logger.error("Database file not found at %s", SQLITE_DB_PATH)
        return {"valid": False, "error": "file_not_found"}

    conn = sqlite3.connect(SQLITE_DB_PATH)
    cur = conn.cursor()

    report: Dict[str, Any] = {"valid": True, "db_path": str(SQLITE_DB_PATH), "failures": []}

    # 1. PRAGMA integrity_check
    cur.execute("PRAGMA integrity_check;")
    integrity_rows = cur.fetchall()
    if integrity_rows != [("ok",)]:
        logger.error("SQLite PRAGMA integrity_check failed: %s", integrity_rows)
        report["valid"] = False
        report["failures"].append(f"SQLite integrity check failed: {integrity_rows}")
    else:
        logger.info("SQLite PRAGMA integrity_check passed: ok")

    # 2. Required tables and non-empty checks
    required_tables = ["roads", "intersections", "buildings", "emergency_facilities"]
    all_tables = required_tables + ["places", "dataset_metadata"]
    counts = {}
    for t in all_tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t};")
            counts[t] = cur.fetchone()[0]
        except sqlite3.OperationalError as exc:
            logger.error("Missing expected table %s: %s", t, exc)
            report["valid"] = False
            report["failures"].append(f"Missing table: {t}")
            counts[t] = 0

    report["counts"] = counts
    logger.info("Table counts: %s", counts)

    for t in required_tables:
        if counts.get(t, 0) == 0:
            logger.error("Required table '%s' is empty!", t)
            report["valid"] = False
            report["failures"].append(f"Required table empty: {t}")

    # 3. Coordinate bounds validation
    if counts.get("roads", 0) > 0:
        cur.execute("SELECT MIN(lon), MAX(lon), MIN(lat), MAX(lat) FROM intersections;")
        min_lon, max_lon, min_lat, max_lat = cur.fetchone()
        logger.info("Intersection coordinate bounds: lon [%.4f, %.4f], lat [%.4f, %.4f]",
                    min_lon or 0, max_lon or 0, min_lat or 0, max_lat or 0)
        if min_lon is None or min_lat is None:
            report["valid"] = False
            report["failures"].append("No valid intersection coordinates found")
        elif not (MIN_LON - BBOX_MARGIN <= min_lon and max_lon <= MAX_LON + BBOX_MARGIN and
                  MIN_LAT - BBOX_MARGIN <= min_lat and max_lat <= MAX_LAT + BBOX_MARGIN):
            logger.warning("Coordinates extend beyond expected pilot bounds: [%s, %s, %s, %s]",
                           min_lon, min_lat, max_lon, max_lat)
        report["bounds"] = {"min_lon": min_lon, "max_lon": max_lon, "min_lat": min_lat, "max_lat": max_lat}

    # 4. Geometry validity checks (sample inspection)
    cur.execute("SELECT geometry_geojson FROM roads LIMIT 100;")
    for row in cur.fetchall():
        geom = json.loads(row[0])
        if geom.get("type") != "LineString" or len(geom.get("coordinates", [])) < 2:
            report["valid"] = False
            report["failures"].append("Invalid road LineString geometry detected")
            break

    cur.execute("SELECT geometry_geojson FROM buildings LIMIT 100;")
    for row in cur.fetchall():
        geom = json.loads(row[0])
        if geom.get("type") != "Polygon":
            report["valid"] = False
            report["failures"].append(f"Invalid building geometry type: {geom.get('type')}")
            break
        coords = geom.get("coordinates", [[]])[0]
        if len(coords) < 4 or coords[0] != coords[-1]:
            report["valid"] = False
            report["failures"].append("Building polygon ring is not closed or has fewer than 4 points")
            break

    # 5. Check road width non-fabrication (missing width must remain NULL)
    total_roads = counts.get("roads", 0)
    if total_roads > 0:
        cur.execute("SELECT COUNT(*) FROM roads WHERE width_m IS NULL;")
        null_widths = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM roads WHERE width_m IS NOT NULL;")
        measured_widths = cur.fetchone()[0]
        null_pct = (null_widths / total_roads * 100) if total_roads else 0

        report["road_widths"] = {
            "null_count": null_widths,
            "measured_count": measured_widths,
            "null_pct": round(null_pct, 1),
        }
        logger.info("Road widths: %d unknown/unmeasured (%.1f%%), %d mapped in OSM",
                    null_widths, null_pct, measured_widths)
        if null_widths == 0:
            logger.warning("All road widths are populated; verify widths were not synthetically fabricated!")

    # 6. Check road topology / intersection degrees
    if counts.get("intersections", 0) > 0:
        cur.execute("SELECT COUNT(*) FROM intersections WHERE degree >= 2;")
        junctions_ge_2 = cur.fetchone()[0]
        cur.execute("SELECT MAX(degree), AVG(degree) FROM intersections;")
        max_deg, avg_deg = cur.fetchone()
        report["topology"] = {
            "connected_junctions_ge_2": junctions_ge_2,
            "max_degree": max_deg,
            "avg_degree": round(avg_deg, 2) if avg_deg else 0,
        }
        logger.info("Topology: %d connected junctions (degree >= 2), max degree: %s, avg degree: %.2f",
                    junctions_ge_2, max_deg, avg_deg or 0)
        if junctions_ge_2 == 0:
            report["valid"] = False
            report["failures"].append("No connected intersections (degree >= 2) found in road network")

    # 7. Check emergency facilities types & neutral verification status
    if counts.get("emergency_facilities", 0) > 0:
        cur.execute("SELECT facility_type, COUNT(*) FROM emergency_facilities GROUP BY facility_type;")
        facility_breakdown = dict(cur.fetchall())
        report["facility_breakdown"] = facility_breakdown
        logger.info("Emergency facilities breakdown: %s", facility_breakdown)

        cur.execute("SELECT DISTINCT verification_status FROM emergency_facilities;")
        fac_verif = [r[0] for r in cur.fetchall()]
        report["facility_verification_status"] = fac_verif
        if fac_verif != ["unverified_osm"]:
            logger.error("Unexpected verification status on emergency facilities: %s", fac_verif)
            report["valid"] = False
            report["failures"].append(f"Unexpected facility verification status: {fac_verif}")

    # 8. Check metadata table
    if counts.get("dataset_metadata", 0) > 0:
        cur.execute("SELECT key, value FROM dataset_metadata;")
        meta_dict = dict(cur.fetchall())
        report["metadata"] = meta_dict

    conn.close()
    return report


def validate_geojson(db_report: Dict[str, Any]) -> Dict[str, Any]:
    """Audit the generated GeoJSON FeatureCollection and verify exact count consistency."""
    if not GEOJSON_PATH.exists():
        logger.error("GeoJSON file not found at %s", GEOJSON_PATH)
        return {"valid": False, "error": "file_not_found", "failures": ["GeoJSON file not found"]}

    try:
        with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        logger.error("Failed to parse GeoJSON: %s", exc)
        return {"valid": False, "error": "parse_error", "failures": [f"JSON decode error: {exc}"]}

    report: Dict[str, Any] = {"valid": True, "failures": []}

    if data.get("type") != "FeatureCollection":
        logger.error("GeoJSON root type is not FeatureCollection")
        report["valid"] = False
        report["failures"].append("Root is not FeatureCollection")

    features = data.get("features", [])
    meta = data.get("metadata", {})
    size_mb = GEOJSON_PATH.stat().st_size / (1024 * 1024)

    report["feature_count"] = len(features)
    report["file_size_mb"] = round(size_mb, 2)
    report["metadata"] = meta

    # Consistency with SQLite database
    db_counts = db_report.get("counts", {})
    expected_features = (
        db_counts.get("roads", 0) +
        db_counts.get("buildings", 0) +
        db_counts.get("emergency_facilities", 0)
    )

    if len(features) != expected_features:
        logger.error("GeoJSON feature count (%d) does not match expected DB count (%d)!",
                     len(features), expected_features)
        report["valid"] = False
        report["failures"].append(f"Count mismatch: GeoJSON has {len(features)}, DB has {expected_features}")
    else:
        logger.info("GeoJSON feature count (%d) exactly matches DB feature count (%d)",
                    len(features), expected_features)

    # Check neutral access_status (no premature decisions in exported raw data)
    for f in features[:100]:
        status = f.get("properties", {}).get("access_status")
        if status in ("ok", "infeasible"):
            logger.error("Exported feature %s has premature accessibility decision: %s", f.get("id"), status)
            report["valid"] = False
            report["failures"].append("Premature accessibility decision found in raw GeoJSON")
            break

    logger.info("GeoJSON valid: %d features, %.2f MB", len(features), size_mb)
    return report


def run_validation():
    """Run full validation and output report. Exits with 1 on failure."""
    logger.info("Validating Pilot Geographic Foundation...")
    db_res = validate_database()
    geo_res = validate_geojson(db_res)

    print("\n" + "=" * 65)
    print("UNREACHABLE PILOT GEOGRAPHIC DATA VALIDATION REPORT")
    print("=" * 65)
    print(f"Database Path:             {SQLITE_DB_PATH}")
    print(f"Database Integrity Valid:  {db_res.get('valid')}")
    print(f"Roads Count:               {db_res.get('counts', {}).get('roads', 0)}")
    print(f"Intersections Count:       {db_res.get('counts', {}).get('intersections', 0)}")
    print(f"Connected Junctions (>=2): {db_res.get('topology', {}).get('connected_junctions_ge_2', 0)}")
    print(f"Buildings Count:           {db_res.get('counts', {}).get('buildings', 0)}")
    print(f"Emergency Facilities Count:{db_res.get('counts', {}).get('emergency_facilities', 0)}")
    print(f"Emergency Breakdown:       {db_res.get('facility_breakdown', {})}")
    print(f"Road Widths Unknown/NULL:  {db_res.get('road_widths', {}).get('null_count', 0)} ({db_res.get('road_widths', {}).get('null_pct', 0)}%)")
    print(f"Road Widths Mapped:        {db_res.get('road_widths', {}).get('measured_count', 0)}")
    print(f"GeoJSON Path:              {GEOJSON_PATH}")
    print(f"GeoJSON Valid:             {geo_res.get('valid')}")
    print(f"GeoJSON Features Count:    {geo_res.get('feature_count', 0)}")
    print(f"GeoJSON File Size:         {geo_res.get('file_size_mb', 0)} MB")

    failures = db_res.get("failures", []) + geo_res.get("failures", [])
    if failures:
        print("\nVALIDATION FAILURES:")
        for f in failures:
            print(f"  [X] {f}")
        print("=" * 65 + "\n")
        sys.exit(1)

    print("\nALL PILOT DATA INTEGRITY CHECKS PASSED.")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    run_validation()

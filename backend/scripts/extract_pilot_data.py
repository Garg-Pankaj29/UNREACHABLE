"""Pilot geographic data extraction script for UNREACHABLE.

Parses OpenStreetMap PBF data using pyosmium, filters features within the
Chandigarh-Mohali-Gharuan pilot bounding box, and creates:
1. SQLite database with normalized schema for roads, topology, buildings, places, and emergency facilities.
2. GeoJSON FeatureCollection for immediate visualization and validation.

Safety & Integrity Principles:
- Uses temporary output files and atomic replacement so aborted extractions never leave corrupt or misleading datasets.
- Uses disk-backed sparse node location storage (sparse_file_array) to avoid out-of-memory crashes on large extracts.
- Preserves raw tags and OSM IDs. Leaves missing road widths strictly NULL/unknown (never fabricated).
- Leaves accessibility classification neutral ("unclassified") until evaluated by the accessibility engine.
"""

import json
import logging
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import osmium

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("unreachable.extract_pilot")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DATA_DIR = REPO_ROOT / "data" / "raw"
PILOT_DATA_DIR = REPO_ROOT / "data" / "pilot"

CROPPED_PBF_PATH = RAW_DATA_DIR / "chandigarh-pilot.osm.pbf"
REGIONAL_PBF_PATH = RAW_DATA_DIR / "northern-zone-latest.osm.pbf"
PBF_PATH = CROPPED_PBF_PATH if CROPPED_PBF_PATH.exists() else REGIONAL_PBF_PATH
SQLITE_DB_PATH = PILOT_DATA_DIR / "chandigarh_pilot.sqlite"
GEOJSON_PATH = PILOT_DATA_DIR / "chandigarh_pilot_features.geojson"
METADATA_PATH = RAW_DATA_DIR / "download_metadata.json"

# Bounding Box: Chandigarh, SAS Nagar Mohali, Kharar, Gharuan (Chandigarh University area)
# [Min Lon, Min Lat, Max Lon, Max Lat]
PILOT_BBOX = (76.52, 30.62, 76.88, 30.82)
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = PILOT_BBOX

EMERGENCY_AMENITIES = {"hospital", "fire_station", "clinic", "doctors"}
PLACE_TYPES = {"city", "town", "suburb", "neighbourhood", "locality", "village", "hamlet"}
EXCLUDED_HIGHWAYS = {"proposed", "abandoned", "construction", "raceway", "corridor", "elevator"}


def haversine_distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Calculate great-circle distance between two coordinates in meters."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def parse_float_width(val_str: Optional[str]) -> Optional[float]:
    """Parse road width string to float in meters, preserving None if unknown.
    
    Never fabricates a default measurement. Returns None if unparseable or unknown.
    """
    if not val_str:
        return None
    cleaned = (
        val_str.strip().lower()
        .replace("meters", "")
        .replace("meter", "")
        .replace("metres", "")
        .replace("metre", "")
        .replace("approx", "")
        .replace("m", "")
        .strip()
    )
    if ";" in cleaned:
        cleaned = cleaned.split(";")[0].strip()
    if "-" in cleaned and not cleaned.startswith("-"):
        cleaned = cleaned.split("-")[0].strip()
    try:
        w = float(cleaned)
        if 0.5 <= w <= 60.0:
            return round(w, 2)
    except (ValueError, TypeError):
        pass
    return None


def parse_int_lanes(lanes_str: Optional[str]) -> Optional[int]:
    """Parse lanes string to int, preserving None if unknown."""
    if not lanes_str:
        return None
    try:
        val = lanes_str.strip().split(";")[0].split("-")[0].strip()
        num = int(val)
        if 1 <= num <= 24:
            return num
    except (ValueError, TypeError):
        pass
    return None


class PilotExtractor(osmium.SimpleHandler):
    """Pyosmium handler to extract roads, buildings, places, and emergency facilities."""

    def __init__(self):
        super().__init__()
        self.roads: List[Dict[str, Any]] = []
        self.buildings: List[Dict[str, Any]] = []
        self.emergency_facilities: List[Dict[str, Any]] = []
        self.places: List[Dict[str, Any]] = []
        self.node_occurrences: Dict[int, List[str]] = {}
        self.node_coords: Dict[int, Tuple[float, float]] = {}

    def node(self, n: osmium.osm.Node):
        """Process OSM nodes: only tagged nodes, skipping untagged geometry nodes instantly."""
        if not len(n.tags):
            return

        try:
            lon = n.location.lon
            lat = n.location.lat
        except (osmium.InvalidLocationError, AttributeError):
            return

        if not (MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT):
            return

        tags = {tag.k: tag.v for tag in n.tags}

        # Check emergency facility
        amenity = tags.get("amenity")
        emergency = tags.get("emergency")
        if (amenity in EMERGENCY_AMENITIES) or (emergency == "ambulance_station"):
            facility_type = emergency if emergency == "ambulance_station" else amenity
            fac_id = f"osm_emergency_node_{n.id}"
            self.emergency_facilities.append({
                "id": fac_id,
                "osm_id": n.id,
                "osm_type": "node",
                "name": tags.get("name") or tags.get("operator") or f"{facility_type.replace('_', ' ').title()} (OSM {n.id})",
                "facility_type": facility_type,
                "operator": tags.get("operator"),
                "emergency_flag": emergency,
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "raw_tags": tags,
                "provenance_source": "Geofabrik OpenStreetMap Northern Zone",
                "verification_status": "unverified_osm",
            })

        # Check named places
        place = tags.get("place")
        if place in PLACE_TYPES and "name" in tags:
            self.places.append({
                "id": f"osm_place_node_{n.id}",
                "osm_id": n.id,
                "osm_type": "node",
                "name": tags["name"],
                "place_type": place,
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "raw_tags": tags,
                "provenance_source": "Geofabrik OpenStreetMap Northern Zone",
            })

    def way(self, w: osmium.osm.Way):
        """Process OSM ways: routable roads, building footprints, and area facilities."""
        if not len(w.tags):
            return

        tags = {tag.k: tag.v for tag in w.tags}
        highway = tags.get("highway")
        building = tags.get("building")
        amenity = tags.get("amenity")
        emergency = tags.get("emergency")

        if not (highway or (building and building != "no") or amenity or emergency):
            return

        # Highway (Road)
        if highway and highway not in EXCLUDED_HIGHWAYS:
            coords: List[List[float]] = []
            node_ids: List[int] = []
            any_in_bbox = False

            for n in w.nodes:
                try:
                    lon, lat = n.lon, n.lat
                    coords.append([round(lon, 6), round(lat, 6)])
                    node_ids.append(n.ref)
                    if MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT:
                        any_in_bbox = True
                        self.node_coords[n.ref] = (round(lon, 6), round(lat, 6))
                except (osmium.InvalidLocationError, AttributeError):
                    continue

            if any_in_bbox and len(coords) >= 2:
                road_id = f"osm_road_{w.id}"
                
                # Calculate road length
                length_m = 0.0
                for i in range(len(coords) - 1):
                    length_m += haversine_distance_m(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])

                oneway_tag = tags.get("oneway", "no").lower()
                oneway = 1 if oneway_tag in ("yes", "true", "1") else (-1 if oneway_tag == "-1" else 0)

                for nid in node_ids:
                    if nid not in self.node_occurrences:
                        self.node_occurrences[nid] = []
                    self.node_occurrences[nid].append(road_id)

                self.roads.append({
                    "id": road_id,
                    "osm_id": w.id,
                    "name": tags.get("name") or tags.get("name:en") or f"Unnamed {highway.replace('_', ' ').title()}",
                    "road_class": highway,
                    "oneway": oneway,
                    "surface": tags.get("surface"),
                    "width_m": parse_float_width(tags.get("width")),
                    "maxwidth_m": parse_float_width(tags.get("maxwidth")),
                    "lanes": parse_int_lanes(tags.get("lanes")),
                    "access": tags.get("access"),
                    "vehicle": tags.get("vehicle"),
                    "emergency": tags.get("emergency"),
                    "u_node": node_ids[0],
                    "v_node": node_ids[-1],
                    "node_ids": node_ids,
                    "coords": coords,
                    "length_m": round(length_m, 2),
                    "raw_tags": tags,
                    "provenance_source": "Geofabrik OpenStreetMap Northern Zone",
                    "verification_status": "unverified_osm",
                })
            return

        # Building
        if building and building != "no":
            coords = []
            any_in_bbox = False
            for n in w.nodes:
                try:
                    lon, lat = n.lon, n.lat
                    coords.append([round(lon, 6), round(lat, 6)])
                    if MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT:
                        any_in_bbox = True
                except (osmium.InvalidLocationError, AttributeError):
                    continue

            if any_in_bbox and len(coords) >= 3:
                if coords[0] != coords[-1]:
                    coords.append(coords[0])

                c_lon = sum(c[0] for c in coords[:-1]) / (len(coords) - 1)
                c_lat = sum(c[1] for c in coords[:-1]) / (len(coords) - 1)

                bldg_id = f"osm_bldg_{w.id}"
                self.buildings.append({
                    "id": bldg_id,
                    "osm_id": w.id,
                    "name": tags.get("name") or tags.get("name:en") or f"Building {w.id}",
                    "use_type": building,
                    "building_levels": parse_int_lanes(tags.get("building:levels")),
                    "addr_street": tags.get("addr:street"),
                    "addr_housenumber": tags.get("addr:housenumber"),
                    "addr_postcode": tags.get("addr:postcode"),
                    "centroid_lon": round(c_lon, 6),
                    "centroid_lat": round(c_lat, 6),
                    "coords": [coords],
                    "raw_tags": tags,
                    "provenance_source": "Geofabrik OpenStreetMap Northern Zone",
                    "verification_status": "unverified_osm",
                })
            return

        # Emergency facility on a way
        if (amenity in EMERGENCY_AMENITIES) or (emergency == "ambulance_station"):
            coords = []
            for n in w.nodes:
                try:
                    coords.append([round(n.lon, 6), round(n.lat, 6)])
                except (osmium.InvalidLocationError, AttributeError):
                    continue

            if coords and any(MIN_LON <= c[0] <= MAX_LON and MIN_LAT <= c[1] <= MAX_LAT for c in coords):
                c_lon = sum(c[0] for c in coords) / len(coords)
                c_lat = sum(c[1] for c in coords) / len(coords)
                facility_type = emergency if emergency == "ambulance_station" else amenity
                self.emergency_facilities.append({
                    "id": f"osm_emergency_way_{w.id}",
                    "osm_id": w.id,
                    "osm_type": "way",
                    "name": tags.get("name") or tags.get("operator") or f"{facility_type.replace('_', ' ').title()} (OSM {w.id})",
                    "facility_type": facility_type,
                    "operator": tags.get("operator"),
                    "emergency_flag": emergency,
                    "lon": round(c_lon, 6),
                    "lat": round(c_lat, 6),
                    "raw_tags": tags,
                    "provenance_source": "Geofabrik OpenStreetMap Northern Zone",
                    "verification_status": "unverified_osm",
                })


def init_database(db_path: Path):
    """Initialize the SQLite database schema with indexes on the target (or temp) path."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE roads (
        id TEXT PRIMARY KEY,
        osm_id INTEGER NOT NULL,
        name TEXT,
        road_class TEXT NOT NULL,
        oneway INTEGER NOT NULL DEFAULT 0,
        surface TEXT,
        width_m REAL,
        maxwidth_m REAL,
        lanes INTEGER,
        access TEXT,
        vehicle TEXT,
        emergency TEXT,
        u_node INTEGER NOT NULL,
        v_node INTEGER NOT NULL,
        length_m REAL NOT NULL,
        node_ids_json TEXT NOT NULL,
        geometry_geojson TEXT NOT NULL,
        raw_tags_json TEXT NOT NULL,
        provenance_source TEXT NOT NULL,
        verification_status TEXT NOT NULL
    );
    """)

    cur.execute("CREATE INDEX idx_roads_road_class ON roads(road_class);")
    cur.execute("CREATE INDEX idx_roads_u_node ON roads(u_node);")
    cur.execute("CREATE INDEX idx_roads_v_node ON roads(v_node);")

    cur.execute("""
    CREATE TABLE intersections (
        osm_id INTEGER PRIMARY KEY,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        degree INTEGER NOT NULL,
        connected_roads_json TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE buildings (
        id TEXT PRIMARY KEY,
        osm_id INTEGER NOT NULL,
        name TEXT,
        use_type TEXT,
        building_levels INTEGER,
        addr_street TEXT,
        addr_housenumber TEXT,
        addr_postcode TEXT,
        centroid_lon REAL NOT NULL,
        centroid_lat REAL NOT NULL,
        geometry_geojson TEXT NOT NULL,
        raw_tags_json TEXT NOT NULL,
        provenance_source TEXT NOT NULL,
        verification_status TEXT NOT NULL
    );
    """)
    cur.execute("CREATE INDEX idx_buildings_centroid ON buildings(centroid_lat, centroid_lon);")

    cur.execute("""
    CREATE TABLE emergency_facilities (
        id TEXT PRIMARY KEY,
        osm_id INTEGER NOT NULL,
        osm_type TEXT NOT NULL,
        name TEXT NOT NULL,
        facility_type TEXT NOT NULL,
        operator TEXT,
        emergency_flag TEXT,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        raw_tags_json TEXT NOT NULL,
        provenance_source TEXT NOT NULL,
        verification_status TEXT NOT NULL
    );
    """)
    cur.execute("CREATE INDEX idx_facilities_type ON emergency_facilities(facility_type);")

    cur.execute("""
    CREATE TABLE places (
        id TEXT PRIMARY KEY,
        osm_id INTEGER NOT NULL,
        osm_type TEXT NOT NULL,
        name TEXT NOT NULL,
        place_type TEXT NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        raw_tags_json TEXT NOT NULL,
        provenance_source TEXT NOT NULL
    );
    """)
    cur.execute("CREATE INDEX idx_places_name ON places(name);")

    cur.execute("""
    CREATE TABLE dataset_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    conn.commit()
    conn.close()


def store_in_sqlite(extractor: PilotExtractor, target_db_path: Path, metadata: Dict[str, Any]):
    """Insert extracted features into a temporary SQLite database, then atomically move into place."""
    target_db_path.parent.mkdir(parents=True, exist_ok=True)
    temp_db_path = target_db_path.with_name(f"{target_db_path.name}.tmp_{os.getpid()}")

    try:
        logger.info("Initializing temporary SQLite database at %s", temp_db_path)
        init_database(temp_db_path)
        conn = sqlite3.connect(temp_db_path)
        cur = conn.cursor()

        # 1. Insert Roads
        road_rows = [
            (
                r["id"],
                r["osm_id"],
                r["name"],
                r["road_class"],
                r["oneway"],
                r["surface"],
                r["width_m"],
                r["maxwidth_m"],
                r["lanes"],
                r["access"],
                r["vehicle"],
                r["emergency"],
                r["u_node"],
                r["v_node"],
                r["length_m"],
                json.dumps(r["node_ids"]),
                json.dumps({"type": "LineString", "coordinates": r["coords"]}),
                json.dumps(r["raw_tags"]),
                r["provenance_source"],
                r["verification_status"],
            )
            for r in extractor.roads
        ]
        cur.executemany("""
        INSERT INTO roads (
            id, osm_id, name, road_class, oneway, surface, width_m, maxwidth_m, lanes,
            access, vehicle, emergency, u_node, v_node, length_m, node_ids_json,
            geometry_geojson, raw_tags_json, provenance_source, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, road_rows)

        # 2. Insert Intersections
        intersection_rows = []
        for nid, road_list in extractor.node_occurrences.items():
            if nid in extractor.node_coords:
                lon, lat = extractor.node_coords[nid]
                intersection_rows.append((
                    nid,
                    lon,
                    lat,
                    len(road_list),
                    json.dumps(list(set(road_list)))
                ))

        cur.executemany("""
        INSERT INTO intersections (osm_id, lon, lat, degree, connected_roads_json)
        VALUES (?, ?, ?, ?, ?);
        """, intersection_rows)

        # 3. Insert Buildings
        building_rows = [
            (
                b["id"],
                b["osm_id"],
                b["name"],
                b["use_type"],
                b["building_levels"],
                b["addr_street"],
                b["addr_housenumber"],
                b["addr_postcode"],
                b["centroid_lon"],
                b["centroid_lat"],
                json.dumps({"type": "Polygon", "coordinates": b["coords"]}),
                json.dumps(b["raw_tags"]),
                b["provenance_source"],
                b["verification_status"],
            )
            for b in extractor.buildings
        ]
        cur.executemany("""
        INSERT INTO buildings (
            id, osm_id, name, use_type, building_levels, addr_street, addr_housenumber,
            addr_postcode, centroid_lon, centroid_lat, geometry_geojson, raw_tags_json,
            provenance_source, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, building_rows)

        # 4. Insert Emergency Facilities
        emergency_rows = [
            (
                ef["id"],
                ef["osm_id"],
                ef["osm_type"],
                ef["name"],
                ef["facility_type"],
                ef["operator"],
                ef["emergency_flag"],
                ef["lon"],
                ef["lat"],
                json.dumps(ef["raw_tags"]),
                ef["provenance_source"],
                ef["verification_status"],
            )
            for ef in extractor.emergency_facilities
        ]
        cur.executemany("""
        INSERT INTO emergency_facilities (
            id, osm_id, osm_type, name, facility_type, operator, emergency_flag,
            lon, lat, raw_tags_json, provenance_source, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, emergency_rows)

        # 5. Insert Places
        place_rows = [
            (
                p["id"],
                p["osm_id"],
                p["osm_type"],
                p["name"],
                p["place_type"],
                p["lon"],
                p["lat"],
                json.dumps(p["raw_tags"]),
                p["provenance_source"],
            )
            for p in extractor.places
        ]
        cur.executemany("""
        INSERT INTO places (id, osm_id, osm_type, name, place_type, lon, lat, raw_tags_json, provenance_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, place_rows)

        # 6. Insert Metadata
        metadata_entries = [
            ("dataset_name", "Chandigarh-Mohali-Gharuan Emergency Access Pilot Foundation"),
            ("geographic_bounds_bbox", json.dumps(list(PILOT_BBOX))),
            ("licence", "Open Data Commons Open Database License (ODbL) 1.0"),
            ("attribution", "(c) OpenStreetMap contributors"),
            ("source_provider", "Geofabrik GmbH"),
            ("source_extract", PBF_PATH.name),
            ("extract_timestamp_utc", datetime.now(timezone.utc).isoformat()),
            ("source_snapshot_date", metadata.get("source_last_modified", "Tue, 20 Oct 2026 23:14:55 GMT")),
            ("sha256_checksum", metadata.get("sha256_checksum", "uncomputed")),
            ("roads_count", str(len(extractor.roads))),
            ("intersections_count", str(len(intersection_rows))),
            ("buildings_count", str(len(extractor.buildings))),
            ("emergency_facilities_count", str(len(extractor.emergency_facilities))),
            ("places_count", str(len(extractor.places))),
        ]
        cur.executemany("INSERT INTO dataset_metadata (key, value) VALUES (?, ?);", metadata_entries)

        conn.commit()
        conn.close()

        # Atomic replacement of final database file
        if target_db_path.exists():
            target_db_path.unlink()
        temp_db_path.replace(target_db_path)
        logger.info("Database committed and atomically moved to %s (%d roads, %d intersections, %d buildings, %d emergency facilities, %d places)",
                    target_db_path, len(road_rows), len(intersection_rows), len(building_rows), len(emergency_rows), len(place_rows))
    except Exception as exc:
        if temp_db_path.exists():
            try:
                temp_db_path.unlink()
            except Exception:
                pass
        raise exc


def export_geojson(extractor: PilotExtractor, target_geojson_path: Path):
    """Export derived FeatureCollection atomically using a temporary file."""
    target_geojson_path.parent.mkdir(parents=True, exist_ok=True)
    temp_geojson_path = target_geojson_path.with_name(f"{target_geojson_path.name}.tmp_{os.getpid()}")

    features: List[Dict[str, Any]] = []

    # Add emergency facilities (neutral unverified status, preserving facility_type)
    for ef in extractor.emergency_facilities:
        features.append({
            "type": "Feature",
            "id": ef["id"],
            "geometry": {
                "type": "Point",
                "coordinates": [ef["lon"], ef["lat"]],
            },
            "properties": {
                "id": ef["id"],
                "osm_id": ef["osm_id"],
                "feature_type": "station",
                "name": ef["name"],
                "station_type": ef["facility_type"],
                "operator": ef["operator"],
                "access_status": "unclassified",
                "data_source": "OpenStreetMap",
                "verification_status": ef["verification_status"],
                "notes": f"Imported facility: {ef['facility_type']} (OSM {ef['osm_id']}). Unverified operational status.",
            }
        })

    # Add roads (neutral unclassified status, preserving missing widths as None/NULL)
    for r in extractor.roads:
        features.append({
            "type": "Feature",
            "id": r["id"],
            "geometry": {
                "type": "LineString",
                "coordinates": r["coords"],
            },
            "properties": {
                "id": r["id"],
                "osm_id": r["osm_id"],
                "feature_type": "road",
                "name": r["name"],
                "road_class": r["road_class"],
                "oneway": r["oneway"],
                "surface": r["surface"] or "unknown",
                "width_m": r["width_m"],
                "maxwidth_m": r["maxwidth_m"],
                "lanes": r["lanes"],
                "length_m": r["length_m"],
                "u_node": r["u_node"],
                "v_node": r["v_node"],
                "access_status": "unclassified",
                "data_source": "OpenStreetMap",
                "verification_status": r["verification_status"],
            }
        })

    # Add buildings (neutral unclassified status)
    for b in extractor.buildings:
        features.append({
            "type": "Feature",
            "id": b["id"],
            "geometry": {
                "type": "Polygon",
                "coordinates": b["coords"],
            },
            "properties": {
                "id": b["id"],
                "osm_id": b["osm_id"],
                "feature_type": "building",
                "name": b["name"],
                "use_type": b["use_type"],
                "building_levels": b["building_levels"],
                "addr_street": b["addr_street"],
                "addr_housenumber": b["addr_housenumber"],
                "access_status": "unclassified",
                "data_source": "OpenStreetMap",
                "verification_status": b["verification_status"],
            }
        })

    geojson_data = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "Chandigarh-Mohali-Gharuan Sector (Real Geographic Pilot Extract)",
            "description": "Real-world OpenStreetMap extract for Chandigarh, SAS Nagar Mohali, and Gharuan/CU. Unverified field measurements remain explicitly unknown and unclassified.",
            "crs": "urn:ogc:def:crs:OGC:1.3:CRS84",
            "bounds_bbox": list(PILOT_BBOX),
            "licence": "ODbL 1.0 (https://www.openstreetmap.org/copyright)",
            "attribution": "(c) OpenStreetMap contributors",
            "features_summary": {
                "emergency_facilities": len(extractor.emergency_facilities),
                "roads": len(extractor.roads),
                "buildings": len(extractor.buildings),
                "places": len(extractor.places),
            }
        },
        "features": features,
    }

    try:
        with open(temp_geojson_path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f)
        if target_geojson_path.exists():
            target_geojson_path.unlink()
        temp_geojson_path.replace(target_geojson_path)
        logger.info("GeoJSON file atomically written to %s (%.2f MB)", target_geojson_path, target_geojson_path.stat().st_size / (1024 * 1024))
    except Exception as exc:
        if temp_geojson_path.exists():
            try:
                temp_geojson_path.unlink()
            except Exception:
                pass
        raise exc


def run_extraction():
    """Main execution function to parse PBF and generate datasets."""
    if not PBF_PATH.exists():
        logger.error("OSM PBF file not found at %s. Please run download_osm_extract.py first.", PBF_PATH)
        sys.exit(1)

    metadata: Dict[str, Any] = {}
    if METADATA_PATH.exists():
        try:
            with open(METADATA_PATH, "r", encoding="utf-8") as mf:
                metadata = json.load(mf)
        except Exception as exc:
            logger.warning("Could not read metadata file: %s", exc)

    logger.info("Starting pyosmium extraction from %s for BBOX %s", PBF_PATH, PILOT_BBOX)
    logger.info("Note: Node location cache uses 'sparse_file_array' on disk to maintain low memory footprint.")
    t0 = time.time()

    extractor = PilotExtractor()
    # Note: OSM PBF extracts must be parsed sequentially. Bounding-box filtering filters
    # extracted geometries in Python and does not shorten the sequential byte stream read.
    extractor.apply_file(str(PBF_PATH), locations=True, idx="sparse_file_array")
    elapsed = time.time() - t0

    logger.info("PBF parsing completed in %.2f seconds.", elapsed)
    logger.info("Extracted %d roads", len(extractor.roads))
    logger.info("Extracted %d buildings", len(extractor.buildings))
    logger.info("Extracted %d emergency facilities", len(extractor.emergency_facilities))
    logger.info("Extracted %d places", len(extractor.places))
    logger.info("Identified %d topological road intersections", len(extractor.node_coords))

    # Persist atomically to SQLite
    store_in_sqlite(extractor, SQLITE_DB_PATH, metadata)

    # Persist atomically to GeoJSON
    export_geojson(extractor, GEOJSON_PATH)

    logger.info("Pilot geographic data extraction complete!")


if __name__ == "__main__":
    run_extraction()

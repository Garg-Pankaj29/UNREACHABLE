"""Service for querying and serving extracted pilot geographic data from SQLite."""
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import REPO_ROOT

logger = logging.getLogger("unreachable.pilot_service")

PILOT_SQLITE_PATH = REPO_ROOT / "data" / "pilot" / "chandigarh_pilot.sqlite"


class PilotDataService:
    """Provides efficient, indexed access to real Chandigarh-Mohali-Gharuan pilot data."""

    def __init__(self, db_path: Path = PILOT_SQLITE_PATH):
        self.db_path = db_path

    def is_available(self) -> bool:
        """Check if pilot SQLite database exists."""
        return self.db_path.exists()

    def _get_connection(self) -> sqlite3.Connection:
        """Create a read-only SQLite connection."""
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def get_summary(self) -> Dict[str, Any]:
        """Fetch metadata summary of the pilot dataset."""
        if not self.is_available():
            return {
                "available": False,
                "message": "Pilot database not found. Please run extraction pipeline.",
            }

        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM dataset_metadata;")
            meta = dict(cur.fetchall())

            cur.execute("SELECT facility_type, COUNT(*) FROM emergency_facilities GROUP BY facility_type;")
            facility_breakdown = dict(cur.fetchall())

            return {
                "available": True,
                "dataset_name": meta.get("dataset_name", "Chandigarh Pilot"),
                "licence": meta.get("licence", "ODbL 1.0"),
                "attribution": meta.get("attribution", "(c) OpenStreetMap contributors"),
                "bounds_bbox": json.loads(meta.get("geographic_bounds_bbox", "[76.52, 30.62, 76.88, 30.82]")),
                "counts": {
                    "roads": int(meta.get("roads_count", 0)),
                    "intersections": int(meta.get("intersections_count", 0)),
                    "buildings": int(meta.get("buildings_count", 0)),
                    "emergency_facilities": int(meta.get("emergency_facilities_count", 0)),
                    "places": int(meta.get("places_count", 0)),
                },
                "facility_breakdown": facility_breakdown,
            }
        finally:
            conn.close()

    def get_emergency_facilities(
        self,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        category: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch emergency facilities as GeoJSON features with optional bbox and category filtering."""
        if not self.is_available():
            return []

        conn = self._get_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT id, osm_id, name, facility_type, operator, emergency_flag, lon, lat, verification_status
                FROM emergency_facilities
                WHERE 1=1
            """
            params: List[Any] = []
            if bbox:
                min_lon, min_lat, max_lon, max_lat = bbox
                query += " AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?"
                params.extend([min_lon, max_lon, min_lat, max_lat])
            if category and isinstance(category, str):
                query += " AND facility_type = ?"
                params.append(category)

            query += " ORDER BY CASE facility_type WHEN 'fire_station' THEN 1 WHEN 'hospital' THEN 2 WHEN 'clinic' THEN 3 ELSE 4 END, name ASC;"
            cur.execute(query, tuple(params))

            features = []
            for r in cur.fetchall():
                fac_type = r["facility_type"]
                coords = [round(r["lon"], 6), round(r["lat"], 6)]
                features.append({
                    "type": "Feature",
                    "id": r["id"],
                    "geometry": {
                        "type": "Point",
                        "coordinates": coords,
                    },
                    "properties": {
                        "id": r["id"],
                        "osm_id": r["osm_id"],
                        "feature_type": "station",
                        "facility_type": fac_type,
                        "station_type": fac_type,
                        "name": r["name"],
                        "operator": r["operator"],
                        "coordinates": coords,
                        "lon": coords[0],
                        "lat": coords[1],
                        "access_status": "unclassified",
                        "data_source": "OpenStreetMap",
                        "verification_status": r["verification_status"],
                        "notes": f"Mapped {fac_type.replace('_', ' ').title()}. Unverified municipal status.",
                    },
                })
            return features
        finally:
            conn.close()

    def get_roads(
        self,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        zoom: Optional[int] = None,
        limit: int = 1500,
    ) -> List[Dict[str, Any]]:
        """Fetch road segments with zoom-based level-of-detail and bbox filtering."""
        if not self.is_available():
            return []

        conn = self._get_connection()
        try:
            cur = conn.cursor()

            # When zoomed out (zoom < 14) or no bbox specified: serve major roads only
            if zoom is not None and zoom < 14 or bbox is None:
                cur.execute(
                    """
                    SELECT id, osm_id, name, road_class, oneway, surface, width_m, maxwidth_m,
                           lanes, length_m, geometry_geojson, verification_status
                    FROM roads
                    WHERE road_class IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary',
                                         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link')
                    LIMIT ?;
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
            else:
                # Zoom >= 14 with bbox: find connected roads via intersections in viewport
                min_lon, min_lat, max_lon, max_lat = bbox
                cur.execute(
                    """
                    SELECT connected_roads_json FROM intersections
                    WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?
                    LIMIT ?;
                    """,
                    (min_lon, max_lon, min_lat, max_lat, limit),
                )
                inter_rows = cur.fetchall()
                road_ids: Set[str] = set()
                for ir in inter_rows:
                    try:
                        road_ids.update(json.loads(ir["connected_roads_json"]))
                        if len(road_ids) >= limit:
                            break
                    except Exception:
                        continue

                if not road_ids:
                    return []

                # Query road details for matched IDs
                id_list = list(road_ids)[:limit]
                placeholders = ",".join(["?"] * len(id_list))
                cur.execute(
                    f"""
                    SELECT id, osm_id, name, road_class, oneway, surface, width_m, maxwidth_m,
                           lanes, length_m, geometry_geojson, verification_status
                    FROM roads
                    WHERE id IN ({placeholders});
                    """,
                    id_list,
                )
                rows = cur.fetchall()

            features = []
            for r in rows:
                try:
                    geom = json.loads(r["geometry_geojson"])
                except Exception:
                    continue

                features.append({
                    "type": "Feature",
                    "id": r["id"],
                    "geometry": geom,
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
                        "access_status": "unclassified",
                        "data_source": "OpenStreetMap",
                        "verification_status": r["verification_status"],
                    },
                })
            return features
        finally:
            conn.close()

    def get_buildings(
        self,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        zoom: Optional[int] = None,
        limit: int = 1000,
    ) -> List[Dict[str, Any]]:
        """Fetch building footprints when zoomed in enough (zoom >= 14 or explicit bbox)."""
        if not self.is_available():
            return []

        # Do not render individual building footprints at low zoom to avoid UI stalls
        if zoom is not None and zoom < 14:
            return []

        conn = self._get_connection()
        try:
            cur = conn.cursor()
            if bbox:
                min_lon, min_lat, max_lon, max_lat = bbox
                cur.execute(
                    """
                    SELECT id, osm_id, name, use_type, building_levels, addr_street,
                           addr_housenumber, centroid_lon, centroid_lat, geometry_geojson, verification_status
                    FROM buildings
                    WHERE centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?
                    LIMIT ?;
                    """,
                    (min_lon, max_lon, min_lat, max_lat, limit),
                )
            else:
                # Default sample from core pilot sector if no bbox provided
                cur.execute(
                    """
                    SELECT id, osm_id, name, use_type, building_levels, addr_street,
                           addr_housenumber, centroid_lon, centroid_lat, geometry_geojson, verification_status
                    FROM buildings
                    LIMIT ?;
                    """,
                    (limit,),
                )

            features = []
            for r in cur.fetchall():
                try:
                    geom = json.loads(r["geometry_geojson"])
                except Exception:
                    continue

                features.append({
                    "type": "Feature",
                    "id": r["id"],
                    "geometry": geom,
                    "properties": {
                        "id": r["id"],
                        "osm_id": r["osm_id"],
                        "feature_type": "building",
                        "name": r["name"],
                        "use_type": r["use_type"],
                        "building_levels": r["building_levels"],
                        "floors": r["building_levels"],
                        "addr_street": r["addr_street"],
                        "addr_housenumber": r["addr_housenumber"],
                        "centroid_lon": r["centroid_lon"],
                        "centroid_lat": r["centroid_lat"],
                        "access_status": "unclassified",
                        "data_source": "OpenStreetMap",
                        "verification_status": r["verification_status"],
                    },
                })
            return features
        finally:
            conn.close()

    def get_features(
        self,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        zoom: Optional[int] = None,
        layer: str = "all",
        limit: int = 2500,
    ) -> Dict[str, Any]:
        """Aggregate facilities, roads, and buildings into an efficient FeatureCollection."""
        features: List[Dict[str, Any]] = []

        if layer in ("all", "stations", "facilities"):
            features.extend(self.get_emergency_facilities(bbox=bbox))

        if layer in ("all", "roads"):
            road_limit = min(limit, 1500)
            features.extend(self.get_roads(bbox=bbox, zoom=zoom, limit=road_limit))

        if layer in ("all", "buildings"):
            bldg_limit = min(limit, 1000)
            features.extend(self.get_buildings(bbox=bbox, zoom=zoom, limit=bldg_limit))

        return {
            "type": "FeatureCollection",
            "metadata": {
                "name": "Chandigarh-Mohali-Gharuan Pilot Corridor",
                "source": "OpenStreetMap (Geofabrik regional extract)",
                "licence": "ODbL 1.0 (https://www.openstreetmap.org/copyright)",
                "attribution": "(c) OpenStreetMap contributors",
                "bbox": list(bbox) if bbox else None,
                "zoom": zoom,
                "layer_requested": layer,
                "feature_count": len(features),
            },
            "features": features,
        }

    def search(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Fast indexed search across emergency facilities, roads, buildings, and places."""
        if not self.is_available() or not query or len(query.strip()) < 1:
            return []

        q_clean = query.strip()
        pattern = f"%{q_clean}%"
        conn = self._get_connection()
        results: List[Dict[str, Any]] = []

        try:
            cur = conn.cursor()

            # 1. Emergency facilities (hospitals, fire stations, clinics, doctors)
            cur.execute(
                """
                SELECT id, osm_id, osm_type, name, facility_type, operator, emergency_flag,
                       lon, lat, raw_tags_json, verification_status
                FROM emergency_facilities
                WHERE name LIKE ? OR operator LIKE ? OR id LIKE ? OR facility_type LIKE ?
                LIMIT ?;
                """,
                (pattern, pattern, pattern, pattern, limit),
            )
            for row in cur.fetchall():
                fac_type = row["facility_type"]
                sub_label = fac_type.replace("_", " ").title()
                op_str = f" • {row['operator']}" if row["operator"] else ""
                results.append({
                    "id": row["id"],
                    "osm_id": row["osm_id"],
                    "name": row["name"],
                    "feature_type": "facility",
                    "sub_type": fac_type,
                    "details": f"{sub_label}{op_str} (unverified_osm)",
                    "coordinates": [row["lon"], row["lat"]],
                    "geometry": {
                        "type": "Point",
                        "coordinates": [row["lon"], row["lat"]],
                    },
                    "properties": {
                        "id": row["id"],
                        "osm_id": row["osm_id"],
                        "name": row["name"],
                        "feature_type": "facility",
                        "facility_type": fac_type,
                        "operator": row["operator"],
                        "emergency": row["emergency_flag"],
                        "access_status": "unverified",
                        "source": "local_pilot",
                        "inside_pilot_area": True,
                        "coverage_notice": "Inside pilot corridor - Detailed road access available",
                        "verification_status": row["verification_status"],
                        "raw_tags": json.loads(row["raw_tags_json"]) if row["raw_tags_json"] else {},
                    },
                    "source": "local_pilot",
                    "inside_pilot_area": True,
                    "verification_status": row["verification_status"],
                })

            rem_limit = limit - len(results)
            if rem_limit > 0:
                # 2. Named Places (Suburbs, Towns, Villages)
                cur.execute(
                    """
                    SELECT id, osm_id, name, place_type, lon, lat
                    FROM places
                    WHERE name LIKE ?
                    LIMIT ?;
                    """,
                    (pattern, rem_limit),
                )
                for row in cur.fetchall():
                    p_type = row["place_type"]
                    results.append({
                        "id": row["id"],
                        "osm_id": row["osm_id"],
                        "name": row["name"],
                        "feature_type": "place",
                        "sub_type": p_type,
                        "details": f"Location • {p_type.capitalize()}",
                        "coordinates": [row["lon"], row["lat"]],
                        "geometry": {
                            "type": "Point",
                            "coordinates": [row["lon"], row["lat"]],
                        },
                        "properties": {
                            "id": row["id"],
                            "osm_id": row["osm_id"],
                            "name": row["name"],
                            "feature_type": "place",
                            "place_type": p_type,
                            "source": "local_pilot",
                            "inside_pilot_area": True,
                            "coverage_notice": "Inside pilot corridor - Detailed road access available",
                            "access_status": "unknown",
                        },
                        "source": "local_pilot",
                        "inside_pilot_area": True,
                    })

            rem_limit = limit - len(results)
            if rem_limit > 0:
                # 3. Roads
                cur.execute(
                    """
                    SELECT id, osm_id, name, road_class, width_m, lanes, length_m,
                           geometry_geojson, raw_tags_json, verification_status
                    FROM roads
                    WHERE (name IS NOT NULL AND name != '' AND (name LIKE ? OR id LIKE ?))
                       OR (id LIKE ?)
                    LIMIT ?;
                    """,
                    (pattern, pattern, pattern, rem_limit),
                )
                for row in cur.fetchall():
                    road_cls = row["road_class"]
                    w_str = f" • Width: {row['width_m']}m" if row["width_m"] else " • Width: unknown"
                    geom = None
                    coords = None
                    if row["geometry_geojson"]:
                        try:
                            geom = json.loads(row["geometry_geojson"])
                            if geom.get("type") == "LineString" and geom.get("coordinates"):
                                c_list = geom["coordinates"]
                                mid = c_list[len(c_list) // 2]
                                coords = [mid[0], mid[1]]
                        except Exception:
                            pass

                    results.append({
                        "id": row["id"],
                        "osm_id": row["osm_id"],
                        "name": row["name"] or f"Road ({road_cls})",
                        "feature_type": "road",
                        "sub_type": road_cls,
                        "details": f"{road_cls.capitalize()} road{w_str}",
                        "coordinates": coords,
                        "geometry": geom,
                        "properties": {
                            "id": row["id"],
                            "osm_id": row["osm_id"],
                            "name": row["name"],
                            "feature_type": "road",
                            "road_class": road_cls,
                            "width_m": row["width_m"],
                            "lanes": row["lanes"],
                            "length_m": row["length_m"],
                            "source": "local_pilot",
                            "inside_pilot_area": True,
                            "coverage_notice": "Inside pilot corridor - Detailed road access available",
                            "access_status": "unclassified",
                            "verification_status": row["verification_status"],
                            "raw_tags": json.loads(row["raw_tags_json"]) if row["raw_tags_json"] else {},
                        },
                        "source": "local_pilot",
                        "inside_pilot_area": True,
                        "verification_status": row["verification_status"],
                    })

            rem_limit = limit - len(results)
            if rem_limit > 0:
                # 4. Buildings
                cur.execute(
                    """
                    SELECT id, osm_id, name, use_type, building_levels, addr_street,
                           addr_housenumber, centroid_lon, centroid_lat, geometry_geojson,
                           raw_tags_json, verification_status
                    FROM buildings
                    WHERE (name IS NOT NULL AND name != '' AND (name LIKE ? OR addr_street LIKE ?))
                       OR id LIKE ?
                    LIMIT ?;
                    """,
                    (pattern, pattern, pattern, rem_limit),
                )
                for row in cur.fetchall():
                    u_type = row["use_type"] or "building"
                    addr_parts = [p for p in (row["addr_housenumber"], row["addr_street"]) if p]
                    addr = f" • {' '.join(addr_parts)}" if addr_parts else ""
                    geom = None
                    if row["geometry_geojson"]:
                        try:
                            geom = json.loads(row["geometry_geojson"])
                        except Exception:
                            pass

                    results.append({
                        "id": row["id"],
                        "osm_id": row["osm_id"],
                        "name": row["name"] or f"Building {row['id'].replace('osm_bldg_', '')}",
                        "feature_type": "building",
                        "sub_type": u_type,
                        "details": f"Building ({u_type}){addr}",
                        "coordinates": [row["centroid_lon"], row["centroid_lat"]],
                        "geometry": geom,
                        "properties": {
                            "id": row["id"],
                            "osm_id": row["osm_id"],
                            "name": row["name"] or f"Building {row['id'].replace('osm_bldg_', '')}",
                            "feature_type": "building",
                            "use_type": u_type,
                            "building_levels": row["building_levels"],
                            "addr_street": row["addr_street"],
                            "addr_housenumber": row["addr_housenumber"],
                            "centroid_lon": row["centroid_lon"],
                            "centroid_lat": row["centroid_lat"],
                            "source": "local_pilot",
                            "inside_pilot_area": True,
                            "coverage_notice": "Inside pilot corridor - Detailed road access available",
                            "access_status": "unknown",
                            "verification_status": row["verification_status"],
                            "raw_tags": json.loads(row["raw_tags_json"]) if row["raw_tags_json"] else {},
                        },
                        "source": "local_pilot",
                        "inside_pilot_area": True,
                        "verification_status": row["verification_status"],
                    })

            return results
        finally:
            conn.close()


pilot_data_service = PilotDataService()

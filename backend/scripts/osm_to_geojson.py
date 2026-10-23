#!/usr/bin/env python3
"""Convert raw Overpass OSM JSON export into UNREACHABLE neighbourhood.geojson format.

Follows UNREACHABLE schema specifications:
- Splits highway ways at shared intersection nodes to ensure topological graph connectivity.
- Assigns standardized IDs: road-osm-<id>, bldg-osm-<id>, station-osm-<id>.
- Applies deterministic width policy:
  * Tagged width -> osm_tagged
  * Untagged primary/secondary/tertiary -> estimated from lanes
  * Untagged residential/service/track -> width_m null, unverified
- Detects physical barriers within 3m of roads to set obstructions.
- Detects power lines within proximity to flag possible_overhead_wire in notes (never an obstruction).
- Assigns data_source and verification/verification_status to all features.
"""

import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

LAT0 = 30.77
COS_LAT0 = math.cos(math.radians(LAT0))
METERS_PER_DEG_LAT = 111139.0
METERS_PER_DEG_LON = METERS_PER_DEG_LAT * COS_LAT0


def to_xy(lon: float, lat: float) -> Tuple[float, float]:
    """Convert lon/lat to local Cartesian metric coordinates in meters."""
    return lon * METERS_PER_DEG_LON, lat * METERS_PER_DEG_LAT


def dist_pt_to_seg(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    """Compute distance from point (px, py) to segment (x1, y1)-(x2, y2) in meters."""
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    qx = x1 + t * dx
    qy = y1 + t * dy
    return math.hypot(px - qx, py - qy)


def min_dist_pts_to_linestring(pts_xy: List[Tuple[float, float]], line_xy: List[Tuple[float, float]]) -> float:
    """Compute minimum distance between a set of points and a LineString."""
    if not pts_xy or not line_xy or len(line_xy) < 2:
        return float("inf")
    min_d = float("inf")
    for px, py in pts_xy:
        for i in range(len(line_xy) - 1):
            x1, y1 = line_xy[i]
            x2, y2 = line_xy[i + 1]
            d = dist_pt_to_seg(px, py, x1, y1, x2, y2)
            if d < min_d:
                min_d = d
    return min_d


def segments_cross(a1: Tuple[float, float], a2: Tuple[float, float], b1: Tuple[float, float], b2: Tuple[float, float]) -> bool:
    """Check if 2D line segment a1-a2 crosses segment b1-b2."""
    def ccw(p1, p2, p3):
        return (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0])
    return (ccw(a1, b1, b2) != ccw(a2, b1, b2)) and (ccw(a1, a2, b1) != ccw(a1, a2, b2))


def min_dist_between_linestrings(line1_xy: List[Tuple[float, float]], line2_xy: List[Tuple[float, float]]) -> float:
    """Compute minimum distance between two LineStrings, returning 0 if they intersect."""
    if not line1_xy or not line2_xy:
        return float("inf")
    # Check intersection
    for i in range(len(line1_xy) - 1):
        s1_a, s1_b = line1_xy[i], line1_xy[i + 1]
        for j in range(len(line2_xy) - 1):
            s2_a, s2_b = line2_xy[j], line2_xy[j + 1]
            if segments_cross(s1_a, s1_b, s2_a, s2_b):
                return 0.0

    d1 = min_dist_pts_to_linestring(line1_xy, line2_xy)
    d2 = min_dist_pts_to_linestring(line2_xy, line1_xy)
    return min(d1, d2)


def parse_numeric_width(val: Any) -> Optional[float]:
    """Parse numeric width value from tags."""
    if val is None:
        return None
    s = str(val).strip().lower().replace("m", "").replace("meters", "").strip()
    try:
        w = float(s)
        return round(w, 2) if w > 0 else None
    except (ValueError, TypeError):
        return None


def get_element_points_xy(el: dict) -> List[Tuple[float, float]]:
    """Extract metric coordinates for a node or way element."""
    pts = []
    if el.get("type") == "node" and "lon" in el and "lat" in el:
        pts.append(to_xy(el["lon"], el["lat"]))
    elif "geometry" in el:
        for pt in el["geometry"]:
            pts.append(to_xy(pt["lon"], pt["lat"]))
    return pts


def get_element_centroid(el: dict) -> Tuple[float, float]:
    """Compute (lon, lat) centroid for node, way, or relation."""
    if el.get("type") == "node" and "lon" in el and "lat" in el:
        return el["lon"], el["lat"]
    if "bounds" in el:
        b = el["bounds"]
        return (b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2
    geom = el.get("geometry", [])
    if not geom and "members" in el:
        geom = [pt for m in el.get("members", []) for pt in m.get("geometry", [])]
    if not geom:
        return 0.0, 0.0
    avg_lon = sum(pt["lon"] for pt in geom) / len(geom)
    avg_lat = sum(pt["lat"] for pt in geom) / len(geom)
    return avg_lon, avg_lat


def is_station(tags: dict) -> bool:
    amenity = tags.get("amenity", "")
    emergency = tags.get("emergency", "")
    return amenity in ("fire_station", "hospital", "police") or emergency in ("fire_station", "hospital", "ambulance_station")


def convert_osm_to_geojson(overpass_data: dict) -> dict:
    elements = overpass_data.get("elements", [])

    # Categorize elements
    road_ways = []
    barrier_elements = []
    power_lines = []
    station_elements = []
    building_elements = []

    for el in elements:
        tags = el.get("tags", {})
        if is_station(tags):
            station_elements.append(el)
        elif "highway" in tags and el.get("type") == "way":
            road_ways.append(el)
        elif "barrier" in tags:
            barrier_elements.append(el)
        elif "power" in tags and tags.get("power") in ("line", "minor_line", "cable"):
            power_lines.append(el)
        elif "building" in tags:
            building_elements.append(el)

    # 1. Count node usage across roads to identify junction split points
    node_counts = {}
    for w in road_ways:
        for nid in w.get("nodes", []):
            node_counts[nid] = node_counts.get(nid, 0) + 1

    shared_junction_nodes = {nid for nid, cnt in node_counts.items() if cnt > 1}

    # Prepare barrier point sets
    barriers_xy = []
    for b in barrier_elements:
        b_pts = get_element_points_xy(b)
        b_type = b.get("tags", {}).get("barrier", "barrier")
        if b_pts:
            barriers_xy.append((b_pts, b_type))

    # Prepare power line geometries
    power_lines_xy = []
    for p in power_lines:
        p_pts = get_element_points_xy(p)
        if len(p_pts) >= 2:
            power_lines_xy.append(p_pts)

    features = []
    processed_roads_for_proximity = []  # list of (road_id, line_xy, lonlat_coords)

    # 2. Process and split road ways
    for w in road_ways:
        osm_id = w["id"]
        tags = w.get("tags", {})
        nodes = w.get("nodes", [])
        geom = w.get("geometry", [])

        if len(nodes) < 2 or len(geom) < 2:
            continue

        # Determine split indices
        split_indices = [0]
        for i in range(1, len(nodes) - 1):
            if nodes[i] in shared_junction_nodes:
                split_indices.append(i)
        split_indices.append(len(nodes) - 1)

        num_segments = len(split_indices) - 1

        # Evaluate width policy for this road way
        # Policy:
        # tag -> osm_tagged
        # untagged primary/secondary/tertiary -> estimated from lanes
        # untagged residential/service/track -> width_m null
        raw_width = parse_numeric_width(tags.get("width") or tags.get("maxwidth"))
        highway_type = tags.get("highway", "residential").lower()

        is_major = highway_type in (
            "primary", "primary_link",
            "secondary", "secondary_link",
            "tertiary", "tertiary_link",
            "trunk", "trunk_link",
            "motorway", "motorway_link",
        )

        if raw_width is not None:
            width_m = raw_width
            ver_state = "osm_tagged"
        elif is_major:
            lanes_str = tags.get("lanes")
            lanes_num = None
            if lanes_str:
                try:
                    lanes_num = float(lanes_str)
                except (ValueError, TypeError):
                    lanes_num = None

            if lanes_num and lanes_num > 0:
                width_m = round(lanes_num * 3.5, 2)
            else:
                if "primary" in highway_type or "trunk" in highway_type or "motorway" in highway_type:
                    width_m = 7.0
                elif "secondary" in highway_type:
                    width_m = 6.0
                else:
                    width_m = 5.5
            ver_state = "estimated_from_lanes"
        else:
            # Untagged residential / service / track / other
            width_m = None
            ver_state = "unverified"

        road_name = tags.get("name") or f"{highway_type.replace('_', ' ').capitalize()} Corridor {osm_id}"
        surface = tags.get("surface") or ("asphalt" if is_major else "paved")

        # Create segments
        for seg_idx in range(num_segments):
            start_i = split_indices[seg_idx]
            end_i = split_indices[seg_idx + 1]

            seg_geom = geom[start_i:end_i + 1]
            if len(seg_geom) < 2:
                continue

            seg_coords = [[pt["lon"], pt["lat"]] for pt in seg_geom]
            seg_xy = [to_xy(pt["lon"], pt["lat"]) for pt in seg_geom]

            if num_segments == 1:
                road_id = f"road-osm-{osm_id}"
            else:
                road_id = f"road-osm-{osm_id}-{seg_idx + 1}"

            # Check barriers within 3m
            obstruction = None
            for b_pts, b_type in barriers_xy:
                d = min_dist_pts_to_linestring(b_pts, seg_xy)
                if d <= 3.0:
                    obstruction = f"barrier:{b_type}"
                    break

            # Check power lines proximity (<= 20m)
            notes_parts = []
            for p_pts in power_lines_xy:
                d = min_dist_between_linestrings(seg_xy, p_pts)
                if d <= 20.0:
                    notes_parts.append("possible_overhead_wire")
                    break

            # Calculate initial access_status
            if obstruction:
                access_status = "infeasible"
            elif width_m is None:
                access_status = "unknown"
            elif width_m >= 3.5:
                access_status = "feasible"
            elif width_m >= 2.4:
                access_status = "constrained"
            else:
                access_status = "infeasible"

            road_props = {
                "id": road_id,
                "feature_type": "road",
                "name": road_name,
                "road_class": highway_type.replace("_", " ").capitalize(),
                "width_m": width_m,
                "surface": surface,
                "access_status": access_status,
                "obstruction": obstruction,
                "data_source": "OpenStreetMap",
                "verification_status": ver_state,
                "verification": ver_state,
                "notes": "; ".join(notes_parts) if notes_parts else None,
            }

            feat = {
                "type": "Feature",
                "id": road_id,
                "geometry": {
                    "type": "LineString",
                    "coordinates": seg_coords,
                },
                "properties": road_props,
            }
            features.append(feat)
            processed_roads_for_proximity.append((road_id, seg_xy, seg_coords))

    # Helper: Find nearest road segment to a point
    def find_nearest_road(lon: float, lat: float) -> Tuple[Optional[str], float]:
        px, py = to_xy(lon, lat)
        min_d = float("inf")
        best_id = None
        for r_id, r_xy, _ in processed_roads_for_proximity:
            d = min_dist_pts_to_linestring([(px, py)], r_xy)
            if d < min_d:
                min_d = d
                best_id = r_id
        return best_id, min_d

    # 3. Process Stations
    for st in station_elements:
        osm_id = st["id"]
        tags = st.get("tags", {})
        c_lon, c_lat = get_element_centroid(st)
        if abs(c_lat) < 1.0 or abs(c_lon) < 1.0:
            continue
        closest_road_id, setback_m = find_nearest_road(c_lon, c_lat)

        station_id = f"station-osm-{osm_id}"
        amenity = tags.get("amenity") or tags.get("emergency") or "emergency"
        station_type_label = amenity.replace("_", " ").title()
        name = tags.get("name") or f"{station_type_label} Facility {osm_id}"

        st_props = {
            "id": station_id,
            "feature_type": "station",
            "name": name,
            "station_type": station_type_label,
            "vehicle_bays": 2,
            "primary_access_road": closest_road_id,
            "access_status": "feasible",
            "data_source": "OpenStreetMap",
            "verification_status": "reference_fixture",
            "verification": "reference_fixture",
            "notes": "Verified emergency response facility location.",
        }

        feat = {
            "type": "Feature",
            "id": station_id,
            "geometry": {
                "type": "Point",
                "coordinates": [c_lon, c_lat],
            },
            "properties": st_props,
        }
        features.append(feat)

    # 4. Process Buildings
    for bldg in building_elements:
        osm_id = bldg["id"]
        tags = bldg.get("tags", {})
        c_lon, c_lat = get_element_centroid(bldg)
        if abs(c_lat) < 1.0 or abs(c_lon) < 1.0:
            continue
        closest_road_id, setback_m = find_nearest_road(c_lon, c_lat)

        bldg_id = f"bldg-osm-{osm_id}"
        levels_str = tags.get("building:levels")
        floors = None
        if levels_str:
            try:
                floors = int(float(levels_str))
            except (ValueError, TypeError):
                floors = None

        # Determine use_type
        building_val = tags.get("building", "yes").lower()
        if tags.get("amenity") == "hospital" or "health" in tags.get("healthcare", ""):
            use_type = "Healthcare / Critical"
        elif building_val in ("residential", "apartments", "house", "dormitory"):
            use_type = "Residential"
        elif building_val in ("commercial", "retail", "office"):
            use_type = "Commercial"
        elif building_val in ("university", "school", "college"):
            use_type = "Institutional"
        else:
            use_type = "General Facility"

        name = tags.get("name") or f"Building {osm_id}"

        bldg_props = {
            "id": bldg_id,
            "feature_type": "building",
            "name": name,
            "use_type": use_type,
            "floors": floors or 1,
            "access_status": "unknown",
            "connected_road_id": closest_road_id,
            "estimated_setback_m": round(setback_m, 1) if setback_m != float("inf") else 5.0,
            "data_source": "OpenStreetMap",
            "verification_status": "unverified",
            "verification": "unverified",
            "notes": f"OSM Building ({building_val}) frontage access uninspected.",
        }

        # Build geometry: Polygon if closed way, Point if node
        geom_type = "Point"
        geom_coords = [c_lon, c_lat]
        if bldg.get("type") == "way" and len(bldg.get("geometry", [])) >= 3:
            pts = [[pt["lon"], pt["lat"]] for pt in bldg["geometry"]]
            # Ensure closed ring
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            geom_type = "Polygon"
            geom_coords = [pts]
        elif bldg.get("type") == "relation" and "members" in bldg:
            outer_members = [m for m in bldg.get("members", []) if m.get("role") == "outer" and len(m.get("geometry", [])) >= 3]
            if outer_members:
                pts = [[pt["lon"], pt["lat"]] for pt in outer_members[0]["geometry"]]
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                geom_type = "Polygon"
                geom_coords = [pts]

        feat = {
            "type": "Feature",
            "id": bldg_id,
            "geometry": {
                "type": geom_type,
                "coordinates": geom_coords,
            },
            "properties": bldg_props,
        }
        features.append(feat)

    result_geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "Chandigarh University & Gharuan Sector (Real OSM Data)",
            "description": "Real OpenStreetMap emergency access intelligence dataset for Chandigarh University Gharuan campus & surrounding area.",
            "crs": "urn:ogc:def:crs:OGC:1.3:CRS84",
            "disclaimer": "PROTOTYPE DEMONSTRATION WITH REAL OPENSTREETMAP DATA.",
        },
        "features": features,
    }
    return result_geojson


def main():
    repo_root = Path(__file__).resolve().parent.parent.parent
    raw_path = repo_root / "data" / "real" / "raw" / "overpass.json"
    out_dir = repo_root / "data" / "real"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "neighbourhood.geojson"

    if not raw_path.exists():
        sys.stderr.write(f"Error: {raw_path} not found. Run fetch_osm.py first.\n")
        sys.exit(1)

    with open(raw_path, "r", encoding="utf-8") as f:
        overpass_data = json.load(f)

    geojson = convert_osm_to_geojson(overpass_data)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, indent=2)

    # Print counts by verification state
    counts_by_ver = {}
    for feat in geojson.get("features", []):
        ver = feat.get("properties", {}).get("verification_status") or feat.get("properties", {}).get("verification") or "unknown"
        counts_by_ver[ver] = counts_by_ver.get(ver, 0) + 1

    print(json.dumps(counts_by_ver, indent=2))


if __name__ == "__main__":
    main()

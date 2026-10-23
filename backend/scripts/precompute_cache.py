#!/usr/bin/env python3
"""Precompute Single-Points-Of-Failure (SPOF) and audit work-orders for real OSM data.

Generates cached JSON files in data/real/cache/ for fire, amb, and rapid apparatus profiles,
allowing instant retrieval on live endpoints without repeated multi-minute graph simulations.
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Set

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models.routing import (
    CriticalRoad,
    RouteRequest,
    SimulateChange,
    SimulateRequest,
)
from app.models.vehicle import get_vehicle_profile
from app.services.access_engine import AccessEngine, WorkOrderItem
from app.services.data_service import DataService


def precompute_real_cache():
    real_geojson_path = REPO_ROOT / "data" / "real" / "neighbourhood.geojson"
    cache_dir = REPO_ROOT / "data" / "real" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    if not real_geojson_path.exists():
        sys.stderr.write(f"Error: {real_geojson_path} does not exist. Run osm_to_geojson.py first.\n")
        sys.exit(1)

    ds = DataService(data_path=real_geojson_path)
    engine = AccessEngine(ds=ds)

    buildings = ds.get_building_features().get("features", [])
    roads = ds.get_road_features().get("features", [])
    stations = ds.get_station_features().get("features", [])
    st_id = stations[0]["id"] if stations else "station-01"

    vehicles = ["fire", "amb", "rapid"]

    severity_rank = {
        "accessible": 3,
        "constrained": 2,
        "unknown": 1,
        "inaccessible": 0,
    }

    for v_id in vehicles:
        print(f"Precomputing cache for apparatus: {v_id}...")
        t0 = time.time()
        vehicle = get_vehicle_profile(v_id)

        # 1. Map baseline routes from station to all buildings
        road_to_bldgs: Dict[str, Set[str]] = {}
        for b in buildings:
            b_id = b["id"]
            req = RouteRequest(origin_station_id=st_id, destination_building_id=b_id, vehicle_id=v_id)
            resp = engine.calculate_route(req)
            for r_seg in resp.segments_traversed:
                road_to_bldgs.setdefault(r_seg, set()).add(b_id)

        # 2. Compute critical roads (SPOF)
        critical_items: List[Dict[str, Any]] = []
        road_impact_map: Dict[str, int] = {}

        for road in roads:
            r_props = road.get("properties", {})
            r_id = r_props.get("id") or road.get("id")
            r_name = r_props.get("name", r_id)
            candidates = road_to_bldgs.get(r_id, set())

            worsened_bldgs = []
            if candidates:
                sim_req = SimulateRequest(
                    vehicle_id=v_id,
                    changes=[SimulateChange(road_id=r_id, action="close")],
                )
                sim_resp = engine.simulate(sim_req)
                for cb in sim_resp.changed_buildings:
                    if cb.id in candidates and severity_rank.get(cb.before, 0) > severity_rank.get(cb.after, 0):
                        worsened_bldgs.append(cb.id)

            impact = len(worsened_bldgs)
            road_impact_map[r_id] = impact

            coords = road.get("geometry", {}).get("coordinates", [])
            critical_items.append({
                "road_id": r_id,
                "name": r_name,
                "buildings_affected": impact,
                "worsened_buildings": worsened_bldgs,
            "building_ids": worsened_bldgs,
                "road_class": r_props.get("road_class"),
                "width_m": r_props.get("width_m"),
                "surface": r_props.get("surface"),
                "coordinates": coords,
            })

        # Sort critical roads by impact descending
        critical_items.sort(key=lambda x: (x["buildings_affected"], x["name"]), reverse=True)

        crit_path = cache_dir / f"critical_roads_{v_id}.json"
        with open(crit_path, "w", encoding="utf-8") as f:
            json.dump(critical_items, f, indent=2)

        # 3. Compute audit work order
        work_order_items: List[Dict[str, Any]] = []
        for road in roads:
            r_props = road.get("properties", {})
            r_id = r_props.get("id") or road.get("id")
            r_name = r_props.get("name", r_id)
            data_src = r_props.get("data_source", "OpenStreetMap")

            asmt = engine.evaluate_segment(road_id=r_id, vehicle=vehicle, props=r_props)
            ver = str(r_props.get("verification_status") or r_props.get("verification") or "").lower()

            is_unknown = (
                asmt.status.value == "unknown"
                or r_props.get("access_status") == "unknown"
                or r_props.get("width_m") is None
            )
            is_unverified = (
                "unverified" in ver
                or "uninspected" in ver
                or ver in ["unverified", "unverified_survey", "uninspected"]
            )

            if not (is_unknown or is_unverified):
                continue

            if r_props.get("reason"):
                reason = r_props["reason"]
            elif is_unknown:
                reason = asmt.notes or r_props.get("notes") or "Width unmeasured in cadastre; clearance unverified."
            else:
                reason = "Unverified cadastral survey: field ground truth audit required."

            impact = road_impact_map.get(r_id, 0)
            work_order_items.append({
                "road_id": r_id,
                "name": r_name,
                "reason": reason,
                "buildings_affected": impact,
                "data_source": data_src,
            })

        work_order_items.sort(key=lambda x: (x["buildings_affected"], x["name"]), reverse=True)

        wo_path = cache_dir / f"audit_work_order_{v_id}.json"
        with open(wo_path, "w", encoding="utf-8") as f:
            json.dump(work_order_items, f, indent=2)

        print(f"Finished {v_id} in {time.time()-t0:.2f}s (Critical: {len(critical_items)}, Audit: {len(work_order_items)})")


if __name__ == "__main__":
    precompute_real_cache()

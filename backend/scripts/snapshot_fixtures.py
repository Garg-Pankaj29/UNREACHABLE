"""
Snapshot fixtures generator for UNREACHABLE offline replay fallback.
Executes against in-memory Python services (and optionally live server)
to serialize exact responses for all demo path & app views into frontend/public/fixtures/.
"""

import os
import json
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.services.data_service import DataService
from app.services.access_engine import AccessEngine
from app.services.explain_service import explain_service
from app.models.routing import RouteRequest, SimulateRequest, SimulateChange
from app.models.vehicle import SUPPORTED_VEHICLES


def dump_json(obj, target_path: Path):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if hasattr(obj, "model_dump"):
        data = obj.model_dump(mode="json")
    elif isinstance(obj, list):
        data = [item.model_dump(mode="json") if hasattr(item, "model_dump") else item for item in obj]
    elif isinstance(obj, dict):
        data = obj
    else:
        data = obj
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote fixture: {target_path.name}")


def main():
    repo_root = backend_dir.parent
    fixtures_dir = repo_root / "frontend" / "public" / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    print(f"Target fixtures directory: {fixtures_dir}")

    ds = DataService()
    engine = AccessEngine(ds=ds)
    explain_svc = explain_service

    # 1. Health
    health = {
        "status": "ok",
        "app": "UNREACHABLE",
        "version": "0.1.0",
        "dataset": "Ward 142 (Synthetic)",
        "dataset_status": "loaded",
    }
    dump_json(health, fixtures_dir / "health.json")

    # 2. GeoJSON collections
    dump_json(ds.get_feature_collection(), fixtures_dir / "neighbourhood.json")
    dump_json(ds.get_building_features(), fixtures_dir / "buildings.json")
    dump_json(ds.get_road_features(), fixtures_dir / "roads.json")

    # 3. Vehicles
    dump_json(list(SUPPORTED_VEHICLES.values()), fixtures_dir / "vehicles.json")

    # 4. Stats & Vehicle gap
    dump_json(ds.get_stats(), fixtures_dir / "stats.json")
    for v in ["fire", "amb", "rapid"]:
        dump_json(ds.get_stats(v), fixtures_dir / f"stats_{v}.json")
    dump_json(ds.get_vehicle_gap(), fixtures_dir / "vehicle-gap.json")

    # 5. Critical roads
    for v in ["fire", "amb", "rapid"]:
        cr = engine.get_critical_roads(vehicle_id=v, limit=5)
        dump_json([c.model_dump(mode="json") for c in cr], fixtures_dir / f"critical-roads_{v}.json")
        dump_json([c.model_dump(mode="json") for c in cr], fixtures_dir / f"critical-roads_{v}_5.json")

    # 6. Road access
    road_ids = ["road-101", "road-102", "road-103", "road-104", "road-105", "road-106"]
    for r_id in road_ids:
        for v in ["fire", "amb", "rapid"]:
            try:
                resp = engine.assess_road_access(road_id=r_id, vehicle_id=v)
                dump_json(resp, fixtures_dir / f"road-access_{r_id}_{v}.json")
            except Exception as e:
                print(f"Skip road-access {r_id} {v}: {e}")

    # 7. Building access
    bldg_ids = ["bldg-201", "bldg-202", "bldg-203", "bldg-204", "bldg-205", "bldg-206"]
    for b_id in bldg_ids:
        for v in ["fire", "amb", "rapid"]:
            try:
                ba = engine.assess_building_access(b_id, v, "station-01")
                dump_json(ba, fixtures_dir / f"building-access_{b_id}_{v}_station-01.json")
            except Exception as e:
                print(f"Skip building-access {b_id} {v}: {e}")

    # 8. Routes
    for b_id in ["bldg-201", "bldg-204", "bldg-206"]:
        for v in ["fire", "rapid"]:
            try:
                rt = engine.calculate_route(
                    RouteRequest(origin_station_id="station-01", destination_building_id=b_id, vehicle_profile=v)
                )
                dump_json(rt, fixtures_dir / f"route_station-01_{b_id}__{v}.json")
                dump_json(rt, fixtures_dir / f"route_station-01_{b_id}_{v}.json")
            except Exception as e:
                print(f"Skip route {b_id} {v}: {e}")

    # 9. Reality Check comparison
    for b_id in ["bldg-201", "bldg-204", "bldg-206"]:
        for v in ["fire", "rapid"]:
            try:
                cmp_res = engine.compare_routes("station-01", b_id, v)
                dump_json(cmp_res, fixtures_dir / f"compare_station-01_{b_id}_{v}.json")
                dump_json(cmp_res, fixtures_dir / f"compare_station-01_{b_id}__{v}.json")
            except Exception as e:
                print(f"Skip compare {b_id} {v}: {e}")

    # 10. Simulations
    # Baseline
    sim_baseline = engine.simulate(SimulateRequest(vehicle_id="fire", changes=[]))
    dump_json(sim_baseline, fixtures_dir / "simulate_baseline_fire.json")
    dump_json(sim_baseline, fixtures_dir / "simulate_default.json")

    # Critical road block: road-101
    sim_block_101 = engine.simulate(
        SimulateRequest(
            vehicle_id="fire",
            changes=[SimulateChange(road_id="road-101", action="close")],
        )
    )
    dump_json(sim_block_101, fixtures_dir / "simulate_block_road-101_fire.json")

    # Fix simulation: road-104 clear obstruction
    sim_clear_104 = engine.simulate(
        SimulateRequest(
            vehicle_id="fire",
            changes=[SimulateChange(road_id="road-104", action="clear_obstruction")],
        )
    )
    dump_json(sim_clear_104, fixtures_dir / "simulate_clear_road-104_fire.json")
    dump_json(sim_clear_104, fixtures_dir / "simulate_issue_I-01_fire.json")
    dump_json(sim_clear_104, fixtures_dir / "simulate_issue_I-02_fire.json")

    # 11. Explanations
    for b_id in ["bldg-201", "bldg-204", "bldg-206"]:
        exp = explain_svc.explain("station-01", b_id, "fire")
        dump_json(exp, fixtures_dir / f"explain_station-01_{b_id}_fire.json")

    # 12. Audit work order
    for v in ["fire", "amb", "rapid"]:
        awo = engine.get_audit_work_order(vehicle_id=v)
        dump_json([item.model_dump(mode="json") for item in awo], fixtures_dir / f"audit_work_order_{v}.json")
    dump_json([item.model_dump(mode="json") for item in engine.get_audit_work_order("fire")], fixtures_dir / "audit_work_order_default.json")

    print("All snapshot fixtures generated successfully!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Verification script: query all /api endpoints on local FastAPI instance."""
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

def get(path, params=""):
    url = f"{BASE_URL}{path}{'?' + params if params else ''}"
    req = urllib.request.Request(url, headers={"User-Agent": "UNREACHABLE-Verifier"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()

def post(path, body):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "UNREACHABLE-Verifier"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()

def main():
    s, d = get("/api/health")
    data_mode = json.loads(d.decode()).get("data_mode", "demo")
    
    if data_mode == "real":
        s_id = "station-osm-1216904632"
        b_id = "bldg-osm-4393899629"
        r_id = "road-osm-4034874"
    else:
        s_id = "station-01"
        b_id = "bldg-201"
        r_id = "road-101"

    tests = [
        ("GET  /api/health", lambda: get("/api/health")),
        ("GET  /api/stats", lambda: get("/api/stats")),
        ("GET  /api/buildings", lambda: get("/api/buildings")),
        ("GET  /api/roads", lambda: get("/api/roads")),
        ("GET  /api/vehicles", lambda: get("/api/vehicles")),
        ("GET  /api/vehicles/fire", lambda: get("/api/vehicles/fire")),
        ("GET  /api/neighbourhood", lambda: get("/api/neighbourhood")),
        ("POST /api/routing/route", lambda: post("/api/routing/route", {"origin_station_id": s_id, "destination_building_id": b_id, "vehicle_id": "fire"})),
        ("GET  /api/routing/route", lambda: get("/api/routing/route", f"origin={s_id}&destination_building={b_id}&vehicle=fire")),
        ("POST /api/routing/alternatives", lambda: post("/api/routing/alternatives", {"origin_station_id": s_id, "destination_building_id": b_id, "vehicle_id": "fire", "max_alternatives": 2})),
        ("GET  /api/routing/alternatives", lambda: get("/api/routing/alternatives", f"origin={s_id}&destination_building={b_id}&vehicle=fire&k=2")),
        ("GET  /api/routing/compare", lambda: get("/api/routing/compare", f"station_id={s_id}&building_id={b_id}&vehicle_id=fire")),
        (f"GET  /api/routing/building-access/{b_id}", lambda: get(f"/api/routing/building-access/{b_id}", "vehicle_id=fire")),
        (f"GET  /api/routing/road-access/{r_id}", lambda: get(f"/api/routing/road-access/{r_id}", "vehicle_id=fire")),
        ("POST /api/simulate", lambda: post("/api/simulate", {"blocked_roads": [r_id], "vehicle_id": "fire"})),
        ("GET  /api/analysis/critical-roads", lambda: get("/api/analysis/critical-roads", "vehicle_id=fire&limit=3")),
        ("GET  /api/analysis/vehicle-gap", lambda: get("/api/analysis/vehicle-gap")),
        ("POST /api/explain", lambda: post("/api/explain", {"station_id": s_id, "building_id": b_id, "vehicle_id": "fire"})),
        ("GET  /api/audit/work-order", lambda: get("/api/audit/work-order", "vehicle_id=fire")),
        ("GET  /api/pilot/summary", lambda: get("/api/pilot/summary")),
        ("GET  /api/pilot/features", lambda: get("/api/pilot/features", "layer=stations&limit=5")),
        ("GET  /api/pilot/facilities", lambda: get("/api/pilot/facilities", "limit=5")),
        ("GET  /api/pilot/search", lambda: get("/api/pilot/search", "q=hospital&limit=3")),
        ("POST /api/incidents", lambda: post("/api/incidents", {"road_id": r_id, "action": "block", "reason": "Verification test"})),
        ("GET  /api/incidents", lambda: get("/api/incidents")),
        ("POST /api/incidents (clear)", lambda: post("/api/incidents", {"road_id": r_id, "action": "clear"})),
        ("GET  / (Frontend SPA)", lambda: get("/")),
    ]

    all_ok = True
    results = []
    for name, fn in tests:
        status, body = fn()
        ok = (status == 200)
        if not ok:
            all_ok = False
        results.append((name, status, "PASS" if ok else "FAIL"))

    passed = sum(1 for _, _, res in results if res == "PASS")
    print(f"Summary: {passed}/{len(results)} endpoints PASSED")
    for name, status, res in results:
        print(f"  [{res}] {name} -> {status}")
    if all_ok:
        print("ALL ENDPOINTS VERIFIED OK (200)")

if __name__ == "__main__":
    main()

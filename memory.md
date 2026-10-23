# memory.md — UNREACHABLE (agent working memory)

> Read this file FIRST. Do not scan repo. Keep under 60 lines.

## 1. Project snapshot
- UNREACHABLE: emergency-access intelligence. Can THIS vehicle reach THIS building.
- Deterministic rules decide access; AI only explains. Unknown is valid/actionable.
- Data: synthetic demo (data/sample/) + real mode transition (data/real/).
- Local-first: backend 127.0.0.1:8000, frontend 127.0.0.1:5173. No cloud/new deps.

## 2. Stack and run
- Backend: FastAPI, Python 3.10+. `cd backend && python -m unittest discover -s tests -q`
- Frontend: React 18 + TS + Vite + Leaflet + Tailwind. `cd frontend && npm run build`
- Routing: hash routes (#/map #/routes #/simulation #/interventions #/demo #/about)

## 3. Domain facts
- Vehicles: fire (>=3.5m), amb (>=3.0m), rapid (>=2.4m).
- Statuses: Feasible green | Constrained amber | Infeasible red | Unknown grey.
- Routing: penalty Dijkstra; blocked=inf, constrained x2.5, unknown x3.0.
- Constraints evaluated: clearance width (`width_m`), physical `obstruction`.

## 4. API & Code map
- Access & multi-route: `backend/app/services/access_engine.py` (calculate_route, compare_routes)
- Explain & guardrails: `backend/app/services/explain_service.py` (strict numeric guardrail)
- Stats & vehicle gap: `backend/app/services/data_service.py`
- Pipelines: `backend/scripts/fetch_osm.py`, `backend/scripts/osm_to_geojson.py`
- Endpoints: /api/health, /api/stats, /api/routing/route, /api/routing/compare, /api/simulate, /api/analysis/critical-roads, /api/explain, /api/audit/work-order

## 5. Phase status
| Phase | Task | Status |
|---|---|---|
| 0 | Real-mode baseline audit, tag demo-safe | done |
| 1 | Real data ingestion (fetch_osm.py) | done |
| 2 | Real OSM to GeoJSON (osm_to_geojson.py) | done |
| 3 | Backend real-mode integration & cache | done |
| 4 | Frontend real-mode & vector basemap | done |

- 2026-10-24 | Phase 4 | Expanded to state-wide Punjab emergency network (497 facilities across 23 districts); 75/75 tests OK, build OK | MapView.tsx, TopHeader.tsx, memory.md
- 2026-10-24 | Phase 4 | Added clinics/doctors to visibleStations (teal '+' markers at all zooms); 75/75 tests OK, build OK | MapView.tsx, memory.md
- 2026-10-24 | Phase 4 | Fixed zoom overlap (bottom: 204px) and stopped LOD auto-zoom-out; 75/75 tests OK, build OK | MapView.tsx, AccessAtlasPage.tsx, memory.md
- 2026-10-24 | Phase 4 | Restored OpenStreetMap TileLayer, sanitized relation bounds, auto-fit viewport; 75/75 tests OK, build OK | MapView.tsx, osm_to_geojson.py, memory.md

## 7. Rules for agents
- Additive changes only; keep demo mode intact; never modify data/sample/.
- Run backend tests & frontend build after each task; check last 15 lines.
- Finish by updating memory.md (≤60 lines), then git commit. Max 10 lines reply.

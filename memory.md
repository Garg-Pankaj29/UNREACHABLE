# memory.md — UNREACHABLE (agent working memory)

> Read this file FIRST. Do not scan repo. Keep under 60 lines.

## 1. Project snapshot
- UNREACHABLE: emergency-access intelligence. Can THIS vehicle reach THIS building.
- Deterministic rules decide access; AI only explains. Unknown is valid/actionable.
- Data: synthetic demo (data/sample/) + real mode transition (data/real/).
- Local-first: backend 127.0.0.1:8000 (serves API + SPA). No cloud/new deps.

## 2. Stack and run
- Backend: FastAPI, Python 3.10+. `cd backend && python -m unittest discover -s tests -q`
- Frontend: React 18 + TS + Vite + Leaflet + Tailwind. `cd frontend && npm run build`
- Single launcher: `./scripts/start_demo.sh` (DATA_MODE=real, serves SPA on port 8000)
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
- Endpoints: /api/health, /api/stats, /api/routing/route, /api/simulate, /api/incidents, /api/stream

## 5. Phase status
| Phase | Task | Status |
|---|---|---|
| 0-4 | Real ingestion, GeoJSON pipeline, 497 Punjab facilities, clinics | done |
| 5 | SQLite incidents, live recompute, SSE stream | done |
| 6 | StaticFiles SPA, start_demo.sh, offline guardrails, tagged demo-final | done |

- 2026-10-24 | Vision VLM & Road Certify | Connected LM Studio Gemma vision model; real base64 inspection, estimated carriageway width, instant in-memory road certification, unblocked fire access with true distance; 79/79 tests OK, build OK | vision_service.py, access_engine.py, routes.py, AIInspectorPage.tsx, api.ts, memory.md
- 2026-10-24 | Emergency Route & Pointer Fix | Dedicated emergencyRoutePane z-550, origin/destination pins, halted stray unit tracking loop, offline GPS architecture in explain.md; 79/79 tests OK, build OK | MapView.tsx, AccessAtlasPage.tsx, incident_service.py, explain.md, memory.md
- 2026-10-24 | Road Fix | Vehicle-aware dynamic road styling (Feasible/Constrained/Inaccessible/Unknown); road click highlight fixed; 79/79 tests OK, build OK | MapView.tsx, AccessAtlasPage.tsx, api.ts, memory.md
- 2026-10-24 | Phase 6 | StaticFiles SPA mount, scripts/start_demo.sh, docs/DEMO_CHECKLIST.md, tagged demo-final; 79/79 tests OK, build OK | main.py, start_demo.sh, DEMO_CHECKLIST.md, memory.md

## 6. Rules for agents
- Additive changes only; keep demo mode intact; never modify data/sample/.
- Run backend tests & frontend build after each task; check last 15 lines.
- Finish by updating memory.md (≤60 lines), then git commit. Max 10 lines reply.


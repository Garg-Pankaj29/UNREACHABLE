# memory.md — UNREACHABLE (agent working memory)

> Read this file FIRST. Do not scan the repo. Keep this file under 120 lines.
> Items marked (VERIFY) come from the README and are confirmed/corrected in Phase 0.

## 1. Project snapshot
- UNREACHABLE: emergency-access intelligence. Answers: can THIS vehicle reach THIS building, how sure are we, what to fix first.
- Deterministic rules decide access. AI only explains. Unknown is a valid, actionable result.
- Data is SYNTHETIC (data/sample/neighbourhood.geojson, Chandigarh University & Gharuan Sector). Always label it so.
- Local-first: backend binds 127.0.0.1:8000, frontend 127.0.0.1:5173. No cloud, no new deps.
- Hackathon goal: 3 demo moments = Reality Check, Break-the-city (critical roads), Fix-first simulation.

## 2. Stack and run
- Backend: FastAPI + Pydantic v2, Python 3.10+. `cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`
- Tests: `cd backend && python -m unittest discover -s tests -q` (10 baseline tests in tests/test_access_engine.py)
- Frontend: React 18 + TS + Vite + Leaflet + Tailwind. `cd frontend && npm run dev` / `npm run build`
- Routing: hash routes (#/map #/routes #/simulation #/interventions, others per pages list)

## 3. Domain facts
- Vehicles: fire (>=3.5 m), amb (>=3.0 m), rapid (>=2.4 m)
- Statuses: Feasible(ok) green | Constrained amber | Infeasible red | Unknown grey (Unassessed = external place, no local data)
- Routing: penalty Dijkstra; blocked=inf, constrained x2.5, unknown x3.0 (VERIFY)
- Vehicle gap: evidence_coverage_pct = (feasible+constrained+infeasible)/total*100; verified_reachable_pct = feasible/(feasible+constrained+infeasible)*100 (Unknown excluded)
- Data fields: width_m, obstruction, surface, data_source, verification (unverified_survey | ground_verified | synthetic_fixture) (VERIFY)
- IDs: station-01, bldg-201, bldg-206 (VERIFY)
- Building result separates road-frontage arrival vs unconfirmed entrance.

## 4. API map (existing)
GET /api/health, /api/stats?vehicle_id=, /api/buildings, /api/roads, /api/neighbourhood, /api/vehicles, /api/vehicles/{id}
GET|POST /api/routing/route | GET /api/routing/building-access/{id} | GET /api/routing/road-access/{id}
GET /api/routing/compare?station_id=&building_id=&vehicle_id=
POST /api/simulate | GET /api/analysis/critical-roads?vehicle_id=&limit=5 | GET /api/analysis/vehicle-gap
POST /api/explain (station_id, building_id, vehicle_id) -> {text, source, validated}
GET /api/audit/work-order?vehicle_id= -> [{road_id,name,reason,buildings_affected,data_source}]

## 5. Verified code map (fill in Phase 0)
- Route computation: `backend/app/services/access_engine.py`: `AccessEngine.calculate_route(request: RouteRequest) -> RouteResponse`
- Route comparison: `backend/app/services/access_engine.py`: `AccessEngine.compare_routes(...) -> RouteCompareResponse`
- Route explanation: `backend/app/services/explain_service.py`: `ExplainService.explain(...) -> ExplainResponse`
- Simulation: `backend/app/services/access_engine.py`: `AccessEngine.simulate(request: SimulateRequest) -> SimulateResponse`
- Critical roads: `backend/app/services/access_engine.py`: `AccessEngine.get_critical_roads(...) -> List[CriticalRoad]`
- Audit work order: `backend/app/services/access_engine.py`: `AccessEngine.get_audit_work_order(...) -> List[WorkOrderItem]`
- Per-building assessment: `backend/app/services/access_engine.py`: `AccessEngine.assess_building_access(...) -> BuildingAccessResponse`
- Road segment assessment: `backend/app/services/access_engine.py`: `AccessEngine.evaluate_segment(...) -> SegmentAssessment`
- Stats & vehicle gap: `backend/app/services/data_service.py`: `DataService.get_stats()`, `get_vehicle_gap()`
- Constraints actually evaluated: width (`width_m` vs `min_clearance_width_m`, margin < 0.4m constrained), physical obstruction (`obstruction`). Unevaluated in code: surface, turning radius, gross weight, vertical clearance, gate restrictions.
- Simulation computed in: backend (`POST /api/simulate`) on in-memory dataset copy; UI in `SimulationPage.tsx` and `DetailPanel.tsx`.
- AI/LM Studio: local OpenAI-compatible endpoint at LM_STUDIO_URL (default 127.0.0.1:1234/v1) with strict numeric guardrail & template fallback.
- Demo entry frontend: React app at `http://127.0.0.1:5173` (`frontend/index.html` -> `src/App.tsx`). Guided demo at `#/demo` (`DemoPage.tsx`).
- Replay fallback: `backend/scripts/snapshot_fixtures.py` -> `frontend/public/fixtures/`, offline fallback in `frontend/src/services/api.ts`.

## 6. Phase status
| Phase | Task | Status |
|---|---|---|
| 0 | Baseline audit | done |
| 1 | Reality Check (/api/routing/compare) | done |
| 2 | /api/simulate + critical-roads | done |
| 3 | Vehicle gap scorecard | done |
| 4 | AI explain + guardrail (/api/explain) | done |
| 5 | Demo mode + replay fallback | done |
| 6 | Freeze + README truth | done |
| 7 | Audit work order (optional) | done |

## 7. Recent changes (newest first, MAX 8 lines, one line each: date | phase | what | files)
- 2026-10-22 | Polish | Updated dataset to Chandigarh University & Gharuan Sector (lat 30.7686, lon 76.5750) and refreshed all fixtures; tests 32/32 OK, build OK | neighbourhood.geojson, MapView.tsx, OverviewPage.tsx, InterventionsPage.tsx, DemoPage.tsx, memory.md
- 2026-10-22 | Polish | Fixed light mode synthetic badge contrast and swapped all emojis for Lucide React icons; tests 32/32 OK, build OK | index.css, TopHeader.tsx, App.tsx, DashboardPage.tsx, DemoPage.tsx, RoutesPage.tsx, SimulationPage.tsx, memory.md
- 2026-10-22 | Polish | Fixed navbar overlap with frosted opacity/blur, integrated badges, friendly theme toggle; tests 32/32 OK, build OK | index.css, TopHeader.tsx, App.tsx, memory.md
- 2026-10-22 | Phase 7 | Added GET /api/audit/work-order, CSV export & print view in InterventionsPage; tests 30/30 OK, build OK | access_engine.py, routes.py, test_access_engine.py, InterventionsPage.tsx, api.ts, memory.md
- 2026-10-22 | Phase 6 | Added loading/empty/error states, universal ribbon, aligned README claims & added Hackathon update; tests 29/29 OK, build OK | App.tsx, TopHeader.tsx, BuildingDetailPage.tsx, RoutesPage.tsx, SimulationPage.tsx, OverviewPage.tsx, AIInspectorPage.tsx, AccessAtlasPage.tsx, README.md, memory.md
- 2026-10-22 | Phase 5 | Added DemoPage (7-step presenter bar), snapshot_fixtures script, api replay fallback & visible badge; tests 29/29 OK, build OK | DemoPage.tsx, App.tsx, api.ts, snapshot_fixtures.py, memory.md
- 2026-10-22 | Phase 4 | Added POST /api/explain, explain_service with strict guardrails, UI Explain & two cards; tests 29/29 OK, build OK | explain_service.py, routes.py, schemas.py, test_explain.py, RoutesPage.tsx, AIInspectorPage.tsx, api.ts, index.ts, App.tsx, memory.md
- 2026-10-22 | Phase 3 | Added ?vehicle_id= to /api/stats, GET /api/analysis/vehicle-gap, Vehicle gap strip in OverviewPage; tests 20/20 OK, build OK | data_service.py, schemas.py, routes.py, test_vehicle_gap.py, OverviewPage.tsx, api.ts, index.ts, memory.md


## 8. Known issues / README-vs-code gaps
- Reconciled in Phase 6: README claims now match active code constraints (width and obstruction), local LLM briefing + template fallback documented, and demo entry point clarified.


## 9. Rules for agents
- Additive changes only; no response-shape changes; no new dependencies; no refactors.
- Do not mutate loaded dataset during simulation (copy first).
- Unknown is never counted as reachable or unreachable.
- Reply max 10 lines; no code echo in chat.

## 10. Update protocol (do this LAST in every task)
1. Add ONE line to "Recent changes" (date | phase | what | files). If more than 8 lines, delete the oldest.
2. Update the Phase status table.
3. If a new endpoint/page/file matters, add one line to the relevant section (API map or Code map).
4. Move solved items out of "Known issues"; add new ones.
5. Keep the file under 120 lines. Prefer editing lines to appending.
6. Record the test and build result in one line under Recent changes.

# UNREACHABLE — Offline Demonstration & Evaluation Checklist

This checklist provides the exact operational procedure to demonstrate the UNREACHABLE Emergency Accessibility Intelligence platform completely offline (Wi-Fi off / air-gapped).

---

## 1. Network Isolation & Cold Start (Wi-Fi Off)

1. **Disable Network / Wi-Fi**:
   - Turn off Wi-Fi or disconnect Ethernet:
     ```bash
     # Linux / NetworkManager
     nmcli networking off
     # Or simply toggle Wi-Fi OFF in system settings
     ```
   - Verify network isolation:
     ```bash
     ping -c 1 8.8.8.8 || echo "Offline verified (external network unreachable)"
     ```

2. **Cold Start Single Command**:
   - From the repository root, start the full platform:
     ```bash
     ./scripts/start_demo.sh
     ```
   - This exports `DATA_MODE=real`, verifies `frontend/dist` production assets, and boots FastAPI serving both the backend API and the compiled React SPA on port 8000.
   - Open browser: **`http://127.0.0.1:8000`**

---

## 2. Three Scripted Scenarios

### Scenario 1: State-Wide Punjab Emergency Coverage & Health Facility Density
- **Objective**: Demonstrate multi-district emergency network coverage and local facility visibility.
- **Actions**:
  1. Open the Map page (`#/map`).
  2. Notice the top statistics counter: **497 Emergency Facilities** across Punjab & Chandigarh (Amritsar, Jalandhar, Ludhiana, Patiala, SAS Nagar/Mohali, Bathinda).
  3. Pan across Punjab and zoom into dense urban centers.
  4. Observe hospital and fire station emergency hubs (red/blue markers) and clinics/doctor posts (teal `+` markers) discoverable across all zoom levels.
  5. Click any facility to inspect its coverage radius and connected road segments.

### Scenario 2: Vehicle Access Gap & Clearance Bottleneck Analysis
- **Objective**: Show how vehicle physical dimensions dictate emergency accessibility.
- **Actions**:
  1. Navigate to Routes / Access Analysis (`#/routes`).
  2. Select Station `station-osm-1216904632` and Target Building `bldg-osm-4393899629`.
  3. Compare routes across vehicle profiles:
     - **Heavy Fire Tender (`fire`, 3.5m clearance)**: Flagged as `Constrained` or `Infeasible` due to narrow residential alleyways and clearance deficits.
     - **Light QRV (`rapid`, 2.4m clearance)**: Shows `Feasible` green route bypassing narrow choke points.
  4. Inspect the bottleneck road ID and clearance deficit.
  5. Check Audit / Work Order (`#/interventions`) to view prioritized clearance interventions for municipal road engineers.

### Scenario 3: Real-Time Incident Obstruction, Live Re-Routing & SSE Tracking
- **Objective**: Demonstrate dynamic road incident handling and in-memory routing recalculation.
- **Actions**:
  1. On the map route inspection panel, click **"Block this road"** on any active transit segment.
  2. An incident is dispatched via `POST /api/incidents` and saved to SQLite (`data/incidents.sqlite`).
  3. The backend penalty Dijkstra immediately recalculates an alternative detour without restarting or rewriting GeoJSON.
  4. Observe the live Server-Sent Events stream (`/api/stream`) broadcasting incident state updates and animating the simulated unit position along the detour.
  5. Click **"Clear obstruction"** to restore normal traffic flow; the route reverts smoothly.

---

## 3. Fallback Steps & Reliability Safeguards

| Component | Condition | Automatic Fallback Behavior |
|---|---|---|
| **LLM Explanations** | LM Studio / Local model stopped | Fallback engine uses validated deterministic templates (`source="template"`, `validated=True`). Guardrail ensures zero hallucinated metrics. |
| **Map Basemap** | External tile server unreachable (Wi-Fi off) | Client falls back gracefully to dark canvas vector rendering of Punjab road networks and station nodes. |
| **Incidents SQLite** | Lock or corrupted state | SQLite database automatically initializes schema on first call. Reset with `rm -f data/incidents.sqlite`. |
| **Port Conflicts** | Port 8000 already bound | Specify custom port: `PORT=8080 ./scripts/start_demo.sh`. |

---

## 4. Verification Health Checks

Run these commands in a separate terminal while `start_demo.sh` is running:

```bash
# 1. Platform Health
curl -s http://127.0.0.1:8000/api/health | jq '{status, data_mode, counts}'

# 2. Pilot Summary & Mode
curl -s http://127.0.0.1:8000/api/pilot/summary | jq '{status, total_facilities}'

# 3. Incident List
curl -s http://127.0.0.1:8000/api/incidents | jq .

# 4. Critical Roads Analysis
curl -s "http://127.0.0.1:8000/api/analysis/critical-roads?vehicle_id=fire&limit=3" | jq .
```

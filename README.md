# UNREACHABLE

> **Know the access. Find the constraint. Fix it before an emergency.**

An AI-powered emergency accessibility intelligence platform designed for Indian cities and dense urban environments.

---

## Current Status: Phase 1 — Clean Foundation and Working MVP Shell

Phase 1 provides a clean, decoupled foundation and an interactive operational interface:
- **FastAPI backend** reading GeoJSON datasets from repository-relative paths and exposing health, geometry, and status aggregation endpoints.
- **React + TypeScript + Vite + Tailwind CSS frontend** rendering an interactive **Leaflet** map with clear visual styling for emergency accessibility classes.
- **Vehicle clearance evaluation** comparing standard fire tenders (2.5m), ambulances (2.2m), and two-wheeler rapid responders (1.2m).
- **Asset inspection panel** detailing building setbacks, road widths, simulated physical constraints, and verification statuses.
- **Synthetic sample neighbourhood** centered in an Indian urban coordinate frame (WGS84) illustrating bottlenecks, overhead wire obstacles, and unmeasured lanes.

---

## Project Structure

```
UNREACHABLE/
├── frontend/
│   ├── src/
│   │   ├── components/         # Navigation, Legend, Inspection, Map, Vehicle Selector, Stats
│   │   ├── pages/              # DashboardPage
│   │   ├── services/           # Typed API service client
│   │   ├── types/              # TypeScript interfaces
│   │   ├── App.tsx             # Root React component
│   │   ├── index.css           # Tailwind + Leaflet overrides
│   │   └── main.tsx            # React 18 DOM mount
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── api/                # FastAPI routes (/api/health, /api/buildings, /api/roads, /api/stats)
│   │   ├── core/               # Configuration, CORS, relative path resolution
│   │   ├── models/             # Pydantic v2 schemas
│   │   ├── services/           # Data loading & statistics aggregation service
│   │   └── main.py             # FastAPI application entry point
│   └── requirements.txt
├── data/
│   └── sample/
│       └── neighbourhood.geojson # Synthetic demonstration dataset
├── docs/
│   ├── ARCHITECTURE.md         # System flow, data models, feasibility criteria
│   └── DEVELOPMENT.md          # Setup instructions and commands
├── .gitignore
└── README.md
```

---

## Quickstart

### Prerequisites
- Python 3.10+
- Node.js 18+ and npm
- No paid third-party API keys required

### 1. Start the Backend Service
```powershell
# From project root
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
API runs at `http://127.0.0.1:8000`. Test health at `http://127.0.0.1:8000/api/health`.

### 2. Start the Frontend Application
In a separate terminal:
```powershell
# From project root
cd frontend
npm install
npm run dev
```
Open `http://127.0.0.1:5173` in your browser.

---

## Core Features in Phase 1 MVP Shell

1. **Interactive Municipal Operations Map**:
   Vector rendering of building footprints, road corridors, and emergency stations using Leaflet and OpenStreetMap.
2. **Access State Classification**:
   - 🟢 **Feasible**: Ingress meeting apparatus clearance without known bottlenecks.
   - 🟠 **Constrained**: Narrow lanes (< 2.5m) requiring specialized apparatus (QRV/relay hoses).
   - 🔴 **Infeasible**: Blocked by simulated physical barriers, bollards, or low hanging wire bundles.
   - ⚪ **Unknown**: Unmeasured road width or unverified cadastre entry.
3. **Vehicle Profile Switcher**:
   Real-time evaluation against 3 apparatus categories (Type 1 Water Tender, ALS Ambulance, and QRV Two-Wheeler).
4. **Attribute & Hazard Inspector**:
   Clicking any feature displays asset ID, verified status, data source, physical width, surface, and obstruction details.
5. **No Hallucinated Safety Claims**:
   Buildings are not marked as verified accessible solely because their road geometry exists; data sources and verification flags are transparently surfaced.

---

## Limitations & Prototype Disclaimer

- **Prototype Demonstration**: All sample geometries, road widths, and constraints in `data/sample/neighbourhood.geojson` are synthetic fixtures created for technical validation. They do not constitute official emergency certifications or dispatch guarantees.
- **Out of Scope in Phase 1**: Computer vision image analysis, autonomous road-width measurement, GPS dispatch integration, live obstruction tracking, and pathfinding routing algorithms are slated for subsequent phases.

---

## License

MIT License.

# UNREACHABLE — Local Development Guide

This guide walks through setting up and running the UNREACHABLE platform locally.

---

## Prerequisites

- **Python**: Version 3.10+ (tested on Python 3.13)
- **Node.js**: Version 18+ (tested on Node v24)
- **npm**: Version 9+
- **Git**

No paid third-party API keys or external services are required in Phase 1.

---

## Repository Structure

```
UNREACHABLE/
├── frontend/             # React + TypeScript + Vite + Tailwind frontend
├── backend/              # FastAPI + Uvicorn backend service
├── data/
│   └── sample/           # Synthetic neighbourhood GeoJSON
├── docs/                 # Architecture & development documentation
├── .gitignore            # Git exclusion rules
└── README.md             # Project overview
```

---

## Backend Setup & Execution

### 1. Create and Activate Virtual Environment

From the project root (`UNREACHABLE`):

**On Windows (PowerShell):**
```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
```

**On Linux / macOS:**
```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Start Backend Server

```bash
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The API will be available at:
- **API Base**: `http://127.0.0.1:8000/api`
- **Swagger Docs**: `http://127.0.0.1:8000/docs`
- **Health Check**: `http://127.0.0.1:8000/api/health`

---

## Frontend Setup & Execution

### 1. Install Dependencies

From the project root:

```bash
cd frontend
npm install
```

### 2. Environment Configuration (Optional)

A `.env.example` file is provided:
```bash
# frontend/.env.example
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```
If connecting to a non-default host, copy `.env.example` to `.env.local` and adjust `VITE_API_BASE_URL`.

### 3. Start Development Server

```bash
npm run dev
```

The web interface will launch at:
- **Frontend URL**: `http://127.0.0.1:5173`

---

## Validation & Smoke Checks

### Backend Smoke Test
From the repository root, run:
```powershell
.\backend\.venv\Scripts\python -c "from app.services.data_service import data_service; print(data_service.get_stats())"
```

### API Endpoint Validation
With the backend running:
```powershell
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/stats
curl -s http://127.0.0.1:8000/api/buildings
curl -s http://127.0.0.1:8000/api/roads
```

### Frontend Typecheck & Build
```powershell
cd frontend
npm run build
```
This runs `tsc -b && vite build` ensuring strict TypeScript type safety and bundling.

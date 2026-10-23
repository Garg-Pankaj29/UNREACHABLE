#!/usr/bin/env bash
# ==============================================================================
# UNREACHABLE — Emergency Accessibility Intelligence Platform
# Single-command launcher for Demo / Review (DATA_MODE=real)
# Serves both FastAPI /api endpoints and built React frontend SPA on port 8000
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export DATA_MODE="${DATA_MODE:-real}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8000}"

echo "========================================================================"
echo " Starting UNREACHABLE Emergency Access Platform"
echo " Environment Mode: DATA_MODE=${DATA_MODE}"
echo " Serving on:       http://${HOST}:${PORT}"
echo " Local-First:      Fully offline capable (no cloud dependencies required)"
echo "========================================================================"

# Check and build frontend if distribution directory is absent
if [ ! -d "${REPO_ROOT}/frontend/dist" ] || [ ! -f "${REPO_ROOT}/frontend/dist/index.html" ]; then
    echo "[start_demo] frontend/dist not found. Building production bundle..."
    (cd "${REPO_ROOT}/frontend" && npm run build)
fi

# Locate Python executable (.venv preferred)
PYTHON_BIN=""
if [ -x "${REPO_ROOT}/backend/.venv/bin/python" ]; then
    PYTHON_BIN="${REPO_ROOT}/backend/.venv/bin/python"
elif [ -x "${REPO_ROOT}/.venv/bin/python" ]; then
    PYTHON_BIN="${REPO_ROOT}/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
else
    PYTHON_BIN="python"
fi

echo "[start_demo] Using Python runtime: ${PYTHON_BIN}"
echo "[start_demo] Launching uvicorn server..."

cd "${REPO_ROOT}/backend"
exec "${PYTHON_BIN}" -m uvicorn app.main:app --host "${HOST}" --port "${PORT}"

"""Core configuration module for UNREACHABLE backend."""
from pathlib import Path
from typing import List

# Base directory for the backend application
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Repository root directory
REPO_ROOT = BASE_DIR.parent

# Relative path to sample GeoJSON demonstration dataset
SAMPLE_DATA_PATH = REPO_ROOT / "data" / "sample" / "neighbourhood.geojson"

# Application metadata
PROJECT_NAME = "UNREACHABLE"
PROJECT_TAGLINE = "Know the access. Find the constraint. Fix it before an emergency."
API_VERSION = "0.1.0"

# CORS origins allowed for local frontend development
ALLOWED_ORIGINS: List[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

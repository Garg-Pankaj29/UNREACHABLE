"""Core configuration module for UNREACHABLE backend."""
from pathlib import Path
from typing import List
from dotenv import load_dotenv

# Base directory for the backend application
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Repository root directory
REPO_ROOT = BASE_DIR.parent

# Load environment variables from root or backend .env
load_dotenv(REPO_ROOT / ".env")
load_dotenv(BASE_DIR / ".env")


import os

# Data mode configuration ('demo' by default, or 'real')
DATA_MODE = os.getenv("DATA_MODE", "demo").lower()

# Paths to datasets
SAMPLE_DATA_PATH = REPO_ROOT / "data" / "sample" / "neighbourhood.geojson"
REAL_DATA_PATH = REPO_ROOT / "data" / "real" / "neighbourhood.geojson"
REAL_CACHE_DIR = REPO_ROOT / "data" / "real" / "cache"


def get_active_data_path() -> Path:
    """Returns active dataset path based on DATA_MODE env variable."""
    mode = os.getenv("DATA_MODE", "demo").lower()
    if mode == "real" and REAL_DATA_PATH.exists():
        return REAL_DATA_PATH
    return SAMPLE_DATA_PATH

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

"""FastAPI main application entry point for UNREACHABLE."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.core.config import (
    ALLOWED_ORIGINS,
    PROJECT_NAME,
    PROJECT_TAGLINE,
    API_VERSION,
    REPO_ROOT,
)

# Standard logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("unreachable.main")

app = FastAPI(
    title=PROJECT_NAME,
    description=f"{PROJECT_TAGLINE} — Emergency accessibility intelligence backend API.",
    version=API_VERSION,
)

# Configure CORS restricted to frontend dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Mount API endpoints under /api
app.include_router(api_router, prefix="/api")

# Serve built frontend from FastAPI if dist/ exists
frontend_dist = REPO_ROOT / "frontend" / "dist"
if frontend_dist.is_dir() and (frontend_dist / "index.html").is_file():
    logger.info("Serving built frontend SPA from %s", frontend_dist)
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    logger.info("Frontend dist not found at %s; serving API root info", frontend_dist)

    @app.get("/", tags=["Root"])
    def root_info():
        """Root info endpoint providing basic platform details."""
        return {
            "project": PROJECT_NAME,
            "tagline": PROJECT_TAGLINE,
            "version": API_VERSION,
            "docs_url": "/docs",
            "health_url": "/api/health",
            "status": "operational",
        }


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting UNREACHABLE backend on http://127.0.0.1:8000")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)

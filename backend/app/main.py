"""FastAPI main application entry point for UNREACHABLE."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.core.config import (
    ALLOWED_ORIGINS,
    PROJECT_NAME,
    PROJECT_TAGLINE,
    API_VERSION,
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

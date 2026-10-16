"""FastAPI router defining core UNREACHABLE endpoints."""
import logging
from fastapi import APIRouter, HTTPException, status

from app.core.config import API_VERSION, SAMPLE_DATA_PATH
from app.models.schemas import (
    FeatureCollectionResponse,
    HealthResponse,
    StatsResponse,
)
from app.services.data_service import data_service

logger = logging.getLogger("unreachable.api")

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check endpoint",
    description="Returns backend service health status and dataset availability.",
)
def get_health() -> HealthResponse:
    """Verifies backend is operating and dataset is reachable."""
    is_loaded = data_service.is_loaded()
    return HealthResponse(
        status="healthy" if is_loaded else "degraded",
        version=API_VERSION,
        dataset_loaded=is_loaded,
        sample_file_path=str(SAMPLE_DATA_PATH.name),
    )


@router.get(
    "/buildings",
    response_model=FeatureCollectionResponse,
    summary="Get building footprints",
    description="Returns GeoJSON FeatureCollection of sample neighbourhood buildings.",
)
def get_buildings() -> FeatureCollectionResponse:
    """Returns sample building footprints with accessibility statuses."""
    try:
        return data_service.get_building_features()
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample dataset file not found: {exc}",
        )
    except Exception as exc:
        logger.error("Failed to load buildings: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load building data: {exc}",
        )


@router.get(
    "/roads",
    response_model=FeatureCollectionResponse,
    summary="Get road network segments",
    description="Returns GeoJSON FeatureCollection of sample neighbourhood roads.",
)
def get_roads() -> FeatureCollectionResponse:
    """Returns sample road network segments with physical widths and access constraints."""
    try:
        return data_service.get_road_features()
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample dataset file not found: {exc}",
        )
    except Exception as exc:
        logger.error("Failed to load roads: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load road data: {exc}",
        )


@router.get(
    "/stats",
    response_model=StatsResponse,
    summary="Get accessibility statistics",
    description="Returns calculated summary counts of buildings and road segments by feasibility state.",
)
def get_stats() -> StatsResponse:
    """Calculates and returns summary statistics derived directly from sample dataset."""
    try:
        return data_service.get_stats()
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample dataset file not found: {exc}",
        )
    except Exception as exc:
        logger.error("Failed to compute stats: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compute statistics: {exc}",
        )


@router.get(
    "/neighbourhood",
    response_model=FeatureCollectionResponse,
    summary="Get complete neighbourhood GeoJSON",
    description="Returns the complete sample dataset containing buildings, roads, and emergency station.",
)
def get_neighbourhood() -> FeatureCollectionResponse:
    """Returns the full sample GeoJSON FeatureCollection."""
    try:
        return data_service.get_feature_collection()
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample dataset file not found: {exc}",
        )
    except Exception as exc:
        logger.error("Failed to load neighbourhood: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load neighbourhood data: {exc}",
        )

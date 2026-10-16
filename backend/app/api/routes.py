"""FastAPI router defining core UNREACHABLE endpoints."""
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import API_VERSION, SAMPLE_DATA_PATH
from app.models.routing import (
    BuildingAccessResponse,
    RoadAccessResponse,
    RouteRequest,
    RouteResponse,
)
from app.models.schemas import (
    FeatureCollectionResponse,
    HealthResponse,
    StatsResponse,
)
from app.models.vehicle import (
    SUPPORTED_VEHICLES,
    VehicleProfile,
    get_vehicle_profile,
)
from app.services.access_engine import access_engine
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


# ============================================================================
# Vehicle Profile Endpoints
# ============================================================================

@router.get(
    "/vehicles",
    response_model=List[VehicleProfile],
    summary="List supported vehicle profiles",
    description="Returns standard emergency vehicle dimensions, clearance thresholds, and evaluation scopes.",
)
def list_vehicles() -> List[VehicleProfile]:
    """Returns all supported emergency vehicle profiles."""
    return list(SUPPORTED_VEHICLES.values())


@router.get(
    "/vehicles/{vehicle_id}",
    response_model=VehicleProfile,
    summary="Get vehicle profile by ID",
    description="Returns clearance requirements and constraint specifications for a specific vehicle.",
)
def get_vehicle(vehicle_id: str) -> VehicleProfile:
    """Retrieves profile specifications for a vehicle."""
    prof = get_vehicle_profile(vehicle_id)
    if not prof:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unsupported vehicle profile '{vehicle_id}'. Supported: {list(SUPPORTED_VEHICLES.keys())}",
        )
    return prof


# ============================================================================
# Routing & Access Engine Endpoints
# ============================================================================

@router.post(
    "/routing/route",
    response_model=RouteResponse,
    summary="Calculate emergency vehicle route (POST)",
    description="Evaluates deterministic route from origin station to destination with physical constraint penalties.",
)
def post_route(request: RouteRequest) -> RouteResponse:
    """Calculates defensible emergency route with step-by-step segment assessments."""
    try:
        return access_engine.calculate_route(request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Routing calculation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to calculate route: {exc}",
        )


@router.get(
    "/routing/route",
    response_model=RouteResponse,
    summary="Calculate emergency vehicle route (GET)",
    description="Query-parameter route evaluation for client-side ergonomics.",
)
def get_route(
    origin: str = Query(default="station-01", description="Origin station identifier"),
    destination_building: Optional[str] = Query(default=None, description="Target building identifier"),
    destination_road: Optional[str] = Query(default=None, description="Target road segment identifier"),
    vehicle: str = Query(default="fire", description="Selected vehicle profile ('fire', 'amb', 'rapid')"),
) -> RouteResponse:
    """Convenience GET endpoint to evaluate emergency vehicle routing."""
    req = RouteRequest(
        origin_station_id=origin,
        destination_building_id=destination_building,
        destination_road_id=destination_road,
        vehicle_id=vehicle,
    )
    return post_route(req)


@router.get(
    "/routing/building-access/{building_id}",
    response_model=BuildingAccessResponse,
    summary="Assess building-level emergency vehicle access",
    description="Evaluates building ingress from station, distinguishing fronting road access from unverified entrance.",
)
def assess_building_access(
    building_id: str,
    vehicle: str = Query(default="fire", description="Selected vehicle profile"),
    origin: str = Query(default="station-01", description="Origin dispatch station identifier"),
) -> BuildingAccessResponse:
    """Evaluates building ingress, setbacks, and road connectivity."""
    try:
        return access_engine.assess_building_access(
            building_id=building_id,
            vehicle_id=vehicle,
            origin_station_id=origin,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Building access evaluation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to assess building access: {exc}",
        )


@router.get(
    "/routing/road-access/{road_id}",
    response_model=RoadAccessResponse,
    summary="Assess road segment access clearance",
    description="Direct segment evaluation against vehicle clearance without multi-hop routing.",
)
def assess_road_access(
    road_id: str,
    vehicle: str = Query(default="fire", description="Selected vehicle profile"),
) -> RoadAccessResponse:
    """Evaluates clearance and bottleneck criteria for a single road segment."""
    try:
        return access_engine.assess_road_access(road_id=road_id, vehicle_id=vehicle)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Road access evaluation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to assess road segment: {exc}",
        )

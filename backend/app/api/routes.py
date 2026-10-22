"""FastAPI router defining core UNREACHABLE endpoints."""
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import API_VERSION, SAMPLE_DATA_PATH
from app.models.routing import (
    BuildingAccessResponse,
    CriticalRoad,
    RoadAccessResponse,
    RouteCompareResponse,
    RouteRequest,
    RouteResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.models.schemas import (
    ExplainRequest,
    ExplainResponse,
    FeatureCollectionResponse,
    HealthResponse,
    StatsResponse,
    VehicleGapResponse,
)
from app.models.vehicle import (
    SUPPORTED_VEHICLES,
    VehicleProfile,
    get_vehicle_profile,
)
from app.services.access_engine import WorkOrderItem, access_engine
from app.services.data_service import data_service
from app.services.explain_service import explain_service


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
def get_stats(
    vehicle_id: Optional[str] = Query(default=None, description="Optional vehicle profile ('fire', 'amb', 'rapid')"),
) -> StatsResponse:
    """Calculates and returns summary statistics derived directly from sample dataset or apparatus evaluation."""
    if vehicle_id is not None and not isinstance(vehicle_id, str):
        vehicle_id = None
    if vehicle_id and vehicle_id not in SUPPORTED_VEHICLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported vehicle profile '{vehicle_id}'. Supported: {list(SUPPORTED_VEHICLES.keys())}",
        )

    try:
        return data_service.get_stats(vehicle_id=vehicle_id)
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
    "/routing/compare",
    response_model=RouteCompareResponse,
    summary="Compare naive shortest-path vs vehicle-aware routing",
    description="Compares distance-only naive route against vehicle clearance rules and identifies bottlenecks.",
)
def compare_route(
    station_id: str = Query(default="station-01", description="Origin station identifier"),
    building_id: Optional[str] = Query(default=None, description="Target building identifier"),
    vehicle_id: str = Query(default="fire", description="Selected vehicle profile ('fire', 'amb', 'rapid')"),
    road_id: Optional[str] = Query(default=None, description="Target road identifier (optional alternative to building)"),
) -> RouteCompareResponse:
    """Evaluates naive shortest path vs vehicle-aware routing with explicit violations."""
    try:
        return access_engine.compare_routes(
            station_id=station_id,
            building_id=building_id,
            vehicle_id=vehicle_id,
            road_id=road_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Route comparison failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compare routes: {exc}",
        )



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


# ============================================================================
# Simulation & Vulnerability Analysis Endpoints
# ============================================================================

@router.post(
    "/simulate",
    response_model=SimulateResponse,
    summary="Simulate hypothetical road network changes",
    description="Evaluates building accessibility before and after road changes on an in-memory dataset copy.",
)
def post_simulate(request: SimulateRequest) -> SimulateResponse:
    """Evaluates impact of hypothetical road network interventions or closures."""
    try:
        return access_engine.simulate(request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Simulation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute simulation: {exc}",
        )


@router.get(
    "/analysis/critical-roads",
    response_model=List[CriticalRoad],
    summary="Identify critical single points of failure roads",
    description="Ranks road corridors whose closure disconnects or degrades access to the highest number of buildings.",
)
def get_critical_roads(
    vehicle_id: str = Query(default="fire", description="Emergency vehicle profile ('fire', 'amb', 'rapid')"),
    limit: int = Query(default=5, ge=1, le=50, description="Maximum number of critical corridors to return"),
) -> List[CriticalRoad]:
    """Returns top N single points of failure road segments for a given vehicle profile."""
    try:
        from app.services.access_engine import CRITICAL_ROADS_CACHE
        cache_key = f"{vehicle_id}_{limit}"
        if cache_key in CRITICAL_ROADS_CACHE:
            return CRITICAL_ROADS_CACHE[cache_key]

        res = access_engine.get_critical_roads(vehicle_id=vehicle_id, limit=limit)
        CRITICAL_ROADS_CACHE[cache_key] = res
        return res
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Critical roads analysis failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compute critical roads: {exc}",
        )


@router.get(
    "/analysis/vehicle-gap",
    response_model=VehicleGapResponse,
    summary="Get comparative vehicle accessibility gap metrics",
    description="Evaluates verified reachable percentage and evidence coverage for standard emergency apparatus.",
)
def get_vehicle_gap() -> VehicleGapResponse:
    """Returns accessibility gap scorecard for fire, amb, and rapid apparatus.

    Definitions:
      evidence_coverage_pct = (feasible + constrained + infeasible) / total buildings * 100
      verified_reachable_pct = feasible / (feasible + constrained + infeasible) * 100
      (Unknown is excluded, never counted as reachable or unreachable)
    """
    try:
        return data_service.get_vehicle_gap()
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sample dataset file not found: {exc}",
        )
    except Exception as exc:
        logger.error("Vehicle gap analysis failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compute vehicle gap analysis: {exc}",
        )


@router.post(
    "/explain",
    response_model=ExplainResponse,
    summary="Explain computed emergency access assessment",
    description="Generates plain-language explanation of deterministic route evaluation using local LLM with guardrails or template fallback.",
)
def post_explain(request: ExplainRequest) -> ExplainResponse:
    """Explains deterministic access result using local model with strict guardrails or template fallback."""
    try:
        return explain_service.explain(
            station_id=request.station_id,
            building_id=request.building_id,
            vehicle_id=request.vehicle_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Explanation service failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate explanation: {exc}",
        )


@router.get(
    "/audit/work-order",
    response_model=List[WorkOrderItem],
    summary="Generate prioritized field audit work order",
    description="Ranks unknown/unverified road segments by the number of buildings that depend on them for emergency access.",
)
def get_audit_work_order(
    vehicle_id: str = Query(default="fire", description="Emergency vehicle profile ('fire', 'amb', 'rapid')"),
) -> List[WorkOrderItem]:
    """Returns prioritized audit action list of unknown/unverified road corridors."""
    try:
        return access_engine.get_audit_work_order(vehicle_id=vehicle_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Audit work order generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate audit work order: {exc}",
        )





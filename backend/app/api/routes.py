"""FastAPI router defining core UNREACHABLE endpoints."""
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import API_VERSION, SAMPLE_DATA_PATH
from app.models.routing import (
    BuildingAccessResponse,
    CriticalRoad,
    MultiRouteRequest,
    MultiRouteResponse,
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
    SearchResponse,
    SearchResultItem,
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
from app.services.pilot_service import pilot_data_service


logger = logging.getLogger("unreachable.api")

router = APIRouter()


class ExtendedHealthResponse(HealthResponse):
    """Extended health response schema including data_mode and feature counts."""
    data_mode: str = "demo"
    counts: Optional[dict] = None


@router.get(
    "/health",
    response_model=ExtendedHealthResponse,
    summary="Health check endpoint",
    description="Returns backend service health status, dataset availability, data mode, and counts.",
)
def get_health() -> ExtendedHealthResponse:
    """Verifies backend is operating, dataset is reachable, and reports active mode & counts."""
    is_loaded = data_service.is_loaded()
    mode = data_service.get_data_mode()
    counts = data_service.get_counts() if is_loaded else {}
    active_path = data_service.data_path
    return ExtendedHealthResponse(
        status="healthy" if is_loaded else "degraded",
        version=API_VERSION,
        dataset_loaded=is_loaded,
        sample_file_path=str(active_path.name),
        data_mode=mode,
        counts=counts,
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
    destination_coords: Optional[str] = Query(default=None, description="Target coordinates as 'lon,lat'"),
    destination_name: Optional[str] = Query(default=None, description="Target display label"),
    vehicle: str = Query(default="fire", description="Selected vehicle profile ('fire', 'amb', 'rapid')"),
    mode: Optional[str] = Query(default=None, description="Dataset mode ('pilot' or 'sample')"),
) -> RouteResponse:
    """Convenience GET endpoint to evaluate emergency vehicle routing."""
    coords_list = None
    if destination_coords:
        try:
            parts = [float(p.strip()) for p in destination_coords.split(",")]
            if len(parts) >= 2:
                coords_list = [parts[0], parts[1]]
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid destination_coords format; expected 'lon,lat'",
            )

    req = RouteRequest(
        origin_station_id=origin,
        destination_building_id=destination_building,
        destination_road_id=destination_road,
        destination_coordinates=coords_list,
        destination_name=destination_name,
        vehicle_id=vehicle,
        dataset_mode=mode,
    )
    return post_route(req)


@router.post(
    "/routing/alternatives",
    response_model=MultiRouteResponse,
    summary="Calculate multiple alternative emergency vehicle routes (POST)",
    description="Evaluates bounded k-shortest distinct alternative emergency routes with clearance evaluation and distinct colors.",
)
def post_route_alternatives(request: MultiRouteRequest) -> MultiRouteResponse:
    """Calculates multiple distinct alternative emergency routes."""
    try:
        # Auto-resolve destination_name to coordinates or feature ID if omitted
        if (
            not request.destination_coordinates
            and not request.destination_building_id
            and not request.destination_road_id
            and request.destination_name
        ):
            from app.services.pilot_service import pilot_data_service
            matches = pilot_data_service.search(request.destination_name, limit=5)
            if matches:
                top = matches[0]
                if top.get("coordinates") and len(top["coordinates"]) >= 2:
                    request.destination_coordinates = [float(top["coordinates"][0]), float(top["coordinates"][1])]
                elif top.get("feature_type") == "building":
                    request.destination_building_id = top["id"]
                elif top.get("feature_type") == "road":
                    request.destination_road_id = top["id"]

        return access_engine.calculate_alternative_routes(request)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Alternative routing calculation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to calculate alternative routes: {exc}",
        )


@router.get(
    "/routing/alternatives",
    response_model=MultiRouteResponse,
    summary="Calculate multiple alternative emergency vehicle routes (GET)",
    description="Query-parameter multiple alternative route evaluation for client-side ergonomics.",
)
def get_route_alternatives(
    origin: str = Query(default="osm_emergency_way_129774350", description="Origin station identifier"),
    destination_building: Optional[str] = Query(default=None, description="Target building identifier"),
    destination_road: Optional[str] = Query(default=None, description="Target road segment identifier"),
    destination_coords: Optional[str] = Query(default=None, description="Target coordinates as 'lon,lat'"),
    destination_name: Optional[str] = Query(default=None, description="Target display label"),
    vehicle: str = Query(default="fire", description="Selected vehicle profile ('fire', 'amb', 'rapid')"),
    mode: Optional[str] = Query(default=None, description="Dataset mode ('pilot' or 'sample')"),
    k: int = Query(default=3, ge=1, le=5, description="Number of alternative routes to calculate (1-5)"),
) -> MultiRouteResponse:
    """Convenience GET endpoint to evaluate multiple alternative emergency routes."""
    coords_list = None
    if destination_coords:
        try:
            parts = [float(p.strip()) for p in destination_coords.split(",")]
            if len(parts) >= 2:
                coords_list = [parts[0], parts[1]]
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid destination_coords format; expected 'lon,lat'",
            )

    req = MultiRouteRequest(
        origin_station_id=origin,
        destination_building_id=destination_building,
        destination_road_id=destination_road,
        destination_coordinates=coords_list,
        destination_name=destination_name,
        vehicle_id=vehicle,
        dataset_mode=mode,
        max_alternatives=k,
    )
    return post_route_alternatives(req)



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
    destination_coords: Optional[str] = Query(default=None, description="Target coordinates as 'lon,lat'"),
    destination_name: Optional[str] = Query(default=None, description="Target display label"),
    mode: Optional[str] = Query(default=None, description="Dataset mode ('pilot' or 'sample')"),
) -> RouteCompareResponse:
    """Evaluates naive shortest path vs vehicle-aware routing with explicit violations."""
    coords_list = None
    if destination_coords:
        try:
            parts = [float(p.strip()) for p in destination_coords.split(",")]
            if len(parts) >= 2:
                coords_list = [parts[0], parts[1]]
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid destination_coords format; expected 'lon,lat'",
            )

    try:
        return access_engine.compare_routes(
            station_id=station_id,
            building_id=building_id,
            vehicle_id=vehicle_id,
            road_id=road_id,
            destination_coordinates=coords_list,
            destination_name=destination_name,
            dataset_mode=mode,
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
    origin: Optional[str] = Query(default=None, description="Origin dispatch station identifier"),
    dataset_mode: Optional[str] = Query(default=None, description="Dataset mode: 'pilot' or 'sample'"),
) -> BuildingAccessResponse:
    """Evaluates building ingress, setbacks, and road connectivity."""
    try:
        return access_engine.assess_building_access(
            building_id=building_id,
            vehicle_id=vehicle,
            origin_station_id=origin,
            dataset_mode=dataset_mode,
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
        from app.core.config import REAL_CACHE_DIR
        cache_file = REAL_CACHE_DIR / f"critical_roads_{vehicle_id}.json"
        if data_service.get_data_mode() == "real" and cache_file.exists():
            import json
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return [CriticalRoad(**item) for item in data[:limit]]

        from app.services.access_engine import CRITICAL_ROADS_CACHE
        cache_key = f"{data_service.get_data_mode()}_{vehicle_id}_{limit}"
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
        from app.core.config import REAL_CACHE_DIR
        cache_file = REAL_CACHE_DIR / f"audit_work_order_{vehicle_id}.json"
        if data_service.get_data_mode() == "real" and cache_file.exists():
            import json
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return [WorkOrderItem(**item) for item in data]

        return access_engine.get_audit_work_order(vehicle_id=vehicle_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error("Audit work order generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate audit work order: {exc}",
        )


@router.get(
    "/pilot/summary",
    summary="Get pilot dataset summary",
    description="Returns metadata and feature counts for the real Chandigarh-Mohali-Gharuan pilot dataset.",
)
def get_pilot_summary() -> dict:
    """Returns metadata summary of the pilot database."""
    summary = pilot_data_service.get_summary()
    if not summary.get("available"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pilot dataset not available. Please run extraction pipeline first.",
        )
    return summary


@router.get(
    "/pilot/features",
    response_model=FeatureCollectionResponse,
    summary="Get pilot geographic features",
    description="Streams real pilot roads, buildings, and emergency facilities with zoom-based LOD and viewport bounding box filtering without loading the full 48MB file.",
)
def get_pilot_features(
    bbox: Optional[str] = Query(None, description="Bounding box in 'min_lon,min_lat,max_lon,max_lat' format"),
    zoom: Optional[int] = Query(None, description="Current map zoom level for LOD road/building density"),
    layer: str = Query("all", description="Layer filter: 'all', 'roads', 'buildings', 'facilities'"),
    limit: int = Query(2500, description="Max feature count to return"),
) -> FeatureCollectionResponse:
    """Returns GeoJSON FeatureCollection of pilot features on demand."""
    if not pilot_data_service.is_available():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pilot dataset not available. Please run extraction pipeline first.",
        )

    parsed_bbox = None
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                parsed_bbox = (parts[0], parts[1], parts[2], parts[3])
        except (ValueError, IndexError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid bbox format. Expected 'min_lon,min_lat,max_lon,max_lat' floats.",
            )

    # Support direct function calls where defaults are Query objects
    layer_str = layer.default if hasattr(layer, "default") else layer
    limit_int = limit.default if hasattr(limit, "default") else limit
    zoom_int = zoom.default if hasattr(zoom, "default") else zoom

    try:
        data = pilot_data_service.get_features(
            bbox=parsed_bbox,
            zoom=zoom_int,
            layer=layer_str or "all",
            limit=limit_int or 2500,
        )
        return FeatureCollectionResponse(**data)
    except Exception as exc:
        logger.error("Failed to query pilot features: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch pilot features: {exc}",
        )


@router.get(
    "/pilot/facilities",
    response_model=FeatureCollectionResponse,
    summary="Get pilot emergency facilities",
    description="Returns mapped emergency facilities (hospitals, fire stations, clinics, doctors) in the pilot area.",
)
def get_pilot_facilities(
    category: Optional[str] = Query(None, description="Optional facility type filter ('fire_station', 'hospital', 'clinic', 'doctors')"),
) -> FeatureCollectionResponse:
    """Returns FeatureCollection of mapped emergency facilities."""
    if not pilot_data_service.is_available():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pilot dataset not available. Please run extraction pipeline first.",
        )
    try:
        category_str = category.default if hasattr(category, "default") else category
        facs = pilot_data_service.get_emergency_facilities(category=category_str)
        return FeatureCollectionResponse(
            type="FeatureCollection",
            metadata={
                "name": "Chandigarh Pilot Emergency Facilities",
                "count": len(facs),
                "attribution": "(c) OpenStreetMap contributors",
            },
            features=facs,
        )
    except Exception as exc:
        logger.error("Failed to query emergency facilities: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch emergency facilities: {exc}",
        )


from app.services.geocoding_service import geocoding_service


@router.get(
    "/pilot/search",
    response_model=SearchResponse,
    summary="Universal location search",
    description="Universal location search across local pilot roads/buildings/facilities and online geocoding provider.",
)
def search_pilot_features(
    q: str = Query(..., min_length=1, description="Search term for names, IDs, types, addresses, landmarks, or cities"),
    limit: int = Query(15, ge=1, le=50, description="Max results to return"),
    include_online: bool = Query(True, description="Whether to include online geocoding for unmapped/external locations"),
) -> SearchResponse:
    """Returns matching geographic features from the pilot dataset and online geocoding provider."""
    # Support direct function calls where defaults are Query objects
    limit_int = limit.default if hasattr(limit, "default") else limit
    include_online_bool = include_online.default if hasattr(include_online, "default") else include_online
    max_limit = limit_int or 15

    local_results: List[dict] = []
    if pilot_data_service.is_available():
        try:
            local_results = pilot_data_service.search(query=q, limit=max_limit)
        except Exception as exc:
            logger.error("Local pilot search error: %s", exc)

    online_results: List[dict] = []
    online_available = True
    if include_online_bool:
        try:
            # Query online geocoder for complementary external places or addresses
            online_limit = max(4, max_limit - len(local_results))
            online_items, online_success = geocoding_service.geocode(query=q, limit=online_limit)
            online_available = online_success

            # Avoid duplicates if online geocoder returned something already matched locally
            local_names = {r["name"].lower().strip() for r in local_results if r.get("name")}
            for item in online_items:
                if item["name"].lower().strip() not in local_names:
                    online_results.append(item)
        except Exception as exc:
            logger.info("Online geocoding exception: %s", exc)
            online_available = False

    merged_results = local_results + online_results
    return SearchResponse(
        query=q,
        count=len(merged_results),
        local_count=len(local_results),
        online_count=len(online_results),
        online_available=online_available,
        results=[SearchResultItem(**r) for r in merged_results],
    )





"""Pydantic schemas and enums for emergency vehicle routing and accessibility engine."""
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.models.vehicle import VehicleProfile


class AccessClassification(str, Enum):
    """Deterministic access classification matching project methodology."""
    ACCESSIBLE = "accessible"
    CONSTRAINED = "constrained"
    INACCESSIBLE = "inaccessible"
    UNKNOWN = "unknown"


class SegmentAssessment(BaseModel):
    """Detailed evaluation of a single road segment against vehicle constraints."""
    road_id: str = Field(description="Segment identifier, e.g. 'road-101'")
    name: str = Field(description="Road name")
    road_class: Optional[str] = None
    width_m: Optional[float] = None
    required_width_m: float
    surface: Optional[str] = None
    obstruction: Optional[str] = None
    status: AccessClassification
    is_passable: bool
    length_m: float
    limiting_factors: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class RouteStep(BaseModel):
    """Step in a calculated emergency traversal path."""
    step_index: int
    from_node: str
    to_node: str
    road_id: str
    road_name: str
    segment_length_m: float
    status: AccessClassification
    reason: str


class RouteRequest(BaseModel):
    """Request payload to calculate emergency vehicle routing."""
    origin_station_id: str = Field(
        default="station-01",
        description="Origin dispatch station identifier"
    )
    destination_building_id: Optional[str] = Field(
        default=None,
        description="Target building footprint identifier, e.g. 'bldg-201'"
    )
    destination_road_id: Optional[str] = Field(
        default=None,
        description="Target road segment identifier, e.g. 'road-102'"
    )
    destination_coordinates: Optional[List[float]] = Field(
        default=None,
        description="Target [lon, lat] coordinates from searched destination"
    )
    destination_name: Optional[str] = Field(
        default=None,
        description="Optional human-readable label for destination"
    )
    vehicle_id: str = Field(
        default="fire",
        description="Selected vehicle profile identifier: 'fire', 'amb', or 'rapid'"
    )
    dataset_mode: Optional[str] = Field(
        default=None,
        description="Explicit dataset mode: 'pilot' or 'sample'"
    )


class RouteResponse(BaseModel):
    """Calculated route outcome with deterministic accessibility classification."""
    origin_id: str
    destination_id: str
    destination_type: str = Field(description="'building', 'road', or 'location'")
    vehicle: VehicleProfile
    classification: AccessClassification
    route_found: bool
    total_distance_m: float
    segments_traversed: List[str] = Field(default_factory=list)
    geometry_geojson: Optional[Dict[str, Any]] = Field(
        default=None,
        description="GeoJSON LineString geometry of the real road route path"
    )
    origin_name: Optional[str] = None
    destination_name: Optional[str] = None
    steps: List[RouteStep] = Field(default_factory=list)
    segment_assessments: List[SegmentAssessment] = Field(default_factory=list)
    limiting_segments: List[str] = Field(default_factory=list)
    evaluated_constraints: List[str]
    unevaluated_constraints: List[str]
    explanation: str
    disclaimer: str = Field(
        default="DETERMINISTIC EVALUATION FOR PROTOTYPE DEMONSTRATION. ROAD ARRIVAL DOES NOT GUARANTEE ENTRANCE ACCESS."
    )


class BuildingAccessResponse(BaseModel):
    """Building-level emergency vehicle accessibility assessment."""
    building_id: str
    building_name: str
    use_type: Optional[str] = None
    connected_road_id: Optional[str] = None
    approach_road_name: Optional[str] = None
    estimated_setback_m: Optional[float] = None
    entrance_status: str = Field(
        description="Distinguishes road arrival from verified building entrance: 'road_frontage_only', 'unconfirmed_entrance', 'confirmed_gate'"
    )
    assessment_status: str = Field(
        default="partial_unverified",
        description="Assessment certainty: 'verified', 'partial_unverified', 'unverified', 'verified_inaccessible'"
    )
    vehicle: VehicleProfile
    classification: AccessClassification
    origin_station_id: str
    origin_station_name: Optional[str] = None
    origin_facility_type: Optional[str] = None
    road_access_coordinates: Optional[List[float]] = None
    building_coordinates: Optional[List[float]] = None
    route: Optional[RouteResponse] = None
    limitations: List[str] = Field(default_factory=list)
    missing_evidence: List[str] = Field(default_factory=list)
    plain_language_explanation: str
    disclaimer: str = Field(
        default="MUNICIPAL CADASTRE DEMONSTRATION. ROAD NETWORK REACHABILITY DOES NOT GUARANTEE PHYSICAL BUILDING ENTRANCE INGRESS."
    )


class RoadAccessResponse(BaseModel):
    """Direct segment clearance evaluation for a specific vehicle."""
    road_id: str
    road_name: str
    vehicle: VehicleProfile
    assessment: SegmentAssessment
    plain_language_explanation: str


class RouteViolation(BaseModel):
    """A segment clearance violation identified along a naive shortest-path route."""
    road_id: str
    reason: str
    width_m: Optional[float] = None
    required_m: float


class NaiveRouteSummary(BaseModel):
    """Summary of a distance-only naive route ignoring vehicle constraints."""
    road_ids: List[str] = Field(default_factory=list)
    distance_m: float
    violations: List[RouteViolation] = Field(default_factory=list)


class AwareRouteSummary(BaseModel):
    """Summary of a vehicle-aware defensible route."""
    road_ids: List[str] = Field(default_factory=list)
    distance_m: float
    classification: AccessClassification


class RouteCompareResponse(BaseModel):
    """Comparison between naive shortest-path and vehicle-aware emergency routing."""
    naive: NaiveRouteSummary
    aware: AwareRouteSummary
    verdict: str
    naive_would_fail: bool


class SimulateChange(BaseModel):
    """Intervention change to apply to a road segment during simulation."""
    road_id: str
    action: str = Field(description="'close' | 'clear_obstruction' | 'set_width'")
    value: Optional[float] = None
    new_width_m: Optional[float] = None


class SimulateRequest(BaseModel):
    """Simulation request with vehicle profile and list of hypothetical road changes."""
    vehicle_id: str = "fire"
    changes: List[SimulateChange] = Field(default_factory=list)


class ChangedBuilding(BaseModel):
    """Building whose access classification changed between before and after simulation."""
    id: str
    name: str
    before: str
    after: str


class StatusCounts(BaseModel):
    """Counts of buildings by access classification status."""
    accessible: int = 0
    constrained: int = 0
    inaccessible: int = 0
    unknown: int = 0


class SimulateResponse(BaseModel):
    """Simulation result showing before and after building accessibility."""
    before: Dict[str, int]
    after: Dict[str, int]
    changed_buildings: List[ChangedBuilding]
    assumptions: List[str]


class CriticalRoad(BaseModel):
    """Single point of failure road ranking."""
    road_id: str
    name: str
    buildings_affected: int
    building_ids: List[str]


class AlternativeRoute(BaseModel):
    """A distinct alternative path between origin and destination with clearance evaluation."""
    route_id: str = Field(description="Unique alternative identifier, e.g. 'route-1'")
    route_index: int = Field(description="1-based index of the alternative")
    name: str = Field(description="Descriptive route name, e.g. 'Primary Corridor (via Jan Marg)'")
    color: str = Field(description="Distinct hex color for map display (e.g. #2563eb, #9333ea, #0d9488)")
    classification: AccessClassification
    route_found: bool = True
    total_distance_m: float
    segment_count: int
    segments_traversed: List[str] = Field(default_factory=list)
    geometry_geojson: Optional[Dict[str, Any]] = None
    steps: List[RouteStep] = Field(default_factory=list)
    segment_assessments: List[SegmentAssessment] = Field(default_factory=list)
    limiting_segments: List[str] = Field(default_factory=list)
    known_restrictions: List[str] = Field(default_factory=list)
    unknown_evidence_segments: List[str] = Field(default_factory=list)
    explanation: str
    is_recommended: bool = True


class MultiRouteRequest(BaseModel):
    """Request payload to calculate multiple alternative emergency vehicle routes."""
    origin_station_id: str = Field(
        default="station-01",
        description="Origin dispatch station or emergency facility identifier",
    )
    destination_building_id: Optional[str] = Field(
        default=None,
        description="Target building identifier",
    )
    destination_road_id: Optional[str] = Field(
        default=None,
        description="Target road segment identifier",
    )
    destination_coordinates: Optional[List[float]] = Field(
        default=None,
        description="Target [lon, lat] coordinates",
    )
    destination_name: Optional[str] = Field(
        default=None,
        description="Optional human-readable label for destination",
    )
    vehicle_id: str = Field(
        default="fire",
        description="Selected vehicle profile identifier ('fire', 'amb', 'rapid')",
    )
    dataset_mode: Optional[str] = Field(
        default=None,
        description="Explicit dataset mode ('pilot' or 'sample')",
    )
    max_alternatives: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Maximum number of distinct alternative routes to compute (default: 3)",
    )


class MultiRouteResponse(BaseModel):
    """Multiple alternative routes outcome with comparative metrics and distinct geometries."""
    origin_id: str
    origin_name: str
    origin_facility_type: Optional[str] = None
    origin_coordinates: Optional[List[float]] = None
    destination_id: str
    destination_name: str
    destination_type: str = Field(description="'building', 'road', or 'location'")
    destination_coordinates: Optional[List[float]] = None
    vehicle: VehicleProfile
    requested_count: int
    routes_found_count: int
    status: str = Field(
        description="Status code: 'multiple_found', 'fewer_found', 'single_found', 'none_found', 'outside_pilot', 'disconnected', 'blocked'"
    )
    routes: List[AlternativeRoute] = Field(default_factory=list)
    notes: str = Field(
        description="Explanatory context regarding corridor availability, topological bottlenecks, or unmeasured widths"
    )
    disclaimer: str = Field(
        default="DETERMINISTIC EVALUATION FOR PROTOTYPE DEMONSTRATION. CONNECTIVITY DOES NOT GUARANTEE ENTRANCE INGRESS."
    )




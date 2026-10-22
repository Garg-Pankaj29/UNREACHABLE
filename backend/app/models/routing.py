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
    vehicle_id: str = Field(
        default="fire",
        description="Selected vehicle profile identifier: 'fire', 'amb', or 'rapid'"
    )


class RouteResponse(BaseModel):
    """Calculated route outcome with deterministic accessibility classification."""
    origin_id: str
    destination_id: str
    destination_type: str = Field(description="'building' or 'road'")
    vehicle: VehicleProfile
    classification: AccessClassification
    route_found: bool
    total_distance_m: float
    segments_traversed: List[str] = Field(default_factory=list)
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
    estimated_setback_m: Optional[float] = None
    entrance_status: str = Field(
        description="Distinguishes road arrival from verified building entrance: 'road_frontage_only', 'unconfirmed_entrance', 'confirmed_gate'"
    )
    vehicle: VehicleProfile
    classification: AccessClassification
    origin_station_id: str
    route: Optional[RouteResponse] = None
    limitations: List[str] = Field(default_factory=list)
    plain_language_explanation: str
    disclaimer: str = Field(
        default="MUNICIPAL CADASTRE DEMONSTRATION. BUILDING ENTRANCE ACCESSIBILITY REQUIRES ON-SITE SETBACK SURVEY."
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



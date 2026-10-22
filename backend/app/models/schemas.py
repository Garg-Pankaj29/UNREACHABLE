"""Pydantic models and schemas for UNREACHABLE API."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response schema."""
    status: str = Field(default="healthy", description="Application health status")
    version: str = Field(description="API service version")
    service: str = Field(default="UNREACHABLE-backend", description="Service identifier")
    dataset_loaded: bool = Field(description="Whether sample GeoJSON dataset is successfully loaded")
    sample_file_path: str = Field(description="Relative path of sample dataset")


class GeoJSONGeometry(BaseModel):
    """GeoJSON geometry representation."""
    type: str
    coordinates: Any


class GeoJSONFeature(BaseModel):
    """GeoJSON Feature representation."""
    type: str = "Feature"
    id: Optional[str] = None
    geometry: GeoJSONGeometry
    properties: Dict[str, Any] = Field(default_factory=dict)


class FeatureCollectionResponse(BaseModel):
    """GeoJSON FeatureCollection response representation."""
    type: str = "FeatureCollection"
    metadata: Optional[Dict[str, Any]] = None
    features: List[GeoJSONFeature]


class AccessStatusCounts(BaseModel):
    """Counts grouped by accessibility feasibility state."""
    feasible: int = 0
    constrained: int = 0
    infeasible: int = 0
    unknown: int = 0
    total: int = 0


class StatsResponse(BaseModel):
    """Summary statistics for sample neighbourhood emergency accessibility."""
    area_name: str
    total_features: int
    station_count: int
    buildings: AccessStatusCounts
    roads: AccessStatusCounts
    disclaimer: str


class VehicleGapStats(BaseModel):
    """Vehicle-specific building accessibility breakdown and gap metrics.

    Definitions:
      evidence_coverage_pct = (feasible + constrained + infeasible) / total buildings * 100
      verified_reachable_pct = feasible / (feasible + constrained + infeasible) * 100
      (Unknown is excluded, never counted as reachable or unreachable)
    """
    counts: AccessStatusCounts
    verified_reachable_pct: float
    evidence_coverage_pct: float


class VehicleGapResponse(BaseModel):
    """Comparative vehicle accessibility gap across standard emergency apparatus."""
    fire: VehicleGapStats
    amb: VehicleGapStats
    rapid: VehicleGapStats


class ExplainRequest(BaseModel):
    """Request payload for deterministic route assessment explanation."""
    station_id: str = Field(default="station-01", description="Origin dispatch station identifier")
    building_id: str = Field(description="Target destination building identifier")
    vehicle_id: str = Field(default="fire", description="Emergency vehicle profile ('fire', 'amb', 'rapid')")


class ExplainResponse(BaseModel):
    """Response payload containing guardrail-verified explanation of access assessment."""
    text: str = Field(description="3-sentence explanation based strictly on deterministic facts")
    source: str = Field(description="Origin of explanation: 'local_llm' or 'template'")
    validated: bool = Field(default=True, description="Whether the explanation passed strict numerical guardrails")



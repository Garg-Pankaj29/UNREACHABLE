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

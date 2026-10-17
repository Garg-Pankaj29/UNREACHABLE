"""Vehicle models and catalog for UNREACHABLE emergency accessibility engine."""
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class VehicleProfile(BaseModel):
    """Emergency vehicle profile defining physical clearances and evaluated constraints."""
    id: str = Field(description="Unique identifier for vehicle profile, e.g. 'fire'")
    name: str = Field(description="Human-readable vehicle name")
    category: str = Field(description="Operational category (Heavy apparatus, Ambulance, QRV)")
    min_clearance_width_m: float = Field(description="Minimum required corridor width in meters")
    min_clearance_height_m: float = Field(description="Minimum vertical clearance in meters")
    turning_radius_m: float = Field(description="Outer turning radius in meters")
    weight_tons: float = Field(description="Gross vehicle weight in metric tons")
    description: str = Field(description="Summary of vehicle capabilities and access footprint")
    typical_equipment: str = Field(description="Primary gear / apparatus carried")
    evaluated_constraints: List[str] = Field(
        default_factory=lambda: ["width", "physical_obstruction"],
        description="Physical constraints evaluated against road evidence in this engine"
    )
    unevaluated_constraints: List[str] = Field(
        default_factory=lambda: [
            "overhead_clearance",
            "turning_radius",
            "gross_weight_limit",
            "gate_restriction",
            "entrance_doorway_access"
        ],
        description="Constraints currently unevaluated due to unmeasured cadastral data"
    )


# Standard documented emergency vehicle catalog
SUPPORTED_VEHICLES: Dict[str, VehicleProfile] = {
    "fire": VehicleProfile(
        id="fire",
        name="Fire tender",
        category="Heavy apparatus",
        min_clearance_width_m=3.5,
        min_clearance_height_m=3.5,
        turning_radius_m=8.5,
        weight_tons=16.0,
        description="Heavy municipal water tender requiring ≥ 3.5m clearance corridor.",
        typical_equipment="4,500L water tank, high-pressure pump, extension ladders, rescue gear",
    ),
    "amb": VehicleProfile(
        id="amb",
        name="Ambulance",
        category="Emergency ambulance",
        min_clearance_width_m=3.0,
        min_clearance_height_m=2.5,
        turning_radius_m=6.5,
        weight_tons=4.5,
        description="Standard emergency medical ambulance requiring ≥ 3.0m clearance corridor.",
        typical_equipment="Stretcher, patient monitor, defibrillator, oxygen delivery kit",
    ),
    "rapid": VehicleProfile(
        id="rapid",
        name="Rapid response car",
        category="Rapid response unit",
        min_clearance_width_m=2.4,
        min_clearance_height_m=2.0,
        turning_radius_m=5.0,
        weight_tons=2.2,
        description="Agile quick response unit requiring ≥ 2.4m clearance corridor.",
        typical_equipment="First responder trauma kit, portable fire suppression extinguisher, AED",
    ),
}


def get_vehicle_profile(vehicle_id: str) -> Optional[VehicleProfile]:
    """Retrieves a supported vehicle profile by identifier."""
    return SUPPORTED_VEHICLES.get(vehicle_id.lower().strip())

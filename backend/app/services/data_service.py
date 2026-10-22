"""Data access and statistics computation service for UNREACHABLE."""
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import SAMPLE_DATA_PATH
from app.models.schemas import (
    AccessStatusCounts,
    StatsResponse,
    VehicleGapResponse,
    VehicleGapStats,
)

logger = logging.getLogger("unreachable.data_service")



class DataService:
    """Service to load and query sample neighbourhood GeoJSON data."""

    def __init__(self, data_path: Path = SAMPLE_DATA_PATH):
        self.data_path = data_path
        self._cache: Optional[Dict[str, Any]] = None

    def load_data(self) -> Dict[str, Any]:
        """Loads and parses the GeoJSON sample dataset from repository-relative path."""
        if self._cache is not None:
            return self._cache

        if not self.data_path.exists():
            error_msg = f"Sample dataset not found at expected path: {self.data_path}"
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        try:
            with open(self.data_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info("Successfully loaded sample GeoJSON from %s", self.data_path)
            self._cache = data
            return data
        except json.JSONDecodeError as exc:
            error_msg = f"Failed to parse GeoJSON file {self.data_path}: {exc}"
            logger.error(error_msg)
            raise ValueError(error_msg) from exc

    def is_loaded(self) -> bool:
        """Returns True if dataset file exists and parses properly."""
        try:
            self.load_data()
            return True
        except Exception:
            return False

    def get_feature_collection(self) -> Dict[str, Any]:
        """Returns the full FeatureCollection."""
        return self.load_data()

    def get_building_features(self) -> Dict[str, Any]:
        """Filters and returns GeoJSON FeatureCollection of buildings."""
        data = self.load_data()
        building_features = [
            f for f in data.get("features", [])
            if f.get("properties", {}).get("feature_type") == "building"
        ]
        return {
            "type": "FeatureCollection",
            "metadata": {
                **data.get("metadata", {}),
                "filter": "building",
                "count": len(building_features),
            },
            "features": building_features,
        }

    def get_road_features(self) -> Dict[str, Any]:
        """Filters and returns GeoJSON FeatureCollection of roads."""
        data = self.load_data()
        road_features = [
            f for f in data.get("features", [])
            if f.get("properties", {}).get("feature_type") == "road"
        ]
        return {
            "type": "FeatureCollection",
            "metadata": {
                **data.get("metadata", {}),
                "filter": "road",
                "count": len(road_features),
            },
            "features": road_features,
        }

    def get_station_features(self) -> Dict[str, Any]:
        """Filters and returns GeoJSON FeatureCollection of emergency stations."""
        data = self.load_data()
        station_features = [
            f for f in data.get("features", [])
            if f.get("properties", {}).get("feature_type") == "station"
        ]
        return {
            "type": "FeatureCollection",
            "metadata": {
                **data.get("metadata", {}),
                "filter": "station",
                "count": len(station_features),
            },
            "features": station_features,
        }

    def get_stats(self, vehicle_id: Optional[str] = None) -> StatsResponse:
        """Calculates accessibility statistics for buildings and roads.
        
        If vehicle_id is provided, evaluations are determined dynamically for the apparatus profile.
        Otherwise, default baseline GeoJSON properties are aggregated.
        """
        data = self.load_data()
        features = data.get("features", [])
        metadata = data.get("metadata", {})

        b_counts = {"feasible": 0, "constrained": 0, "infeasible": 0, "unknown": 0}
        r_counts = {"feasible": 0, "constrained": 0, "infeasible": 0, "unknown": 0}
        station_count = 0

        if vehicle_id:
            from app.services.access_engine import AccessEngine
            engine = AccessEngine(ds=self)
            status_map = {
                "accessible": "feasible",
                "feasible": "feasible",
                "constrained": "constrained",
                "inaccessible": "infeasible",
                "infeasible": "infeasible",
                "unknown": "unknown",
            }
            for f in features:
                props = f.get("properties", {})
                f_type = props.get("feature_type")
                feat_id = props.get("id") or f.get("id")

                if f_type == "building":
                    try:
                        asmt = engine.assess_building_access(building_id=feat_id, vehicle_id=vehicle_id)
                        raw_st = asmt.classification.value if hasattr(asmt.classification, "value") else str(asmt.classification)
                        st = status_map.get(raw_st, "unknown")
                    except Exception:
                        st = "unknown"
                    if st in b_counts:
                        b_counts[st] += 1
                    else:
                        b_counts["unknown"] += 1
                elif f_type == "road":
                    try:
                        asmt = engine.assess_road_access(road_id=feat_id, vehicle_id=vehicle_id)
                        raw_st = asmt.assessment.status.value if hasattr(asmt.assessment.status, "value") else str(asmt.assessment.status)
                        st = status_map.get(raw_st, "unknown")
                    except Exception:
                        st = "unknown"
                    if st in r_counts:
                        r_counts[st] += 1
                    else:
                        r_counts["unknown"] += 1
                elif f_type == "station":
                    station_count += 1
        else:
            for f in features:
                props = f.get("properties", {})
                f_type = props.get("feature_type")
                status = props.get("access_status", "unknown")

                if f_type == "building":
                    if status in b_counts:
                        b_counts[status] += 1
                    else:
                        b_counts["unknown"] += 1
                elif f_type == "road":
                    if status in r_counts:
                        r_counts[status] += 1
                    else:
                        r_counts["unknown"] += 1
                elif f_type == "station":
                    station_count += 1

        buildings_stat = AccessStatusCounts(
            feasible=b_counts["feasible"],
            constrained=b_counts["constrained"],
            infeasible=b_counts["infeasible"],
            unknown=b_counts["unknown"],
            total=sum(b_counts.values()),
        )

        roads_stat = AccessStatusCounts(
            feasible=r_counts["feasible"],
            constrained=r_counts["constrained"],
            infeasible=r_counts["infeasible"],
            unknown=r_counts["unknown"],
            total=sum(r_counts.values()),
        )

        return StatsResponse(
            area_name=metadata.get("name", "Synthetic Demonstration Area"),
            total_features=len(features),
            station_count=station_count,
            buildings=buildings_stat,
            roads=roads_stat,
            disclaimer=metadata.get(
                "disclaimer",
                "PROTOTYPE DEMONSTRATION ONLY. NOT AN OFFICIAL EMERGENCY-ACCESS ASSESSMENT."
            ),
        )

    def get_vehicle_gap(self) -> VehicleGapResponse:
        """Calculates accessibility gap metrics across standard vehicle apparatus.

        Definitions:
          evidence_coverage_pct = (feasible + constrained + infeasible) / total buildings * 100
          verified_reachable_pct = feasible / (feasible + constrained + infeasible) * 100
          (Unknown is excluded, never counted as reachable or unreachable)
        """
        from app.services.access_engine import AccessEngine

        engine = AccessEngine(ds=self)
        buildings = self.get_building_features().get("features", [])
        total_buildings = len(buildings)

        status_map = {
            "accessible": "feasible",
            "feasible": "feasible",
            "constrained": "constrained",
            "inaccessible": "infeasible",
            "infeasible": "infeasible",
            "unknown": "unknown",
        }

        vehicles = ["fire", "amb", "rapid"]
        gap_results: Dict[str, VehicleGapStats] = {}

        for v_id in vehicles:
            counts = {"feasible": 0, "constrained": 0, "infeasible": 0, "unknown": 0}
            for b in buildings:
                b_id = b.get("properties", {}).get("id") or b.get("id")
                try:
                    asmt = engine.assess_building_access(building_id=b_id, vehicle_id=v_id)
                    raw_st = (
                        asmt.classification.value
                        if hasattr(asmt.classification, "value")
                        else str(asmt.classification)
                    )
                    st = status_map.get(raw_st, "unknown")
                except Exception:
                    st = "unknown"
                if st in counts:
                    counts[st] += 1
                else:
                    counts["unknown"] += 1

            evidence_count = counts["feasible"] + counts["constrained"] + counts["infeasible"]

            # Definitions:
            # evidence_coverage_pct = (feasible + constrained + infeasible) / total buildings * 100
            # verified_reachable_pct = feasible / (feasible + constrained + infeasible) * 100
            # (Unknown is excluded, never counted as reachable or unreachable)
            cov_pct = (
                round((evidence_count / total_buildings) * 100.0, 1)
                if total_buildings > 0
                else 0.0
            )
            reach_pct = (
                round((counts["feasible"] / evidence_count) * 100.0, 1)
                if evidence_count > 0
                else 0.0
            )

            gap_results[v_id] = VehicleGapStats(
                counts=AccessStatusCounts(
                    feasible=counts["feasible"],
                    constrained=counts["constrained"],
                    infeasible=counts["infeasible"],
                    unknown=counts["unknown"],
                    total=total_buildings,
                ),
                verified_reachable_pct=reach_pct,
                evidence_coverage_pct=cov_pct,
            )

        return VehicleGapResponse(
            fire=gap_results["fire"],
            amb=gap_results["amb"],
            rapid=gap_results["rapid"],
        )



# Singleton instance for route injection
data_service = DataService()

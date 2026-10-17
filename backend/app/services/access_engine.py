"""Vehicle-aware emergency access and deterministic routing engine."""
import heapq
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from app.models.routing import (
    AccessClassification,
    BuildingAccessResponse,
    RoadAccessResponse,
    RouteRequest,
    RouteResponse,
    RouteStep,
    SegmentAssessment,
)
from app.models.vehicle import VehicleProfile, get_vehicle_profile
from app.services.data_service import DataService, data_service
from app.services.graph_service import RoadEdge, RoadGraph, haversine_distance_m

logger = logging.getLogger("unreachable.access_engine")


def get_feature_centroid(feature: Dict[str, Any]) -> Tuple[float, float]:
    """Calculates approximate (lon, lat) representative point for a GeoJSON feature."""
    geom = feature.get("geometry", {})
    g_type = geom.get("type")
    coords = geom.get("coordinates", [])

    if g_type == "Point" and len(coords) >= 2:
        return (float(coords[0]), float(coords[1]))

    if g_type == "LineString" and isinstance(coords, list) and len(coords) >= 1:
        mid = coords[len(coords) // 2]
        return (float(mid[0]), float(mid[1]))

    if g_type == "Polygon" and isinstance(coords, list) and len(coords) >= 1 and len(coords[0]) >= 1:
        ring = coords[0]
        lons = [float(p[0]) for p in ring if len(p) >= 2]
        lats = [float(p[1]) for p in ring if len(p) >= 2]
        if lons and lats:
            return (sum(lons) / len(lons), sum(lats) / len(lats))

    return (77.5950, 12.9715)


class AccessEngine:
    """Core deterministic emergency vehicle routing and accessibility evaluation engine."""

    def __init__(self, ds: DataService = data_service):
        self.data_service = ds
        self._graph: Optional[RoadGraph] = None

    def get_graph(self, force_reload: bool = False) -> RoadGraph:
        """Retrieves or builds the topological road graph from current GeoJSON data."""
        if self._graph is not None and not force_reload:
            return self._graph

        roads_fc = self.data_service.get_road_features()
        features = roads_fc.get("features", [])
        self._graph = RoadGraph.from_geojson_features(features)
        return self._graph

    def evaluate_segment(
        self,
        road_id: str,
        vehicle: VehicleProfile,
        props: Dict[str, Any],
        length_m: float = 0.0,
    ) -> SegmentAssessment:
        """Evaluates a single road segment against vehicle physical clearance constraints."""
        name = props.get("name", road_id)
        road_class = props.get("road_class")
        surface = props.get("surface")
        obstruction = props.get("obstruction")
        width_m = props.get("width_m")

        if width_m is not None:
            try:
                width_m = float(width_m)
            except (ValueError, TypeError):
                width_m = None

        limiting_factors: List[str] = []

        # 1. Obstruction Evaluation
        if obstruction and str(obstruction).strip() and str(obstruction).lower() != "null":
            limiting_factors.append(f"Confirmed physical obstruction: {obstruction}")
            return SegmentAssessment(
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=width_m,
                required_width_m=vehicle.min_clearance_width_m,
                surface=surface,
                obstruction=obstruction,
                status=AccessClassification.INACCESSIBLE,
                is_passable=False,
                length_m=round(length_m, 1),
                limiting_factors=limiting_factors,
                notes=f"Physically impassable: {obstruction}",
            )

        # 2. Width Evaluation
        if width_m is None:
            # Missing width is NOT zero width, but cannot be proven accessible
            limiting_factors.append(
                "Unmeasured corridor width in cadastre: ground truth audit required"
            )
            return SegmentAssessment(
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=None,
                required_width_m=vehicle.min_clearance_width_m,
                surface=surface,
                obstruction=None,
                status=AccessClassification.UNKNOWN,
                is_passable=True,  # Passable conditionally, but flags route outcome as unknown
                length_m=round(length_m, 1),
                limiting_factors=limiting_factors,
                notes="Width unmeasured in cadastre; clearance unverified.",
            )

        if width_m < vehicle.min_clearance_width_m:
            deficit = round(vehicle.min_clearance_width_m - width_m, 2)
            limiting_factors.append(
                f"Width deficit of {deficit}m (usable width {width_m}m < required {vehicle.min_clearance_width_m}m)"
            )
            return SegmentAssessment(
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=width_m,
                required_width_m=vehicle.min_clearance_width_m,
                surface=surface,
                obstruction=None,
                status=AccessClassification.INACCESSIBLE,
                is_passable=False,
                length_m=round(length_m, 1),
                limiting_factors=limiting_factors,
                notes=f"Corridor width {width_m}m is insufficient for {vehicle.name} ({vehicle.min_clearance_width_m}m).",
            )

        # Clearance buffer threshold: less than 0.4m margin marks corridor as constrained
        if width_m < vehicle.min_clearance_width_m + 0.4:
            margin = round(width_m - vehicle.min_clearance_width_m, 2)
            limiting_factors.append(
                f"Marginal clearance: only {margin}m buffer beyond vehicle width"
            )
            return SegmentAssessment(
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=width_m,
                required_width_m=vehicle.min_clearance_width_m,
                surface=surface,
                obstruction=None,
                status=AccessClassification.CONSTRAINED,
                is_passable=True,
                length_m=round(length_m, 1),
                limiting_factors=limiting_factors,
                notes=f"Narrow corridor: {margin}m clearance margin.",
            )

        # Satisfies evaluated width constraints
        return SegmentAssessment(
            road_id=road_id,
            name=name,
            road_class=road_class,
            width_m=width_m,
            required_width_m=vehicle.min_clearance_width_m,
            surface=surface,
            obstruction=None,
            status=AccessClassification.ACCESSIBLE,
            is_passable=True,
            length_m=round(length_m, 1),
            limiting_factors=[],
            notes=f"Adequate clearance for {vehicle.name} ({width_m}m usable width).",
        )

    def calculate_route(self, request: RouteRequest) -> RouteResponse:
        """Calculates deterministic vehicle routing optimizing for defensible access."""
        vehicle = get_vehicle_profile(request.vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {request.vehicle_id}")

        graph = self.get_graph()
        fc = self.data_service.get_feature_collection()
        features = fc.get("features", [])

        # 1. Resolve Origin Station
        origin_st = None
        for f in features:
            props = f.get("properties", {})
            if props.get("feature_type") == "station" and (
                props.get("id") == request.origin_station_id or f.get("id") == request.origin_station_id
            ):
                origin_st = f
                break

        if not origin_st:
            raise KeyError(f"Origin station not found: {request.origin_station_id}")

        st_props = origin_st.get("properties", {})
        st_road_id = st_props.get("primary_access_road")
        st_coords = origin_st.get("geometry", {}).get("coordinates", [])

        if len(st_coords) >= 2:
            st_origin_node = graph.get_closest_node((float(st_coords[0]), float(st_coords[1])))
        else:
            st_origin_node = None

        if not st_origin_node and st_road_id:
            st_nodes = graph.get_nodes_for_road(st_road_id)
            st_origin_node = next(iter(st_nodes)) if st_nodes else None

        if not st_origin_node:
            raise ValueError(f"Origin station {request.origin_station_id} has no connected road nodes")

        # 2. Resolve Destination Target (Building or Road)
        target_road_id: Optional[str] = None
        target_bldg: Optional[Dict[str, Any]] = None
        destination_id = request.destination_building_id or request.destination_road_id
        destination_type = "building" if request.destination_building_id else "road"

        if request.destination_building_id:
            for f in features:
                props = f.get("properties", {})
                if props.get("feature_type") == "building" and (
                    props.get("id") == request.destination_building_id
                    or f.get("id") == request.destination_building_id
                ):
                    target_bldg = f
                    break

            if not target_bldg:
                raise KeyError(f"Destination building not found: {request.destination_building_id}")

            target_road_id = target_bldg.get("properties", {}).get("connected_road_id")
            if not target_road_id:
                # Building exists but has unassigned/missing road connection
                return RouteResponse(
                    origin_id=request.origin_station_id,
                    destination_id=request.destination_building_id,
                    destination_type="building",
                    vehicle=vehicle,
                    classification=AccessClassification.UNKNOWN,
                    route_found=False,
                    total_distance_m=0.0,
                    segments_traversed=[],
                    steps=[],
                    segment_assessments=[],
                    limiting_segments=[],
                    evaluated_constraints=vehicle.evaluated_constraints,
                    unevaluated_constraints=vehicle.unevaluated_constraints,
                    explanation=(
                        f"Building {request.destination_building_id} has no assigned road corridor in the dataset. "
                        "Access cannot be established due to insufficient cadastral data."
                    ),
                )
        elif request.destination_road_id:
            target_road_id = request.destination_road_id
            if not graph.get_nodes_for_road(target_road_id):
                raise KeyError(f"Destination road not found in network: {request.destination_road_id}")
        else:
            raise ValueError("Either destination_building_id or destination_road_id must be provided")

        target_nodes = graph.get_nodes_for_road(target_road_id)
        if not target_nodes:
            return RouteResponse(
                origin_id=request.origin_station_id,
                destination_id=destination_id or "unknown",
                destination_type=destination_type,
                vehicle=vehicle,
                classification=AccessClassification.UNKNOWN,
                route_found=False,
                total_distance_m=0.0,
                segments_traversed=[],
                steps=[],
                segment_assessments=[],
                limiting_segments=[],
                evaluated_constraints=vehicle.evaluated_constraints,
                unevaluated_constraints=vehicle.unevaluated_constraints,
                explanation=f"Target road {target_road_id} has no nodes registered in the network graph.",
            )

        # 3. Dijkstra Pathfinding with Defensible Access Penalties
        # We start at st_origin_node. Target is considered reached when:
        # 1. At least one edge belonging to target_road_id has been traversed in the path,
        #    AND the current node is in target_nodes.
        # (This ensures the route actually delivers the apparatus onto the target road).
        pq: List[Tuple[float, str, List[RoadEdge]]] = []
        best_cost: Dict[Tuple[str, bool], float] = {}  # (node_id, has_traversed_target) -> min_cost
        segment_eval_cache: Dict[str, SegmentAssessment] = {}

        heapq.heappush(pq, (0.0, st_origin_node, []))
        best_cost[(st_origin_node, False)] = 0.0

        chosen_edges: Optional[List[RoadEdge]] = None

        while pq:
            cost, u, path = heapq.heappop(pq)
            has_target = any(e.road_id == target_road_id for e in path)

            if cost > best_cost.get((u, has_target), float("inf")):
                continue

            # Check if destination is reached
            if has_target and u in target_nodes:
                chosen_edges = path
                break

            for edge in graph.adjacency.get(u, []):
                # Avoid looping back immediately on same edge
                if path and path[-1].edge_id == f"{edge.road_id}_{edge.to_node}->{edge.from_node}":
                    continue

                if edge.road_id not in segment_eval_cache:
                    segment_eval_cache[edge.road_id] = self.evaluate_segment(
                        road_id=edge.road_id,
                        vehicle=vehicle,
                        props=edge.properties,
                        length_m=edge.length_m,
                    )
                assessment = segment_eval_cache[edge.road_id]

                # Rule out confirmed impassable segments
                if not assessment.is_passable:
                    continue

                # Apply transparent routing penalties
                if assessment.status == AccessClassification.ACCESSIBLE:
                    edge_penalty_factor = 1.0
                elif assessment.status == AccessClassification.CONSTRAINED:
                    edge_penalty_factor = 2.5  # Prefers verified wider corridor when alternative exists
                elif assessment.status == AccessClassification.UNKNOWN:
                    edge_penalty_factor = 3.0  # Prefers known corridor over unmeasured candidate
                else:
                    edge_penalty_factor = 1.0

                step_cost = edge.length_m * edge_penalty_factor
                new_cost = cost + step_cost
                v = edge.to_node
                new_has_target = has_target or (edge.road_id == target_road_id)

                if new_cost < best_cost.get((v, new_has_target), float("inf")):
                    best_cost[(v, new_has_target)] = new_cost
                    heapq.heappush(pq, (new_cost, v, path + [edge]))

        # 4. Handle Case: Route Found
        if chosen_edges is not None:
            steps: List[RouteStep] = []
            traversed_road_ids: List[str] = []
            unique_assessments: Dict[str, SegmentAssessment] = {}
            total_dist_m = 0.0

            for idx, edge in enumerate(chosen_edges, start=1):
                total_dist_m += edge.length_m
                if edge.road_id not in traversed_road_ids:
                    traversed_road_ids.append(edge.road_id)

                if edge.road_id not in unique_assessments:
                    unique_assessments[edge.road_id] = self.evaluate_segment(
                        road_id=edge.road_id,
                        vehicle=vehicle,
                        props=edge.properties,
                        length_m=edge.length_m,
                    )
                asmt = unique_assessments[edge.road_id]

                steps.append(
                    RouteStep(
                        step_index=idx,
                        from_node=edge.from_node,
                        to_node=edge.to_node,
                        road_id=edge.road_id,
                        road_name=edge.name,
                        segment_length_m=round(edge.length_m, 1),
                        status=asmt.status,
                        reason=asmt.notes or "",
                    )
                )

            limiting_segments: List[str] = []
            any_unknown = False
            any_constrained = False

            for rid, asmt in unique_assessments.items():
                if asmt.status == AccessClassification.UNKNOWN:
                    any_unknown = True
                    limiting_segments.append(rid)
                elif asmt.status == AccessClassification.CONSTRAINED:
                    any_constrained = True
                    limiting_segments.append(rid)

            if any_unknown:
                overall_classification = AccessClassification.UNKNOWN
                explanation = (
                    f"Route identified ({round(total_dist_m, 1)}m across {len(traversed_road_ids)} segments), "
                    f"but contains unmeasured segment(s): {', '.join(limiting_segments)}. "
                    "Access cannot be confirmed accessible without ground truth width survey."
                )
            elif any_constrained:
                overall_classification = AccessClassification.CONSTRAINED
                explanation = (
                    f"Route is passable ({round(total_dist_m, 1)}m), but includes constrained segment(s): "
                    f"{', '.join(limiting_segments)} with narrow safety margins."
                )
            else:
                overall_classification = AccessClassification.ACCESSIBLE
                explanation = (
                    f"Verified accessible route ({round(total_dist_m, 1)}m) via {len(traversed_road_ids)} corridor(s). "
                    f"All segments meet or exceed {vehicle.name} physical clearance requirements."
                )

            return RouteResponse(
                origin_id=request.origin_station_id,
                destination_id=destination_id or "unknown",
                destination_type=destination_type,
                vehicle=vehicle,
                classification=overall_classification,
                route_found=True,
                total_distance_m=round(total_dist_m, 1),
                segments_traversed=traversed_road_ids,
                steps=steps,
                segment_assessments=list(unique_assessments.values()),
                limiting_segments=limiting_segments,
                evaluated_constraints=vehicle.evaluated_constraints,
                unevaluated_constraints=vehicle.unevaluated_constraints,
                explanation=explanation,
            )

        # 5. Handle Case: No Passable Route Found
        # Determine whether geometric path exists if constraints are relaxed
        unconstrained_path = self._find_unconstrained_path(st_origin_node, target_nodes, target_road_id, graph)

        if unconstrained_path is not None:
            blocked_rids: List[str] = []
            reasons: List[str] = []
            for edge in unconstrained_path:
                asmt = self.evaluate_segment(
                    road_id=edge.road_id,
                    vehicle=vehicle,
                    props=edge.properties,
                    length_m=edge.length_m,
                )
                if not asmt.is_passable:
                    if edge.road_id not in blocked_rids:
                        blocked_rids.append(edge.road_id)
                        reasons.extend(asmt.limiting_factors)

            return RouteResponse(
                origin_id=request.origin_station_id,
                destination_id=destination_id or "unknown",
                destination_type=destination_type,
                vehicle=vehicle,
                classification=AccessClassification.INACCESSIBLE,
                route_found=False,
                total_distance_m=0.0,
                segments_traversed=[],
                steps=[],
                segment_assessments=[],
                limiting_segments=blocked_rids,
                evaluated_constraints=vehicle.evaluated_constraints,
                unevaluated_constraints=vehicle.unevaluated_constraints,
                explanation=(
                    f"All candidate routes for {vehicle.name} are blocked by physical constraints along: "
                    f"{', '.join(blocked_rids)}. Reason: {'; '.join(reasons)}"
                ),
            )
        else:
            return RouteResponse(
                origin_id=request.origin_station_id,
                destination_id=destination_id or "unknown",
                destination_type=destination_type,
                vehicle=vehicle,
                classification=AccessClassification.UNKNOWN,
                route_found=False,
                total_distance_m=0.0,
                segments_traversed=[],
                steps=[],
                segment_assessments=[],
                limiting_segments=[],
                evaluated_constraints=vehicle.evaluated_constraints,
                unevaluated_constraints=vehicle.unevaluated_constraints,
                explanation=(
                    "No contiguous topological road connection exists between origin and destination in dataset. "
                    "Incomplete cadastre does not prove physical blockage."
                ),
            )

    def _find_unconstrained_path(
        self,
        start_node: str,
        target_nodes: Set[str],
        target_road_id: str,
        graph: RoadGraph,
    ) -> Optional[List[RoadEdge]]:
        """Finds any path regardless of constraints to distinguish blockage from disconnection."""
        visited: Set[Tuple[str, bool]] = set()
        queue: List[Tuple[str, List[RoadEdge]]] = [(start_node, [])]

        while queue:
            curr, path = queue.pop(0)
            has_target = any(e.road_id == target_road_id for e in path)

            if has_target and curr in target_nodes:
                return path

            state = (curr, has_target)
            if state in visited:
                continue
            visited.add(state)

            for edge in graph.adjacency.get(curr, []):
                new_has_target = has_target or (edge.road_id == target_road_id)
                next_state = (edge.to_node, new_has_target)
                if next_state not in visited:
                    queue.append((edge.to_node, path + [edge]))

        return None

    def assess_building_access(
        self,
        building_id: str,
        vehicle_id: str = "fire",
        origin_station_id: str = "station-01",
    ) -> BuildingAccessResponse:
        """Assesses emergency vehicle access to a specific building footprint."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        fc = self.data_service.get_feature_collection()
        features = fc.get("features", [])

        bldg = None
        for f in features:
            props = f.get("properties", {})
            if props.get("feature_type") == "building" and (
                props.get("id") == building_id or f.get("id") == building_id
            ):
                bldg = f
                break

        if not bldg:
            raise KeyError(f"Building not found: {building_id}")

        b_props = bldg.get("properties", {})
        b_name = b_props.get("name", building_id)
        use_type = b_props.get("use_type")
        connected_road_id = b_props.get("connected_road_id")
        setback_m = b_props.get("estimated_setback_m")

        if not connected_road_id:
            return BuildingAccessResponse(
                building_id=building_id,
                building_name=b_name,
                use_type=use_type,
                connected_road_id=None,
                estimated_setback_m=setback_m,
                entrance_status="unconfirmed_entrance",
                vehicle=vehicle,
                classification=AccessClassification.UNKNOWN,
                origin_station_id=origin_station_id,
                route=None,
                limitations=["Building entrance is unsurveyed with no fronting road link assigned"],
                plain_language_explanation=(
                    f"Building {building_id} ({b_name}) has no fronting road assigned in cadastre records. "
                    "Direct emergency vehicle access cannot be determined."
                ),
            )

        # Route to fronting road
        route_req = RouteRequest(
            origin_station_id=origin_station_id,
            destination_building_id=building_id,
            vehicle_id=vehicle_id,
        )
        route_resp = self.calculate_route(route_req)

        limitations: List[str] = list(route_resp.limiting_segments)
        setback_str = f"{setback_m}m" if setback_m is not None else "unmeasured"

        # Explicitly distinguish road arrival from building entrance access
        if route_resp.classification == AccessClassification.ACCESSIBLE:
            plain_explanation = (
                f"{vehicle.name} can reach the fronting road corridor ({connected_road_id}). "
                f"Note: Property entrance gate is unsurveyed; final {setback_str} setback "
                "must be traversed via pedestrian access or hose relay."
            )
            entrance_status = "road_frontage_only"
        elif route_resp.classification == AccessClassification.CONSTRAINED:
            plain_explanation = (
                f"{vehicle.name} can reach the frontage road with limitations ({', '.join(route_resp.limiting_segments)}). "
                f"Frontage setback is {setback_str}; gate ingress unverified."
            )
            entrance_status = "road_frontage_only"
        elif route_resp.classification == AccessClassification.INACCESSIBLE:
            plain_explanation = (
                f"{vehicle.name} cannot reach fronting corridor ({connected_road_id}) due to physical blockage: "
                f"{route_resp.explanation}"
            )
            entrance_status = "road_frontage_only"
        else:
            plain_explanation = (
                f"Corridor accessibility to {building_id} is unknown due to missing width or unsurveyed data along path."
            )
            entrance_status = "unconfirmed_entrance"

        return BuildingAccessResponse(
            building_id=building_id,
            building_name=b_name,
            use_type=use_type,
            connected_road_id=connected_road_id,
            estimated_setback_m=setback_m,
            entrance_status=entrance_status,
            vehicle=vehicle,
            classification=route_resp.classification,
            origin_station_id=origin_station_id,
            route=route_resp,
            limitations=limitations,
            plain_language_explanation=plain_explanation,
        )

    def assess_road_access(self, road_id: str, vehicle_id: str = "fire") -> RoadAccessResponse:
        """Evaluates direct accessibility of an individual road corridor for a vehicle."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        fc = self.data_service.get_feature_collection()
        features = fc.get("features", [])

        road_f = None
        for f in features:
            props = f.get("properties", {})
            if props.get("feature_type") == "road" and (
                props.get("id") == road_id or f.get("id") == road_id
            ):
                road_f = f
                break

        if not road_f:
            raise KeyError(f"Road segment not found: {road_id}")

        props = road_f.get("properties", {})
        asmt = self.evaluate_segment(
            road_id=road_id,
            vehicle=vehicle,
            props=props,
            length_m=0.0,
        )

        return RoadAccessResponse(
            road_id=road_id,
            road_name=props.get("name", road_id),
            vehicle=vehicle,
            assessment=asmt,
            plain_language_explanation=asmt.notes or "",
        )


# Singleton instance for route injection
access_engine = AccessEngine()

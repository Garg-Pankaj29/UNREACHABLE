"""Vehicle-aware emergency access and deterministic routing engine."""
import copy
import heapq
import json
import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from app.models.routing import (
    AccessClassification,
    AlternativeRoute,
    AwareRouteSummary,
    BuildingAccessResponse,
    ChangedBuilding,
    CriticalRoad,
    MultiRouteRequest,
    MultiRouteResponse,
    NaiveRouteSummary,
    RoadAccessResponse,
    RouteCompareResponse,
    RouteRequest,
    RouteResponse,
    RouteStep,
    RouteViolation,
    SegmentAssessment,
    SimulateChange,
    SimulateRequest,
    SimulateResponse,
)
from app.models.vehicle import VehicleProfile, get_vehicle_profile

# Distinct accessible route line colors for simultaneous map display
ROUTE_COLORS = [
    "#2563eb",  # Route 1: Royal Blue
    "#9333ea",  # Route 2: Purple / Violet
    "#0d9488",  # Route 3: Deep Teal
    "#ea580c",  # Route 4: Vivid Amber / Orange
    "#0284c7",  # Route 5: Sky Blue
]

from app.services.data_service import DataService, data_service
from app.services.geocoding_service import is_in_pilot_corridor
from app.services.graph_service import RoadEdge, RoadGraph, haversine_distance_m
from app.services.pilot_service import PilotDataService, pilot_data_service

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

    def __init__(
        self,
        ds: DataService = data_service,
        pilot_ds: PilotDataService = pilot_data_service,
    ):
        self.data_service = ds
        self.pilot_data_service = pilot_ds
        self._graph: Optional[RoadGraph] = None
        self._pilot_graph: Optional[RoadGraph] = None

    def get_graph(self, force_reload: bool = False) -> RoadGraph:
        """Retrieves or builds the topological road graph from current GeoJSON data."""
        current_mode = self.data_service.get_data_mode() if hasattr(self.data_service, "get_data_mode") else None
        if self._graph is not None and not force_reload and getattr(self, "_cached_graph_mode", None) == current_mode:
            return self._graph

        roads_fc = self.data_service.get_road_features()
        features = roads_fc.get("features", [])
        self._graph = RoadGraph.from_geojson_features(features)
        self._cached_graph_mode = current_mode
        return self._graph

    def get_pilot_graph(self, force_reload: bool = False) -> Optional[RoadGraph]:
        """Retrieves or constructs the topological road network from the pilot SQLite database."""
        if self._pilot_graph is not None and not force_reload:
            return self._pilot_graph
        if not self.pilot_data_service.is_available():
            return None

        conn = self.pilot_data_service._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, name, road_class, oneway, surface, width_m, maxwidth_m,
                       access, vehicle, emergency, length_m, geometry_geojson
                FROM roads;
            """)
            rows = cur.fetchall()
            features = []
            for r in rows:
                try:
                    geom = json.loads(r["geometry_geojson"])
                except Exception:
                    continue
                features.append({
                    "properties": {
                        "feature_type": "road",
                        "id": r["id"],
                        "name": r["name"] or r["id"],
                        "road_class": r["road_class"],
                        "oneway": r["oneway"],
                        "surface": r["surface"],
                        "width_m": r["width_m"],
                        "maxwidth_m": r["maxwidth_m"],
                        "access": r["access"],
                        "vehicle": r["vehicle"],
                        "emergency": r["emergency"],
                        "length_m": r["length_m"],
                    },
                    "geometry": geom,
                })
            self._pilot_graph = RoadGraph.from_geojson_features(features)
            return self._pilot_graph
        finally:
            conn.close()

    def is_pilot_facility(self, station_id: str) -> bool:
        """Checks if a station identifier belongs to the pilot emergency facilities dataset."""
        if not self.pilot_data_service.is_available():
            return False
        conn = self.pilot_data_service._get_connection()
        try:
            cur = conn.cursor()
            osm_num = None
            for part in station_id.split("_"):
                if part.isdigit():
                    osm_num = int(part)
                    break
            cur.execute(
                "SELECT 1 FROM emergency_facilities WHERE id = ? OR name = ? OR osm_id = ? OR id LIKE ? LIMIT 1;",
                (station_id, station_id, osm_num, f"%{station_id}%"),
            )
            return cur.fetchone() is not None
        finally:
            conn.close()

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

        # Check Access restrictions from OSM tags (emergency vehicles have right-of-way on private roads)
        access_tag = props.get("access")
        vehicle_tag = props.get("vehicle")
        emergency_tag = props.get("emergency")

        if emergency_tag == "no":
            limiting_factors.append("Prohibited for emergency vehicles: mapped emergency=no restriction")
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
                notes="Physically/legally prohibited: mapped emergency=no restriction.",
            )

        if (access_tag == "no" or vehicle_tag == "no") and emergency_tag not in ("yes", "destination"):
            limiting_factors.append(f"Prohibited access tag: mapped {access_tag or vehicle_tag} restriction")
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
                notes=f"Restricted access: mapped {access_tag or vehicle_tag} prohibition without emergency exemption.",
            )

        if access_tag == "private" or vehicle_tag == "private":
            limiting_factors.append("Private access corridor: emergency right-of-way applicable")

        # 1. Obstruction & Physical Barrier Evaluation
        barrier = props.get("barrier")
        if barrier and str(barrier).strip().lower() not in ("no", "none", "toll_booth", "border_control", "null"):
            limiting_factors.append(f"Confirmed physical barrier: {barrier}")
            return SegmentAssessment(
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=width_m,
                required_width_m=vehicle.min_clearance_width_m,
                surface=surface,
                obstruction=str(barrier),
                status=AccessClassification.INACCESSIBLE,
                is_passable=False,
                length_m=round(length_m, 1),
                limiting_factors=limiting_factors,
                notes=f"Physically impassable: barrier '{barrier}' blocks passage.",
            )

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

        # Maxwidth sign restriction
        maxwidth_m = props.get("maxwidth_m")
        if maxwidth_m is not None:
            try:
                maxw_val = float(maxwidth_m)
                if maxw_val < vehicle.min_clearance_width_m:
                    limiting_factors.append(
                        f"Physical max-width barrier: {maxw_val}m < required {vehicle.min_clearance_width_m}m"
                    )
                    return SegmentAssessment(
                        road_id=road_id,
                        name=name,
                        road_class=road_class,
                        width_m=width_m,
                        required_width_m=vehicle.min_clearance_width_m,
                        surface=surface,
                        obstruction=f"Maxwidth limit {maxw_val}m",
                        status=AccessClassification.INACCESSIBLE,
                        is_passable=False,
                        length_m=round(length_m, 1),
                        limiting_factors=limiting_factors,
                        notes=f"Physically impassable: maxwidth limit of {maxw_val}m violates vehicle width ({vehicle.min_clearance_width_m}m).",
                    )
            except (ValueError, TypeError):
                pass

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
        """Calculates deterministic vehicle routing optimizing for defensible access across real or sample roads."""
        vehicle = get_vehicle_profile(request.vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {request.vehicle_id}")

        # Check if routing across real pilot dataset
        is_pilot = (
            request.dataset_mode == "pilot"
            or request.origin_station_id.startswith("osm_")
            or (request.destination_building_id and request.destination_building_id.startswith("osm_"))
            or (request.destination_road_id and request.destination_road_id.startswith("osm_"))
            or (request.destination_coordinates is not None)
            or (self.pilot_data_service.is_available() and self.is_pilot_facility(request.origin_station_id))
        )

        if is_pilot and self.pilot_data_service.is_available():
            graph = self.get_pilot_graph()
            if graph is None:
                graph = self.get_graph()
                is_pilot = False
        else:
            graph = self.get_graph()
            is_pilot = False

        origin_name = request.origin_station_id
        st_origin_node: Optional[str] = None

        if is_pilot:
            # Resolve pilot origin facility from SQLite
            conn = self.pilot_data_service._get_connection()
            try:
                cur = conn.cursor()
                osm_num = None
                for part in request.origin_station_id.split("_"):
                    if part.isdigit():
                        osm_num = int(part)
                        break
                cur.execute(
                    "SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE id = ? OR name = ? OR osm_id = ? OR id LIKE ? LIMIT 1;",
                    (request.origin_station_id, request.origin_station_id, osm_num, f"%{request.origin_station_id}%"),
                )
                st_row = cur.fetchone()
                if not st_row:
                    cur.execute(
                        "SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE name LIKE ? LIMIT 1;",
                        (f"%{request.origin_station_id}%",),
                    )
                    st_row = cur.fetchone()

                if st_row:
                    origin_name = st_row["name"]
                    st_origin_node = graph.get_closest_node((float(st_row["lon"]), float(st_row["lat"])))
            finally:
                conn.close()

            if not st_origin_node:
                # If station_id was a sample station or coords not found
                fc = self.data_service.get_feature_collection()
                for f in fc.get("features", []):
                    props = f.get("properties", {})
                    if props.get("id") == request.origin_station_id:
                        origin_name = props.get("name", request.origin_station_id)
                        c = f.get("geometry", {}).get("coordinates", [])
                        if len(c) >= 2:
                            st_origin_node = graph.get_closest_node((float(c[0]), float(c[1])))
                        break

            if not st_origin_node:
                raise KeyError(f"Origin emergency facility not found: {request.origin_station_id}")

            # Resolve pilot destination
            target_road_id: Optional[str] = None
            target_nodes: Set[str] = set()
            destination_id = (
                request.destination_building_id
                or request.destination_road_id
                or request.destination_name
                or "destination"
            )
            destination_name = request.destination_name or destination_id
            destination_type = (
                "building"
                if request.destination_building_id
                else "road"
                if request.destination_road_id
                else "location"
            )

            if request.destination_coordinates:
                dest_lon = float(request.destination_coordinates[0])
                dest_lat = float(request.destination_coordinates[1])
                destination_name = request.destination_name or f"Location ({dest_lat:.4f}, {dest_lon:.4f})"
                destination_id = request.destination_name or f"loc_{dest_lon:.4f}_{dest_lat:.4f}"
                destination_type = "location"

                # Check if destination is outside pilot corridor
                if not is_in_pilot_corridor(dest_lon, dest_lat):
                    return RouteResponse(
                        origin_id=request.origin_station_id,
                        origin_name=origin_name,
                        destination_id=destination_id,
                        destination_name=destination_name,
                        destination_type="location",
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
                            f"Destination '{destination_name}' is outside the Chandigarh pilot road network corridor. "
                            "Detailed road routing and vehicle accessibility analysis are unavailable until road-network coverage data exists for this region."
                        ),
                    )

                dest_node = graph.get_closest_node((dest_lon, dest_lat))
                if dest_node:
                    target_nodes.add(dest_node)

            elif request.destination_building_id:
                conn = self.pilot_data_service._get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id, name, centroid_lon, centroid_lat FROM buildings WHERE id = ? OR name = ? LIMIT 1;",
                        (request.destination_building_id, request.destination_building_id),
                    )
                    b_row = cur.fetchone()
                    if b_row:
                        destination_name = b_row["name"] or b_row["id"]
                        centroid = (float(b_row["centroid_lon"]), float(b_row["centroid_lat"]))
                        cell_x = int(centroid[0] * 100)
                        cell_y = int(centroid[1] * 100)
                        cand_nodes = []
                        for dx in range(-3, 4):
                            for dy in range(-3, 4):
                                ck = (cell_x + dx, cell_y + dy)
                                if ck in graph.grid:
                                    cand_nodes.extend(graph.grid[ck])
                        cand_with_dist = []
                        for nid in set(cand_nodes):
                            d = haversine_distance_m(centroid, graph.nodes[nid])
                            if d <= 400:
                                cand_with_dist.append((d, nid))
                        cand_with_dist.sort()
                        dest_node = None
                        for d, nid in cand_with_dist:
                            edges = graph.adjacency.get(nid, [])
                            unrestricted = [
                                e for e in edges
                                if e.properties.get("access") not in ("no", "private")
                                and e.road_class not in ("footway", "steps", "path", "cycleway")
                            ]
                            if unrestricted:
                                dest_node = nid
                                break
                        if not dest_node and cand_with_dist:
                            dest_node = cand_with_dist[0][1]
                        if not dest_node:
                            dest_node = graph.get_closest_node(centroid)
                        if dest_node:
                            target_nodes.add(dest_node)
                finally:
                    conn.close()

                if not target_nodes:
                    raise KeyError(f"Destination building not found: {request.destination_building_id}")

            elif request.destination_road_id:
                target_road_id = request.destination_road_id
                target_nodes = graph.get_nodes_for_road(target_road_id)
                if not target_nodes:
                    raise KeyError(f"Destination road not found in network: {request.destination_road_id}")
            else:
                raise ValueError("Either destination_building_id, destination_road_id, or destination_coordinates must be provided")

        else:
            # Sample Demonstration Dataset Resolution (Preserves 100% test compatibility)
            fc = self.data_service.get_feature_collection()
            features = fc.get("features", [])

            origin_st = None
            for f in features:
                props = f.get("properties", {})
                if props.get("feature_type") == "station" and (
                    props.get("id") == request.origin_station_id or f.get("id") == request.origin_station_id
                ):
                    origin_st = f
                    break

            if not origin_st and request.origin_station_id in ("station-01", None):
                for f in features:
                    if f.get("properties", {}).get("feature_type") == "station":
                        origin_st = f
                        break

            if not origin_st:
                raise KeyError(f"Origin station not found: {request.origin_station_id}")

            st_props = origin_st.get("properties", {})
            origin_name = st_props.get("name", request.origin_station_id)
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

            target_road_id = None
            target_bldg = None
            destination_id = request.destination_building_id or request.destination_road_id
            destination_name = destination_id
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

                destination_name = target_bldg.get("properties", {}).get("name", destination_id)
                target_road_id = target_bldg.get("properties", {}).get("connected_road_id")
                if not target_road_id:
                    return RouteResponse(
                        origin_id=request.origin_station_id,
                        origin_name=origin_name,
                        destination_id=request.destination_building_id,
                        destination_name=destination_name,
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
                raise ValueError("Either destination_building_id, destination_road_id, or destination_coordinates must be provided")

            target_nodes = graph.get_nodes_for_road(target_road_id)
            if not target_nodes:
                return RouteResponse(
                    origin_id=request.origin_station_id,
                    origin_name=origin_name,
                    destination_id=destination_id or "unknown",
                    destination_name=destination_name,
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

        # Check trivial case where origin is already in target_nodes
        if st_origin_node in target_nodes and (target_road_id is None or not graph.get_nodes_for_road(target_road_id)):
            return RouteResponse(
                origin_id=request.origin_station_id,
                origin_name=origin_name,
                destination_id=destination_id or "unknown",
                destination_name=destination_name,
                destination_type=destination_type,
                vehicle=vehicle,
                classification=AccessClassification.ACCESSIBLE,
                route_found=True,
                total_distance_m=0.0,
                segments_traversed=[],
                geometry_geojson={"type": "LineString", "coordinates": []},
                steps=[],
                segment_assessments=[],
                limiting_segments=[],
                evaluated_constraints=vehicle.evaluated_constraints,
                unevaluated_constraints=vehicle.unevaluated_constraints,
                explanation=f"Origin and destination are co-located at junction node {st_origin_node}.",
            )

        # 3. Dijkstra Pathfinding with Defensible Access Penalties
        pq: List[Tuple[float, str, List[RoadEdge]]] = []
        best_cost: Dict[Tuple[str, bool], float] = {}  # (node_id, has_traversed_target) -> min_cost
        segment_eval_cache: Dict[str, SegmentAssessment] = {}

        heapq.heappush(pq, (0.0, st_origin_node, []))
        best_cost[(st_origin_node, False)] = 0.0

        chosen_edges: Optional[List[RoadEdge]] = None

        while pq:
            cost, u, path = heapq.heappop(pq)
            has_target = any(e.road_id == target_road_id for e in path) if target_road_id else True

            if cost > best_cost.get((u, has_target), float("inf")):
                continue

            # Check if destination is reached
            if target_road_id:
                if has_target and u in target_nodes:
                    chosen_edges = path
                    break
            else:
                if u in target_nodes and len(path) > 0:
                    chosen_edges = path
                    break

            for edge in graph.adjacency.get(u, []):
                # Avoid looping back immediately on same edge
                if path and path[-1].to_node == edge.from_node and path[-1].from_node == edge.to_node:
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
                new_has_target = has_target or (target_road_id is not None and edge.road_id == target_road_id)

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
                    f"but contains unmeasured segment(s): {', '.join(limiting_segments[:5])}. "
                    "Access cannot be confirmed accessible without ground truth width survey."
                )
            elif any_constrained:
                overall_classification = AccessClassification.CONSTRAINED
                explanation = (
                    f"Route is passable ({round(total_dist_m, 1)}m), but includes constrained segment(s): "
                    f"{', '.join(limiting_segments[:5])} with narrow safety margins."
                )
            else:
                overall_classification = AccessClassification.ACCESSIBLE
                explanation = (
                    f"Verified accessible route ({round(total_dist_m, 1)}m) via {len(traversed_road_ids)} corridor(s). "
                    f"All segments meet or exceed {vehicle.name} physical clearance requirements."
                )

            # Assemble contiguous route geometry from actual road coordinates
            route_coords: List[List[float]] = []
            for edge in chosen_edges:
                if not route_coords:
                    route_coords.append([round(edge.coordinates[0][0], 6), round(edge.coordinates[0][1], 6)])
                route_coords.append([round(edge.coordinates[1][0], 6), round(edge.coordinates[1][1], 6)])

            geometry_geojson = {
                "type": "LineString",
                "coordinates": route_coords,
            }

            return RouteResponse(
                origin_id=request.origin_station_id,
                origin_name=origin_name,
                destination_id=destination_id or "unknown",
                destination_name=destination_name,
                destination_type=destination_type,
                vehicle=vehicle,
                classification=overall_classification,
                route_found=True,
                total_distance_m=round(total_dist_m, 1),
                segments_traversed=traversed_road_ids,
                geometry_geojson=geometry_geojson,
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
                origin_name=origin_name,
                destination_id=destination_id or "unknown",
                destination_name=destination_name,
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
                origin_name=origin_name,
                destination_id=destination_id or "unknown",
                destination_name=destination_name,
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

    def _find_dijkstra_path(
        self,
        start_node: str,
        target_nodes: Set[str],
        target_road_id: Optional[str],
        graph: RoadGraph,
        vehicle: VehicleProfile,
        penalized_road_factors: Optional[Dict[str, float]] = None,
        max_pops: int = 80000,
    ) -> Optional[List[RoadEdge]]:
        """Finds vehicle-passable path using A* goal-directed search with optional edge penalties for alternative diversity."""
        from app.services.graph_service import haversine_distance_m

        penalties = penalized_road_factors or {}
        pq: List[Tuple[float, float, str, List[RoadEdge]]] = []  # (priority, cost, node, path)
        best_cost: Dict[Tuple[str, bool], float] = {}
        segment_cache: Dict[str, SegmentAssessment] = {}

        # Target centroid coordinate for A* admissible heuristic
        target_coord: Optional[Tuple[float, float]] = None
        for tn in target_nodes:
            if tn in graph.nodes:
                target_coord = graph.nodes[tn]
                break

        start_h = haversine_distance_m(graph.nodes[start_node], target_coord) if (target_coord and start_node in graph.nodes) else 0.0
        heapq.heappush(pq, (start_h, 0.0, start_node, []))
        best_cost[(start_node, False)] = 0.0
        pops = 0

        while pq and pops < max_pops:
            pops += 1
            _, cost, u, path = heapq.heappop(pq)
            has_target = any(e.road_id == target_road_id for e in path) if target_road_id else True

            if cost > best_cost.get((u, has_target), float("inf")):
                continue

            if target_road_id:
                if has_target and u in target_nodes:
                    return path
            else:
                if u in target_nodes and len(path) > 0:
                    return path

            for edge in graph.adjacency.get(u, []):
                if path and path[-1].to_node == edge.from_node and path[-1].from_node == edge.to_node:
                    continue

                if edge.road_id not in segment_cache:
                    segment_cache[edge.road_id] = self.evaluate_segment(
                        road_id=edge.road_id,
                        vehicle=vehicle,
                        props=edge.properties,
                        length_m=edge.length_m,
                    )
                asmt = segment_cache[edge.road_id]
                if not asmt.is_passable:
                    continue

                if asmt.status == AccessClassification.ACCESSIBLE:
                    base_factor = 1.0
                elif asmt.status == AccessClassification.CONSTRAINED:
                    base_factor = 2.5
                elif asmt.status == AccessClassification.UNKNOWN:
                    base_factor = 3.0
                else:
                    base_factor = 1.0

                extra_factor = penalties.get(edge.road_id, 1.0)
                step_cost = edge.length_m * base_factor * extra_factor
                new_cost = cost + step_cost
                v = edge.to_node
                new_has_target = has_target or (target_road_id is not None and edge.road_id == target_road_id)

                if new_cost < best_cost.get((v, new_has_target), float("inf")):
                    best_cost[(v, new_has_target)] = new_cost
                    h = haversine_distance_m(graph.nodes[v], target_coord) if (target_coord and v in graph.nodes) else 0.0
                    heapq.heappush(pq, (new_cost + h, new_cost, v, path + [edge]))

        return None

    def calculate_alternative_routes(self, request: MultiRouteRequest) -> MultiRouteResponse:
        """Calculates bounded k-shortest distinct alternative emergency routes with clearance evaluation."""
        vehicle = get_vehicle_profile(request.vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {request.vehicle_id}")

        k_target = min(max(request.max_alternatives, 1), 5)

        # Check dataset mode
        is_pilot = (
            request.dataset_mode == "pilot"
            or request.origin_station_id.startswith("osm_")
            or (request.destination_building_id and request.destination_building_id.startswith("osm_"))
            or (request.destination_road_id and request.destination_road_id.startswith("osm_"))
            or (request.destination_coordinates is not None)
            or (self.pilot_data_service.is_available() and self.is_pilot_facility(request.origin_station_id))
        )

        if is_pilot and self.pilot_data_service.is_available():
            graph = self.get_pilot_graph()
            if graph is None:
                graph = self.get_graph()
                is_pilot = False
        else:
            graph = self.get_graph()
            is_pilot = False

        origin_name = request.origin_station_id
        origin_facility_type: Optional[str] = None
        origin_coordinates: Optional[List[float]] = None
        st_origin_node: Optional[str] = None

        if is_pilot:
            conn = self.pilot_data_service._get_connection()
            try:
                cur = conn.cursor()
                osm_num = None
                for part in request.origin_station_id.split("_"):
                    if part.isdigit():
                        osm_num = int(part)
                        break
                cur.execute(
                    "SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE id = ? OR name = ? OR osm_id = ? OR id LIKE ? LIMIT 1;",
                    (request.origin_station_id, request.origin_station_id, osm_num, f"%{request.origin_station_id}%"),
                )
                st_row = cur.fetchone()
                if not st_row:
                    cur.execute(
                        "SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE name LIKE ? LIMIT 1;",
                        (f"%{request.origin_station_id}%",),
                    )
                    st_row = cur.fetchone()

                if st_row:
                    origin_name = st_row["name"]
                    origin_facility_type = st_row["facility_type"]
                    origin_coordinates = [round(float(st_row["lon"]), 6), round(float(st_row["lat"]), 6)]
                    st_origin_node = graph.get_closest_node((origin_coordinates[0], origin_coordinates[1]))
            finally:
                conn.close()

            if not st_origin_node:
                fc = self.data_service.get_feature_collection()
                for f in fc.get("features", []):
                    props = f.get("properties", {})
                    if props.get("id") == request.origin_station_id:
                        origin_name = props.get("name", request.origin_station_id)
                        origin_facility_type = props.get("facility_type") or props.get("station_type")
                        c = f.get("geometry", {}).get("coordinates", [])
                        if len(c) >= 2:
                            origin_coordinates = [round(float(c[0]), 6), round(float(c[1]), 6)]
                            st_origin_node = graph.get_closest_node((origin_coordinates[0], origin_coordinates[1]))
                        break

            if not st_origin_node:
                raise KeyError(f"Origin emergency facility '{request.origin_station_id}' not found in network.")

            # Destination resolution
            target_road_id: Optional[str] = None
            target_nodes: Set[str] = set()
            destination_id = (
                request.destination_building_id
                or request.destination_road_id
                or request.destination_name
                or "destination"
            )
            destination_name = request.destination_name or destination_id
            destination_type = (
                "building"
                if request.destination_building_id
                else "road"
                if request.destination_road_id
                else "location"
            )
            # Auto-resolve destination_name if coordinates/building/road are omitted
            if not request.destination_coordinates and not request.destination_building_id and not request.destination_road_id and request.destination_name:
                matches = self.pilot_data_service.search(request.destination_name, limit=5)
                if matches:
                    top = matches[0]
                    if top.get("coordinates") and len(top["coordinates"]) >= 2:
                        request.destination_coordinates = [float(top["coordinates"][0]), float(top["coordinates"][1])]
                    elif top.get("feature_type") == "building":
                        request.destination_building_id = top["id"]
                    elif top.get("feature_type") == "road":
                        request.destination_road_id = top["id"]

            if request.destination_coordinates:
                dest_lon = float(request.destination_coordinates[0])
                dest_lat = float(request.destination_coordinates[1])
                dest_coords_out = [round(dest_lon, 6), round(dest_lat, 6)]
                destination_name = request.destination_name or f"Location ({dest_lat:.4f}, {dest_lon:.4f})"
                destination_id = request.destination_name or f"loc_{dest_lon:.4f}_{dest_lat:.4f}"
                destination_type = "location"

                if not is_in_pilot_corridor(dest_lon, dest_lat):
                    return MultiRouteResponse(
                        origin_id=request.origin_station_id,
                        origin_name=origin_name,
                        origin_facility_type=origin_facility_type,
                        origin_coordinates=origin_coordinates,
                        destination_id=destination_id,
                        destination_name=destination_name,
                        destination_type="location",
                        destination_coordinates=dest_coords_out,
                        vehicle=vehicle,
                        requested_count=k_target,
                        routes_found_count=0,
                        status="outside_pilot",
                        routes=[],
                        notes=(
                            f"Destination '{destination_name}' is outside the Chandigarh pilot road network corridor. "
                            "Detailed road routing and vehicle accessibility analysis are unavailable until road-network coverage data exists for this region."
                        ),
                    )

                dest_node = graph.get_closest_node((dest_lon, dest_lat))
                if dest_node:
                    target_nodes.add(dest_node)

            elif request.destination_building_id:
                conn = self.pilot_data_service._get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id, name, centroid_lon, centroid_lat FROM buildings WHERE id = ? OR name = ? LIMIT 1;",
                        (request.destination_building_id, request.destination_building_id),
                    )
                    b_row = cur.fetchone()
                    if b_row:
                        destination_name = b_row["name"] or b_row["id"]
                        centroid = (float(b_row["centroid_lon"]), float(b_row["centroid_lat"]))
                        dest_coords_out = [round(centroid[0], 6), round(centroid[1], 6)]
                        dest_node = graph.get_closest_node(centroid)
                        if dest_node:
                            target_nodes.add(dest_node)
                finally:
                    conn.close()

                if not target_nodes:
                    raise KeyError(f"Destination building not found: {request.destination_building_id}")

            elif request.destination_road_id:
                target_road_id = request.destination_road_id
                target_nodes = graph.get_nodes_for_road(target_road_id)
                if not target_nodes:
                    raise KeyError(f"Destination road not found in network: {request.destination_road_id}")
            else:
                raise ValueError("Either destination_building_id, destination_road_id, or destination_coordinates must be provided")

        else:
            # Sample mode
            fc = self.data_service.get_feature_collection()
            features = fc.get("features", [])
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
            origin_name = st_props.get("name", request.origin_station_id)
            origin_facility_type = st_props.get("facility_type") or st_props.get("station_type")
            st_coords = origin_st.get("geometry", {}).get("coordinates", [])
            if len(st_coords) >= 2:
                origin_coordinates = [round(float(st_coords[0]), 6), round(float(st_coords[1]), 6)]
                st_origin_node = graph.get_closest_node((origin_coordinates[0], origin_coordinates[1]))
            else:
                st_origin_node = None

            if not st_origin_node and st_props.get("primary_access_road"):
                st_nodes = graph.get_nodes_for_road(st_props["primary_access_road"])
                st_origin_node = next(iter(st_nodes)) if st_nodes else None

            if not st_origin_node:
                raise ValueError(f"Origin station {request.origin_station_id} has no connected road nodes")

            target_road_id = None
            destination_id = request.destination_building_id or request.destination_road_id or "destination"
            destination_name = destination_id
            destination_type = "building" if request.destination_building_id else "road"
            dest_coords_out = None

            if request.destination_building_id:
                bldg = next((f for f in features if f.get("properties", {}).get("id") == request.destination_building_id or f.get("id") == request.destination_building_id), None)
                if not bldg:
                    raise KeyError(f"Destination building not found: {request.destination_building_id}")
                destination_name = bldg.get("properties", {}).get("name", destination_id)
                target_road_id = bldg.get("properties", {}).get("connected_road_id")
            elif request.destination_road_id:
                target_road_id = request.destination_road_id
            else:
                raise ValueError("Either destination_building_id, destination_road_id, or destination_coordinates must be provided")

            target_nodes = graph.get_nodes_for_road(target_road_id) if target_road_id else set()
            if not target_nodes:
                return MultiRouteResponse(
                    origin_id=request.origin_station_id,
                    origin_name=origin_name,
                    origin_facility_type=origin_facility_type,
                    origin_coordinates=origin_coordinates,
                    destination_id=destination_id,
                    destination_name=destination_name,
                    destination_type=destination_type,
                    destination_coordinates=dest_coords_out,
                    vehicle=vehicle,
                    requested_count=k_target,
                    routes_found_count=0,
                    status="disconnected",
                    routes=[],
                    notes=f"Target corridor {target_road_id} has no registered nodes in network.",
                )

        # Check trivial co-location
        if st_origin_node in target_nodes and target_road_id is None:
            single_route = AlternativeRoute(
                route_id="route-1",
                route_index=1,
                name="Direct Arrival (Co-located)",
                color=ROUTE_COLORS[0],
                classification=AccessClassification.ACCESSIBLE,
                route_found=True,
                total_distance_m=0.0,
                segment_count=0,
                segments_traversed=[],
                geometry_geojson={"type": "LineString", "coordinates": []},
                steps=[],
                segment_assessments=[],
                limiting_segments=[],
                known_restrictions=[],
                unknown_evidence_segments=[],
                explanation=f"Origin facility and destination are co-located at junction node {st_origin_node}.",
                is_recommended=True,
            )
            return MultiRouteResponse(
                origin_id=request.origin_station_id,
                origin_name=origin_name,
                origin_facility_type=origin_facility_type,
                origin_coordinates=origin_coordinates,
                destination_id=destination_id,
                destination_name=destination_name,
                destination_type=destination_type,
                destination_coordinates=dest_coords_out,
                vehicle=vehicle,
                requested_count=k_target,
                routes_found_count=1,
                status="single_found",
                routes=[single_route],
                notes="Origin and destination are directly co-located.",
            )

        # Multi-Path Diversified Dijkstra Search
        discovered_paths: List[List[RoadEdge]] = []
        penalized_roads: Dict[str, float] = {}
        max_attempts = min(k_target * 4, 12)

        for attempt in range(max_attempts):
            if len(discovered_paths) >= k_target:
                break

            cand_path = self._find_dijkstra_path(
                start_node=st_origin_node,
                target_nodes=target_nodes,
                target_road_id=target_road_id,
                graph=graph,
                vehicle=vehicle,
                penalized_road_factors=penalized_roads,
            )

            if not cand_path:
                break

            # Distinctness check: compare length overlap against all accepted routes
            cand_len = sum(e.length_m for e in cand_path)
            cand_rids = set(e.road_id for e in cand_path)
            is_distinct = True

            for ex_path in discovered_paths:
                ex_len = sum(e.length_m for e in ex_path)
                ex_rids = set(e.road_id for e in ex_path)
                shared_rids = cand_rids.intersection(ex_rids)
                shared_len = sum(e.length_m for e in cand_path if e.road_id in shared_rids)
                denom = min(cand_len, ex_len)
                overlap = (shared_len / denom) if denom > 0 else 1.0
                if overlap > 0.75:
                    is_distinct = False
                    break

            if is_distinct:
                discovered_paths.append(cand_path)

            # Penalize traversed roads to encourage branching into alternative corridors
            for e in cand_path:
                penalized_roads[e.road_id] = penalized_roads.get(e.road_id, 1.0) * 3.5

        # Handle No Routes Found
        if not discovered_paths:
            unconstrained = self._find_unconstrained_path(st_origin_node, target_nodes, target_road_id, graph)
            if unconstrained:
                blocked_rids: List[str] = []
                reasons: List[str] = []
                for edge in unconstrained:
                    asmt = self.evaluate_segment(edge.road_id, vehicle, edge.properties, edge.length_m)
                    if not asmt.is_passable:
                        if edge.road_id not in blocked_rids:
                            blocked_rids.append(edge.road_id)
                            reasons.extend(asmt.limiting_factors)

                return MultiRouteResponse(
                    origin_id=request.origin_station_id,
                    origin_name=origin_name,
                    origin_facility_type=origin_facility_type,
                    origin_coordinates=origin_coordinates,
                    destination_id=destination_id,
                    destination_name=destination_name,
                    destination_type=destination_type,
                    destination_coordinates=dest_coords_out,
                    vehicle=vehicle,
                    requested_count=k_target,
                    routes_found_count=0,
                    status="blocked",
                    routes=[],
                    notes=(
                        f"All candidate routes for {vehicle.name} are blocked by physical clearance restrictions along: "
                        f"{', '.join(blocked_rids[:4])}. Barriers/Reasons: {'; '.join(reasons[:4])}."
                    ),
                )
            else:
                return MultiRouteResponse(
                    origin_id=request.origin_station_id,
                    origin_name=origin_name,
                    origin_facility_type=origin_facility_type,
                    origin_coordinates=origin_coordinates,
                    destination_id=destination_id,
                    destination_name=destination_name,
                    destination_type=destination_type,
                    destination_coordinates=dest_coords_out,
                    vehicle=vehicle,
                    requested_count=k_target,
                    routes_found_count=0,
                    status="disconnected",
                    routes=[],
                    notes="No contiguous topological road connection exists between origin and destination in dataset.",
                )

        # Assemble AlternativeRoute instances
        routes_output: List[AlternativeRoute] = []
        for idx, path in enumerate(discovered_paths, start=1):
            route_id = f"route-{idx}"
            color = ROUTE_COLORS[(idx - 1) % len(ROUTE_COLORS)]
            total_dist_m = sum(e.length_m for e in path)
            traversed_rids: List[str] = []
            segment_asmts: Dict[str, SegmentAssessment] = {}
            steps: List[RouteStep] = []
            coords: List[List[float]] = []

            for s_idx, edge in enumerate(path, start=1):
                if edge.road_id not in traversed_rids:
                    traversed_rids.append(edge.road_id)

                if edge.road_id not in segment_asmts:
                    segment_asmts[edge.road_id] = self.evaluate_segment(
                        road_id=edge.road_id,
                        vehicle=vehicle,
                        props=edge.properties,
                        length_m=edge.length_m,
                    )
                asmt = segment_asmts[edge.road_id]

                steps.append(
                    RouteStep(
                        step_index=s_idx,
                        from_node=edge.from_node,
                        to_node=edge.to_node,
                        road_id=edge.road_id,
                        road_name=edge.name,
                        segment_length_m=round(edge.length_m, 1),
                        status=asmt.status,
                        reason=asmt.notes or "",
                    )
                )

                if not coords:
                    coords.append([round(edge.coordinates[0][0], 6), round(edge.coordinates[0][1], 6)])
                coords.append([round(edge.coordinates[1][0], 6), round(edge.coordinates[1][1], 6)])

            limiting_segments: List[str] = []
            known_restrictions: List[str] = []
            unknown_evidence_segments: List[str] = []
            any_unknown = False
            any_constrained = False

            for rid, asmt in segment_asmts.items():
                if asmt.status == AccessClassification.UNKNOWN:
                    any_unknown = True
                    limiting_segments.append(rid)
                    unknown_evidence_segments.append(rid)
                elif asmt.status == AccessClassification.CONSTRAINED:
                    any_constrained = True
                    limiting_segments.append(rid)
                    for factor in asmt.limiting_factors:
                        if factor not in known_restrictions:
                            known_restrictions.append(f"{asmt.name} ({rid}): {factor}")

            if any_unknown:
                overall_classification = AccessClassification.UNKNOWN
                explanation = (
                    f"Route identified ({round(total_dist_m, 1)}m across {len(traversed_rids)} segments), "
                    f"but contains {len(unknown_evidence_segments)} unmeasured segment(s): {', '.join(unknown_evidence_segments[:4])}. "
                    "Clearance cannot be verified without ground truth width survey."
                )
                is_rec = False
            elif any_constrained:
                overall_classification = AccessClassification.CONSTRAINED
                explanation = (
                    f"Passable alternative route ({round(total_dist_m, 1)}m across {len(traversed_rids)} segments), "
                    f"with narrow clearance margin on: {', '.join(limiting_segments[:4])}."
                )
                is_rec = True
            else:
                overall_classification = AccessClassification.ACCESSIBLE
                explanation = (
                    f"Verified accessible route ({round(total_dist_m, 1)}m across {len(traversed_rids)} segments). "
                    f"All segments meet physical clearance requirements for {vehicle.name}."
                )
                is_rec = True

            # Determine human-friendly route label based on prominent corridor name
            named_roads = [e.name for e in path if e.name and not e.name.startswith("osm_") and not e.name.startswith("Unnamed")]
            label_suffix = f" (via {named_roads[0]})" if named_roads else f" (via {traversed_rids[0]})"
            route_name = f"Route {idx}: Primary Corridor{label_suffix}" if idx == 1 else f"Route {idx}: Alternative {chr(63 + idx)}{label_suffix}"

            routes_output.append(
                AlternativeRoute(
                    route_id=route_id,
                    route_index=idx,
                    name=route_name,
                    color=color,
                    classification=overall_classification,
                    route_found=True,
                    total_distance_m=round(total_dist_m, 1),
                    segment_count=len(traversed_rids),
                    segments_traversed=traversed_rids,
                    geometry_geojson={"type": "LineString", "coordinates": coords},
                    steps=steps,
                    segment_assessments=list(segment_asmts.values()),
                    limiting_segments=limiting_segments,
                    known_restrictions=known_restrictions,
                    unknown_evidence_segments=unknown_evidence_segments,
                    explanation=explanation,
                    is_recommended=is_rec,
                )
            )

        # Status and summary context
        found_cnt = len(routes_output)
        if found_cnt >= k_target:
            status_code = "multiple_found"
            notes_str = f"Found {found_cnt} distinct traversable alternative routes meeting diversity criteria (overlap <= 75%)."
        elif found_cnt > 1:
            status_code = "fewer_found"
            notes_str = (
                f"Found {found_cnt} of {k_target} requested alternative routes. "
                "Fewer alternatives are available because the local road network topology provides limited independent arterial corridors without excessive detour."
            )
        else:
            status_code = "single_found"
            notes_str = (
                f"Only 1 traversable corridor connects this origin and destination for {vehicle.name}. "
                "No viable alternative topological corridor exists within allowable detour limits."
            )

        # Honest disclosure when all routes contain unmeasured widths
        if all(r.classification == AccessClassification.UNKNOWN for r in routes_output):
            notes_str += " Note: All candidate routes contain unmeasured road widths in cadastral records; ground surveys are required before confirming verified accessibility."

        return MultiRouteResponse(
            origin_id=request.origin_station_id,
            origin_name=origin_name,
            origin_facility_type=origin_facility_type,
            origin_coordinates=origin_coordinates,
            destination_id=destination_id,
            destination_name=destination_name,
            destination_type=destination_type,
            destination_coordinates=dest_coords_out,
            vehicle=vehicle,
            requested_count=k_target,
            routes_found_count=found_cnt,
            status=status_code,
            routes=routes_output,
            notes=notes_str,
        )


    def _find_unconstrained_path(
        self,
        start_node: str,
        target_nodes: Set[str],
        target_road_id: Optional[str],
        graph: RoadGraph,
        max_steps: int = 30000,
    ) -> Optional[List[RoadEdge]]:
        """Finds any path regardless of constraints to distinguish blockage from disconnection."""
        from collections import deque
        visited: Set[str] = set()
        queue = deque([(start_node, [])])
        steps = 0

        while queue and steps < max_steps:
            steps += 1
            curr, path = queue.popleft()
            has_target = any(e.road_id == target_road_id for e in path) if target_road_id else True

            if target_road_id:
                if has_target and curr in target_nodes:
                    return path
            else:
                if curr in target_nodes and len(path) > 0:
                    return path

            if curr in visited:
                continue
            visited.add(curr)

            for edge in graph.adjacency.get(curr, []):
                if edge.to_node not in visited:
                    queue.append((edge.to_node, path + [edge]))

        return None

    def assess_building_access(
        self,
        building_id: str,
        vehicle_id: str = "fire",
        origin_station_id: Optional[str] = None,
        dataset_mode: Optional[str] = None,
    ) -> BuildingAccessResponse:
        """Assesses emergency vehicle access to a specific building footprint, distinguishing road reachability from physical entrance ingress."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        # Check if building is in the real pilot SQLite database
        bldg_row = None
        is_pilot = (dataset_mode == "pilot") or building_id.startswith("osm_")
        if self.pilot_data_service.is_available() and dataset_mode != "sample":
            conn = self.pilot_data_service._get_connection()
            try:
                cur = conn.cursor()
                osm_num = None
                for part in building_id.split("_"):
                    if part.isdigit():
                        osm_num = int(part)
                        break
                cur.execute(
                    """SELECT id, name, use_type, centroid_lon, centroid_lat, geometry_geojson, verification_status
                       FROM buildings WHERE id = ? OR name = ? OR osm_id = ? LIMIT 1;""",
                    (building_id, building_id, osm_num),
                )
                bldg_row = cur.fetchone()
                if bldg_row:
                    is_pilot = True
            finally:
                conn.close()

        if is_pilot and bldg_row:
            b_id = bldg_row["id"]
            b_name = bldg_row["name"] or b_id
            use_type = bldg_row["use_type"] or "building"
            b_lon = float(bldg_row["centroid_lon"])
            b_lat = float(bldg_row["centroid_lat"])
            centroid = (b_lon, b_lat)
            building_coords = [b_lon, b_lat]

            graph = self.get_pilot_graph()
            if not graph:
                raise ValueError("Pilot road network graph is unavailable")

            # Identify candidate connected road access nodes within proximity
            cell_x = int(b_lon * 100)
            cell_y = int(b_lat * 100)
            cand_nodes: List[str] = []
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    ck = (cell_x + dx, cell_y + dy)
                    if ck in graph.grid:
                        cand_nodes.extend(graph.grid[ck])

            cand_with_dist: List[Tuple[float, str]] = []
            for nid in set(cand_nodes):
                d = haversine_distance_m(centroid, graph.nodes[nid])
                if d <= 350:
                    cand_with_dist.append((d, nid))
            cand_with_dist.sort()

            best_node = None
            best_dist = None
            best_edge = None
            for d, nid in cand_with_dist:
                edges = graph.adjacency.get(nid, [])
                unrestricted = [
                    e for e in edges
                    if e.properties.get("access") not in ("no", "private")
                    and e.road_class not in ("footway", "steps", "path", "cycleway")
                ]
                if unrestricted:
                    best_node = nid
                    best_dist = d
                    best_edge = unrestricted[0]
                    break

            if not best_node and cand_with_dist:
                best_dist, best_node = cand_with_dist[0]
                edges = graph.adjacency.get(best_node, [])
                best_edge = edges[0] if edges else None

            if not best_node:
                best_node = graph.get_closest_node(centroid)
                if best_node:
                    best_dist = haversine_distance_m(centroid, graph.nodes[best_node])
                    edges = graph.adjacency.get(best_node, [])
                    best_edge = edges[0] if edges else None

            if not best_node or best_dist is None or best_dist > 800:
                return BuildingAccessResponse(
                    building_id=b_id,
                    building_name=b_name,
                    use_type=use_type,
                    connected_road_id=None,
                    approach_road_name=None,
                    estimated_setback_m=round(best_dist, 1) if best_dist is not None else None,
                    entrance_status="unconfirmed_entrance",
                    assessment_status="unverified",
                    vehicle=vehicle,
                    classification=AccessClassification.UNKNOWN,
                    origin_station_id=origin_station_id or "station-01",
                    building_coordinates=building_coords,
                    route=None,
                    limitations=["Isolated building footprint with no connected road corridor in network within 800m"],
                    missing_evidence=[
                        "Building entrance gate is unsurveyed in municipal records.",
                        "No mapped public road access corridor connects to this structure.",
                    ],
                    plain_language_explanation=(
                        f"Building {b_name} ({b_id}) has no connected road access corridor mapped in the pilot network. "
                        "Direct emergency apparatus access cannot be determined."
                    ),
                )

            road_access_coords = [float(graph.nodes[best_node][0]), float(graph.nodes[best_node][1])]
            setback_m = round(best_dist, 1)
            connected_road_id = best_edge.road_id if best_edge else f"node_{best_node}"
            approach_road_name = (best_edge.name or best_edge.road_id) if best_edge else "Connected Road Access"

            # Resolve origin emergency facility in pilot dataset
            origin_name = None
            origin_type = None
            resolved_origin_id = origin_station_id

            if not resolved_origin_id or resolved_origin_id == "station-01":
                conn = self.pilot_data_service._get_connection()
                try:
                    cur = conn.cursor()
                    if vehicle.id == "fire":
                        cur.execute("SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE facility_type = 'fire_station';")
                        stns = cur.fetchall()
                        if not stns:
                            cur.execute("SELECT id, name, facility_type, lon, lat FROM emergency_facilities LIMIT 100;")
                            stns = cur.fetchall()
                    else:
                        cur.execute("SELECT id, name, facility_type, lon, lat FROM emergency_facilities WHERE facility_type IN ('hospital', 'clinic');")
                        stns = cur.fetchall()
                        if not stns:
                            cur.execute("SELECT id, name, facility_type, lon, lat FROM emergency_facilities LIMIT 100;")
                            stns = cur.fetchall()

                    with_d = []
                    for s in stns:
                        d = haversine_distance_m(centroid, (float(s["lon"]), float(s["lat"])))
                        with_d.append((d, s))
                    with_d.sort()
                    if with_d:
                        closest_fac = with_d[0][1]
                        resolved_origin_id = closest_fac["id"]
                        origin_name = closest_fac["name"]
                        origin_type = closest_fac["facility_type"]
                finally:
                    conn.close()

            if not resolved_origin_id:
                resolved_origin_id = "osm_emergency_way_129774350"
                origin_name = "Sector 17 Fire Station"
                origin_type = "fire_station"

            # Calculate vehicle-aware route to connected road access point
            route_req = RouteRequest(
                origin_station_id=resolved_origin_id,
                destination_coordinates=road_access_coords,
                destination_name=f"{b_name} Road Corridor ({approach_road_name})",
                vehicle_id=vehicle_id,
                dataset_mode="pilot",
            )
            route_resp = self.calculate_route(route_req)
            if not origin_name:
                origin_name = route_resp.origin_name

            missing_evidence = [
                "Property entrance gate and perimeter threshold location are unsurveyed in municipal records.",
            ]
            if best_edge and best_edge.width_m is None:
                missing_evidence.append(
                    f"Approach corridor width for {approach_road_name} is unmeasured in cadastre; on-site ground truth width audit required."
                )
            if route_resp.limiting_segments:
                missing_evidence.append(
                    f"{len(route_resp.limiting_segments)} road segment(s) along approach corridor lack verified physical clearance."
                )
            missing_evidence.append(
                f"Final {setback_m}m setback from public road corridor to building footprint requires pedestrian advance or hose relay."
            )
            if vehicle.id == "fire":
                missing_evidence.append(
                    "Aerial ladder turntable clearance and building façade standoff distance are unverified."
                )

            limitations = list(route_resp.limiting_segments)

            if not route_resp.route_found or route_resp.classification == AccessClassification.INACCESSIBLE:
                assessment_status = "verified_inaccessible"
                entrance_status = "unconfirmed_entrance"
                plain_explanation = (
                    f"{vehicle.name} from {origin_name or resolved_origin_id} cannot reach the connected road corridor "
                    f"({approach_road_name}) due to physical bottlenecks along the path: {route_resp.explanation}"
                )
            elif route_resp.classification == AccessClassification.UNKNOWN or (best_edge and best_edge.width_m is None):
                assessment_status = "partial_unverified"
                entrance_status = "road_frontage_only"
                plain_explanation = (
                    f"{vehicle.name} route from {origin_name or resolved_origin_id} reaches the connected road corridor on "
                    f"{approach_road_name} ({setback_m}m setback to building), but clearance certainty is UNVERIFIED due to unmeasured road widths. "
                    f"CRITICAL ACCESS DISTINCTION: Mapped road-network reachability does NOT imply building entrance ingress. "
                    f"Property gates and internal driveways are unsurveyed; apparatus must remain in the public corridor while crew deploys hose lines."
                )
            elif route_resp.classification == AccessClassification.CONSTRAINED:
                assessment_status = "partial_unverified"
                entrance_status = "road_frontage_only"
                plain_explanation = (
                    f"{vehicle.name} from {origin_name or resolved_origin_id} can reach the approach corridor on {approach_road_name} "
                    f"under operational constraints ({', '.join(route_resp.limiting_segments)}). "
                    f"Road-to-building setback is {setback_m}m. Building entrance gate is unsurveyed; physical entry of heavy apparatus into property is not supported."
                )
            else:
                assessment_status = "road_verified_entrance_unverified"
                entrance_status = "road_frontage_only"
                plain_explanation = (
                    f"{vehicle.name} can navigate the public road network from {origin_name or resolved_origin_id} to the "
                    f"frontage corridor on {approach_road_name} ({setback_m}m setback). "
                    f"NOTE: Road corridor clearance is verified, but building entrance gates, boundary walls, and courtyard setbacks are unsurveyed. "
                    f"Direct apparatus entry into building premises cannot be claimed."
                )

            return BuildingAccessResponse(
                building_id=b_id,
                building_name=b_name,
                use_type=use_type,
                connected_road_id=connected_road_id,
                approach_road_name=approach_road_name,
                estimated_setback_m=setback_m,
                entrance_status=entrance_status,
                assessment_status=assessment_status,
                vehicle=vehicle,
                classification=route_resp.classification,
                origin_station_id=resolved_origin_id,
                origin_station_name=origin_name,
                origin_facility_type=origin_type,
                road_access_coordinates=road_access_coords,
                building_coordinates=building_coords,
                route=route_resp,
                limitations=limitations,
                missing_evidence=missing_evidence,
                plain_language_explanation=plain_explanation,
            )

        # Sample Demonstration Dataset Resolution (Preserves 100% test compatibility)
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
        centroid = get_feature_centroid(bldg)
        building_coords = [centroid[0], centroid[1]]
        resolved_origin_id = origin_station_id or "station-01"

        if not connected_road_id:
            return BuildingAccessResponse(
                building_id=building_id,
                building_name=b_name,
                use_type=use_type,
                connected_road_id=None,
                approach_road_name=None,
                estimated_setback_m=setback_m,
                entrance_status="unconfirmed_entrance",
                assessment_status="unverified",
                vehicle=vehicle,
                classification=AccessClassification.UNKNOWN,
                origin_station_id=resolved_origin_id,
                origin_station_name="Sector 1 Station",
                origin_facility_type="fire_station",
                building_coordinates=building_coords,
                route=None,
                limitations=["Building entrance is unsurveyed with no fronting road link assigned"],
                missing_evidence=[
                    "Building entrance gate is unsurveyed in cadastre.",
                    "No fronting road assigned in municipal records.",
                ],
                plain_language_explanation=(
                    f"Building {building_id} ({b_name}) has no fronting road assigned in cadastre records. "
                    "Direct emergency vehicle access cannot be determined."
                ),
            )

        connected_road = next((f for f in features if f.get("properties", {}).get("id") == connected_road_id), None)
        approach_road_name = connected_road.get("properties", {}).get("name") if connected_road else connected_road_id

        # Route to fronting road
        route_req = RouteRequest(
            origin_station_id=resolved_origin_id,
            destination_building_id=building_id,
            vehicle_id=vehicle_id,
            dataset_mode="sample",
        )
        route_resp = self.calculate_route(route_req)

        limitations = list(route_resp.limiting_segments)
        setback_str = f"{setback_m}m" if setback_m is not None else "unmeasured"

        missing_evidence = [
            "Building entrance gate is unsurveyed in cadastre.",
            f"Setback distance ({setback_str}) from corridor requires pedestrian or hose line advance.",
        ]
        if route_resp.limiting_segments:
            missing_evidence.append(f"{len(route_resp.limiting_segments)} segment(s) along route have bottlenecks or unmeasured widths.")

        if route_resp.classification == AccessClassification.ACCESSIBLE:
            plain_explanation = (
                f"{vehicle.name} can reach the fronting road corridor ({connected_road_id}). "
                f"Note: Property entrance gate is unsurveyed; final {setback_str} setback "
                "must be traversed via pedestrian access or hose relay."
            )
            entrance_status = "road_frontage_only"
            assessment_status = "road_verified_entrance_unverified"
        elif route_resp.classification == AccessClassification.CONSTRAINED:
            plain_explanation = (
                f"{vehicle.name} can reach the frontage road with limitations ({', '.join(route_resp.limiting_segments)}). "
                f"Frontage setback is {setback_str}; gate ingress unverified."
            )
            entrance_status = "road_frontage_only"
            assessment_status = "partial_unverified"
        elif route_resp.classification == AccessClassification.INACCESSIBLE:
            plain_explanation = (
                f"{vehicle.name} cannot reach fronting corridor ({connected_road_id}) due to physical blockage: "
                f"{route_resp.explanation}"
            )
            entrance_status = "road_frontage_only"
            assessment_status = "verified_inaccessible"
        else:
            plain_explanation = (
                f"Corridor accessibility to {building_id} is unknown due to missing width or unsurveyed data along path."
            )
            entrance_status = "unconfirmed_entrance"
            assessment_status = "partial_unverified"

        return BuildingAccessResponse(
            building_id=building_id,
            building_name=b_name,
            use_type=use_type,
            connected_road_id=connected_road_id,
            approach_road_name=approach_road_name,
            estimated_setback_m=setback_m,
            entrance_status=entrance_status,
            assessment_status=assessment_status,
            vehicle=vehicle,
            classification=route_resp.classification,
            origin_station_id=resolved_origin_id,
            origin_station_name="Sector 1 Station",
            origin_facility_type="fire_station",
            building_coordinates=building_coords,
            route=route_resp,
            limitations=limitations,
            missing_evidence=missing_evidence,
            plain_language_explanation=plain_explanation,
        )

    def calculate_naive_route(
        self,
        origin_station_id: str,
        destination_building_id: Optional[str] = None,
        destination_road_id: Optional[str] = None,
        destination_coordinates: Optional[List[float]] = None,
        destination_name: Optional[str] = None,
        dataset_mode: Optional[str] = None,
    ) -> Tuple[List[RoadEdge], float, List[str]]:
        """Calculates distance-only shortest path using Dijkstra, ignoring vehicle clearance constraints."""
        is_pilot = (
            dataset_mode == "pilot"
            or origin_station_id.startswith("osm_")
            or (destination_building_id and destination_building_id.startswith("osm_"))
            or (destination_road_id and destination_road_id.startswith("osm_"))
            or (destination_coordinates is not None)
            or (self.pilot_data_service.is_available() and self.is_pilot_facility(origin_station_id))
        )

        if is_pilot and self.pilot_data_service.is_available():
            graph = self.get_pilot_graph()
            if graph is None:
                graph = self.get_graph()
                is_pilot = False
        else:
            graph = self.get_graph()
            is_pilot = False

        st_origin_node: Optional[str] = None
        target_road_id: Optional[str] = None
        target_nodes: Set[str] = set()

        if is_pilot:
            conn = self.pilot_data_service._get_connection()
            try:
                cur = conn.cursor()
                osm_num = None
                for part in origin_station_id.split("_"):
                    if part.isdigit():
                        osm_num = int(part)
                        break
                cur.execute(
                    "SELECT id, name, lon, lat FROM emergency_facilities WHERE id = ? OR name = ? OR osm_id = ? OR id LIKE ? LIMIT 1;",
                    (origin_station_id, origin_station_id, osm_num, f"%{origin_station_id}%"),
                )
                st_row = cur.fetchone()
                if not st_row:
                    cur.execute(
                        "SELECT id, name, lon, lat FROM emergency_facilities WHERE name LIKE ? LIMIT 1;",
                        (f"%{origin_station_id}%",),
                    )
                    st_row = cur.fetchone()
                if st_row:
                    st_origin_node = graph.get_closest_node((float(st_row["lon"]), float(st_row["lat"])))
            finally:
                conn.close()

            if not st_origin_node:
                fc = self.data_service.get_feature_collection()
                for f in fc.get("features", []):
                    props = f.get("properties", {})
                    if props.get("id") == origin_station_id:
                        c = f.get("geometry", {}).get("coordinates", [])
                        if len(c) >= 2:
                            st_origin_node = graph.get_closest_node((float(c[0]), float(c[1])))
                        break

            if not st_origin_node:
                raise KeyError(f"Origin station not found: {origin_station_id}")

            if destination_coordinates:
                dest_lon = float(destination_coordinates[0])
                dest_lat = float(destination_coordinates[1])
                dest_node = graph.get_closest_node((dest_lon, dest_lat))
                if dest_node:
                    target_nodes.add(dest_node)
            elif destination_building_id:
                conn = self.pilot_data_service._get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id, name, centroid_lon, centroid_lat FROM buildings WHERE id = ? OR name = ? LIMIT 1;",
                        (destination_building_id, destination_building_id),
                    )
                    b_row = cur.fetchone()
                    if b_row:
                        dest_node = graph.get_closest_node((float(b_row["centroid_lon"]), float(b_row["centroid_lat"])))
                        if dest_node:
                            target_nodes.add(dest_node)
                finally:
                    conn.close()
                if not target_nodes:
                    raise KeyError(f"Destination building not found: {destination_building_id}")
            elif destination_road_id:
                target_road_id = destination_road_id
                target_nodes = graph.get_nodes_for_road(target_road_id)
                if not target_nodes:
                    raise KeyError(f"Destination road not found in network: {destination_road_id}")
            else:
                raise ValueError("Destination building, road, or coordinates required")

        else:
            fc = self.data_service.get_feature_collection()
            features = fc.get("features", [])

            # Resolve Origin Station
            origin_st = None
            for f in features:
                props = f.get("properties", {})
                if props.get("feature_type") == "station" and (
                    props.get("id") == origin_station_id or f.get("id") == origin_station_id
                ):
                    origin_st = f
                    break

            if not origin_st:
                raise KeyError(f"Origin station not found: {origin_station_id}")

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
                raise ValueError(f"Origin station {origin_station_id} has no connected road nodes")

            # Resolve Destination
            if destination_building_id:
                target_bldg = None
                for f in features:
                    props = f.get("properties", {})
                    if props.get("feature_type") == "building" and (
                        props.get("id") == destination_building_id or f.get("id") == destination_building_id
                    ):
                        target_bldg = f
                        break
                if not target_bldg:
                    raise KeyError(f"Destination building not found: {destination_building_id}")
                target_road_id = target_bldg.get("properties", {}).get("connected_road_id")
                if not target_road_id:
                    return [], 0.0, []
            elif destination_road_id:
                target_road_id = destination_road_id
                if not graph.get_nodes_for_road(target_road_id):
                    raise KeyError(f"Destination road not found in network: {destination_road_id}")
            else:
                raise ValueError("Either destination_building_id or destination_road_id must be provided")

            target_nodes = graph.get_nodes_for_road(target_road_id)
            if not target_nodes:
                return [], 0.0, []

        # Pure distance Dijkstra
        pq: List[Tuple[float, str, List[RoadEdge]]] = []
        best_cost: Dict[Tuple[str, bool], float] = {}

        heapq.heappush(pq, (0.0, st_origin_node, []))
        best_cost[(st_origin_node, False)] = 0.0

        chosen_edges: Optional[List[RoadEdge]] = None

        while pq:
            dist, u, path = heapq.heappop(pq)
            has_target = any(e.road_id == target_road_id for e in path) if target_road_id else True

            if dist > best_cost.get((u, has_target), float("inf")):
                continue

            if target_road_id:
                if has_target and u in target_nodes:
                    chosen_edges = path
                    break
            else:
                if u in target_nodes and len(path) > 0:
                    chosen_edges = path
                    break

            for edge in graph.adjacency.get(u, []):
                if path and path[-1].to_node == edge.from_node and path[-1].from_node == edge.to_node:
                    continue

                new_dist = dist + edge.length_m
                v = edge.to_node
                new_has_target = has_target or (target_road_id is not None and edge.road_id == target_road_id)

                if new_dist < best_cost.get((v, new_has_target), float("inf")):
                    best_cost[(v, new_has_target)] = new_dist
                    heapq.heappush(pq, (new_dist, v, path + [edge]))

        if not chosen_edges:
            return [], 0.0, []

        road_ids: List[str] = []
        total_dist_m = 0.0
        for e in chosen_edges:
            total_dist_m += e.length_m
            if e.road_id not in road_ids:
                road_ids.append(e.road_id)

        return chosen_edges, round(total_dist_m, 1), road_ids

    def compare_routes(
        self,
        station_id: str = "station-01",
        building_id: Optional[str] = None,
        vehicle_id: str = "fire",
        road_id: Optional[str] = None,
        destination_coordinates: Optional[List[float]] = None,
        destination_name: Optional[str] = None,
        dataset_mode: Optional[str] = None,
    ) -> RouteCompareResponse:
        """Compares naive distance-only pathfinding vs vehicle-aware emergency access."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        # 1. Compute naive distance-only path
        naive_edges, naive_dist_m, naive_road_ids = self.calculate_naive_route(
            origin_station_id=station_id,
            destination_building_id=building_id,
            destination_road_id=road_id,
            destination_coordinates=destination_coordinates,
            destination_name=destination_name,
            dataset_mode=dataset_mode,
        )

        # 2. Evaluate each segment on the naive path with the existing clearance function
        violations: List[RouteViolation] = []
        evaluated_segments: Set[str] = set()

        for edge in naive_edges:
            if edge.road_id in evaluated_segments:
                continue
            evaluated_segments.add(edge.road_id)

            asmt = self.evaluate_segment(
                road_id=edge.road_id,
                vehicle=vehicle,
                props=edge.properties,
                length_m=edge.length_m,
            )

            # Check if segment violates vehicle physical clearance (inaccessible or unmeasured)
            if not asmt.is_passable:
                reason = asmt.notes or ("; ".join(asmt.limiting_factors) if asmt.limiting_factors else "Inaccessible corridor")
                violations.append(
                    RouteViolation(
                        road_id=edge.road_id,
                        reason=reason,
                        width_m=asmt.width_m,
                        required_m=vehicle.min_clearance_width_m,
                    )
                )

        naive_would_fail = len(violations) > 0

        # 3. Compute vehicle-aware defensible route using calculate_route
        aware_req = RouteRequest(
            origin_station_id=station_id,
            destination_building_id=building_id,
            destination_road_id=road_id,
            destination_coordinates=destination_coordinates,
            destination_name=destination_name,
            vehicle_id=vehicle_id,
            dataset_mode=dataset_mode,
        )
        aware_resp = self.calculate_route(aware_req)

        aware_summary = AwareRouteSummary(
            road_ids=aware_resp.segments_traversed,
            distance_m=aware_resp.total_distance_m,
            classification=aware_resp.classification,
        )

        naive_summary = NaiveRouteSummary(
            road_ids=naive_road_ids,
            distance_m=naive_dist_m,
            violations=violations,
        )

        # 4. Generate deterministic verdict template string
        if naive_would_fail:
            v0 = violations[0]
            if v0.width_m is not None and v0.width_m < v0.required_m:
                verdict = (
                    f"A distance-only route would fail at {v0.road_id} "
                    f"({v0.width_m} m < {v0.required_m} m required for {vehicle.name})"
                )
            else:
                verdict = (
                    f"A distance-only route would fail at {v0.road_id} "
                    f"({v0.reason})"
                )
        elif not naive_road_ids and not aware_summary.road_ids:
            verdict = "No route found between station and destination under either model."
        elif naive_road_ids == aware_summary.road_ids:
            verdict = (
                f"Distance-only route and vehicle-aware route are identical "
                f"({naive_dist_m} m); corridor satisfies {vehicle.name} clearance."
            )
        else:
            verdict = (
                f"Distance-only route is passable but vehicle-aware route takes a safer bypass "
                f"({aware_summary.distance_m} m vs {naive_dist_m} m naive)."
            )

        return RouteCompareResponse(
            naive=naive_summary,
            aware=aware_summary,
            verdict=verdict,
            naive_would_fail=naive_would_fail,
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

    def simulate(self, request: SimulateRequest) -> SimulateResponse:
        """Simulates hypothetical road network changes on an in-memory copy without mutating real data."""
        vehicle_id = request.vehicle_id or "fire"
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        # 1. Evaluate BEFORE state on current unmodified data
        fc_original = self.data_service.get_feature_collection()
        features_original = fc_original.get("features", [])
        building_features = [
            f for f in features_original if f.get("properties", {}).get("feature_type") == "building"
        ]

        before_status_map: Dict[str, str] = {}
        building_names: Dict[str, str] = {}
        for b in building_features:
            b_id = b.get("properties", {}).get("id") or b.get("id")
            b_name = b.get("properties", {}).get("name", b_id)
            building_names[b_id] = b_name
            asmt = self.assess_building_access(building_id=b_id, vehicle_id=vehicle_id)
            before_status_map[b_id] = asmt.classification.value

        # 2. Deepcopy features for in-memory simulation
        features_sim = copy.deepcopy(features_original)

        # 3. Apply changes to in-memory copy
        assumptions: List[str] = [
            "Simulation is evaluated deterministically in-memory without persistent modifications.",
            f"All access constraints verified against {vehicle.name} physical apparatus specifications.",
        ]

        for change in request.changes:
            r_id = change.road_id
            act = change.action
            target_feat = None
            for f in features_sim:
                if (
                    f.get("properties", {}).get("feature_type") == "road"
                    and (f.get("properties", {}).get("id") == r_id or f.get("id") == r_id)
                ):
                    target_feat = f
                    break

            if not target_feat:
                continue

            r_props = target_feat.setdefault("properties", {})
            r_name = r_props.get("name", r_id)

            if act in ("close", "block"):
                r_props["obstruction"] = "Simulated closure / emergency incident block"
                r_props["access_status"] = "infeasible"
                assumptions.append(f"Road {r_name} ({r_id}) temporarily closed to emergency apparatus.")
            elif act in ("clear", "clear_obstruction"):
                r_props["obstruction"] = None
                r_props["access_status"] = "feasible"
                assumptions.append(f"Physical obstructions and wire bundles cleared from {r_name} ({r_id}).")
            elif act in ("set_width", "widen"):
                val = change.value if change.value is not None else getattr(change, "new_width_m", None)
                if val is not None:
                    r_props["width_m"] = float(val)
                    obs = str(r_props.get("obstruction") or "").lower()
                    if "width" in obs or "bottleneck" in obs or "narrow" in obs or "clearance" in obs:
                        r_props["obstruction"] = None
                    r_props["access_status"] = "feasible"
                    assumptions.append(f"Usable width of {r_name} ({r_id}) adjusted to {val}m.")

        # 4. Create isolated in-memory DataService and AccessEngine for AFTER state
        class InMemoryDataService(DataService):
            def __init__(self, sim_fc: Dict[str, Any]):
                self._cache = sim_fc

            def load_data(self) -> Dict[str, Any]:
                return self._cache

        sim_ds = InMemoryDataService(
            {
                "type": "FeatureCollection",
                "metadata": {**fc_original.get("metadata", {}), "simulation": True},
                "features": features_sim,
            }
        )
        sim_engine = AccessEngine(ds=sim_ds)

        after_status_map: Dict[str, str] = {}
        for b_id in before_status_map.keys():
            sim_asmt = sim_engine.assess_building_access(building_id=b_id, vehicle_id=vehicle_id)
            after_status_map[b_id] = sim_asmt.classification.value

        # 5. Collate counts and changed buildings
        before_counts: Dict[str, int] = {"accessible": 0, "constrained": 0, "inaccessible": 0, "unknown": 0}
        after_counts: Dict[str, int] = {"accessible": 0, "constrained": 0, "inaccessible": 0, "unknown": 0}

        for st in before_status_map.values():
            before_counts[st] = before_counts.get(st, 0) + 1

        for st in after_status_map.values():
            after_counts[st] = after_counts.get(st, 0) + 1

        changed_buildings: List[ChangedBuilding] = []
        for b_id, b_status in before_status_map.items():
            a_status = after_status_map[b_id]
            if b_status != a_status:
                changed_buildings.append(
                    ChangedBuilding(
                        id=b_id,
                        name=building_names.get(b_id, b_id),
                        before=b_status,
                        after=a_status,
                    )
                )

        return SimulateResponse(
            before=before_counts,
            after=after_counts,
            changed_buildings=changed_buildings,
            assumptions=assumptions,
        )

    def get_critical_roads(self, vehicle_id: str = "fire", limit: int = 5) -> List[CriticalRoad]:
        """Calculates single-points-of-failure roads ranked by number of buildings whose access deteriorates when closed."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        fc = self.data_service.get_feature_collection()
        features = fc.get("features", [])
        roads = [f for f in features if f.get("properties", {}).get("feature_type") == "road"]

        severity_rank = {
            "accessible": 3,
            "constrained": 2,
            "unknown": 1,
            "inaccessible": 0,
        }

        critical_list: List[CriticalRoad] = []

        for road in roads:
            r_props = road.get("properties", {})
            r_id = r_props.get("id") or road.get("id")
            r_name = r_props.get("name", r_id)

            sim_req = SimulateRequest(
                vehicle_id=vehicle_id,
                changes=[SimulateChange(road_id=r_id, action="close")],
            )
            sim_resp = self.simulate(sim_req)

            worsened_buildings: List[str] = []
            for cb in sim_resp.changed_buildings:
                # Deterioration: rank before > rank after (e.g. accessible -> inaccessible/constrained)
                if severity_rank.get(cb.before, 0) > severity_rank.get(cb.after, 0):
                    worsened_buildings.append(cb.id)

            critical_list.append(
                CriticalRoad(
                    road_id=r_id,
                    name=r_name,
                    buildings_affected=len(worsened_buildings),
                    building_ids=worsened_buildings,
                )
            )

        critical_list.sort(key=lambda cr: cr.buildings_affected, reverse=True)
        return critical_list[:limit]

    def get_audit_work_order(self, vehicle_id: str = "fire") -> List["WorkOrderItem"]:
        """Calculates prioritized audit work order for unknown/unverified road segments ranked by dependent buildings."""
        vehicle = get_vehicle_profile(vehicle_id)
        if not vehicle:
            raise ValueError(f"Unsupported vehicle profile: {vehicle_id}")

        fc = self.data_service.get_feature_collection()
        features = fc.get("features", [])
        roads = [f for f in features if f.get("properties", {}).get("feature_type") == "road"]

        severity_rank = {
            "accessible": 3,
            "constrained": 2,
            "unknown": 1,
            "inaccessible": 0,
        }

        work_order: List[WorkOrderItem] = []

        for road in roads:
            r_props = road.get("properties", {})
            r_id = r_props.get("id") or road.get("id")
            r_name = r_props.get("name", r_id)
            data_src = r_props.get("data_source")

            asmt = self.evaluate_segment(road_id=r_id, vehicle=vehicle, props=r_props)
            ver = str(r_props.get("verification_status") or r_props.get("verification") or "").lower()

            is_unknown = (
                asmt.status == AccessClassification.UNKNOWN
                or r_props.get("access_status") == "unknown"
                or r_props.get("width_m") is None
            )
            is_unverified = (
                "unverified" in ver
                or "uninspected" in ver
                or ver in ["unverified", "unverified_survey", "uninspected"]
            )

            if not (is_unknown or is_unverified):
                continue

            # Reason derivation
            if r_props.get("reason"):
                reason = r_props["reason"]
            elif is_unknown:
                reason = (
                    asmt.notes
                    or r_props.get("notes")
                    or "Width unmeasured in cadastre; clearance unverified."
                )
            elif is_unverified:
                label = ver.replace("_", " ") if ver else "unverified"
                reason = (
                    r_props.get("notes")
                    if (r_props.get("notes") and ("unverified" in r_props["notes"].lower() or "audit" in r_props["notes"].lower()))
                    else f"Unverified cadastral survey ({label}): field ground truth audit required."
                )
            else:
                reason = r_props.get("notes") or "Ground truth physical clearance audit required."

            # Calculate buildings affected using the same method as critical-roads (simulation closure)
            sim_req = SimulateRequest(
                vehicle_id=vehicle_id,
                changes=[SimulateChange(road_id=r_id, action="close")],
            )
            sim_resp = self.simulate(sim_req)

            worsened_buildings: List[str] = []
            for cb in sim_resp.changed_buildings:
                if severity_rank.get(cb.before, 0) > severity_rank.get(cb.after, 0):
                    worsened_buildings.append(cb.id)

            work_order.append(
                WorkOrderItem(
                    road_id=r_id,
                    name=r_name,
                    reason=reason,
                    buildings_affected=len(worsened_buildings),
                    data_source=data_src,
                )
            )

        # Ranked by buildings affected descending, secondary sort by road_id
        work_order.sort(key=lambda item: (-item.buildings_affected, item.road_id))
        return work_order


from pydantic import BaseModel


class WorkOrderItem(BaseModel):
    """Prioritized work order item for ground truth road audit."""
    road_id: str
    name: str
    reason: str
    buildings_affected: int
    data_source: Optional[str] = None


# In-memory cache for critical roads by vehicle_id
CRITICAL_ROADS_CACHE: Dict[str, List[CriticalRoad]] = {}


# Singleton instance for route injection
access_engine = AccessEngine()




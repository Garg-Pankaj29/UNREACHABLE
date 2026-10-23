"""Road network graph service for topological representation and connectivity analysis."""
import logging
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("unreachable.graph_service")


def haversine_distance_m(coord1: Tuple[float, float], coord2: Tuple[float, float]) -> float:
    """Calculates great-circle distance in meters between two (lon, lat) points."""
    lon1, lat1 = coord1
    lon2, lat2 = coord2
    R = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def node_key(coord: Tuple[float, float]) -> str:
    """Deterministic node identifier from rounded coordinates (6 decimals ~ 0.11m precision)."""
    lon, lat = round(coord[0], 6), round(coord[1], 6)
    return f"node_{lon:.6f}_{lat:.6f}"


@dataclass
class RoadEdge:
    """Directed edge representing a traversable sub-segment between two junctions."""
    edge_id: str
    from_node: str
    to_node: str
    road_id: str
    name: str
    road_class: Optional[str]
    width_m: Optional[float]
    surface: Optional[str]
    obstruction: Optional[str]
    access_status: str
    length_m: float
    coordinates: List[Tuple[float, float]]
    properties: Dict[str, Any] = field(default_factory=dict)


class RoadGraph:
    """Topological graph representing road network junctions as nodes and segments as edges."""

    def __init__(self):
        self.nodes: Dict[str, Tuple[float, float]] = {}  # node_id -> (lon, lat)
        self.adjacency: Dict[str, List[RoadEdge]] = {}  # node_id -> [RoadEdge]
        self.road_to_edges: Dict[str, List[RoadEdge]] = {}  # road_id -> [RoadEdge]
        self.road_to_nodes: Dict[str, Set[str]] = {}  # road_id -> {node_id}
        self.grid: Dict[Tuple[int, int], List[str]] = {}  # (cell_x, cell_y) -> [node_id] (~1km bins)
        self.total_roads_loaded: int = 0

    def add_node(self, coord: Tuple[float, float]) -> str:
        """Registers a junction node if not already present, returning its unique key."""
        nid = node_key(coord)
        if nid not in self.nodes:
            lon, lat = round(coord[0], 6), round(coord[1], 6)
            self.nodes[nid] = (lon, lat)
            self.adjacency[nid] = []
            cell = (int(lon * 100), int(lat * 100))
            self.grid.setdefault(cell, []).append(nid)
        return nid

    def add_edge(
        self,
        u_coord: Tuple[float, float],
        v_coord: Tuple[float, float],
        road_id: str,
        name: str,
        road_class: Optional[str],
        width_m: Optional[float],
        surface: Optional[str],
        obstruction: Optional[str],
        access_status: str,
        properties: Dict[str, Any],
        bidirectional: bool = True,
    ):
        """Adds a graph edge between two junction coordinates."""
        u = self.add_node(u_coord)
        v = self.add_node(v_coord)

        if u == v:
            # Self-loop with identical coordinates ignored
            return

        length_m = haversine_distance_m(u_coord, v_coord)
        edge_id_forward = f"{road_id}_{u}->{v}"

        forward_edge = RoadEdge(
            edge_id=edge_id_forward,
            from_node=u,
            to_node=v,
            road_id=road_id,
            name=name,
            road_class=road_class,
            width_m=width_m,
            surface=surface,
            obstruction=obstruction,
            access_status=access_status,
            length_m=length_m,
            coordinates=[u_coord, v_coord],
            properties=properties,
        )

        self.adjacency[u].append(forward_edge)
        self.road_to_edges.setdefault(road_id, []).append(forward_edge)
        self.road_to_nodes.setdefault(road_id, set()).update([u, v])

        if bidirectional:
            edge_id_backward = f"{road_id}_{v}->{u}"
            backward_edge = RoadEdge(
                edge_id=edge_id_backward,
                from_node=v,
                to_node=u,
                road_id=road_id,
                name=name,
                road_class=road_class,
                width_m=width_m,
                surface=surface,
                obstruction=obstruction,
                access_status=access_status,
                length_m=length_m,
                coordinates=[v_coord, u_coord],
                properties=properties,
            )
            self.adjacency[v].append(backward_edge)
            self.road_to_edges[road_id].append(backward_edge)

    @classmethod
    def from_geojson_features(cls, features: List[Dict[str, Any]]) -> "RoadGraph":
        """Builds a RoadGraph from GeoJSON road features, respecting mapped one-way restrictions."""
        graph = cls()
        road_count = 0

        for f in features:
            props = f.get("properties", {})
            if props.get("feature_type") != "road":
                continue

            road_id = props.get("id") or f.get("id")
            if not road_id:
                logger.warning("Skipping road feature without ID")
                continue

            geom = f.get("geometry", {})
            geom_type = geom.get("type")
            coords = geom.get("coordinates")

            if geom_type != "LineString" or not isinstance(coords, list) or len(coords) < 2:
                logger.warning("Skipping road %s: invalid LineString geometry", road_id)
                continue

            name = props.get("name", road_id)
            road_class = props.get("road_class")
            width_m = props.get("width_m")
            if width_m is not None:
                try:
                    width_m = float(width_m)
                except (ValueError, TypeError):
                    width_m = None

            surface = props.get("surface")
            obstruction = props.get("obstruction")
            access_status = props.get("access_status", "unknown")

            # Respect mapped one-way rules
            oneway_val = props.get("oneway")
            is_forward = oneway_val in (1, "1", "yes", True)
            is_reverse = oneway_val in (-1, "-1")
            bidirectional = not (is_forward or is_reverse)

            # Add each consecutive line subsegment
            for i in range(len(coords) - 1):
                p1 = coords[i]
                p2 = coords[i + 1]
                if (
                    isinstance(p1, (list, tuple))
                    and isinstance(p2, (list, tuple))
                    and len(p1) >= 2
                    and len(p2) >= 2
                ):
                    u_pt = (float(p1[0]), float(p1[1]))
                    v_pt = (float(p2[0]), float(p2[1]))

                    if is_reverse:
                        # Reverse one-way: traverse v -> u only
                        graph.add_edge(
                            u_coord=v_pt,
                            v_coord=u_pt,
                            road_id=road_id,
                            name=name,
                            road_class=road_class,
                            width_m=width_m,
                            surface=surface,
                            obstruction=obstruction,
                            access_status=access_status,
                            properties=props,
                            bidirectional=False,
                        )
                    else:
                        graph.add_edge(
                            u_coord=u_pt,
                            v_coord=v_pt,
                            road_id=road_id,
                            name=name,
                            road_class=road_class,
                            width_m=width_m,
                            surface=surface,
                            obstruction=obstruction,
                            access_status=access_status,
                            properties=props,
                            bidirectional=bidirectional,
                        )

            road_count += 1

        graph.total_roads_loaded = road_count
        logger.info(
            "RoadGraph constructed: %d nodes, %d edges across %d roads",
            len(graph.nodes),
            sum(len(edges) for edges in graph.adjacency.values()),
            road_count,
        )
        return graph

    def get_closest_node(self, coord: Tuple[float, float]) -> Optional[str]:
        """Finds closest node in the graph to given (lon, lat) coordinates with spatial indexing."""
        if not self.nodes:
            return None

        target_lon, target_lat = coord
        cell_x = int(target_lon * 100)
        cell_y = int(target_lat * 100)

        # Check immediate 9 grid cells first
        candidates: List[str] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                c_key = (cell_x + dx, cell_y + dy)
                if c_key in self.grid:
                    candidates.extend(self.grid[c_key])

        # If not found nearby, expand to 25 cells
        if not candidates:
            for dx in (-2, -1, 0, 1, 2):
                for dy in (-2, -1, 0, 1, 2):
                    c_key = (cell_x + dx, cell_y + dy)
                    if c_key in self.grid:
                        candidates.extend(self.grid[c_key])

        # Fallback to all nodes if outside indexed clusters
        search_set = candidates if candidates else self.nodes.keys()

        best_node = None
        best_dist = float("inf")
        for nid in search_set:
            n_coord = self.nodes[nid]
            dist = haversine_distance_m(coord, n_coord)
            if dist < best_dist:
                best_dist = dist
                best_node = nid

        return best_node

    def get_nodes_for_road(self, road_id: str) -> Set[str]:
        """Returns all graph nodes touched by a given road segment."""
        return self.road_to_nodes.get(road_id, set())

    def get_edges_for_road(self, road_id: str) -> List[RoadEdge]:
        """Returns all directed graph edges comprising a given road."""
        return self.road_to_edges.get(road_id, [])

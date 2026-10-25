"""SQLite-backed emergency incident management and real-time streaming service."""
import asyncio
import datetime
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Set, Tuple

from app.core.config import REPO_ROOT

logger = logging.getLogger("unreachable.incident_service")

DEFAULT_INCIDENTS_DB = REPO_ROOT / "data" / "incidents.sqlite"


class IncidentService:
    """Manages road blockage incidents backed by SQLite with in-memory caching and real-time pub/sub."""

    def __init__(self, db_path: Path = DEFAULT_INCIDENTS_DB):
        self.db_path = db_path
        self._blocked_roads: Set[str] = set()
        self._subscribers: Set[asyncio.Queue] = set()
        self._active_route_coords: List[Tuple[float, float]] = []
        self._unit_progress: float = 0.0
        self._unit_id: str = "UNIT-101"
        self._vehicle_id: str = "fire"
        self._init_db()
        self._load_from_db()

    def _get_connection(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Initializes incidents schema in SQLite if not already present."""
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    road_id TEXT NOT NULL UNIQUE,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    def _load_from_db(self):
        """Loads all active blocked roads from SQLite into in-memory cache."""
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT road_id FROM incidents WHERE status = 'blocked';")
            rows = cur.fetchall()
            self._blocked_roads = {r["road_id"] for r in rows}
            logger.info("Loaded %d active incidents from %s", len(self._blocked_roads), self.db_path)
        finally:
            conn.close()

    def is_road_blocked(self, road_id: str) -> bool:
        """Returns True if the road is currently marked blocked."""
        return road_id in self._blocked_roads

    def get_blocked_roads_set(self) -> Set[str]:
        """Returns in-memory set of blocked road IDs for rapid $O(1)$ lookups."""
        return set(self._blocked_roads)

    def get_blocked_roads(self) -> List[str]:
        """Returns sorted list of currently blocked road IDs."""
        return sorted(list(self._blocked_roads))

    def get_incidents(self) -> List[Dict[str, Any]]:
        """Queries and returns active incident records from SQLite."""
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, road_id, action, status, reason, created_at, updated_at
                FROM incidents
                WHERE status = 'blocked'
                ORDER BY updated_at DESC;
            """)
            rows = cur.fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def block_road(self, road_id: str, reason: str = "Manual emergency closure") -> Dict[str, Any]:
        """Marks a road as blocked in SQLite and in-memory cache, notifying listeners."""
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO incidents (road_id, action, status, reason, created_at, updated_at)
                VALUES (?, 'block', 'blocked', ?, ?, ?)
                ON CONFLICT(road_id) DO UPDATE SET
                    action = 'block',
                    status = 'blocked',
                    reason = excluded.reason,
                    updated_at = excluded.updated_at;
            """, (road_id, reason, now, now))
            conn.commit()
        finally:
            conn.close()

        self._blocked_roads.add(road_id)
        self._invalidate_engine_caches()

        event = {
            "type": "incident",
            "action": "block",
            "road_id": road_id,
            "reason": reason,
            "blocked_roads": self.get_blocked_roads(),
            "timestamp": now,
        }
        self._broadcast(event)
        logger.info("Road %s blocked: %s", road_id, reason)
        return event

    def clear_road(self, road_id: str) -> Dict[str, Any]:
        """Clears incident for a road in SQLite and in-memory cache, notifying listeners."""
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                DELETE FROM incidents WHERE road_id = ?;
            """, (road_id,))
            conn.commit()
        finally:
            conn.close()

        self._blocked_roads.discard(road_id)
        self._invalidate_engine_caches()

        event = {
            "type": "incident",
            "action": "clear",
            "road_id": road_id,
            "blocked_roads": self.get_blocked_roads(),
            "timestamp": now,
        }
        self._broadcast(event)
        logger.info("Road %s cleared", road_id)
        return event

    def _invalidate_engine_caches(self):
        """Invalidates graph and feature caches across data_service and access_engine."""
        try:
            from app.services.access_engine import access_engine
            access_engine._graph = None
            access_engine._cached_graph_mode = None
        except Exception as exc:
            logger.debug("Access engine cache reset error: %s", exc)

    def clear_active_route(self):
        """Clears current active route line and halts simulated unit animation."""
        self._active_route_coords = None
        self._unit_progress = 0.0

    def set_active_route(self, coordinates: List[Tuple[float, float]], vehicle_id: str = "fire", unit_id: str = "UNIT-101"):
        """Sets the current active route line for simulated unit animation."""
        if coordinates and len(coordinates) >= 2:
            self._active_route_coords = coordinates
            self._vehicle_id = vehicle_id
            self._unit_id = unit_id
            self._unit_progress = 0.0

    def get_unit_position(self) -> Optional[Dict[str, Any]]:
        """Computes current interpolated position of simulated unit along the route."""
        coords = self._active_route_coords
        if not coords or len(coords) < 2:
            return None

        # Advance progress; stop once route is finished
        self._unit_progress += 0.04
        if self._unit_progress >= 1.0:
            self._active_route_coords = None
            self._unit_progress = 0.0
            return None

        # Linear interpolation along polyline
        n_segments = len(coords) - 1
        segment_float = self._unit_progress * n_segments
        idx = int(segment_float)
        t = segment_float - idx

        if idx >= n_segments:
            curr_pt = coords[-1]
        else:
            p1 = coords[idx]
            p2 = coords[idx + 1]
            lon = p1[0] + (p2[0] - p1[0]) * t
            lat = p1[1] + (p2[1] - p1[1]) * t
            curr_pt = (round(lon, 6), round(lat, 6))

        return {
            "type": "unit_position",
            "unit_id": self._unit_id,
            "vehicle_id": self._vehicle_id,
            "coordinates": [curr_pt[0], curr_pt[1]],  # [lon, lat]
            "progress_pct": round(self._unit_progress * 100, 1),
            "speed_kmh": 46.5,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    def _broadcast(self, event: Dict[str, Any]):
        """Pushes event into all active SSE client queues."""
        dead_queues = set()
        for q in self._subscribers:
            try:
                q.put_nowait(event)
            except Exception:
                dead_queues.add(q)
        self._subscribers.difference_update(dead_queues)

    def subscribe(self) -> asyncio.Queue:
        """Registers a new SSE listener queue."""
        q = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        """Unregisters an SSE listener queue."""
        self._subscribers.discard(q)


incident_service = IncidentService()

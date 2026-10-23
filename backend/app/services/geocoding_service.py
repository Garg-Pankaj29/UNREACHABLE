"""Geocoding provider adapter for universal location search in UNREACHABLE.

Supports:
1. OpenStreetMap Nominatim free geocoding provider (default, configurable via GEOCODING_PROVIDER_URL).
2. Rate-limiting guard respecting public provider usage policy (1 request/sec max).
3. Thread-safe in-memory caching for repeated search terms.
4. Offline fallback: graceful failure with short timeouts so offline users are never blocked.
5. Pilot corridor boundary checking to distinguish covered vs unmapped territories.
"""

import json
import logging
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("unreachable.geocoding")

# Pilot corridor bounding box: (min_lon, min_lat, max_lon, max_lat)
PILOT_BBOX = (76.52, 30.62, 76.88, 30.82)

# Configurable provider URL & User-Agent
GEOCODING_PROVIDER_URL = os.environ.get(
    "GEOCODING_PROVIDER_URL",
    "https://nominatim.openstreetmap.org/search",
)
GEOCODING_TIMEOUT_S = float(os.environ.get("GEOCODING_TIMEOUT_S", "4.0"))
GEOCODING_USER_AGENT = os.environ.get(
    "GEOCODING_USER_AGENT",
    "UNREACHABLE-Emergency-Platform/1.0 (emergency-accessibility-intelligence)",
)


def is_in_pilot_corridor(lon: float, lat: float) -> bool:
    """Check if given WGS84 coordinates fall inside Chandigarh-Mohali-Gharuan pilot bounds."""
    return PILOT_BBOX[0] <= lon <= PILOT_BBOX[2] and PILOT_BBOX[1] <= lat <= PILOT_BBOX[3]


class GeocodingService:
    """Adapter for online geocoding providers with rate-limiting, caching, and offline resilience."""

    def __init__(
        self,
        provider_url: str = GEOCODING_PROVIDER_URL,
        user_agent: str = GEOCODING_USER_AGENT,
        timeout: float = GEOCODING_TIMEOUT_S,
    ):
        self.provider_url = provider_url
        self.user_agent = user_agent
        self.timeout = timeout
        self._cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
        self._cache_ttl_s = 3600.0  # 1 hour TTL
        self._last_request_time: float = 0.0
        self._min_interval_s: float = 1.0  # Nominatim policy requires max 1 req/sec

    def geocode(self, query: str, limit: int = 5) -> Tuple[List[Dict[str, Any]], bool]:
        """Geocode query string. Returns (results, is_online_successful).

        Never raises on network error; gracefully returns empty list and False.
        """
        clean_q = query.strip()
        if not clean_q or len(clean_q) < 2:
            return [], True

        cache_key = f"{clean_q.lower()}_{limit}"
        now = time.time()

        # Check cache
        if cache_key in self._cache:
            ts, cached_results = self._cache[cache_key]
            if now - ts < self._cache_ttl_s:
                return cached_results, True

        # Respect rate limit
        elapsed = now - self._last_request_time
        if elapsed < self._min_interval_s:
            time.sleep(self._min_interval_s - elapsed)

        params = {
            "q": clean_q,
            "format": "jsonv2",
            "addressdetails": "1",
            "limit": str(min(limit, 10)),
            # Bias towards North India / Chandigarh region but allow global searches
            "viewbox": "76.52,30.82,76.88,30.62",
            "bounded": "0",
        }
        url = f"{self.provider_url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "application/json",
            },
        )

        try:
            self._last_request_time = time.time()
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if resp.status != 200:
                    logger.warning("Geocoding provider returned status %d", resp.status)
                    return [], False
                raw_data = json.loads(resp.read().decode("utf-8"))

            parsed_results = self._parse_nominatim_results(raw_data)
            self._cache[cache_key] = (time.time(), parsed_results)
            return parsed_results, True

        except Exception as exc:
            logger.info("Online geocoding unavailable or failed (%s). Continuing offline.", exc)
            return [], False

    def _parse_nominatim_results(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Map raw Nominatim responses into normalized SearchResultItem format."""
        results = []
        for idx, item in enumerate(raw_data):
            try:
                lat = float(item["lat"])
                lon = float(item["lon"])
            except (ValueError, KeyError):
                continue

            in_pilot = is_in_pilot_corridor(lon, lat)

            # Extract human-readable primary name and locality details
            addr = item.get("address", {})
            primary_name = (
                item.get("name")
                or addr.get("road")
                or addr.get("suburb")
                or addr.get("city")
                or addr.get("town")
                or item.get("display_name", "").split(",")[0]
            )

            # Build locality line (e.g. "Sector 14, Chandigarh, Punjab")
            locality_parts = []
            for k in ("neighbourhood", "suburb", "city_district", "city", "town", "state"):
                val = addr.get(k)
                if val and val not in locality_parts and val != primary_name:
                    locality_parts.append(val)
            locality_str = ", ".join(locality_parts[:3]) or item.get("display_name", "")

            osm_type = item.get("osm_type", "node")
            osm_id = item.get("osm_id", idx)
            category = item.get("category", "")
            item_type = item.get("type", "")

            # Classify feature type
            if category == "amenity" and item_type in ("hospital", "clinic", "doctors", "fire_station"):
                feature_type = "facility"
            elif category == "highway" or "road" in category:
                feature_type = "road"
            elif category in ("building", "commercial", "residential"):
                feature_type = "building"
            elif category in ("place", "boundary"):
                feature_type = "place"
            else:
                feature_type = "landmark"

            sub_label = item_type.replace("_", " ").title() if item_type else category.capitalize()

            coverage_notice = (
                "Inside pilot corridor - Detailed road access available"
                if in_pilot
                else "Outside pilot coverage - Detailed road access analysis unavailable"
            )

            results.append({
                "id": f"online_{osm_type}_{osm_id}",
                "osm_id": osm_id if isinstance(osm_id, int) else None,
                "name": primary_name,
                "feature_type": feature_type,
                "sub_type": item_type or category,
                "details": f"{sub_label} • {locality_str}",
                "coordinates": [lon, lat],
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
                "properties": {
                    "id": f"online_{osm_type}_{osm_id}",
                    "osm_id": osm_id,
                    "name": primary_name,
                    "display_name": item.get("display_name"),
                    "feature_type": feature_type,
                    "sub_type": item_type or category,
                    "locality": locality_str,
                    "source": "online_osm",
                    "inside_pilot_area": in_pilot,
                    "coverage_notice": coverage_notice,
                    "access_status": "unclassified" if in_pilot else "unmapped_outside_pilot",
                    "verification_status": "unverified_online",
                    "raw_address": addr,
                },
                "source": "online_osm",
                "inside_pilot_area": in_pilot,
                "verification_status": "unverified_online",
            })

        return results


geocoding_service = GeocodingService()

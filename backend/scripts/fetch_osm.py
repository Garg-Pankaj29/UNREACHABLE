#!/usr/bin/env python3
"""Fetch OpenStreetMap data via Overpass API for real-mode UNREACHABLE evaluation.

Queries OpenStreetMap via standard library urllib for a designated bounding box,
extracts highways, barriers, buildings, emergency stations, power lines, and clearance tags,
and writes the raw payload and manifest to data/real/raw/.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Bounding box: south, west, north, east
BBOX = (30.760, 76.560, 30.780, 76.590)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

OVERPASS_QUERY = f"""[out:json][timeout:90];
(
  nwr["highway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["barrier"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["amenity"~"^(fire_station|hospital|police)$"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["emergency"~"^(fire_station|hospital|ambulance_station)$"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["power"~"^(line|minor_line|cable)$"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["maxwidth"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["maxheight"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  nwr["width"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body geom;
"""


def fetch_from_overpass(query: str) -> dict:
    encoded_data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_err = None

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            req = urllib.request.Request(
                endpoint,
                data=encoded_data,
                headers={"User-Agent": "UNREACHABLE-FetchOSM/1.0 (emergency-access-audit)"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                if resp.status == 200:
                    payload = resp.read().decode("utf-8")
                    return json.loads(payload)
        except Exception as e:
            last_err = e
            time.sleep(2)
            continue

    raise RuntimeError(f"All Overpass endpoints failed. Last error: {last_err}")


def calculate_counts(elements: list) -> dict:
    roads = sum(1 for el in elements if "highway" in el.get("tags", {}))
    buildings = sum(1 for el in elements if "building" in el.get("tags", {}))
    barriers = sum(1 for el in elements if "barrier" in el.get("tags", {}))
    stations = sum(
        1
        for el in elements
        if el.get("tags", {}).get("amenity") in ("fire_station", "hospital", "police")
        or el.get("tags", {}).get("emergency") in ("fire_station", "hospital", "ambulance_station")
    )
    power_lines = sum(1 for el in elements if "power" in el.get("tags", {}))
    maxwidth = sum(1 for el in elements if "maxwidth" in el.get("tags", {}))
    maxheight = sum(1 for el in elements if "maxheight" in el.get("tags", {}))
    width = sum(1 for el in elements if "width" in el.get("tags", {}))

    return {
        "roads": roads,
        "buildings": buildings,
        "barriers": barriers,
        "stations": stations,
        "power_lines": power_lines,
        "maxwidth": maxwidth,
        "maxheight": maxheight,
        "width": width,
        "total_elements": len(elements),
    }


def main():
    repo_root = Path(__file__).resolve().parent.parent.parent
    raw_dir = repo_root / "data" / "real" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    overpass_data = fetch_from_overpass(OVERPASS_QUERY)
    elements = overpass_data.get("elements", [])
    counts = calculate_counts(elements)

    if counts["roads"] <= 0:
        sys.stderr.write("Verification failed: road count is 0!\n")
        sys.exit(1)
    if counts["buildings"] <= 0:
        sys.stderr.write("Verification failed: building count is 0!\n")
        sys.exit(1)
    if counts["stations"] == 0:
        sys.stderr.write("Warning: stations count is 0 in bounding box!\n")

    timestamp = datetime.now(timezone.utc).isoformat()
    manifest = {
        "timestamp": timestamp,
        "bbox": [BBOX[0], BBOX[1], BBOX[2], BBOX[3]],
        "counts": counts,
    }

    overpass_path = raw_dir / "overpass.json"
    with open(overpass_path, "w", encoding="utf-8") as f:
        json.dump(overpass_data, f, indent=2)

    manifest_path = raw_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Print only the manifest
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

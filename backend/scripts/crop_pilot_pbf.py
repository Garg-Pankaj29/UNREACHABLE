"""Crop regional OpenStreetMap PBF to Chandigarh-Mohali-Gharuan pilot corridor.

Uses pyosmium (installed in backend/.venv) to crop data/raw/northern-zone-latest.osm.pbf
into data/raw/chandigarh-pilot.osm.pbf for bounding box (76.52, 30.62, 76.88, 30.82).

Key Principles:
1. Pure pyosmium implementation using BackReferenceWriter.
   No external CLI tools (e.g. osmium-tool) or additional pip packages required.
2. Complete road geometry & dependency preservation:
   - Preserves all nodes within the bounding box.
   - Preserves all ways intersecting the bounding box.
   - Uses pyosmium's BackReferenceWriter (relation_depth=0) to pull in all referenced
     boundary nodes, ensuring road and building geometries are 100% reconstructible.
   - Retains relevant local relations (multipolygons, local boundaries) whose members
     intersect the pilot area on a best-effort basis (regional relation networks across
     the entire Northern Zone are not claimed to be fully closed).
3. Safe atomic write & guaranteed cleanup:
   - Writes to a temporary file (.tmp_{pid}) first.
   - Validates that sampled ways have complete reconstructible node geometries.
   - Atomically replaces destination only after complete, verified success.
   - Always cleans up temporary files on failure or interruption, leaving source PBF unmodified.
"""

import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, Set, Tuple

import osmium
from osmium.back_reference_writer import BackReferenceWriter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("unreachable.crop_pilot_pbf")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DATA_DIR = REPO_ROOT / "data" / "raw"
SOURCE_PBF_PATH = RAW_DATA_DIR / "northern-zone-latest.osm.pbf"
TARGET_PBF_PATH = RAW_DATA_DIR / "chandigarh-pilot.osm.pbf"

# Bounding box: Chandigarh, SAS Nagar Mohali, Kharar, Gharuan / CU
# (Min Lon, Min Lat, Max Lon, Max Lat)
PILOT_BBOX = (76.52, 30.62, 76.88, 30.82)


class PilotCropHandler(osmium.SimpleHandler):
    """Filters OSM entities intersecting the pilot bounding box."""

    def __init__(self, writer: BackReferenceWriter, bbox: Tuple[float, float, float, float]):
        super().__init__()
        self.writer = writer
        self.min_lon, self.min_lat, self.max_lon, self.max_lat = bbox

        self.nodes_scanned = 0
        self.nodes_kept = 0
        self.ways_scanned = 0
        self.ways_kept = 0
        self.relations_scanned = 0
        self.relations_kept = 0

        self.kept_node_ids: Set[int] = set()
        self.kept_way_ids: Set[int] = set()

    def node(self, n: osmium.osm.Node):
        self.nodes_scanned += 1
        if self.nodes_scanned % 5_000_000 == 0:
            logger.info("Scanned %d nodes (kept %d in bbox)...", self.nodes_scanned, self.nodes_kept)

        try:
            lon = n.location.lon
            lat = n.location.lat
        except (osmium.InvalidLocationError, AttributeError):
            return

        if self.min_lon <= lon <= self.max_lon and self.min_lat <= lat <= self.max_lat:
            self.writer.add_node(n)
            self.kept_node_ids.add(n.id)
            self.nodes_kept += 1

    def way(self, w: osmium.osm.Way):
        self.ways_scanned += 1
        if self.ways_scanned % 500_000 == 0:
            logger.info("Scanned %d ways (kept %d in bbox)...", self.ways_scanned, self.ways_kept)

        in_bbox = False
        for n in w.nodes:
            try:
                if self.min_lon <= n.lon <= self.max_lon and self.min_lat <= n.lat <= self.max_lat:
                    in_bbox = True
                    break
            except (osmium.InvalidLocationError, AttributeError):
                continue

        if in_bbox:
            self.writer.add_way(w)
            self.kept_way_ids.add(w.id)
            self.ways_kept += 1

    def relation(self, r: osmium.osm.Relation):
        self.relations_scanned += 1
        if self.relations_scanned % 100_000 == 0:
            logger.info("Scanned %d relations (kept %d in bbox)...", self.relations_scanned, self.relations_kept)

        # Skip vast regional transit/railway networks spanning Northern India
        tags = {t.k: t.v for t in r.tags}
        if tags.get("route") in ("train", "railway", "flight", "ferry"):
            return

        relevant = False
        for m in r.members:
            if m.type == 'w' and m.ref in self.kept_way_ids:
                relevant = True
                break
            if m.type == 'n' and m.ref in self.kept_node_ids:
                relevant = True
                break

        if relevant:
            self.writer.add_relation(r)
            self.relations_kept += 1


class PbfValidatorHandler(osmium.SimpleHandler):
    """Validates that a cropped PBF contains complete, reconstructible entities."""

    def __init__(self, bbox: Tuple[float, float, float, float]):
        super().__init__()
        self.min_lon, self.min_lat, self.max_lon, self.max_lat = bbox
        self.node_count = 0
        self.way_count = 0
        self.relation_count = 0
        self.reconstructed_way_nodes = 0
        self.tested_ways = 0
        self.ways_with_missing_nodes = 0
        self.min_node_lon = 180.0
        self.max_node_lon = -180.0
        self.min_node_lat = 90.0
        self.max_node_lat = -90.0

    def node(self, n: osmium.osm.Node):
        self.node_count += 1
        try:
            lon = n.location.lon
            lat = n.location.lat
            self.min_node_lon = min(self.min_node_lon, lon)
            self.max_node_lon = max(self.max_node_lon, lon)
            self.min_node_lat = min(self.min_node_lat, lat)
            self.max_node_lat = max(self.max_node_lat, lat)
        except (osmium.InvalidLocationError, AttributeError):
            pass

    def way(self, w: osmium.osm.Way):
        self.way_count += 1
        # Check first 500 ways for 100% complete node geometry reconstruction
        if self.tested_ways < 500:
            self.tested_ways += 1
            has_missing = False
            for n in w.nodes:
                try:
                    if n.location.valid():
                        self.reconstructed_way_nodes += 1
                    else:
                        has_missing = True
                except (osmium.InvalidLocationError, AttributeError):
                    has_missing = True
            if has_missing:
                self.ways_with_missing_nodes += 1

    def relation(self, r: osmium.osm.Relation):
        self.relation_count += 1


def validate_cropped_pbf(pbf_path: Path, bbox: Tuple[float, float, float, float]) -> bool:
    """Open the output PBF and confirm nodes, ways, relations, and geometry reconstruction."""
    logger.info("Validating cropped PBF at %s...", pbf_path)
    if not pbf_path.exists():
        logger.error("Validation failed: file %s does not exist", pbf_path)
        return False

    file_size_mb = pbf_path.stat().st_size / (1024 * 1024)
    if file_size_mb == 0:
        logger.error("Validation failed: file %s is empty", pbf_path)
        return False

    validator = PbfValidatorHandler(bbox)
    try:
        validator.apply_file(str(pbf_path), locations=True, idx="sparse_file_array")
    except Exception as exc:
        logger.error("Validation failed to parse PBF: %s", exc)
        return False

    logger.info("Validation Results:")
    logger.info("  Nodes found:        %d", validator.node_count)
    logger.info("  Ways found:         %d", validator.way_count)
    logger.info("  Relations found:    %d", validator.relation_count)
    logger.info("  Sampled ways tested:%d (reconstructed nodes: %d, ways with missing nodes: %d)",
                validator.tested_ways, validator.reconstructed_way_nodes, validator.ways_with_missing_nodes)
    logger.info("  Node coord range:   lon [%.4f, %.4f], lat [%.4f, %.4f]",
                validator.min_node_lon, validator.max_node_lon,
                validator.min_node_lat, validator.max_node_lat)

    if validator.node_count == 0:
        logger.error("Validation failed: zero nodes found in cropped PBF")
        return False
    if validator.way_count == 0:
        logger.error("Validation failed: zero ways found in cropped PBF")
        return False
    if validator.relation_count == 0:
        logger.info("Note: zero relations found in cropped PBF")
    if validator.tested_ways > 0 and validator.ways_with_missing_nodes > 0:
        logger.error("Validation failed: %d sampled ways had missing node locations; geometry reconstruction incomplete",
                     validator.ways_with_missing_nodes)
        return False

    logger.info("Cropped PBF validation PASSED successfully.")
    return True


def crop_pbf(source_pbf: Path = SOURCE_PBF_PATH,
             target_pbf: Path = TARGET_PBF_PATH,
             bbox: Tuple[float, float, float, float] = PILOT_BBOX) -> None:
    """Crops source PBF to bounding box and writes target PBF atomically."""
    if not source_pbf.exists():
        logger.error("Source PBF not found at %s. Please run download_osm_extract.py first.", source_pbf)
        sys.exit(1)

    target_pbf.parent.mkdir(parents=True, exist_ok=True)
    temp_target_pbf = target_pbf.with_name(f"{target_pbf.stem}.tmp_{os.getpid()}.osm.pbf")
    destination_replaced = False

    logger.info("==================================================")
    logger.info("UNREACHABLE Pilot Bounding Box PBF Crop")
    logger.info("==================================================")
    logger.info("Source PBF:        %s (%.2f MB)", source_pbf, source_pbf.stat().st_size / (1024 * 1024))
    logger.info("Target PBF:        %s", target_pbf)
    logger.info("Temporary Output:  %s", temp_target_pbf)
    logger.info("Bounding Box:      %s (MinLon, MinLat, MaxLon, MaxLat)", bbox)
    logger.info("Dependency Mode:   BackReferenceWriter (reference-complete road/way geometries; local relations best-effort)")
    logger.info("==================================================")

    t_start = time.time()

    try:
        # Pass 1: Stream source PBF, filter entities into BackReferenceWriter
        logger.info("Starting extraction and reference tracking pass...")
        with BackReferenceWriter(temp_target_pbf, source_pbf, overwrite=True, remove_tags=False, relation_depth=0) as writer:
            handler = PilotCropHandler(writer, bbox)
            handler.apply_file(str(source_pbf), locations=True, idx="sparse_file_array")
            logger.info("Pass 1 completed:")
            logger.info("  Total scanned: %d nodes, %d ways, %d relations",
                        handler.nodes_scanned, handler.ways_scanned, handler.relations_scanned)
            logger.info("  Direct matches: %d nodes, %d ways, %d relations",
                        handler.nodes_kept, handler.ways_kept, handler.relations_kept)
            logger.info("Closing writer to assemble backward references and complete geometries...")

        # BackReferenceWriter.close() ran upon context exit
        t_crop = time.time() - t_start
        temp_size_mb = temp_target_pbf.stat().st_size / (1024 * 1024)
        logger.info("Cropped PBF created at temp file (%.2f MB) in %.2f seconds.", temp_size_mb, t_crop)

        # Validation step
        is_valid = validate_cropped_pbf(temp_target_pbf, bbox)
        if not is_valid:
            logger.error("Validation failed. Aborting without replacing target destination.")
            sys.exit(1)

        # Atomic replacement of target destination
        temp_target_pbf.replace(target_pbf)
        destination_replaced = True

        total_time = time.time() - t_start
        final_size_mb = target_pbf.stat().st_size / (1024 * 1024)
        logger.info("==================================================")
        logger.info("SUCCESS: Pilot PBF cropped and atomically placed.")
        logger.info("Final Destination: %s", target_pbf)
        logger.info("Final Size:        %.2f MB (%.1f%% of regional extract)",
                    final_size_mb, (final_size_mb / (source_pbf.stat().st_size / (1024 * 1024))) * 100)
        logger.info("Total Duration:    %.2f seconds", total_time)
        logger.info("==================================================")

    except Exception as exc:
        logger.exception("PBF cropping failed: %s", exc)
        sys.exit(1)
    finally:
        if not destination_replaced and temp_target_pbf.exists():
            try:
                temp_target_pbf.unlink()
            except Exception:
                pass


if __name__ == "__main__":
    crop_pbf()

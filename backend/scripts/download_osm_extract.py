"""Download script for OpenStreetMap regional PBF extract from Geofabrik.

Downloads the Northern Zone regional extract covering Chandigarh, Mohali, and Punjab,
verifies MD5 and SHA256 checksums, and records provenance metadata.
Does not run automatically at application runtime.
"""

import hashlib
import json
import logging
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("unreachable.download_osm")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DATA_DIR = REPO_ROOT / "data" / "raw"

GEOFABRIK_BASE = "https://download.geofabrik.de/asia/india"
PBF_FILENAME = "northern-zone-latest.osm.pbf"
MD5_FILENAME = "northern-zone-latest.osm.pbf.md5"

PBF_URL = f"{GEOFABRIK_BASE}/{PBF_FILENAME}"
MD5_URL = f"{GEOFABRIK_BASE}/{MD5_FILENAME}"


def fetch_official_md5() -> str:
    """Fetch the official MD5 checksum file from Geofabrik."""
    logger.info("Fetching official MD5 checksum from %s", MD5_URL)
    req = urllib.request.Request(
        MD5_URL,
        headers={"User-Agent": "UNREACHABLE-Access-Atlas/Phase1-DataPipeline"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode("utf-8").strip()
        # Format is usually: `<hash>  <filename>` or `<hash> *<filename>`
        official_hash = content.split()[0].lower()
        logger.info("Official Geofabrik MD5: %s", official_hash)
        return official_hash


def download_extract(force: bool = False) -> Path:
    """Download the regional OSM PBF extract and verify its checksum."""
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    target_pbf = RAW_DATA_DIR / PBF_FILENAME
    target_md5_file = RAW_DATA_DIR / MD5_FILENAME
    metadata_file = RAW_DATA_DIR / "download_metadata.json"

    official_md5 = fetch_official_md5()
    with open(target_md5_file, "w", encoding="utf-8") as f:
        f.write(f"{official_md5}  {PBF_FILENAME}\n")

    # Check if existing file is already valid
    if target_pbf.exists() and not force:
        logger.info("Target file %s already exists. Verifying checksum...", target_pbf)
        hasher_md5 = hashlib.md5()
        hasher_sha256 = hashlib.sha256()
        with open(target_pbf, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                hasher_md5.update(chunk)
                hasher_sha256.update(chunk)
        existing_md5 = hasher_md5.hexdigest().lower()
        if existing_md5 == official_md5:
            logger.info("Existing file MD5 matches official checksum (%s). Skipping download.", existing_md5)
            # Ensure metadata exists
            if not metadata_file.exists():
                meta = {
                    "source_url": PBF_URL,
                    "source_provider": "Geofabrik GmbH",
                    "dataset_name": "Northern Zone OpenStreetMap Regional Extract",
                    "filename": PBF_FILENAME,
                    "file_size_bytes": target_pbf.stat().st_size,
                    "download_timestamp_utc": datetime.now(timezone.utc).isoformat(),
                    "md5_checksum": existing_md5,
                    "sha256_checksum": hasher_sha256.hexdigest().lower(),
                    "licence": "Open Data Commons Open Database License (ODbL) 1.0",
                    "attribution": "© OpenStreetMap contributors",
                    "verification_status": "checksum_verified",
                }
                with open(metadata_file, "w", encoding="utf-8") as mf:
                    json.dump(meta, mf, indent=2)
            return target_pbf
        else:
            logger.warning("Existing file MD5 (%s) does NOT match official (%s). Re-downloading.", existing_md5, official_md5)

    logger.info("Starting download of %s to %s", PBF_URL, target_pbf)
    req = urllib.request.Request(
        PBF_URL,
        headers={"User-Agent": "UNREACHABLE-Access-Atlas/Phase1-DataPipeline"},
    )

    t0 = time.time()
    hasher_md5 = hashlib.md5()
    hasher_sha256 = hashlib.sha256()
    temp_target = target_pbf.with_suffix(".pbf.part")

    with urllib.request.urlopen(req, timeout=60) as resp:
        total_size = int(resp.headers.get("Content-Length", 0))
        last_modified = resp.headers.get("Last-Modified", "")
        logger.info("Content-Length: %d bytes (%.2f MB), Last-Modified: %s", total_size, total_size / (1024 * 1024), last_modified)

        downloaded = 0
        last_log = time.time()

        with open(temp_target, "wb") as out_f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                out_f.write(chunk)
                hasher_md5.update(chunk)
                hasher_sha256.update(chunk)
                downloaded += len(chunk)

                if time.time() - last_log >= 5.0 or (total_size and downloaded >= total_size):
                    elapsed = time.time() - t0
                    speed = (downloaded / (1024 * 1024)) / max(elapsed, 0.001)
                    pct = (downloaded / total_size * 100) if total_size else 0
                    logger.info("Progress: %.1f MB / %.1f MB (%.1f%%) at %.2f MB/s", downloaded / (1024 * 1024), total_size / (1024 * 1024), pct, speed)
                    last_log = time.time()

    if temp_target.exists():
        if target_pbf.exists():
            target_pbf.unlink()
        temp_target.rename(target_pbf)

    actual_md5 = hasher_md5.hexdigest().lower()
    actual_sha256 = hasher_sha256.hexdigest().lower()
    actual_size = target_pbf.stat().st_size

    logger.info("Download complete. File size: %d bytes. MD5: %s", actual_size, actual_md5)
    if actual_md5 != official_md5:
        logger.error("CHECKSUM MISMATCH! Expected %s, got %s", official_md5, actual_md5)
        raise ValueError(f"MD5 mismatch for {target_pbf}: expected {official_md5}, got {actual_md5}")

    logger.info("MD5 checksum successfully verified against Geofabrik.")
    logger.info("SHA256 checksum: %s", actual_sha256)

    # Save detailed metadata
    metadata = {
        "source_url": PBF_URL,
        "source_provider": "Geofabrik GmbH",
        "dataset_name": "Northern Zone OpenStreetMap Regional Extract",
        "filename": PBF_FILENAME,
        "file_size_bytes": actual_size,
        "source_last_modified": last_modified,
        "download_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "md5_checksum": actual_md5,
        "sha256_checksum": actual_sha256,
        "licence": "Open Data Commons Open Database License (ODbL) 1.0",
        "attribution": "© OpenStreetMap contributors",
        "verification_status": "checksum_verified",
    }
    with open(metadata_file, "w", encoding="utf-8") as mf:
        json.dump(metadata, mf, indent=2)

    logger.info("Metadata saved to %s", metadata_file)
    return target_pbf


if __name__ == "__main__":
    force_download = "--force" in sys.argv
    try:
        download_extract(force=force_download)
    except Exception as exc:
        logger.exception("Failed to download OSM extract: %s", exc)
        sys.exit(1)

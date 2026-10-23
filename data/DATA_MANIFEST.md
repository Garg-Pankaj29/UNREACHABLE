# UNREACHABLE Geographic Dataset Manifest (Phase 1)

This manifest formally documents the primary geographic datasets acquired, processed, and maintained for the UNREACHABLE Emergency Accessibility Intelligence platform.

---

## 1. Primary Source Dataset: OpenStreetMap Northern Zone Regional Extract

| Field | Detail |
|---|---|
| **Source Provider** | Geofabrik GmbH ([https://www.geofabrik.de/](https://www.geofabrik.de/)) |
| **Source URL** | [https://download.geofabrik.de/asia/india/northern-zone-latest.osm.pbf](https://download.geofabrik.de/asia/india/northern-zone-latest.osm.pbf) |
| **Source Landing Page** | [https://download.geofabrik.de/asia/india/northern-zone.html](https://download.geofabrik.de/asia/india/northern-zone.html) |
| **Licence** | Open Data Commons Open Database License (ODbL) 1.0 |
| **Required Attribution** | (c) OpenStreetMap contributors ([https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)) |
| **Acquisition Method** | Repeatable development download via `backend/scripts/download_osm_extract.py` (offline at runtime) |
| **Actual Download Timestamp** | 2026-10-23T02:13:13Z (UTC) |
| **Source Snapshot Date** | Tue, 20 Oct 2026 23:14:55 GMT |
| **File Format** | OSM PBF (Protocolbuffer Binary Format) |
| **Downloaded File Size** | 224,091,116 bytes (213.71 MB) |
| **MD5 Checksum** | `7147d0e86e929e5bbdaab84028966c25` (Verified against Geofabrik official `.md5` file) |
| **SHA256 Checksum** | `9e90b57eefc0d5b4d71ec81ef164caf620d2bb6e21042576788b1bfbc0ea2949` |
| **Local Raw Storage** | `data/raw/northern-zone-latest.osm.pbf` |

---

## 2. Derived Pilot Dataset: Chandigarh-Mohali-Gharuan Pilot Corridor

| Field | Detail |
|---|---|
| **Geographic Coverage** | Chandigarh Union Territory, SAS Nagar (Mohali), Kharar, and Gharuan Sector (Chandigarh University area) |
| **Bounding Box (WGS84)** | `[76.52, 30.62, 76.88, 30.82]` (Min Lon, Min Lat, Max Lon, Max Lat) |
| **Extraction Script** | `backend/scripts/extract_pilot_data.py` |
| **Validation Script** | `backend/scripts/validate_pilot_data.py` |
| **Node Location Storage** | Disk-backed temporary sparse file array (`idx="sparse_file_array"`) to guarantee low memory usage and avoid OOM crashes |
| **Derived SQLite Database** | `data/pilot/chandigarh_pilot.sqlite` |
| **Derived GeoJSON Export** | `data/pilot/chandigarh_pilot_features.geojson` |
| **Output Integrity** | Temporary atomic file swap (`.tmp_*` -> final) ensures incomplete extractions never overwrite or leave corrupted databases |

### Extracted Feature Schema & Rules
- **Road Network**: Routable line geometries, OSM IDs, highway classifications, one-way constraints, surface types, access restrictions, and raw tags. Missing road widths remain explicitly `NULL` (never fabricated).
- **Topology / Intersections**: Junction nodes occurring in two or more roads, storing degrees and connected road IDs to enable graph routing.
- **Buildings**: Building footprint polygons, centroid coordinates, street address tags where mapped, and category types.
- **Places**: Named localities, towns, sectors, and villages for spatial disambiguation.
- **Emergency Facilities**: Filtered candidate amenities (`hospital`, `fire_station`, `clinic`, `doctors`, `ambulance_station`). Preserves specific facility type. Mapped status is explicitly recorded as `verification_status = "unverified_osm"` until validated by municipal field surveys.
- **Neutral Access Classification**: Exported features are marked `access_status = "unclassified"`. Width is never treated as a final access determination in the raw data foundation; the deterministic accessibility engine must evaluate accessibility.

---

## 3. Synthetic Demonstration Dataset (Segregated Baseline)

| Field | Detail |
|---|---|
| **Storage Location** | `data/sample/neighbourhood.geojson` |
| **Status** | Preserved unmodified as reference demonstration baseline and fallback fixture |
| **Feature Count** | 13 features (1 fire station, 6 road segments, 6 building footprints) |
| **Provenance Label** | `Synthetic Prototype Model` |

---

## 4. Candidate Supplemental Sources (Under Evaluation)

The following national spatial data providers are recorded as candidate repositories for Phase 2+ enrichment. **None are currently imported:**

1. **ISRO Bhuvan Platform**
   - URL: [https://bhuvan.nrsc.gov.in/](https://bhuvan.nrsc.gov.in/) & [https://bhuvan-app1.nrsc.gov.in/bhuvanstore2.php](https://bhuvan-app1.nrsc.gov.in/bhuvanstore2.php)
   - Candidate Layers: Cartosat digital elevation models, flood hazard zones, national land-use classifications.
   - Status: Candidate source. Licensing, redistribution, and API access terms under evaluation.

2. **Open Government Data (OGD) Platform India**
   - URL: [https://data.gov.in/](https://data.gov.in/)
   - Candidate Layers: Ministry of Health and Family Welfare (MoHFW) verified facility registers, municipal administrative boundaries.
   - Status: Candidate source. NDSAP licensing terms to be confirmed before ingestion.

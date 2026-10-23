# OpenStreetMap Attribution and ODbL Compliance Notice

## 1. Attribution Statement

This project uses geographic data derived from **OpenStreetMap**, distributed by **Geofabrik GmbH**.

> **© OpenStreetMap contributors**  
> OpenStreetMap data is licensed under the [Open Data Commons Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1.0/).

Any public display, user interface, or publication displaying data or derived intelligence from this foundation must display:
- **"Data © OpenStreetMap contributors"** with a direct hyperlink to [https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright).

---

## 2. Downstream Rights and Obligations (ODbL 1.0)

When redistributing or using derived databases created by UNREACHABLE:

1. **Share-Alike**: If you publicly use or distribute a Derivative Database (such as routing graphs, accessibility matrices, or bottleneck scores derived from OSM data), the derivative database must also be made available under the ODbL 1.0.
2. **Keep Open**: If you distribute the database or a derivative, you must not use technological measures (e.g., DRM) that restrict others from exercising their rights under the license without providing an unencrypted copy.
3. **Attribution**: You must attribute OpenStreetMap as the source of the data in the manner specified above.
4. **Produced Works**: Works produced by using the database (e.g., analysis reports, visual maps, route directions) do not need to be licensed under ODbL, but they **must** carry the attribution notice: `"Contains information from OpenStreetMap, which is made available here under the Open Database License (ODbL)."`

---

## 3. Data Foundation Boundary & Field Verification Principle

UNREACHABLE models emergency vehicle access under strict data ethics:

- **Missing Data is Unknown, Never Fabricated**: OpenStreetMap ways without an explicit `width` or `maxwidth` tag are recorded as `width_m = NULL`. UNREACHABLE never fabricates default widths for municipal roads.
- **Facility Verification**: Mapped emergency facilities (`amenity=hospital`, `amenity=fire_station`, `emergency=ambulance_station`, `amenity=clinic`, `amenity=doctors`) reflect OSM community contributions. An OSM record does **not** certify that a facility is currently operational, staffed, or equipped with specific apparatus. All imported facilities are recorded with `verification_status = "unverified_osm"` until certified through authorized municipal ground-truth surveys.
- **Separation from Synthetic Demo**: The synthetic test fixture (`data/sample/neighbourhood.geojson`) remains segregated and clearly labeled as `"Synthetic Prototype Model"`. Real-world imported extracts are housed separately under `data/pilot/` and `data/raw/`.

---

## 4. Candidate Supplemental Sources (Under Evaluation)

The following official Indian spatial repositories have been recorded as candidate sources for future integration. **None of these datasets are currently imported or redistributed:**

1. **ISRO Bhuvan Platform**
   - URL: [https://bhuvan.nrsc.gov.in/](https://bhuvan.nrsc.gov.in/)
   - Open Data Store: [https://bhuvan-app1.nrsc.gov.in/bhuvanstore2.php](https://bhuvan-app1.nrsc.gov.in/bhuvanstore2.php)
   - Scope: National thematic layers, high-resolution satellite imagery, flood inundation models.
   - Status: Candidate source. License terms, access APIs, and redistribution permissions require formal legal review prior to ingestion.

2. **Open Government Data (OGD) Platform India**
   - URL: [https://data.gov.in/](https://data.gov.in/)
   - Scope: National Data Sharing and Accessibility Policy (NDSAP) datasets, municipal health facilities, administrative boundaries.
   - Status: Candidate source. Attribution and data accuracy guidelines to be validated per ministry dataset terms.

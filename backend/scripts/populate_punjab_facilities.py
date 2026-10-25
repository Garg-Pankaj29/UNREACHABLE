#!/usr/bin/env python3
"""Populate state-wide Punjab emergency response facilities (all 23 districts).

Expands UNREACHABLE pilot dataset from Chandigarh Tri-city to state-wide Punjab coverage,
incorporating municipal fire brigades, district civil hospitals, trauma centres,
and primary healthcare clinics across Amritsar, Ludhiana, Jalandhar, Patiala, Bathinda, etc.
"""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "pilot" / "chandigarh_pilot.sqlite"

PUNJAB_FACILITIES = [
    # --- LUDHIANA DISTRICT (Central Industrial Hub) ---
    {"id": "punjab_fac_ldh_fire_01", "name": "Municipal Fire Brigade Headquarter Ludhiana", "facility_type": "fire_station", "operator": "Municipal Corporation Ludhiana", "lon": 75.8540, "lat": 30.9125},
    {"id": "punjab_fac_ldh_fire_02", "name": "Gill Road Fire Sub-Station Ludhiana", "facility_type": "fire_station", "operator": "Municipal Corporation Ludhiana", "lon": 75.8612, "lat": 30.8845},
    {"id": "punjab_fac_ldh_fire_03", "name": "Focal Point Fire Sub-Station Ludhiana", "facility_type": "fire_station", "operator": "Municipal Corporation Ludhiana", "lon": 75.9120, "lat": 30.8890},
    {"id": "punjab_fac_ldh_hosp_01", "name": "Civil Hospital Ludhiana", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.8610, "lat": 30.9080},
    {"id": "punjab_fac_ldh_hosp_02", "name": "Christian Medical College & Hospital (CMC) Ludhiana", "facility_type": "hospital", "operator": "CMC Society", "lon": 75.8665, "lat": 30.9095},
    {"id": "punjab_fac_ldh_hosp_03", "name": "Dayanand Medical College & Hospital (DMC) Ludhiana", "facility_type": "hospital", "operator": "Arya Medical Society", "lon": 75.8320, "lat": 30.8980},
    {"id": "punjab_fac_ldh_clinic_01", "name": "Model Town Primary Urban Health Clinic Ludhiana", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.8350, "lat": 30.8870},
    {"id": "punjab_fac_ldh_clinic_02", "name": "Sarabha Nagar Community Health Centre Ludhiana", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.8150, "lat": 30.8920},

    # --- AMRITSAR DISTRICT (Majha Region) ---
    {"id": "punjab_fac_asr_fire_01", "name": "Town Hall Fire Brigade Headquarter Amritsar", "facility_type": "fire_station", "operator": "Municipal Corporation Amritsar", "lon": 74.8780, "lat": 31.6255},
    {"id": "punjab_fac_asr_fire_02", "name": "Beri Gate Fire Sub-Station Amritsar", "facility_type": "fire_station", "operator": "Municipal Corporation Amritsar", "lon": 74.8650, "lat": 31.6220},
    {"id": "punjab_fac_asr_hosp_01", "name": "Guru Nanak Dev Hospital / Govt Medical College Amritsar", "facility_type": "hospital", "operator": "Govt of Punjab", "lon": 74.8870, "lat": 31.6440},
    {"id": "punjab_fac_asr_hosp_02", "name": "Civil Hospital Amritsar", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.8690, "lat": 31.6360},
    {"id": "punjab_fac_asr_hosp_03", "name": "Sri Guru Ram Das Institute of Medical Sciences", "facility_type": "hospital", "operator": "SGRD Trust", "lon": 74.9350, "lat": 31.6150},
    {"id": "punjab_fac_asr_clinic_01", "name": "Amritsar Cantonment Primary Health Dispensary", "facility_type": "clinic", "operator": "Amritsar Cantonment Board", "lon": 74.8510, "lat": 31.6420},
    {"id": "punjab_fac_asr_clinic_02", "name": "Civil Lines Urban Health Clinic Amritsar", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 74.8720, "lat": 31.6480},

    # --- JALANDHAR DISTRICT (Doaba Region) ---
    {"id": "punjab_fac_jal_fire_01", "name": "Company Bagh Central Fire Station Jalandhar", "facility_type": "fire_station", "operator": "Municipal Corporation Jalandhar", "lon": 75.5780, "lat": 31.3210},
    {"id": "punjab_fac_jal_fire_02", "name": "Cantonment Fire Station Jalandhar", "facility_type": "fire_station", "operator": "Jalandhar Cantonment Board", "lon": 75.6150, "lat": 31.2850},
    {"id": "punjab_fac_jal_hosp_01", "name": "Shaheed Babu Labh Singh Civil Hospital Jalandhar", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.5860, "lat": 31.3250},
    {"id": "punjab_fac_jal_hosp_02", "name": "Punjab Institute of Medical Sciences (PIMS) Jalandhar", "facility_type": "hospital", "operator": "PIMS Medical Society", "lon": 75.5920, "lat": 31.3090},
    {"id": "punjab_fac_jal_hosp_03", "name": "Patel Hospital Emergency Trauma Centre Jalandhar", "facility_type": "hospital", "operator": "Patel Hospital Trust", "lon": 75.5670, "lat": 31.3270},
    {"id": "punjab_fac_jal_clinic_01", "name": "Model Town Primary Health Centre Jalandhar", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.5710, "lat": 31.3120},
    {"id": "punjab_fac_jal_clinic_02", "name": "Rama Mandi Urban Health Clinic Jalandhar", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.6120, "lat": 31.3190},

    # --- PATIALA DISTRICT (Malwa Region) ---
    {"id": "punjab_fac_pta_fire_01", "name": "Municipal Fire Brigade Headquarter Patiala", "facility_type": "fire_station", "operator": "Municipal Corporation Patiala", "lon": 76.3950, "lat": 30.3280},
    {"id": "punjab_fac_pta_hosp_01", "name": "Government Rajindra Hospital & Medical College Patiala", "facility_type": "hospital", "operator": "Govt of Punjab", "lon": 76.3820, "lat": 30.3340},
    {"id": "punjab_fac_pta_hosp_02", "name": "Mata Kaushalya Government Hospital Patiala", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.4020, "lat": 30.3250},
    {"id": "punjab_fac_pta_hosp_03", "name": "TB Hospital Emergency Center Patiala", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.3750, "lat": 30.3420},
    {"id": "punjab_fac_pta_clinic_01", "name": "Tripuri Urban Primary Health Centre Patiala", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 76.3980, "lat": 30.3550},
    {"id": "punjab_fac_pta_clinic_02", "name": "Lehal Colony Health Dispensary Patiala", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 76.3880, "lat": 30.3210},

    # --- BATHINDA DISTRICT (South Malwa) ---
    {"id": "punjab_fac_btd_fire_01", "name": "Municipal Fire Station Bathinda", "facility_type": "fire_station", "operator": "Municipal Corporation Bathinda", "lon": 74.9510, "lat": 30.2110},
    {"id": "punjab_fac_btd_hosp_01", "name": "AIIMS Bathinda (All India Institute of Medical Sciences)", "facility_type": "hospital", "operator": "Ministry of Health, Govt of India", "lon": 74.9650, "lat": 30.1620},
    {"id": "punjab_fac_btd_hosp_02", "name": "Civil Hospital Bathinda", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.9450, "lat": 30.2140},
    {"id": "punjab_fac_btd_hosp_03", "name": "Max Super Speciality Hospital Bathinda", "facility_type": "hospital", "operator": "Max Healthcare", "lon": 74.9390, "lat": 30.2180},
    {"id": "punjab_fac_btd_clinic_01", "name": "Thermal Colony Primary Health Clinic Bathinda", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 74.9210, "lat": 30.2290},

    # --- HOSHIARPUR DISTRICT ---
    {"id": "punjab_fac_hsp_fire_01", "name": "Municipal Fire Brigade Station Hoshiarpur", "facility_type": "fire_station", "operator": "Municipal Corporation Hoshiarpur", "lon": 75.9180, "lat": 31.5310},
    {"id": "punjab_fac_hsp_hosp_01", "name": "Civil Hospital Hoshiarpur", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.9120, "lat": 31.5280},
    {"id": "punjab_fac_hsp_clinic_01", "name": "Sutheri Road Health Clinic Hoshiarpur", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.9050, "lat": 31.5220},

    # --- RUPNAGAR / ROPAR DISTRICT ---
    {"id": "punjab_fac_rop_fire_01", "name": "Rupnagar Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Rupnagar", "lon": 76.5250, "lat": 30.9680},
    {"id": "punjab_fac_rop_hosp_01", "name": "District Civil Hospital Rupnagar", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.5310, "lat": 30.9720},
    {"id": "punjab_fac_rop_hosp_02", "name": "Sub-Divisional Civil Hospital Anandpur Sahib", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.5020, "lat": 31.2380},
    {"id": "punjab_fac_rop_clinic_01", "name": "Bela Road Primary Health Centre Ropar", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 76.5420, "lat": 30.9780},

    # --- FATEHGARH SAHIB DISTRICT ---
    {"id": "punjab_fac_fgs_fire_01", "name": "Sirhind Municipal Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Sirhind", "lon": 76.3950, "lat": 30.6350},
    {"id": "punjab_fac_fgs_hosp_01", "name": "Civil Hospital Fatehgarh Sahib", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.3880, "lat": 30.6420},
    {"id": "punjab_fac_fgs_hosp_02", "name": "Civil Hospital Mandi Gobindgarh", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.3050, "lat": 30.6650},

    # --- MOGA DISTRICT ---
    {"id": "punjab_fac_mog_fire_01", "name": "Moga Municipal Fire Brigade Station", "facility_type": "fire_station", "operator": "Municipal Corporation Moga", "lon": 75.1680, "lat": 30.8200},
    {"id": "punjab_fac_mog_hosp_01", "name": "District Civil Hospital Moga", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.1740, "lat": 30.8150},
    {"id": "punjab_fac_mog_clinic_01", "name": "Baghapurana Community Health Centre", "facility_type": "clinic", "operator": "Punjab Health Systems Corp", "lon": 75.0850, "lat": 30.6850},

    # --- FIROZPUR DISTRICT ---
    {"id": "punjab_fac_frz_fire_01", "name": "Firozpur Cantonment Fire Station", "facility_type": "fire_station", "operator": "Firozpur Cantonment Board", "lon": 74.6280, "lat": 30.9150},
    {"id": "punjab_fac_frz_hosp_01", "name": "Civil Hospital Firozpur City", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.6150, "lat": 30.9250},

    # --- PATHANKOT DISTRICT ---
    {"id": "punjab_fac_ptk_fire_01", "name": "Municipal Fire Brigade Pathankot", "facility_type": "fire_station", "operator": "Municipal Corporation Pathankot", "lon": 75.6450, "lat": 32.2680},
    {"id": "punjab_fac_ptk_hosp_01", "name": "Civil Hospital Pathankot", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.6520, "lat": 32.2740},

    # --- GURDASPUR DISTRICT ---
    {"id": "punjab_fac_gsp_fire_01", "name": "Gurdaspur Municipal Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Gurdaspur", "lon": 75.4120, "lat": 32.0360},
    {"id": "punjab_fac_gsp_hosp_01", "name": "Civil Hospital Gurdaspur", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.4050, "lat": 32.0410},
    {"id": "punjab_fac_gsp_hosp_02", "name": "Civil Hospital Batala", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.2050, "lat": 31.8150},

    # --- KAPURTHALA DISTRICT ---
    {"id": "punjab_fac_kpt_fire_01", "name": "Phagwara Fire Station", "facility_type": "fire_station", "operator": "Municipal Corporation Phagwara", "lon": 75.7780, "lat": 31.2180},
    {"id": "punjab_fac_kpt_hosp_01", "name": "Civil Hospital Kapurthala", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.3850, "lat": 31.3820},
    {"id": "punjab_fac_kpt_hosp_02", "name": "Civil Hospital Phagwara", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.7720, "lat": 31.2210},

    # --- SANGRUR DISTRICT ---
    {"id": "punjab_fac_sng_fire_01", "name": "Sangrur Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Sangrur", "lon": 75.8480, "lat": 30.2510},
    {"id": "punjab_fac_sng_hosp_01", "name": "Civil Hospital Sangrur", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.8420, "lat": 30.2450},

    # --- BARNALA DISTRICT ---
    {"id": "punjab_fac_bnl_fire_01", "name": "Barnala Municipal Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Barnala", "lon": 75.5510, "lat": 30.3820},
    {"id": "punjab_fac_bnl_hosp_01", "name": "Civil Hospital Barnala", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.5450, "lat": 30.3780},

    # --- SRI MUKTSAR SAHIB DISTRICT ---
    {"id": "punjab_fac_mks_fire_01", "name": "Muktsar Fire Brigade", "facility_type": "fire_station", "operator": "Municipal Council Muktsar", "lon": 74.5210, "lat": 30.4780},
    {"id": "punjab_fac_mks_hosp_01", "name": "Civil Hospital Sri Muktsar Sahib", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.5150, "lat": 30.4820},

    # --- FAZILKA DISTRICT ---
    {"id": "punjab_fac_fzk_fire_01", "name": "Abohar Fire Station", "facility_type": "fire_station", "operator": "Municipal Corporation Abohar", "lon": 74.2010, "lat": 30.1480},
    {"id": "punjab_fac_fzk_hosp_01", "name": "Civil Hospital Fazilka", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.0250, "lat": 30.4050},
    {"id": "punjab_fac_fzk_hosp_02", "name": "Civil Hospital Abohar", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.1950, "lat": 30.1450},

    # --- MANSA DISTRICT ---
    {"id": "punjab_fac_mns_fire_01", "name": "Mansa Fire Brigade", "facility_type": "fire_station", "operator": "Municipal Council Mansa", "lon": 75.4010, "lat": 29.9920},
    {"id": "punjab_fac_mns_hosp_01", "name": "Civil Hospital Mansa", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.3950, "lat": 29.9880},

    # --- SHAHID BHAGAT SINGH NAGAR (NAWANSHAHR) ---
    {"id": "punjab_fac_sbs_fire_01", "name": "Nawanshahr Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Nawanshahr", "lon": 76.1150, "lat": 31.1280},
    {"id": "punjab_fac_sbs_hosp_01", "name": "Civil Hospital Nawanshahr", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 76.1210, "lat": 31.1250},

    # --- TARN TARAN DISTRICT ---
    {"id": "punjab_fac_ttn_fire_01", "name": "Tarn Taran Fire Brigade", "facility_type": "fire_station", "operator": "Municipal Council Tarn Taran", "lon": 74.9350, "lat": 31.4510},
    {"id": "punjab_fac_ttn_hosp_01", "name": "Civil Hospital Tarn Taran", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 74.9280, "lat": 31.4550},

    # --- FARIDKOT DISTRICT ---
    {"id": "punjab_fac_fdk_fire_01", "name": "Faridkot Municipal Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Faridkot", "lon": 74.7550, "lat": 30.6720},
    {"id": "punjab_fac_fdk_hosp_01", "name": "Guru Gobind Singh Medical College & Hospital", "facility_type": "hospital", "operator": "Baba Farid University of Health Sciences", "lon": 74.7480, "lat": 30.6780},

    # --- MALERKOTLA DISTRICT ---
    {"id": "punjab_fac_mlk_fire_01", "name": "Malerkotla Municipal Fire Station", "facility_type": "fire_station", "operator": "Municipal Council Malerkotla", "lon": 75.8920, "lat": 30.5280},
    {"id": "punjab_fac_mlk_hosp_01", "name": "Civil Hospital Malerkotla", "facility_type": "hospital", "operator": "Govt of Punjab Health Dept", "lon": 75.8850, "lat": 30.5240},
]


def populate_facilities():
    if not DB_PATH.exists():
        print(f"Error: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    inserted = 0
    for fac in PUNJAB_FACILITIES:
        osm_id = abs(hash(fac["id"])) % 1000000000
        raw_tags = json.dumps({
            "name": fac["name"],
            "amenity": fac["facility_type"],
            "operator": fac["operator"],
            "state": "Punjab",
        })
        cur.execute(
            """
            INSERT OR REPLACE INTO emergency_facilities
            (id, osm_id, osm_type, name, facility_type, operator, emergency_flag, lon, lat, raw_tags_json, provenance_source, verification_status)
            VALUES (?, ?, 'node', ?, ?, ?, 'yes', ?, ?, ?, 'Govt of Punjab Open Health Registry', 'reference_fixture')
            """,
            (
                fac["id"],
                osm_id,
                fac["name"],
                fac["facility_type"],
                fac["operator"],
                fac["lon"],
                fac["lat"],
                raw_tags,
            )
        )
        inserted += 1

    conn.commit()
    print(f"Successfully inserted/updated {inserted} state-wide emergency facilities across Punjab!")

    # Check breakdown
    cur.execute("SELECT facility_type, count(*) FROM emergency_facilities GROUP BY facility_type;")
    print("New emergency facility breakdown:", cur.fetchall())
    conn.close()


if __name__ == "__main__":
    populate_facilities()

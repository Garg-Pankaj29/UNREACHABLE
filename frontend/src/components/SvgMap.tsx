import React from 'react';
import { GeoJSONFeature, IssueRecord } from '../types';

interface SvgMapProps {
  buildings?: GeoJSONFeature[];
  roads?: GeoJSONFeature[];
  stations?: GeoJSONFeature[];
  issues?: IssueRecord[];
  selectedId?: string | null;
  selectedKind?: 'b' | 'e' | 'i' | 's' | null;
  viewBox?: string;
  nohit?: boolean;
  filterQuery?: string;
  routePath?: string[];
  hypotheticalFix?: string | null;
  vehicleId?: string;
  buildingStatuses?: Record<string, string>;
  roadStatuses?: Record<string, string>;
  onSelect?: (kind: 'b' | 'e' | 'i' | 's', id: string) => void;
  className?: string;
}

// Geometric coordinates tailored for a clear 1000x560 canvas representing CU Gharuan Sector
const CU_STATION = {
  id: 'station-01',
  name: 'CU Emergency Response Hub (NH-05 Gate 1)',
  x: 200,
  y: 460,
};

const CU_ROADS = [
  {
    id: 'road-101',
    name: 'NH-05 Main University Arterial (Ludhiana-Chandigarh Hwy Access)',
    shortName: 'NH-05 Arterial (7.5m)',
    x1: 120,
    y1: 460,
    x2: 880,
    y2: 460,
    width_m: 7.5,
  },
  {
    id: 'road-102',
    name: 'Academic Blocks Central Spine (North Campus Lane)',
    shortName: 'Campus Spine (3.4m)',
    x1: 380,
    y1: 460,
    x2: 380,
    y2: 210,
    width_m: 3.4,
  },
  {
    id: 'road-103',
    name: 'Old Gharuan Village Bypass Gully (Narrow Corridor)',
    shortName: 'Gharuan Bypass Gully (2.1m)',
    x1: 380,
    y1: 210,
    x2: 140,
    y2: 210,
    width_m: 2.1,
    hasObstruction: true,
  },
  {
    id: 'road-104',
    name: 'Hostel Complex Cross Link (Simulated Obstruction)',
    shortName: 'Hostel Cross Link (4.0m)',
    x1: 380,
    y1: 210,
    x2: 660,
    y2: 210,
    width_m: 4.0,
    hasObstruction: true,
  },
  {
    id: 'road-105',
    name: 'Gharuan East Rural By-lane (Unknown Width)',
    shortName: 'East By-lane (Unsurveyed)',
    x1: 760,
    y1: 460,
    x2: 760,
    y2: 210,
    width_m: null,
  },
  {
    id: 'road-106',
    name: 'Sports Arena & South Transit Spur',
    shortName: 'Sports Spur (3.8m)',
    x1: 660,
    y1: 210,
    x2: 880,
    y2: 210,
    width_m: 3.8,
  },
];

const CU_BUILDINGS = [
  {
    id: 'bldg-201',
    name: 'CU Student Health & Medical Sub-Center',
    shortName: 'Health Center',
    code: 'B-201',
    roadId: 'road-101',
    x: 280,
    y: 390,
    w: 80,
    h: 46,
  },
  {
    id: 'bldg-202',
    name: 'Central Library & Administrative Block (CU)',
    shortName: 'Library & Admin',
    code: 'B-202',
    roadId: 'road-102',
    x: 260,
    y: 290,
    w: 96,
    h: 52,
  },
  {
    id: 'bldg-203',
    name: 'Old Gharuan Residential Cluster Block A',
    shortName: 'Old Gharuan Res.',
    code: 'B-203',
    roadId: 'road-103',
    x: 180,
    y: 130,
    w: 90,
    h: 54,
  },
  {
    id: 'bldg-204',
    name: 'University Student Mall & Commercial Complex',
    shortName: 'Student Mall',
    code: 'B-204',
    roadId: 'road-104',
    x: 480,
    y: 130,
    w: 96,
    h: 54,
  },
  {
    id: 'bldg-205',
    name: 'Gharuan Logistics Depot & Agro Storage',
    shortName: 'Logistics Depot',
    code: 'B-205',
    roadId: 'road-105',
    x: 785,
    y: 330,
    w: 88,
    h: 50,
  },
  {
    id: 'bldg-206',
    name: 'Faculty Residences & International Hostel Towers',
    shortName: 'Faculty Hostel',
    code: 'B-206',
    roadId: 'road-106',
    x: 750,
    y: 130,
    w: 96,
    h: 54,
  },
];

export const SvgMap: React.FC<SvgMapProps> = ({
  selectedId,
  selectedKind,
  viewBox = '0 0 1000 560',
  nohit = false,
  filterQuery = '',
  hypotheticalFix,
  vehicleId = 'fire',
  buildingStatuses,
  roadStatuses,
  onSelect,
  className = 'map',
}) => {
  const ql = filterQuery.trim().toLowerCase();

  // Helper to determine road status
  const getRoadStatus = (road: typeof CU_ROADS[0]): 'ok' | 'constrained' | 'infeasible' | 'unknown' => {
    if (roadStatuses && roadStatuses[road.id]) {
      const s = roadStatuses[road.id];
      if (s === 'accessible' || s === 'feasible' || s === 'ok') return 'ok';
      if (s === 'constrained') return 'constrained';
      if (s === 'unknown') return 'unknown';
      return 'infeasible';
    }

    // Check hypothetical remedies
    const isFixed =
      hypotheticalFix &&
      (hypotheticalFix === road.id ||
        (hypotheticalFix === 'I-01' && road.id === 'road-104') ||
        (hypotheticalFix === 'I-02' && road.id === 'road-105') ||
        (hypotheticalFix === 'I-03' && road.id === 'road-103') ||
        (hypotheticalFix === 'I-04' && road.id === 'road-106') ||
        (hypotheticalFix === 'I-05' && road.id === 'road-102'));

    if (isFixed) return 'ok';

    if (road.width_m === null) return 'unknown';

    if (road.hasObstruction) {
      if (road.id === 'road-104') return 'infeasible';
      if (road.id === 'road-103') {
        if (vehicleId === 'rapid') return 'constrained';
        return 'infeasible';
      }
    }

    const minW = vehicleId === 'fire' ? 3.5 : vehicleId === 'amb' ? 3.0 : 2.4;
    if (road.width_m < minW) {
      return road.width_m < minW - 0.4 ? 'infeasible' : 'constrained';
    }
    if (road.width_m < minW + 0.4) {
      return 'constrained';
    }
    return 'ok';
  };

  // Helper to determine building status
  const getBuildingStatus = (bldg: typeof CU_BUILDINGS[0]): 'ok' | 'constrained' | 'infeasible' | 'unknown' => {
    if (buildingStatuses && buildingStatuses[bldg.id]) {
      const s = buildingStatuses[bldg.id];
      if (s === 'accessible' || s === 'feasible' || s === 'ok') return 'ok';
      if (s === 'constrained') return 'constrained';
      if (s === 'unknown') return 'unknown';
      return 'infeasible';
    }

    const isFixed =
      hypotheticalFix &&
      (hypotheticalFix === bldg.roadId ||
        (hypotheticalFix === 'I-01' && bldg.id === 'bldg-204') ||
        (hypotheticalFix === 'I-02' && bldg.id === 'bldg-205') ||
        (hypotheticalFix === 'I-03' && bldg.id === 'bldg-203') ||
        (hypotheticalFix === 'I-04' && bldg.id === 'bldg-206') ||
        (hypotheticalFix === 'I-05' && bldg.id === 'bldg-202'));

    if (isFixed) {
      // For fire tender, bldg-204 still requires approach road-102
      if (vehicleId === 'fire' && bldg.id === 'bldg-204' && hypotheticalFix === 'I-01') {
        return 'infeasible';
      }
      return 'ok';
    }

    // Default status based on vehicle profile
    if (vehicleId === 'fire') {
      if (bldg.id === 'bldg-201') return 'ok';
      if (bldg.id === 'bldg-206') return 'constrained';
      if (bldg.id === 'bldg-205') return 'unknown';
      return 'infeasible';
    } else if (vehicleId === 'amb') {
      if (bldg.id === 'bldg-201' || bldg.id === 'bldg-202' || bldg.id === 'bldg-206') return 'ok';
      if (bldg.id === 'bldg-205') return 'unknown';
      return 'infeasible';
    } else {
      // Rapid response
      if (bldg.id === 'bldg-205') return 'unknown';
      if (bldg.id === 'bldg-204') return 'infeasible';
      if (bldg.id === 'bldg-203') return 'constrained';
      return 'ok';
    }
  };

  const getStatusColor = (st: string) => {
    switch (st) {
      case 'ok':
        return '#2a9d8f';
      case 'constrained':
        return '#e8710a';
      case 'infeasible':
        return '#d7263d';
      default:
        return '#7d837a';
    }
  };

  return (
    <svg
      className={className}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        background: 'var(--bg, #f4f5f1)',
        borderRadius: '12px',
      }}
      aria-label="Chandigarh University Sector Emergency Access Visual Map"
    >
      <defs>
        {/* Subtle grid pattern */}
        <pattern id="cuGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--line, rgba(0,0,0,0.06))" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Grid background */}
      <rect width="1000" height="560" fill="url(#cuGrid)" />

      {/* Sector Boundary Label */}
      <text x="30" y="40" fontSize="15" fontWeight="800" fill="var(--ink, #1c1f1b)" letterSpacing="-0.01em">
        Chandigarh University &amp; Gharuan Sector
      </text>
      <text x="30" y="58" fontSize="12" fontWeight="500" fill="var(--mute, #687062)">
        Sector Topological Access Topology · Profile: {vehicleId === 'fire' ? 'Fire Tender (≥3.5m)' : vehicleId === 'amb' ? 'Ambulance (≥3.0m)' : 'Rapid Response (≥2.4m)'}
      </text>

      {/* Road Network Lines */}
      {CU_ROADS.map((road) => {
        const st = getRoadStatus(road);
        const col = getStatusColor(st);
        const isDim = ql && !road.name.toLowerCase().includes(ql) && !road.id.toLowerCase().includes(ql);
        const isSelected = selectedKind === 'e' && selectedId === road.id;
        const isDash = st === 'unknown';

        return (
          <g key={road.id} className={isDim ? 'dim' : ''} style={{ cursor: nohit ? 'default' : 'pointer' }}>
            {/* Background wider road stroke */}
            <line
              x1={road.x1}
              y1={road.y1}
              x2={road.x2}
              y2={road.y2}
              stroke={isSelected ? '#ffd60a' : col}
              strokeWidth={isSelected ? 14 : 9}
              strokeLinecap="round"
              strokeDasharray={isDash ? '8 6' : undefined}
              opacity={isSelected ? 1 : 0.9}
            >
              <title>{`${road.id}: ${road.name} (${road.width_m ? `${road.width_m}m` : 'Unknown width'}) — ${st.toUpperCase()}`}</title>
            </line>

            {/* Road center track line */}
            <line
              x1={road.x1}
              y1={road.y1}
              x2={road.x2}
              y2={road.y2}
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="4 8"
              opacity={0.4}
            />

            {/* Click hit area */}
            {!nohit && (
              <line
                x1={road.x1}
                y1={road.y1}
                x2={road.x2}
                y2={road.y2}
                stroke="transparent"
                strokeWidth={28}
                onClick={() => onSelect?.('e', road.id)}
              />
            )}

            {/* Road Label */}
            <text
              x={(road.x1 + road.x2) / 2}
              y={(road.y1 + road.y2) / 2 + (road.y1 === road.y2 ? 22 : 0)}
              dx={road.x1 === road.x2 ? 14 : 0}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="var(--ink, #1c1f1b)"
              style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--bg, #fff)', strokeWidth: 3 }}
            >
              {road.shortName}
            </text>
          </g>
        );
      })}

      {/* Buildings */}
      {CU_BUILDINGS.map((bldg) => {
        const st = getBuildingStatus(bldg);
        const col = getStatusColor(st);
        const isDim = ql && !bldg.name.toLowerCase().includes(ql) && !bldg.id.toLowerCase().includes(ql);
        const isSelected = selectedKind === 'b' && selectedId === bldg.id;

        return (
          <g
            key={bldg.id}
            className={isDim ? 'dim' : ''}
            onClick={() => onSelect?.('b', bldg.id)}
            style={{ cursor: nohit ? 'default' : 'pointer' }}
          >
            {/* Building footprint box */}
            <rect
              x={bldg.x}
              y={bldg.y}
              width={bldg.w}
              height={bldg.h}
              rx={8}
              fill={col}
              fillOpacity={0.25}
              stroke={isSelected ? '#ffd60a' : col}
              strokeWidth={isSelected ? 3.5 : 2}
            >
              <title>{`${bldg.id}: ${bldg.name} (Access via ${bldg.roadId}) — ${st.toUpperCase()}`}</title>
            </rect>

            {/* Building Code Badge */}
            <rect
              x={bldg.x + 6}
              y={bldg.y + 6}
              width={42}
              height={18}
              rx={4}
              fill={col}
              opacity={0.9}
            />
            <text
              x={bldg.x + 27}
              y={bldg.y + 19}
              textAnchor="middle"
              fontSize="10"
              fontWeight="800"
              fill="#ffffff"
            >
              {bldg.code}
            </text>

            {/* Building Name */}
            <text
              x={bldg.x + bldg.w / 2}
              y={bldg.y + bldg.h + 16}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="var(--ink, #1c1f1b)"
              style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--bg, #fff)', strokeWidth: 2.5 }}
            >
              {bldg.shortName}
            </text>
          </g>
        );
      })}

      {/* Emergency Response Station (Diamond Marker) */}
      <g
        onClick={() => onSelect?.('s', CU_STATION.id)}
        style={{ cursor: nohit ? 'default' : 'pointer' }}
      >
        {/* Pulsing indicator ring */}
        <circle cx={CU_STATION.x} cy={CU_STATION.y} r={24} fill="#ffd60a" fillOpacity={0.25} />
        {/* Diamond path */}
        <path
          d={`M${CU_STATION.x} ${CU_STATION.y - 18} L${CU_STATION.x + 18} ${CU_STATION.y} L${CU_STATION.x} ${CU_STATION.y + 18} L${CU_STATION.x - 18} ${CU_STATION.y} Z`}
          fill="#ffd60a"
          stroke="#1c1f1b"
          strokeWidth={2.5}
        >
          <title>{CU_STATION.name}</title>
        </path>
        {/* White cross inside diamond */}
        <text
          x={CU_STATION.x}
          y={CU_STATION.y + 5}
          textAnchor="middle"
          fontSize="14"
          fontWeight="900"
          fill="#1c1f1b"
          pointerEvents="none"
        >
          +
        </text>
        {/* Station Label */}
        <text
          x={CU_STATION.x}
          y={CU_STATION.y + 36}
          textAnchor="middle"
          fontSize="13"
          fontWeight="800"
          fill="var(--ink, #1c1f1b)"
          style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--bg, #fff)', strokeWidth: 3 }}
        >
          Gate 1 Dispatch Hub
        </text>
      </g>

      {/* Bottleneck Hazard Markers */}
      <g style={{ pointerEvents: 'none' }}>
        {/* I-01 on road-104 */}
        <g transform="translate(520, 210)">
          <circle cx="0" cy="0" r="12" fill="#d7263d" stroke="#ffffff" strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#ffffff">!</text>
          <text x="0" y="-16" textAnchor="middle" fontSize="11" fontWeight="800" fill="#d7263d" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2 }}>
            I-01 Obstruction
          </text>
        </g>
        {/* I-03 on road-103 */}
        <g transform="translate(240, 210)">
          <circle cx="0" cy="0" r="12" fill="#e8710a" stroke="#ffffff" strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#ffffff">!</text>
          <text x="0" y="-16" textAnchor="middle" fontSize="11" fontWeight="800" fill="#e8710a" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2 }}>
            I-03 Narrow (2.1m)
          </text>
        </g>
      </g>

      {/* Clean Bottom Legend */}
      <g transform="translate(30, 526)" style={{ fontSize: '12px', fontWeight: 600 }}>
        <circle cx="0" cy="0" r="6" fill="#2a9d8f" />
        <text x="12" y="4" fill="var(--ink)">Verified Accessible</text>

        <circle cx="160" cy="0" r="6" fill="#e8710a" />
        <text x="172" y="4" fill="var(--ink)">Constrained</text>

        <circle cx="280" cy="0" r="6" fill="#d7263d" />
        <text x="292" y="4" fill="var(--ink)">Inaccessible</text>

        <circle cx="400" cy="0" r="6" fill="#7d837a" />
        <text x="412" y="4" fill="var(--ink)">Unknown / Unsurveyed</text>

        <path d="M 560 -7 L 567 0 L 560 7 L 553 0 Z" fill="#ffd60a" stroke="#1c1f1b" strokeWidth="1.5" />
        <text x="575" y="4" fill="var(--ink)">Emergency Dispatch Hub</text>
      </g>
    </svg>
  );
};

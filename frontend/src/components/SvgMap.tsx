import React from 'react';
import { GeoJSONFeature, IssueRecord } from '../types';
import { ACCESS_LABELS } from '../services/store';

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
  routePath?: number[];
  hypotheticalFix?: string | null;
  onSelect?: (kind: 'b' | 'e' | 'i' | 's', id: string) => void;
  className?: string;
}

export const SvgMap: React.FC<SvgMapProps> = ({
  selectedId,
  selectedKind,
  viewBox = '0 0 1000 560',
  nohit = false,
  filterQuery = '',
  hypotheticalFix,
  onSelect,
  className = 'map',
}) => {
  // 15 Node grid from reference demo
  const N: { x: number; y: number }[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 5; i++) {
      N.push({ x: 130 + i * 185, y: 110 + j * 170 });
    }
  }

  const HW = [
    [6.5, 4.2, 2.6, 5.8],
    [7, 6.5, 3.1, null],
    [5.5, 2.2, 4.8, 6],
  ];
  const VW = [
    [6, 4, 7, 2.8, 5],
    [5, null, 6, 4.5, 3.2],
  ];

  interface EdgeItem {
    id: string;
    a: number;
    b: number;
    w: number | null;
    name: string;
    i: number;
  }

  const E: EdgeItem[] = [];
  let eIdx = 0;
  HW.forEach((r, j) =>
    r.forEach((w, i) =>
      E.push({
        id: `h${j}-${i}`,
        a: j * 5 + i,
        b: j * 5 + i + 1,
        w,
        name: `${['Mill', 'Temple', 'Canal'][j]} Lane ${i + 1}`,
        i: eIdx++,
      })
    )
  );
  VW.forEach((r, j) =>
    r.forEach((w, i) =>
      E.push({
        id: `v${j}-${i}`,
        a: j * 5 + i,
        b: j * 5 + i + 5,
        w,
        name: `${['Ash', 'Birch', 'Cedar', 'Dune', 'Elm'][i]} Street ${j + 1}`,
        i: eIdx++,
      })
    )
  );

  const mid = (e: EdgeItem) => ({
    x: (N[e.a].x + N[e.b].x) / 2,
    y: (N[e.a].y + N[e.b].y) / 2,
  });

  const B = E.filter((_, i) => i % 4 !== 1).map((e, k) => {
    const m = mid(e);
    const s = k % 2 ? 1 : -1;
    const hz = N[e.a].y === N[e.b].y;
    return {
      id: 'B-' + String(k + 1).padStart(3, '0'),
      e: e.id,
      x: m.x + (hz ? 0 : s * 34),
      y: m.y + (hz ? s * 34 : 0),
    };
  });

  const STN = [
    { id: 'S-A', n: 0, name: 'Sample Station A' },
    { id: 'S-B', n: 14, name: 'Sample Station B' },
  ];

  const getEdgeClass = (e: EdgeItem) => {
    // Check if fixed hypothetically
    if (hypotheticalFix && (e.id === 'h0-2' || e.id === 'v0-2' || e.id === 'h2-1')) {
      return 'ok';
    }
    if (e.id === 'v0-2') return 'infeasible'; // simulated parked vehicles blocking lane
    if (e.w === null) return 'unknown';
    if (e.w < 2.5) return 'infeasible';
    if (e.w < 3.5) return 'constrained';
    return 'ok';
  };

  const ql = filterQuery.toLowerCase();

  return (
    <svg
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label="Synthetic emergency access map"
    >
      {/* Roads */}
      {E.map((e) => {
        const c = getEdgeClass(e);
        const a = N[e.a];
        const z = N[e.b];
        const isDim = ql && !e.name.toLowerCase().includes(ql);
        const isSelected = selectedKind === 'e' && selectedId === e.id;

        return (
          <g key={e.id} className={isDim ? 'dim' : ''}>
            <line
              className={`rd c-${c} ${c === 'unknown' ? 'dash' : ''}`}
              x1={a.x}
              y1={a.y}
              x2={z.x}
              y2={z.y}
              style={{ strokeWidth: isSelected ? 12 : undefined }}
            >
              <title>{`${e.name}: ${ACCESS_LABELS[c] || c}`}</title>
            </line>
            {!nohit && (
              <line
                className="hit"
                x1={a.x}
                y1={a.y}
                x2={z.x}
                y2={z.y}
                onClick={() => onSelect?.('e', e.id)}
              />
            )}
          </g>
        );
      })}

      {/* Buildings */}
      {B.map((b) => {
        const parentEdge = E.find((ed) => ed.id === b.e);
        const c = parentEdge ? getEdgeClass(parentEdge) : 'ok';
        const isDim = ql && !b.id.toLowerCase().includes(ql);
        const isSelected = selectedKind === 'b' && selectedId === b.id;

        return (
          <g key={b.id} className={isDim ? 'dim' : ''}>
            <rect
              className={`bd c-${c} ${c === 'unknown' ? 'u' : ''} ${
                isSelected ? 'sel' : ''
              }`}
              x={b.x - 9}
              y={b.y - 9}
              width={18}
              height={18}
              rx={4}
              onClick={() => onSelect?.('b', b.id)}
            >
              <title>{`${b.id}: ${ACCESS_LABELS[c] || c}`}</title>
            </rect>
            {isSelected && (
              <text
                x={b.x}
                y={b.y - 16}
                textAnchor="middle"
                fontSize={14}
                fontWeight={800}
                fill="currentColor"
              >
                {b.id}
              </text>
            )}
          </g>
        );
      })}

      {/* Issues */}
      <g>
        <circle className="ring" cx={mid(E[14]).x} cy={mid(E[14]).y} r={12} />
        <circle
          className="is"
          cx={mid(E[14]).x}
          cy={mid(E[14]).y}
          r={8}
          onClick={() => onSelect?.('i', 'I-01')}
        >
          <title>I-01: Parked vehicles blocking lane</title>
        </circle>
      </g>

      {/* Stations */}
      {STN.map((t) => {
        const n = N[t.n];
        return (
          <g key={t.id} onClick={() => onSelect?.('s', t.id)}>
            <path
              className="st"
              d={`M${n.x} ${n.y - 18}l16 18-16 18-16-18z`}
            >
              <title>{t.name}</title>
            </path>
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fontSize={12}
              fontWeight={800}
              fill="var(--bg)"
              pointerEvents="none"
            >
              +
            </text>
          </g>
        );
      })}
    </svg>
  );
};

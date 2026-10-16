import { IssueRecord } from '../types';

export const VEHICLE_OPTIONS: Record<string, { n: string; w: number; desc: string }> = {
  fire: {
    n: 'Fire tender',
    w: 3.5,
    desc: 'Heavy water tender requiring ≥ 3.5m clearance.',
  },
  amb: {
    n: 'Ambulance',
    w: 3.0,
    desc: 'Emergency ambulance requiring ≥ 3.0m clearance.',
  },
  rapid: {
    n: 'Rapid response car',
    w: 2.4,
    desc: 'Agile rapid response unit requiring ≥ 2.4m clearance.',
  },
};

export const INITIAL_ISSUES: IssueRecord[] = [
  {
    id: 'I-01',
    t: 'Parked vehicles blocking lane',
    type: 'Obstruction',
    edge: 'road-104',
    sev: 'high',
    st: 'open',
    ver: 'Unverified report',
    blocked: 1,
    fixW: null,
    ai: 'Vehicles appear to occupy the carriageway, blocking all 4-wheeled emergency ingress.',
    age: '2 days ago',
  },
  {
    id: 'I-02',
    t: 'Unmeasured access road',
    type: 'Unknown width',
    edge: 'road-105',
    sev: 'med',
    st: 'review',
    ver: 'Measurement unavailable in cadastre',
    fixW: 5,
    ai: 'No usable image evidence yet. Ground survey required.',
    age: '5 days ago',
  },
  {
    id: 'I-03',
    t: 'Narrow approach corridor (Old Bazaar Gully)',
    type: 'Width constraint',
    edge: 'road-103',
    sev: 'high',
    st: 'open',
    ver: 'Sample measurement 2.1 m',
    fixW: 6,
    ai: 'Visible narrowing between structures near the cross-junction.',
    age: '9 days ago',
  },
  {
    id: 'I-04',
    t: 'Restricted entrance bollards',
    type: 'Restricted entrance',
    edge: 'road-106',
    sev: 'low',
    st: 'verified',
    ver: 'Verified by site visit (demo)',
    fixW: 5.5,
    ai: 'Gate or removable bollards may restrict entrance during peak hours.',
    age: '3 weeks ago',
  },
  {
    id: 'I-05',
    t: 'Visible overhead wire cluster and narrowing',
    type: 'Width constraint',
    edge: 'road-102',
    sev: 'med',
    st: 'open',
    ver: 'Sample measurement 3.4 m with sagging wires',
    fixW: 5,
    ai: 'Overhead cables hang lower than 2.8m along the lane center.',
    age: '12 days ago',
  },
];

export const ACCESS_LABELS: Record<string, string> = {
  ok: 'Verified accessible',
  feasible: 'Verified accessible',
  constrained: 'Constrained',
  infeasible: 'Potentially inaccessible',
  unknown: 'Unknown',
};

export const ACCESS_SYMBOLS: Record<string, string> = {
  ok: '●',
  feasible: '●',
  constrained: '▲',
  infeasible: '✕',
  unknown: '?',
};

export const SEVERITY_LEVELS: Record<string, number> = {
  high: 3,
  med: 2,
  low: 1,
};

export const SEVERITY_NAMES: Record<string, string> = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
};

export const STATUS_NAMES: Record<string, string> = {
  open: 'Open',
  review: 'Under review',
  verified: 'Verified',
  resolved: 'Resolved',
};

export function calculateIssueScore(issue: IssueRecord, affectedBuildingsCount: number = 2): number {
  const sevWeight = SEVERITY_LEVELS[issue.sev] || 1;
  return sevWeight * 20 + affectedBuildingsCount * 6;
}

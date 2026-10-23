import React, { useState, useEffect } from 'react';
import { StatsResponse, IssueRecord, CriticalRoad, VehicleGapResponse } from '../types';
import { SvgMap } from '../components/SvgMap';
import { calculateIssueScore, SEVERITY_NAMES } from '../services/store';
import { api } from '../services/api';
import { Zap } from 'lucide-react';

interface OverviewPageProps {
  stats: StatsResponse | null;
  issues: IssueRecord[];
  sessionLog: string[];
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  stats,
  issues,
  sessionLog,
}) => {
  const [selectedVehicle, setSelectedVehicle] = useState<'fire' | 'amb' | 'rapid'>('fire');
  const [vehicleStats, setVehicleStats] = useState<StatsResponse | null>(stats);
  const [vehicleGap, setVehicleGap] = useState<VehicleGapResponse | null>(null);
  const [criticalRoads, setCriticalRoads] = useState<CriticalRoad[]>([]);
  const [criticalLoading, setCriticalLoading] = useState<boolean>(false);

  // Load comparative vehicle gap analysis once
  useEffect(() => {
    let isMounted = true;
    api.fetchVehicleGap()
      .then((res) => {
        if (isMounted) setVehicleGap(res);
      })
      .catch((err) => console.warn('Failed to load vehicle gap analysis:', err));
    return () => {
      isMounted = false;
    };
  }, []);

  // Update apparatus-specific stats and critical roads whenever selected vehicle changes
  useEffect(() => {
    let isMounted = true;
    setCriticalLoading(true);

    Promise.all([
      api.fetchStats(selectedVehicle),
      api.fetchCriticalRoads(selectedVehicle, 5),
    ])
      .then(([statsRes, criticalRes]) => {
        if (isMounted) {
          setVehicleStats(statsRes);
          setCriticalRoads(criticalRes);
        }
      })
      .catch((err) => console.warn('Failed to load vehicle-specific data:', err))
      .finally(() => {
        if (isMounted) setCriticalLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedVehicle]);

  const activeStats = vehicleStats || stats;
  const buildingsCount = activeStats?.buildings.total ?? 6;
  const reachableCount = activeStats?.buildings.feasible ?? 1;
  const constraintsCount =
    (activeStats?.buildings.constrained ?? 0) + (activeStats?.buildings.infeasible ?? 0);
  const unknownCount = activeStats?.buildings.unknown ?? 1;
  const openIssuesCount = issues.filter(
    (i) => i.st === 'open' || i.st === 'review'
  ).length;

  const sortedIssues = [...issues]
    .filter((i) => i.st !== 'resolved')
    .sort((a, b) => calculateIssueScore(b) - calculateIssueScore(a))
    .slice(0, 5);

  const FORMULA_TOOLTIP =
    "Formulas:\n" +
    "• evidence_coverage_pct = (feasible + constrained + infeasible) / total buildings * 100\n" +
    "• verified_reachable_pct = feasible / (feasible + constrained + infeasible) * 100\n" +
    "(Unknown is excluded, never counted as reachable or unreachable)";

  const VEHICLE_CONFIG: Array<{
    key: 'fire' | 'amb' | 'rapid';
    name: string;
    clearance: string;
    sublabel: string;
  }> = [
    { key: 'fire', name: 'Fire Engine', clearance: '≥ 3.5m clearance', sublabel: 'Heavy municipal apparatus' },
    { key: 'amb', name: 'Ambulance', clearance: '≥ 3.0m clearance', sublabel: 'Medium emergency apparatus' },
    { key: 'rapid', name: 'Rapid Response', clearance: '≥ 2.4m clearance', sublabel: 'Light access motorcycle/4x4' },
  ];

  const getSevClass = (sev: string) => {
    switch (sev) {
      case 'high':
        return 'c-infeasible';
      case 'med':
        return 'c-constrained';
      default:
        return 'c-unknown';
    }
  };

  return (
    <section className="v">
      {/* Hero */}
      <div className="hero">
        <div>
          <h1>
            Every second matters.
            <span>Every road must be reachable.</span>
          </h1>
          <div className="tape" aria-hidden="true" />
          <p className="lede">
            UNREACHABLE reveals which building footprints emergency vehicles may struggle
            to reach due to narrow lanes, physical bottlenecks, and restricted entrances.
            Watch the vehicles moving in the background: each unit travels through the street grid
            and halts with a warning pulse when corridors are obstructed or impassable.
          </p>
          <div className="cta">
            <a
              className="btn pri"
              href="#/demo"
              id="hero-presenter-demo-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--tape, #ffd60a)',
                color: '#1c1f1b',
                fontWeight: 800,
                fontSize: '16px',
                height: '48px',
                padding: '0 24px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                border: '1.5px solid rgba(0,0,0,0.15)',
              }}
            >
              <Zap size={18} className="fill-current text-current" aria-hidden="true" />
              <span>Presenter Demo</span>
            </a>
          </div>
        </div>

        <a className="prev" href="#/map" aria-label="Open Access Atlas">
          <SvgMap nohit={true} vehicleId={selectedVehicle} />
          <span>Open Access Atlas</span>
        </a>
      </div>

      {/* Vehicle Gap Scorecard Strip */}
      <div
        className="vehicle-gap-strip"
        style={{
          margin: '24px 0',
          background: 'var(--glass)',
          border: '1.5px solid var(--line)',
          borderRadius: '16px',
          padding: '20px 22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', letterSpacing: '-0.01em' }}>Vehicle Gap Scorecard</h2>
              <span
                title={FORMULA_TOOLTIP}
                style={{
                  cursor: 'help',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: 'var(--line)',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--ink)',
                }}
              >
                ⓘ
              </span>
            </div>
            <p className="lede" style={{ fontSize: '14px', margin: '4px 0 0 0' }}>
              One memorable number per apparatus. Click a column to filter citywide KPIs and vulnerability analysis.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                fontWeight: 800,
                color: 'var(--mute)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--line)',
                padding: '4px 10px',
                borderRadius: '20px',
                letterSpacing: '0.04em',
              }}
            >
              Synthetic demo data
            </span>
          </div>
        </div>

        {/* 3 Columns: Fire / Ambulance / Rapid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
            marginTop: '16px',
          }}
        >
          {VEHICLE_CONFIG.map((cfg) => {
            const data = vehicleGap ? vehicleGap[cfg.key] : null;
            const isSelected = selectedVehicle === cfg.key;
            // Fallback hand-computable defaults matching Ward 142 dataset if offline/loading
            const reachPct = data?.verified_reachable_pct ?? (cfg.key === 'fire' ? 20.0 : 60.0);
            const covPct = data?.evidence_coverage_pct ?? 83.3;
            const feasibleCount = data?.counts.feasible ?? (cfg.key === 'fire' ? 1 : 3);
            const totalAssessed = (data?.counts.feasible ?? (cfg.key === 'fire' ? 1 : 3)) +
                                  (data?.counts.constrained ?? (cfg.key === 'fire' ? 1 : 0)) +
                                  (data?.counts.infeasible ?? (cfg.key === 'fire' ? 3 : 2));

            const barColor = reachPct >= 60 ? '#2a9d8f' : reachPct >= 35 ? '#e9c46a' : '#d7263d';

            return (
              <button
                key={cfg.key}
                type="button"
                onClick={() => setSelectedVehicle(cfg.key)}
                title={FORMULA_TOOLTIP}
                style={{
                  textAlign: 'left',
                  background: isSelected ? 'rgba(231,111,81,0.09)' : 'var(--bg)',
                  border: isSelected ? '2px solid var(--accent, #e76f51)' : '1px solid var(--line)',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 12px rgba(231,111,81,0.15)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>
                      {cfg.name}
                    </span>
                    <div style={{ fontSize: '11px', color: 'var(--mute)' }}>{cfg.clearance}</div>
                  </div>
                  {isSelected ? (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        background: 'var(--accent, #e76f51)',
                        color: '#fff',
                        padding: '2px 7px',
                        borderRadius: '6px',
                      }}
                    >
                      Selected
                    </span>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--mute)', fontWeight: 600 }}>Click to test</span>
                  )}
                </div>

                {/* Number 1: Verified Reachable % (Memorable Number) */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <b style={{ fontSize: '28px', lineHeight: 1, color: isSelected ? 'var(--accent, #e76f51)' : 'var(--ink)' }}>
                      {reachPct.toFixed(1)}%
                    </b>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mute)' }}>
                      verified reachable
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--mute)', marginTop: '2px' }}>
                    {feasibleCount} of {totalAssessed} surveyed buildings reachable
                  </div>
                </div>

                {/* Small Bar */}
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--line)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, reachPct))}%`,
                      background: barColor,
                      borderRadius: '3px',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>

                {/* Number 2: Evidence Coverage % */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--line)',
                    paddingTop: '8px',
                    marginTop: '2px',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--mute)' }}>Evidence coverage:</span>
                  <b style={{ fontSize: '13px', color: 'var(--ink)' }}>{covPct.toFixed(1)}%</b>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Numbers Grid (updates with selected vehicle) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px 4px' }}>
        <small style={{ fontSize: '14px', fontWeight: 700, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          CU Gharuan Sector Assessment for {selectedVehicle === 'fire' ? 'Fire Engine (≥3.5m)' : selectedVehicle === 'amb' ? 'Ambulance (≥3.0m)' : 'Rapid Response (≥2.4m)'}
        </small>
      </div>
      <div className="nums">
        <div>
          <b>{buildingsCount}</b>
          <small>Buildings assessed</small>
        </div>
        <div>
          <b style={{ color: reachableCount > 0 ? '#2a9d8f' : 'inherit' }}>{reachableCount}</b>
          <small>Verified reachable</small>
        </div>
        <div>
          <b style={{ color: constraintsCount > 0 ? '#d7263d' : 'inherit' }}>{constraintsCount}</b>
          <small>Access constraints</small>
        </div>
        <div>
          <b>{unknownCount}</b>
          <small>Unknown status</small>
        </div>
        <div>
          <b>{openIssuesCount}</b>
          <small>Issues awaiting review</small>
        </div>
      </div>


      {/* Top 5 Single Points of Failure Card */}
      <div style={{ margin: '24px 0', background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '16px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px' }}>Top 5 Single Points of Failure</h2>
            <p className="lede" style={{ fontSize: '15px', margin: '4px 0 0 0' }}>
              Critical corridors ranked by number of buildings whose access deteriorates if blocked (evaluated for {selectedVehicle === 'fire' ? 'Fire Engine ≥3.5m' : selectedVehicle === 'amb' ? 'Ambulance ≥3.0m' : 'Rapid Response ≥2.4m'}).
            </p>
          </div>
          <span style={{ fontSize: '12px', textTransform: 'uppercase', fontWeight: 800, color: 'var(--sig)', background: 'rgba(215,38,61,0.08)', padding: '4px 10px', borderRadius: '6px' }}>
            Vulnerability Engine
          </span>
        </div>

        {criticalLoading ? (
          <p style={{ color: 'var(--mute)', fontSize: '15px', margin: '14px 0' }}>Analyzing topological single points of failure...</p>
        ) : criticalRoads.length === 0 ? (
          <p style={{ color: 'var(--mute)', fontSize: '15px', margin: '14px 0' }}>
            No critical single points of failure detected for this vehicle profile.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginTop: '16px' }}>
            {criticalRoads.map((cr, idx) => (
              <div
                key={cr.road_id}
                style={{
                  background: 'var(--bg)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '12px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--mute)' }}>#{idx + 1}</span>
                    <span className="sc" style={{ background: cr.buildings_affected > 0 ? '#d7263d' : '#2a9d8f' }}>
                      {cr.buildings_affected}
                    </span>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '15px', marginTop: '6px', color: 'var(--ink)' }}>
                    {cr.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--mute)', fontFamily: 'monospace', marginTop: '2px' }}>
                    {cr.road_id}
                  </div>
                </div>
                <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--sig)', fontWeight: 700 }}>
                  {cr.buildings_affected} building{cr.buildings_affected !== 1 ? 's' : ''} compromised
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two-Column Section */}
      <div className="two">
        <div>
          <h2>Where to look first</h2>
          <p className="lede" style={{ fontSize: '15px', marginBottom: '14px' }}>
            Illustrative priority scores derived from transparent severity and footprint impact rules.
            Not a speculative risk forecast.
          </p>

          <div style={{ marginTop: '8px' }}>
            {sortedIssues.map((issue) => {
              const sc = calculateIssueScore(issue);
              return (
                <a key={issue.id} className="row" href={`#/i/${issue.id}`}>
                  <span className="sc">{sc}</span>
                  <span>
                    <b>{issue.t}</b>
                    <small>
                      {issue.type} on {issue.edge}
                    </small>
                  </span>
                  <b className={`pl ${getSevClass(issue.sev)}`}>
                    {SEVERITY_NAMES[issue.sev]}
                  </b>
                  <span>2 bldgs</span>
                </a>
              );
            })}
            {sortedIssues.length === 0 && <p>No open issues recorded.</p>}
          </div>
        </div>

        <div>
          <h2>This session</h2>
          <div style={{ marginTop: '12px' }}>
            {sessionLog.slice(0, 5).map((logItem, idx) => (
              <div
                key={idx}
                className="row"
                style={{ gridTemplateColumns: '1fr', padding: '10px 8px' }}
              >
                <span style={{ fontSize: '14px' }}>{logItem}</span>
              </div>
            ))}
          </div>

          <div className="cta" style={{ marginTop: '18px' }}>
            <a className="btn sm" href="#/routes">
              Analyse a route
            </a>
            <a className="btn sm" href="#/inspector">
              Inspect an image
            </a>
          </div>

          <div style={{ marginTop: '28px' }}>
            <h3 style={{ marginBottom: '10px' }}>Quick actions</h3>
            <div className="quickgrid">
              <a className="quicklink" href="#/map">
                <b>Access Atlas</b>
                <small>Inspect roads and building access</small>
              </a>
              <a className="quicklink" href="#/routes">
                <b>Route Analysis</b>
                <small>Check vehicle-specific approach</small>
              </a>
              <a className="quicklink" href="#/inspector">
                <b>AI Inspector</b>
                <small>Review street photos for hazards</small>
              </a>
              <a className="quicklink" href="#/interventions">
                <b>Interventions</b>
                <small>Prioritize physical bottlenecks</small>
              </a>
            </div>
          </div>
        </div>
      </div>

      <p className="dis">
        UNREACHABLE is a decision-support prototype operating on synthetic demonstration
        data. It does not replace emergency dispatch systems or certified on-site municipal engineering surveys.
      </p>
    </section>
  );
};

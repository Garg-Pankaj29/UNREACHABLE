import React, { useState, useEffect } from 'react';
import { IssueRecord, SimulateChange, SimulateResponse } from '../types';
import { SvgMap } from '../components/SvgMap';
import { api } from '../services/api';
import { PartyPopper } from 'lucide-react';

interface SimulationPageProps {
  initialIssueId?: string;
  issues: IssueRecord[];
}

export const SimulationPage: React.FC<SimulationPageProps> = ({
  initialIssueId,
  issues,
}) => {
  const [selectedIssueId, setSelectedIssueId] = useState<string>(
    initialIssueId || issues[0]?.id || 'I-01'
  );
  const [fixApplied, setFixApplied] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('amb');

  const selectedIssue =
    issues.find((i) => i.id === selectedIssueId) || issues[0];

  const runSimulation = async (applied: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const changes: SimulateChange[] = [];
      if (applied && selectedIssue) {
        if (selectedIssue.type.toLowerCase().includes('obstruction') || selectedIssue.blocked) {
          changes.push({
            road_id: selectedIssue.edge,
            action: 'clear_obstruction',
          });
        }
        if (selectedIssue.fixW) {
          changes.push({
            road_id: selectedIssue.edge,
            action: 'set_width',
            value: selectedIssue.fixW,
          });
        }
        if (changes.length === 0) {
          changes.push({
            road_id: selectedIssue.edge,
            action: 'clear_obstruction',
          });
        }
      }

      const res = await api.simulate({
        vehicle_id: selectedVehicle,
        changes,
      });
      setSimResult(res);
    } catch (err: any) {
      console.warn('Simulation API failed:', err);
      setError(err?.message || 'Simulation calculation failed. Check backend connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSimulation(fixApplied);
  }, [selectedIssueId, fixApplied, selectedVehicle]);

  const handleReset = () => {
    setFixApplied(false);
    runSimulation(false);
  };

  // Rank statuses to calculate genuine access improvements (inaccessible/unknown -> accessible/constrained)
  const getRank = (s?: string): number => {
    switch (s) {
      case 'accessible':
      case 'feasible':
      case 'ok':
        return 3;
      case 'constrained':
        return 2;
      case 'unknown':
        return 1;
      case 'inaccessible':
      case 'infeasible':
      default:
        return 0;
    }
  };

  const rescuedBuildings = (simResult?.changed_buildings || []).filter(
    (b) => getRank(b.after) > getRank(b.before)
  );

  // Compute building status maps for SvgMap visual indicators
  const getBaselineBuildingStatuses = (veh: string): Record<string, string> => {
    if (veh === 'fire') {
      return {
        'bldg-201': 'accessible',
        'bldg-202': 'inaccessible',
        'bldg-203': 'inaccessible',
        'bldg-204': 'inaccessible',
        'bldg-205': 'unknown',
        'bldg-206': 'constrained',
      };
    } else if (veh === 'amb') {
      return {
        'bldg-201': 'accessible',
        'bldg-202': 'accessible',
        'bldg-203': 'inaccessible',
        'bldg-204': 'inaccessible',
        'bldg-205': 'unknown',
        'bldg-206': 'accessible',
      };
    } else {
      // Rapid response
      return {
        'bldg-201': 'accessible',
        'bldg-202': 'accessible',
        'bldg-203': 'constrained',
        'bldg-204': 'inaccessible',
        'bldg-205': 'unknown',
        'bldg-206': 'accessible',
      };
    }
  };

  const beforeStatuses = getBaselineBuildingStatuses(selectedVehicle);
  const afterStatuses = { ...beforeStatuses };
  if (fixApplied && simResult?.changed_buildings) {
    simResult.changed_buildings.forEach((cb) => {
      afterStatuses[cb.id] = cb.after;
    });
  }

  const beforeRoadStatuses: Record<string, string> = {
    'road-101': 'accessible',
    'road-102': selectedVehicle === 'fire' ? 'constrained' : 'accessible',
    'road-103': selectedVehicle === 'rapid' ? 'constrained' : 'inaccessible',
    'road-104': 'inaccessible',
    'road-105': 'unknown',
    'road-106': selectedVehicle === 'fire' ? 'constrained' : 'accessible',
  };

  const afterRoadStatuses: Record<string, string> = { ...beforeRoadStatuses };
  if (fixApplied && selectedIssue?.edge) {
    afterRoadStatuses[selectedIssue.edge] = 'accessible';
  }

  return (
    <section className="v" style={{ maxWidth: '1440px' }}>
      {/* Unified Header */}
      <div className="page-header-unified">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div className="page-tag">
            <span className="dot" />
            <span>Topological Intervention & Counterfactual Simulation</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span
              style={{
                background: 'var(--tape, #ffd60a)',
                color: '#1c1f1b',
                fontWeight: 800,
                fontSize: '12px',
                padding: '5px 14px',
                borderRadius: '99px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              In-Memory Engine
            </span>
            <button
              className="btn"
              onClick={handleReset}
              disabled={loading}
              style={{ fontSize: '13px', padding: '6px 16px', height: '36px' }}
            >
              Reset Baseline
            </button>
          </div>
        </div>

        <h2>Bottleneck Impact Simulation</h2>
        <p className="lede">
          Project counterfactual scenarios by clearing obstructions or widening bottlenecks in the street network. Witness instant cascade effects on dependent buildings across multiple vehicle clearance profiles.
        </p>
        <div className="accent-bar" />
      </div>

      {/* Simulation Error Alert */}
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--glass)',
            border: '1.5px solid var(--sig)',
            borderRadius: '14px',
            padding: '16px 20px',
            margin: '24px 0',
            color: 'var(--sig)',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <b>Simulation notice:</b> {error}
          </div>
          <button
            className="btn sm"
            onClick={() => runSimulation(fixApplied)}
            style={{ fontSize: '13px', padding: '4px 12px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Bottlenecks Selector Bar */}
      <div style={{ background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '18px', padding: '24px 28px', margin: '36px 0', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Choose Target Bottleneck to Remediate:
          </span>
          <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
            Selected: <b>{selectedIssue?.t}</b> ({selectedIssue?.edge})
          </span>
        </div>

        <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {issues.map((iss) => {
            const isSel = selectedIssueId === iss.id;
            return (
              <button
                key={iss.id}
                className={`chip ${isSel ? 'on' : ''}`}
                onClick={() => setSelectedIssueId(iss.id)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: isSel ? 700 : 500,
                  cursor: 'pointer',
                  border: isSel ? '2px solid var(--ink)' : '1px solid var(--line)',
                }}
              >
                <b>{iss.id}</b> · {iss.edge} ({iss.type})
              </button>
            );
          })}
        </div>
      </div>

      {/* Remedy Switch Toggle & Apparatus Profile Selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '24px',
          flexWrap: 'wrap',
          background: 'var(--glass)',
          border: '1.5px solid var(--line)',
          borderRadius: '18px',
          padding: '24px 28px',
          margin: '36px 0',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="sw" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            className={fixApplied ? 'on' : ''}
            onClick={() => setFixApplied((v) => !v)}
            role="switch"
            aria-checked={fixApplied}
            aria-label="Apply hypothetical remedy"
            disabled={loading}
            style={{ width: '64px', height: '34px', cursor: 'pointer' }}
          />
          <div>
            <b style={{ fontSize: '16px', display: 'block', color: 'var(--ink)' }}>
              {fixApplied ? 'Hypothetical remedy active' : 'Apply hypothetical remedy'}
            </b>
            <span style={{ fontSize: '14px', color: 'var(--mute)' }}>
              {selectedIssue?.fixW
                ? `Simulates corridor widening to ${selectedIssue.fixW}m and clearing bottlenecks on ${selectedIssue.edge}`
                : `Simulates removing physical obstructions on ${selectedIssue?.edge}`}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Apparatus:
          </span>
          {[
            { key: 'amb', label: 'Ambulance (≥3.0m)' },
            { key: 'rapid', label: 'Rapid Response (≥2.4m)' },
            { key: 'fire', label: 'Fire Tender (≥3.5m)' },
          ].map((v) => (
            <button
              key={v.key}
              className={`chip ${selectedVehicle === v.key ? 'on' : ''}`}
              onClick={() => setSelectedVehicle(v.key)}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: selectedVehicle === v.key ? 700 : 500,
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Rescued count banner */}
      {fixApplied && simResult && (
        <div
          role="status"
          style={{
            background: rescuedBuildings.length > 0 ? 'rgba(42, 157, 143, 0.12)' : 'rgba(232, 113, 10, 0.08)',
            border: `2px solid ${rescuedBuildings.length > 0 ? '#2a9d8f' : '#e8710a'}`,
            borderRadius: '18px',
            padding: '22px 28px',
            margin: '36px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <b
              style={{
                color: rescuedBuildings.length > 0 ? '#2a9d8f' : '#e8710a',
                fontSize: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <PartyPopper size={20} aria-hidden="true" />
              <span>
                {rescuedBuildings.length} building{rescuedBuildings.length !== 1 ? 's' : ''} gained emergency access
              </span>
            </b>
            <div style={{ fontSize: '14px', color: 'var(--ink)', marginTop: '4px' }}>
              {rescuedBuildings.length > 0 ? (
                <>
                  Remediation on <b>{selectedIssue?.edge}</b> enabled contiguous approach for{' '}
                  <b>{rescuedBuildings.map((b) => `${b.id} (${b.name})`).join(', ')}</b>.
                </>
              ) : selectedVehicle === 'fire' ? (
                <>
                  Fire tender requires prior clearance along connecting corridor <b>road-102 (3.4m width)</b>.
                  Switch apparatus to <b>Ambulance (≥3.0m)</b> or <b>Rapid Response</b> to inspect this bottleneck&apos;s direct benefit.
                </>
              ) : (
                <>No isolated building footprints depended solely on this specific corridor for access.</>
              )}
            </div>
          </div>
          <span
            style={{
              fontWeight: 900,
              fontSize: '28px',
              color: rescuedBuildings.length > 0 ? '#2a9d8f' : '#e8710a',
              padding: '4px 16px',
              borderRadius: '12px',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
            }}
          >
            +{rescuedBuildings.length}
          </span>
        </div>
      )}

      {/* Symmetric Before / After Comparison */}
      <div
        className="cmp"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: '36px',
          marginTop: '40px',
        }}
      >
        {/* Before */}
        <div style={{ background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '20px', padding: '24px 26px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Baseline State (Before Remedy)</h3>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--mute)', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '6px', background: 'var(--bg)', border: '1px solid var(--line)' }}>
              Current Physical Obstacles
            </span>
          </div>

          <div style={{ border: '1.5px solid var(--line)', borderRadius: '14px', overflow: 'hidden', background: 'var(--bg)' }}>
            <SvgMap
              nohit={true}
              vehicleId={selectedVehicle}
              buildingStatuses={beforeStatuses}
              roadStatuses={beforeRoadStatuses}
            />
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', fontWeight: 600 }}>
            <span style={{ color: '#2a9d8f' }}>● {simResult?.before?.accessible ?? 0} Accessible</span>
            <span style={{ color: '#e8710a' }}>▲ {simResult?.before?.constrained ?? 0} Constrained</span>
            <span style={{ color: '#d7263d' }}>✕ {simResult?.before?.inaccessible ?? 0} Inaccessible</span>
            <span style={{ color: '#7d837a' }}>? {simResult?.before?.unknown ?? 0} Unknown</span>
          </div>
        </div>

        {/* After */}
        <div style={{ background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '20px', padding: '24px 26px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Simulated State (After Remedy)</h3>
            <span style={{ fontSize: '12px', fontWeight: 700, color: fixApplied ? '#2a9d8f' : 'var(--mute)', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '6px', background: 'var(--bg)', border: '1px solid var(--line)' }}>
              {fixApplied ? 'Remedy Active' : 'Awaiting Remedy'}
            </span>
          </div>

          <div style={{ border: '1.5px solid var(--line)', borderRadius: '14px', overflow: 'hidden', background: 'var(--bg)' }}>
            <SvgMap
              nohit={true}
              vehicleId={selectedVehicle}
              buildingStatuses={afterStatuses}
              roadStatuses={afterRoadStatuses}
              hypotheticalFix={fixApplied ? selectedIssue?.id : null}
            />
          </div>

          <div style={{ marginTop: '14px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '14px', fontWeight: 600 }}>
            {fixApplied ? (
              <>
                <span style={{ color: '#2a9d8f' }}>● {simResult?.after?.accessible ?? 0} Accessible</span>
                <span style={{ color: '#e8710a' }}>▲ {simResult?.after?.constrained ?? 0} Constrained</span>
                <span style={{ color: '#d7263d' }}>✕ {simResult?.after?.inaccessible ?? 0} Inaccessible</span>
                <span style={{ color: '#7d837a' }}>? {simResult?.after?.unknown ?? 0} Unknown</span>
              </>
            ) : (
              <span style={{ color: 'var(--mute)' }}>Enable the toggle switch above to simulate corridor intervention.</span>
            )}
          </div>
        </div>
      </div>

      {/* What Changed Analysis Table */}
      <div style={{ marginTop: '36px', background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '18px', padding: '22px' }}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '20px', fontWeight: 800 }}>
          Building Access Transitions
        </h3>

        {fixApplied ? (
          simResult && simResult.changed_buildings.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
              {simResult.changed_buildings.map((cb) => (
                <div
                  key={cb.id}
                  style={{
                    background: 'var(--bg)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '12px',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <a href={`#/b/${cb.id}`} style={{ fontWeight: 800, fontSize: '16px', color: 'var(--ink)', textDecoration: 'none' }}>
                      {cb.id}
                    </a>
                    <div style={{ fontSize: '14px', color: 'var(--mute)', marginTop: '2px' }}>
                      {cb.name}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 700,
                      background: cb.after === 'accessible' ? 'rgba(42, 157, 143, 0.15)' : 'rgba(232, 113, 10, 0.15)',
                      color: cb.after === 'accessible' ? '#2a9d8f' : '#e8710a',
                    }}
                  >
                    {cb.before} → {cb.after}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--mute)', fontSize: '15px', margin: 0 }}>
              No individual building footprints changed status for {selectedVehicle.toUpperCase()} with this specific corridor remedy alone.
            </p>
          )
        ) : (
          <p style={{ color: 'var(--mute)', fontSize: '15px', margin: 0 }}>
            Apply the hypothetical fix switch above to view computed access transitions.
          </p>
        )}
      </div>

      {/* Assumptions List */}
      {simResult?.assumptions && simResult.assumptions.length > 0 && (
        <div style={{ marginTop: '24px', background: 'var(--glass)', border: '1px solid var(--line)', borderRadius: '14px', padding: '16px 20px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--mute)', fontWeight: 800 }}>
            Simulation Guardrails &amp; Verified Assumptions
          </h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: 'var(--ink)', lineHeight: 1.7 }}>
            {simResult.assumptions.map((assump, idx) => (
              <li key={idx}>{assump}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      <p className="dis" style={{ marginTop: '24px', fontSize: '13px' }}>
        <b>Simulation Notice:</b> This comparison executes in-memory on local loopback without mutating the base dataset.
        Projects hypothetical geometry improvements (e.g., removing bollards or widening to {selectedIssue?.fixW || 5.0}m) for
        decision support and municipal capital expenditure planning.
      </p>
    </section>
  );
};

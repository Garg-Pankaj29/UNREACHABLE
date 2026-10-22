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
  const [fixApplied, setFixApplied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('fire');

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

  // Rescued buildings: buildings whose access was improved (e.g. inaccessible/constrained -> accessible)
  const rescuedBuildings = (simResult?.changed_buildings || []).filter(
    (b) =>
      (b.before === 'inaccessible' && (b.after === 'accessible' || b.after === 'constrained')) ||
      (b.before === 'constrained' && b.after === 'accessible')
  );

  return (
    <section className="v">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2>Bottleneck impact simulation</h2>
          <p className="lede">
            Select an identified urban bottleneck, then apply a hypothetical widening or clearance
            remedy to project which building footprints would gain feasible emergency access.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span
            style={{
              background: 'var(--tape, #ffd60a)',
              color: '#1c1f1b',
              fontWeight: 800,
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '99px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            SIMULATION
          </span>
          <button
            className="btn"
            onClick={handleReset}
            disabled={loading}
            style={{ fontSize: '12px', padding: '4px 12px' }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Simulation Error Alert */}
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--sig)',
            borderRadius: '12px',
            padding: '12px 16px',
            margin: '16px 0',
            color: 'var(--sig)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div>
            <b>Simulation notice:</b> {error}
          </div>
          <button
            className="btn sm"
            onClick={() => runSimulation(fixApplied)}
            style={{ fontSize: '11px', padding: '2px 8px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State when no issues */}
      {issues.length === 0 && (
        <div
          className="nf"
          style={{
            margin: '20px 0',
            padding: '24px',
            background: 'var(--glass)',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            textAlign: 'center',
          }}
        >
          <h3 style={{ margin: '0 0 6px 0' }}>No bottleneck issues loaded</h3>
          <p className="lede" style={{ margin: 0, fontSize: '13px' }}>
            No hazard or corridor bottleneck records are currently available to simulate.
          </p>
        </div>
      )}

      {/* Bottleneck Selector Chips */}
      {issues.length > 0 && (
        <div className="chips" style={{ margin: '20px 0' }}>
          {issues.map((iss) => (
            <button
              key={iss.id}
              className={`chip ${selectedIssueId === iss.id ? 'on' : ''}`}
              onClick={() => {
                setSelectedIssueId(iss.id);
                setFixApplied(false);
              }}
            >
              {iss.id} · {iss.edge} ({iss.type})
            </button>
          ))}
        </div>
      )}

      {/* Switch Toggle & Vehicle selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div className="sw">
          <button
            className={fixApplied ? 'on' : ''}
            onClick={() => setFixApplied((v) => !v)}
            role="switch"
            aria-checked={fixApplied}
            aria-label="Apply hypothetical fix"
            disabled={loading}
          />
          <b style={{ fontSize: '15px' }}>
            {fixApplied ? 'Hypothetical fix applied' : 'Apply hypothetical fix'}
          </b>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--mute)' }}>Vehicle:</span>
          {(['fire', 'amb', 'rapid'] as const).map((vKey) => (
            <button
              key={vKey}
              className={`chip ${selectedVehicle === vKey ? 'on' : ''}`}
              onClick={() => setSelectedVehicle(vKey)}
              style={{ padding: '2px 10px', fontSize: '12px' }}
            >
              {vKey.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Rescued count banner */}
      {fixApplied && simResult && (
        <div
          role="status"
          style={{
            background: 'rgba(42, 157, 143, 0.12)',
            border: '1.5px solid var(--ok, #2a9d8f)',
            borderRadius: '12px',
            padding: '12px 16px',
            margin: '20px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <b style={{ color: 'var(--ok, #2a9d8f)', fontSize: '15px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <PartyPopper size={16} aria-hidden="true" />
              <span>{rescuedBuildings.length} building{rescuedBuildings.length !== 1 ? 's' : ''} rescued</span>
            </b>
            <div style={{ fontSize: '13px', color: 'var(--ink)', marginTop: '2px' }}>
              Hypothetical intervention on <b>{selectedIssue?.edge}</b> converted blocked corridors into verified ingress paths.
            </div>
          </div>
          <span style={{ fontWeight: 800, fontSize: '20px', color: 'var(--ok, #2a9d8f)' }}>
            +{rescuedBuildings.length}
          </span>
        </div>
      )}

      {/* Before / After Comparison */}
      <div className="cmp" style={{ marginTop: '20px' }}>
        {/* Before */}
        <div>
          <h3 style={{ marginBottom: '10px' }}>Current State (Before)</h3>
          <div style={{ border: '1px solid var(--line)', borderRadius: '16px', overflow: 'hidden', background: 'var(--glass)', padding: '12px' }}>
            <SvgMap nohit={true} />
          </div>
          <p style={{ marginTop: '10px', fontSize: '14px', color: 'var(--mute)' }}>
            ● {simResult?.before?.accessible ?? 0} Feasible &nbsp;&nbsp;
            ▲ {simResult?.before?.constrained ?? 0} Constrained &nbsp;&nbsp;
            ✕ {simResult?.before?.inaccessible ?? 0} Infeasible &nbsp;&nbsp;
            ? {simResult?.before?.unknown ?? 0} Unknown
          </p>
        </div>

        {/* After */}
        <div>
          <h3 style={{ marginBottom: '10px' }}>Simulated State (After)</h3>
          <div style={{ border: '1px solid var(--line)', borderRadius: '16px', overflow: 'hidden', background: 'var(--glass)', padding: '12px' }}>
            <SvgMap
              nohit={true}
              hypotheticalFix={fixApplied ? selectedIssue?.id : null}
            />
          </div>
          <p style={{ marginTop: '10px', fontSize: '14px', color: 'var(--mute)' }}>
            {fixApplied ? (
              <span style={{ color: 'var(--ok, #2a9d8f)', fontWeight: 600 }}>
                ● {simResult?.after?.accessible ?? 0} Feasible &nbsp;&nbsp;
                ▲ {simResult?.after?.constrained ?? 0} Constrained &nbsp;&nbsp;
                ✕ {simResult?.after?.inaccessible ?? 0} Infeasible &nbsp;&nbsp;
                ? {simResult?.after?.unknown ?? 0} Unknown
              </span>
            ) : (
              'Enable the toggle switch above to simulate corridor intervention.'
            )}
          </p>
        </div>
      </div>

      {/* What Changed Analysis */}
      <h3 style={{ marginTop: '28px', marginBottom: '12px' }}>What changed</h3>
      {fixApplied ? (
        simResult && simResult.changed_buildings.length > 0 ? (
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {simResult.changed_buildings.map((cb) => (
              <div
                key={cb.id}
                className="row"
                style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}
              >
                <a href={`#/b/${cb.id}`} style={{ fontWeight: 700 }}>
                  {cb.id} ({cb.name})
                </a>
                <span
                  style={{
                    color: cb.after === 'accessible' ? 'var(--ok, #2a9d8f)' : 'var(--warn, #e8710a)',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                >
                  {cb.before} → {cb.after}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--mute)' }}>
            No building accessibility changes detected for {selectedVehicle.toUpperCase()} with this intervention.
          </p>
        )
      ) : (
        <p style={{ color: 'var(--mute)' }}>
          Apply the hypothetical fix switch to calculate access changes.
        </p>
      )}

      {/* Assumptions List */}
      {simResult?.assumptions && simResult.assumptions.length > 0 && (
        <div style={{ marginTop: '24px', background: 'var(--glass)', border: '1px solid var(--line)', borderRadius: '12px', padding: '14px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--mute)' }}>
            Simulation Assumptions & Guardrails
          </h4>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--ink)', lineHeight: 1.6 }}>
            {simResult.assumptions.map((assump, idx) => (
              <li key={idx}>{assump}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      <p className="dis" style={{ marginTop: '20px' }}>
        <b>Simulation Notice:</b> This comparison executes in-memory on local loopback without mutating the base dataset.
        Projects hypothetical geometry improvements (e.g., removing bollards or widening to {selectedIssue?.fixW || 5.0} m).
      </p>
    </section>
  );
};


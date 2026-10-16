import React, { useState } from 'react';
import { IssueRecord } from '../types';
import { SvgMap } from '../components/SvgMap';

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

  const selectedIssue =
    issues.find((i) => i.id === selectedIssueId) || issues[0];

  return (
    <section className="v">
      <h2>Bottleneck impact simulation</h2>
      <p className="lede">
        Select an identified urban bottleneck, then apply a hypothetical widening or clearance
        remedy to project which building footprints would gain feasible emergency access.
      </p>

      {/* Bottleneck Selector Chips */}
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

      {/* Switch Toggle */}
      <div className="sw">
        <button
          className={fixApplied ? 'on' : ''}
          onClick={() => setFixApplied((v) => !v)}
          role="switch"
          aria-checked={fixApplied}
          aria-label="Apply hypothetical fix"
        />
        <b style={{ fontSize: '15px' }}>
          {fixApplied ? 'Hypothetical fix applied' : 'Apply hypothetical fix'}
        </b>
      </div>

      {/* Before / After Comparison */}
      <div className="cmp" style={{ marginTop: '24px' }}>
        {/* Before */}
        <div>
          <h3 style={{ marginBottom: '10px' }}>Current State (Before)</h3>
          <div style={{ border: '1px solid var(--line)', borderRadius: '16px', overflow: 'hidden', background: 'var(--glass)', padding: '12px' }}>
            <SvgMap nohit={true} />
          </div>
          <p style={{ marginTop: '10px', fontSize: '14px', color: 'var(--mute)' }}>
            ● 3 Feasible &nbsp;&nbsp; ▲ 1 Constrained &nbsp;&nbsp; ✕ 1 Infeasible &nbsp;&nbsp; ? 1 Unknown
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
              <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
                ● 5 Feasible &nbsp;&nbsp; ▲ 0 Constrained &nbsp;&nbsp; ✕ 0 Infeasible &nbsp;&nbsp; ? 1 Unknown
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
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <div className="row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}>
            <a href="#/b/bldg-203" style={{ fontWeight: 700 }}>
              bldg-203 (Old Quarter Tenement Block A)
            </a>
            <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
              Constrained ▲ → Verified Feasible ●
            </span>
          </div>
          <div className="row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}>
            <a href="#/b/bldg-204" style={{ fontWeight: 700 }}>
              bldg-204 (Prabhat Commercial Complex)
            </a>
            <span style={{ color: 'var(--ok)', fontWeight: 600 }}>
              Impassable ✕ → Verified Feasible ●
            </span>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--mute)' }}>
          Apply the hypothetical fix switch to calculate access changes.
        </p>
      )}

      {/* Disclaimer */}
      <p className="dis">
        <b>Simulation Notice:</b> This comparison projects hypothetical geometry improvements
        (e.g., removing bollards or widening to {selectedIssue?.fixW || 5.0} m). Certified
        engineering impact calculations and network-wide cascade models will be activated in
        Phase 2 alongside the path routing engine.
      </p>
    </section>
  );
};

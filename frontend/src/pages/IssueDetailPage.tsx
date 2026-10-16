import React from 'react';
import { IssueRecord } from '../types';
import { SvgMap } from '../components/SvgMap';
import { SEVERITY_NAMES, STATUS_NAMES } from '../services/store';

interface IssueDetailPageProps {
  issueId: string;
  issues: IssueRecord[];
  onUpdateStatus: (
    id: string,
    status: 'open' | 'review' | 'verified' | 'resolved'
  ) => void;
}

export const IssueDetailPage: React.FC<IssueDetailPageProps> = ({
  issueId,
  issues,
  onUpdateStatus,
}) => {
  const issue = issues.find((i) => i.id === issueId);

  if (!issue) {
    return (
      <section className="v nf">
        <h2>Issue not found</h2>
        <p className="lede">
          That issue ID isn't in the demo dataset. Check the link or open it from the Interventions list.
        </p>
        <div className="cta">
          <a className="btn pri" href="#/interventions">
            Open Interventions
          </a>
        </div>
      </section>
    );
  }

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

  const getStatusClass = (st: string) => {
    switch (st) {
      case 'resolved':
      case 'verified':
        return 'c-ok';
      case 'review':
        return 'c-constrained';
      default:
        return 'c-unknown';
    }
  };

  return (
    <section className="v">
      <p style={{ fontSize: '13px', color: 'var(--mute)', marginBottom: '4px' }}>
        <a href="#/interventions" style={{ textDecoration: 'underline' }}>
          Interventions
        </a>{' '}
        / {issue.id}
      </p>

      <h2>{issue.t}</h2>

      <div className="cta" style={{ margin: '8px 0 24px' }}>
        <b className={`pl ${getSevClass(issue.sev)}`}>
          {SEVERITY_NAMES[issue.sev]} Severity
        </b>
        <b className={`pl ${getStatusClass(issue.st)}`}>
          {STATUS_NAMES[issue.st]}
        </b>
        <b className="pl c-unknown">{issue.ver}</b>
      </div>

      <div className="split">
        {/* Left Column */}
        <div>
          <p>
            {issue.type} on <b>{issue.edge}</b>, reported {issue.age || 'recently'}.
          </p>

          {issue.photo && (
            <div style={{ margin: '14px 0' }}>
              <img
                src={issue.photo}
                alt="Hazard observation evidence"
                style={{ maxWidth: '100%', borderRadius: '12px' }}
              />
            </div>
          )}

          <h3 style={{ marginTop: '20px' }}>AI observation (unverified)</h3>
          <p style={{ color: 'var(--mute)', marginTop: '4px' }}>
            {issue.ai || 'Observation pending AI inspector analysis.'}
          </p>

          <h3 style={{ marginTop: '16px' }}>Human-verified facts</h3>
          <p style={{ color: 'var(--mute)', marginTop: '4px' }}>
            {issue.st === 'verified' || issue.st === 'resolved'
              ? issue.ver
              : 'None yet. Corridor dimensions remain unconfirmed until surveyed.'}
          </p>

          <h3 style={{ marginTop: '16px' }}>Buildings that could change</h3>
          <div style={{ marginTop: '8px' }}>
            <a
              className="row"
              style={{ gridTemplateColumns: '1fr auto', padding: '10px 8px' }}
              href="#/b/bldg-203"
            >
              <span>bldg-203</span>
              <span style={{ color: 'var(--ok)', fontWeight: 500 }}>
                Constrained to Verified Feasible (Hypothetical)
              </span>
            </a>
            <a
              className="row"
              style={{ gridTemplateColumns: '1fr auto', padding: '10px 8px' }}
              href="#/b/bldg-204"
            >
              <span>bldg-204</span>
              <span style={{ color: 'var(--ok)', fontWeight: 500 }}>
                Infeasible to Feasible (Hypothetical)
              </span>
            </a>
          </div>

          <div className="cta" style={{ marginTop: '24px' }}>
            <a className="btn pri" href={`#/simulation/${issue.id}`}>
              Simulate Impact
            </a>
            {(['review', 'verified', 'resolved'] as const)
              .filter((s) => s !== issue.st)
              .map((s) => (
                <button
                  key={s}
                  className="btn"
                  onClick={() => onUpdateStatus(issue.id, s)}
                >
                  Mark {STATUS_NAMES[s].toLowerCase()}
                </button>
              ))}
          </div>

          <p className="dis">
            Suggested next step: Dispatch a municipal survey team to verify corridor geometry,
            measure effective carriageway width, and audit overhead wire bundle heights.
          </p>
        </div>

        {/* Right Column: Map Preview */}
        <div>
          <SvgMap nohit={true} />
        </div>
      </div>
    </section>
  );
};

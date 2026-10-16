import React from 'react';
import { StatsResponse, IssueRecord } from '../types';
import { SvgMap } from '../components/SvgMap';
import { calculateIssueScore, SEVERITY_NAMES } from '../services/store';

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
  const buildingsCount = stats?.buildings.total ?? 6;
  const constraintsCount =
    (stats?.buildings.constrained ?? 1) + (stats?.buildings.infeasible ?? 1);
  const unknownCount = stats?.buildings.unknown ?? 1;
  const openIssuesCount = issues.filter(
    (i) => i.st === 'open' || i.st === 'review'
  ).length;

  const sortedIssues = [...issues]
    .filter((i) => i.st !== 'resolved')
    .sort((a, b) => calculateIssueScore(b) - calculateIssueScore(a))
    .slice(0, 5);

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
            <a className="btn pri" href="#/map">
              Explore Access Atlas
            </a>
            <a className="btn" href="#/about">
              See how it works
            </a>
          </div>
        </div>

        <a className="prev" href="#/map" aria-label="Open Access Atlas">
          <SvgMap nohit={true} />
          <span>Open Access Atlas</span>
        </a>
      </div>

      {/* KPI Numbers Grid */}
      <div className="nums">
        <div>
          <b>{buildingsCount}</b>
          <small>Buildings assessed</small>
        </div>
        <div>
          <b>{constraintsCount}</b>
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
                <b>⌖ Access Atlas</b>
                <small>Inspect roads and building access</small>
              </a>
              <a className="quicklink" href="#/routes">
                <b>↗ Route analysis</b>
                <small>Check vehicle-specific approach</small>
              </a>
              <a className="quicklink" href="#/inspector">
                <b>◈ AI Inspector</b>
                <small>Review street photos for hazards</small>
              </a>
              <a className="quicklink" href="#/interventions">
                <b>▲ Interventions</b>
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

import React, { useState } from 'react';
import { IssueRecord } from '../types';
import {
  calculateIssueScore,
  SEVERITY_NAMES,
  STATUS_NAMES,
} from '../services/store';

interface InterventionsPageProps {
  issues: IssueRecord[];
  onUpdateIssueStatus: (
    id: string,
    newStatus: 'open' | 'review' | 'verified' | 'resolved'
  ) => void;
}

export const InterventionsPage: React.FC<InterventionsPageProps> = ({
  issues,
  onUpdateIssueStatus,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const openIssues = issues.filter((i) => i.st !== 'resolved');
  const awaitingVerification = issues.filter(
    (i) => i.st === 'open' || i.st === 'review'
  );
  const resolvedIssues = issues.filter((i) => i.st === 'resolved');

  const filtered = issues
    .filter((i) => {
      if (filterSeverity !== 'all' && i.sev !== filterSeverity) return false;
      if (filterStatus !== 'all' && i.st !== filterStatus) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.t.toLowerCase().includes(q) ||
        i.type.toLowerCase().includes(q) ||
        i.edge.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => calculateIssueScore(b) - calculateIssueScore(a));

  const getSevBadge = (sev: string) => {
    switch (sev) {
      case 'high':
        return <b className="pl c-infeasible">{SEVERITY_NAMES[sev]}</b>;
      case 'med':
        return <b className="pl c-constrained">{SEVERITY_NAMES[sev]}</b>;
      default:
        return <b className="pl c-unknown">{SEVERITY_NAMES[sev]}</b>;
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'resolved':
      case 'verified':
        return <b className="pl c-ok">{STATUS_NAMES[st]}</b>;
      case 'review':
        return <b className="pl c-constrained">{STATUS_NAMES[st]}</b>;
      default:
        return <b className="pl c-unknown">{STATUS_NAMES[st]}</b>;
    }
  };

  return (
    <section className="v">
      <h2>Interventions and issues</h2>

      {/* KPI Numbers */}
      <div className="nums" style={{ margin: '24px 0' }}>
        <div>
          <b>{openIssues.length}</b>
          <small>Open issues</small>
        </div>
        <div>
          <b>{awaitingVerification.length}</b>
          <small>Awaiting verification</small>
        </div>
        <div>
          <b>{resolvedIssues.length}</b>
          <small>Resolved</small>
        </div>
        <div>
          <b>{issues.length * 2}</b>
          <small>Buildings affected</small>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        className="cta"
        style={{ margin: '0 0 16px', alignItems: 'flex-end', display: 'flex', gap: '14px', flexWrap: 'wrap' }}
      >
        <div className="fld" style={{ margin: 0, flex: 1, minWidth: '220px' }}>
          <label htmlFor="sq">Search issues</label>
          <input
            id="sq"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, hazard, or road"
          />
        </div>

        <div className="fld" style={{ margin: 0 }}>
          <label htmlFor="fv">Severity</label>
          <select
            id="fv"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
          >
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="med">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="fld" style={{ margin: 0 }}>
          <label htmlFor="fs">Status</label>
          <select
            id="fs"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="review">Under review</option>
            <option value="verified">Verified</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Issues Table */}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Priority (illustrative)</th>
              <th>Issue</th>
              <th>Location</th>
              <th>Buildings affected</th>
              <th>Verification</th>
              <th>Updated</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((issue) => (
              <tr
                key={issue.id}
                className="cl"
                onClick={(e) => {
                  if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    window.location.hash = `#/i/${issue.id}`;
                  }
                }}
              >
                <td className="sc">{calculateIssueScore(issue)}</td>
                <td>
                  <b>{issue.t}</b>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <small>{issue.type}</small>
                    {getSevBadge(issue.sev)}
                  </div>
                </td>
                <td>{issue.edge}</td>
                <td>2</td>
                <td>{issue.ver}</td>
                <td>{issue.age || 'Recent'}</td>
                <td>
                  {getStatusBadge(issue.st)}
                  <div className="cta" style={{ margin: '6px 0 0', gap: '4px' }}>
                    {(['review', 'verified', 'resolved'] as const)
                      .filter((s) => s !== issue.st)
                      .map((s) => (
                        <button
                          key={s}
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateIssueStatus(issue.id, s);
                          }}
                        >
                          {s === 'review'
                            ? 'Review'
                            : s === 'verified'
                            ? 'Verify'
                            : 'Resolve'}
                        </button>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="nf">No issues match these filters. Clear the search or choose All.</p>
      )}

      <p className="dis">
        Priority = Severity weight plus building footprints impacted. Suggested prioritization
        rules are advisory prototype algorithms and do not represent statutory emergency orders.
      </p>
    </section>
  );
};

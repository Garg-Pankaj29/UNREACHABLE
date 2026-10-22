import React, { useState, useEffect } from 'react';
import { IssueRecord } from '../types';
import {
  calculateIssueScore,
  SEVERITY_NAMES,
  STATUS_NAMES,
} from '../services/store';
import { api, WorkOrderItem } from '../services/api';

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

  // Field Audit Work Order state
  const [auditItems, setAuditItems] = useState<WorkOrderItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditVehicle, setAuditVehicle] = useState('fire');
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingAudit(true);
    api
      .fetchAuditWorkOrder(auditVehicle)
      .then((items) => {
        if (!cancelled) {
          setAuditItems(items || []);
          setLoadingAudit(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load audit work order:', err);
          setLoadingAudit(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auditVehicle]);

  const handleExportCSV = () => {
    if (!auditItems || auditItems.length === 0) return;
    const headers = [
      'Priority',
      'Road ID',
      'Corridor Name',
      'Ground Truth Deficiency / Reason',
      'Buildings Dependent',
      'Data Source',
    ];
    const rows = auditItems.map((item, idx) => [
      idx + 1,
      `"${item.road_id.replace(/"/g, '""')}"`,
      `"${item.name.replace(/"/g, '""')}"`,
      `"${item.reason.replace(/"/g, '""')}"`,
      item.buildings_affected,
      `"${(item.data_source || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `emergency_access_audit_work_order_${auditVehicle}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const openIssues = issues.filter((i) => i.st !== 'resolved');
  const awaitingVerification = issues.filter(
    (i) => i.st === 'open' || i.st === 'review'
  );
  const resolvedIssues = issues.filter((i) => i.st !== 'resolved');

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

  if (printMode) {
    return (
      <section
        className="v"
        style={{
          background: '#ffffff',
          color: '#111827',
          padding: '24px',
          borderRadius: '8px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            borderBottom: '2px solid #111827',
            paddingBottom: '12px',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#111827' }}>
              EMERGENCY ACCESS FIELD AUDIT WORK ORDER
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#4b5563' }}>
              Jurisdiction: Chandigarh University & Gharuan Sector (Synthetic Cadastre) &bull; Vehicle Profile:{' '}
              <b>{auditVehicle.toUpperCase()}</b> &bull; Priority Queue
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn pri" onClick={() => window.print()}>
              Print document
            </button>
            <button className="btn" onClick={handleExportCSV}>
              Export audit list (CSV)
            </button>
            <button className="btn" onClick={() => setPrintMode(false)}>
              Exit print view
            </button>
          </div>
        </div>

        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 16px' }}>
          Field survey assignment: Measure Usable Corridor Width and Overhead
          Clearances for ranked unmeasured / unverified road corridors.
        </p>

        <div
          className="tw"
          style={{ border: '1px solid #d1d5db', marginBottom: '20px' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  background: '#f3f4f6',
                  textAlign: 'left',
                  borderBottom: '2px solid #9ca3af',
                }}
              >
                <th style={{ padding: '8px' }}>#</th>
                <th style={{ padding: '8px' }}>Road Segment</th>
                <th style={{ padding: '8px' }}>Audit Reason / Cadastral Gap</th>
                <th style={{ padding: '8px' }}>Buildings Dependent</th>
                <th style={{ padding: '8px' }}>Data Source</th>
                <th style={{ padding: '8px', minWidth: '180px' }}>
                  Surveyor Verification
                </th>
              </tr>
            </thead>
            <tbody>
              {auditItems.map((item, idx) => (
                <tr
                  key={item.road_id}
                  style={{ borderBottom: '1px solid #e5e7eb' }}
                >
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>
                    {idx + 1}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <b>{item.name}</b>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>
                      ID: {item.road_id}
                    </div>
                  </td>
                  <td style={{ padding: '8px', fontSize: '13px' }}>
                    {item.reason}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontWeight: 'bold',
                      textAlign: 'center',
                    }}
                  >
                    {item.buildings_affected}
                  </td>
                  <td
                    style={{
                      padding: '8px',
                      fontSize: '12px',
                      color: '#4b5563',
                    }}
                  >
                    {item.data_source || 'Synthetic Cadastre'}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px' }}>
                    <div>[ &nbsp; ] Pass &nbsp; [ &nbsp; ] Fail</div>
                    <div style={{ marginTop: '4px' }}>Width: ________m</div>
                    <div style={{ marginTop: '4px' }}>
                      Sign: ________________
                    </div>
                  </td>
                </tr>
              ))}
              {auditItems.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ padding: '16px', textAlign: 'center' }}
                  >
                    {loadingAudit
                      ? 'Generating audit work order...'
                      : 'No unknown or unverified road corridors found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p
          className="dis"
          style={{ color: '#6b7280', fontSize: '11px', marginTop: '16px' }}
        >
          PROTOTYPE DEMONSTRATION WORK ORDER. Generated deterministically from
          synthetic municipal test data.
        </p>
      </section>
    );
  }

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

      {/* Field Audit Action List (Turning Unknown into Action) */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '8px',
          padding: '16px',
          margin: '0 0 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>
              Field audit work order (Actionable "Unknowns")
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13px',
                color: 'var(--c-muted, #94a3b8)',
              }}
            >
              Deterministic ranking of unknown and unverified corridors by
              dependent building counts. Unknown is turned into a prioritized field
              survey queue.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div className="fld" style={{ margin: 0 }}>
              <select
                id="audit-veh"
                value={auditVehicle}
                onChange={(e) => setAuditVehicle(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '13px' }}
              >
                <option value="fire">Fire Engine (&ge;3.5m)</option>
                <option value="amb">Ambulance (&ge;3.0m)</option>
                <option value="rapid">Rapid Response (&ge;2.4m)</option>
              </select>
            </div>
            <button
              className="btn pri"
              onClick={handleExportCSV}
              title="Download CSV work order"
            >
              Export audit list (CSV)
            </button>
            <button
              className="btn"
              onClick={() => setPrintMode(true)}
              title="Open print-friendly checklist"
            >
              Print-friendly view
            </button>
          </div>
        </div>

        {loadingAudit ? (
          <p className="nf" style={{ margin: '16px 0 0' }}>
            Evaluating corridor dependency rankings...
          </p>
        ) : (
          <div className="tw" style={{ margin: '16px 0 0' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Rank</th>
                  <th>Corridor</th>
                  <th>Audit reason / Cadastral gap</th>
                  <th style={{ textAlign: 'center' }}>Buildings dependent</th>
                  <th>Data source</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {auditItems.map((item, idx) => (
                  <tr key={item.road_id}>
                    <td className="sc" style={{ fontSize: '15px' }}>#{idx + 1}</td>
                    <td style={{ fontSize: '15px' }}>
                      <b>{item.name}</b>
                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--c-muted, #94a3b8)',
                        }}
                      >
                        {item.road_id}
                      </div>
                    </td>
                    <td style={{ fontSize: '14px', lineHeight: 1.5 }}>{item.reason}</td>
                    <td style={{ textAlign: 'center' }}>
                      <b className="pl c-constrained" style={{ fontSize: '14px' }}>
                        {item.buildings_affected}
                      </b>
                    </td>
                    <td
                      style={{
                        fontSize: '13px',
                        color: 'var(--c-muted, #94a3b8)',
                      }}
                    >
                      {item.data_source || 'Synthetic Cadastre'}
                    </td>
                    <td>
                      <span
                        className="pl c-unknown"
                        style={{ fontSize: '13px' }}
                      >
                        Survey Required
                      </span>
                    </td>
                  </tr>
                ))}
                {auditItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="nf">
                      No corridors requiring audit under current apparatus profile.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
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

import React from 'react';

interface MethodologyStep {
  step: string;
  title: string;
  badge: string;
  description: string;
  detail: string;
  iconSvg: React.ReactNode;
}

const METHODOLOGY_STEPS: MethodologyStep[] = [
  {
    step: '01',
    title: 'Collect Evidence',
    badge: 'Multi-Source Fusion',
    description: 'Compile road network centerlines, cadastral parcels, and physical passage widths.',
    detail: 'Aggregates municipal hazard feeds, open spatial datasets, and emergency access constraints into unified geometric networks.',
    iconSvg: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    step: '02',
    title: 'Inspect & Vision Audit',
    badge: 'AI Vision Pipeline',
    description: 'Parse street-level imagery into structured physical observations.',
    detail: 'Detects overhead cable sag, illegal parking, construction bollards, and dynamic encroachments for surveyor verification.',
    iconSvg: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    step: '03',
    title: 'Analyse Access Envelopes',
    badge: 'Clearance Testing',
    description: 'Test emergency vehicle width and height profiles against corridors.',
    detail: 'Evaluates fire engines, standard ambulances, and quick-response bikes against segment limits to identify access breaks.',
    iconSvg: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    ),
  },
  {
    step: '04',
    title: 'Prioritize Interventions',
    badge: 'Impact Scoring',
    description: 'Rank physical infrastructure fixes by total population and footprints unlocked.',
    detail: 'Focuses limited municipal capital on bottleneck nodes that yield the highest immediate safety benefit.',
    iconSvg: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];

export const AboutPage: React.FC = () => {
  return (
    <section className="v about-container" style={{ maxWidth: '1240px', margin: '0 auto', paddingBottom: '110px' }}>
      {/* Header Banner */}
      <div className="about-header" style={{ marginBottom: '44px', textAlign: 'left' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 12px', borderRadius: '99px', background: 'var(--glass)', border: '1px solid var(--line)', marginBottom: '16px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--tape)' }} />
          Decision-Support Architecture & Technical Methodology
        </div>
        
        <h2 style={{ fontSize: 'clamp(32px, 4.2vw, 48px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15, margin: '0 0 16px 0' }}>
          About & Methodology
        </h2>

        <p className="lede" style={{ fontSize: '19px', lineHeight: 1.6, maxWidth: '85ch', margin: '0 0 20px 0', color: 'var(--mute)' }}>
          <strong style={{ color: 'var(--ink)' }}>Distance is not the same as access.</strong> UNREACHABLE combines verified municipal road geometry, standardized emergency vehicle clearance profiles, citizen hazard reports, and AI-assisted street imagery analysis to uncover inaccessible pockets <em style={{ fontStyle: 'normal', color: 'var(--ink)' }}>before</em> a crisis occurs.
        </p>

        <div style={{ height: '4px', width: '72px', background: 'var(--tape)', borderRadius: '2px' }} />
      </div>

      {/* Methodology Pipeline Section */}
      <div style={{ marginBottom: '56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
          <div>
            <h3 style={{ fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
              Four-Stage Analytical Pipeline
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--mute)' }}>
              From raw geometric records to prioritized municipal interventions
            </p>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--mute)' }}>
            Deterministic + Vision Audited
          </span>
        </div>

        {/* 4 Cards Grid - Symmetric, balanced, clean typography */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '20px',
          }}
        >
          {METHODOLOGY_STEPS.map((s) => (
            <div
              key={s.step}
              style={{
                background: 'var(--glass)',
                border: '1.5px solid var(--line)',
                borderRadius: '16px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <span
                  style={{
                    fontSize: '32px',
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                    color: 'var(--ink)',
                    opacity: 0.9,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.step}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: 'rgba(255, 214, 10, 0.14)',
                    color: 'var(--ink)',
                    border: '1px solid rgba(255, 214, 10, 0.4)',
                  }}
                >
                  {s.badge}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={{ display: 'flex', alignItems: 'center', color: 'var(--ink)' }}>{s.iconSvg}</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>
                  {s.title}
                </h4>
              </div>

              <p style={{ margin: '0 0 12px 0', fontSize: '14px', lineHeight: 1.55, fontWeight: 500, color: 'var(--ink)' }}>
                {s.description}
              </p>

              <p style={{ margin: 'auto 0 0 0', fontSize: '13px', lineHeight: 1.5, color: 'var(--mute)', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                {s.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Principles & Technical Foundations - 3 Balanced Cards */}
      <div style={{ marginBottom: '56px' }}>
        <h3 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 20px 0', letterSpacing: '-0.01em' }}>
          Data Trust & Operational Framework
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '24px',
          }}
        >
          {/* Card 1: Data Confidence States */}
          <div
            style={{
              background: 'var(--glass)',
              border: '1.5px solid var(--line)',
              borderRadius: '16px',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--unk)' }} />
              <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                Three States of Information
              </h4>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.6, color: 'var(--mute)' }}>
              Emergency management requires absolute honesty about confidence levels. We distinguish between three distinct evidentiary tiers:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(125, 131, 122, 0.1)', borderLeft: '3px solid var(--unk)' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>Unknown: </span>
                <span style={{ fontSize: '13px', color: 'var(--mute)' }}>No official record. Never assumed safe; triggers high-priority ground inspection.</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(232, 113, 10, 0.1)', borderLeft: '3px solid var(--amb)' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>AI-Observed: </span>
                <span style={{ fontSize: '13px', color: 'var(--mute)' }}>Computer vision detected physical obstruction awaiting field sign-off.</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(22, 138, 92, 0.1)', borderLeft: '3px solid var(--ok)' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>Verified: </span>
                <span style={{ fontSize: '13px', color: 'var(--mute)' }}>Surveyor or municipal official certified physical roadway clearance.</span>
              </div>
            </div>
          </div>

          {/* Card 2: Shared Bottlenecks */}
          <div
            style={{
              background: 'var(--glass)',
              border: '1.5px solid var(--line)',
              borderRadius: '16px',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--amb)' }} />
              <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                Shared Network Bottlenecks
              </h4>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.6, color: 'var(--mute)' }}>
              A single choked arterial corridor, commercial unloading vehicle, or sagging optical fiber bundle can sever emergency ingress for dozens of interior residential buildings.
            </p>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255, 214, 10, 0.08)', border: '1px solid rgba(255, 214, 10, 0.3)', marginTop: 'auto' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                Network Graph Propagation
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--mute)' }}>
                UNREACHABLE models topological dependencies so civil engineers can fix the single high-leverage road link that restores safety to the largest volume of residents.
              </div>
            </div>
          </div>

          {/* Card 3: Design Philosophy & Limits */}
          <div
            style={{
              background: 'var(--glass)',
              border: '1.5px solid var(--line)',
              borderRadius: '16px',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--sig)' }} />
              <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                System Limits & Human Governance
              </h4>
            </div>

            <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: 1.6, color: 'var(--mute)' }}>
              Calibrated for dense Indian urban topologies. Dynamic travel delays and telematics are strictly separated until ground validations finish.
            </p>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(215, 38, 61, 0.08)', border: '1px solid rgba(215, 38, 61, 0.25)', marginTop: 'auto' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
                Civil Authority Support
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--mute)' }}>
                UNREACHABLE provides advisory decision intelligence for planners, fire chiefs, and engineers. It never automates dispatch or overrides incident commanders.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Envelopes Reference Table */}
      <div style={{ marginBottom: '56px', background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '16px', padding: '28px', backdropFilter: 'blur(12px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>
              Calibrated Vehicle Clearance Profiles
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--mute)' }}>
              Standard operational clearance thresholds tested against street geometries
            </p>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--mute)' }}>
            Benchmark: Dense Urban Context
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid var(--line)', color: 'var(--mute)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '10px 12px' }}>Vehicle Class</th>
                <th style={{ padding: '10px 12px' }}>Min. Width Required</th>
                <th style={{ padding: '10px 12px' }}>Min. Height Required</th>
                <th style={{ padding: '10px 12px' }}>Typical Emergency Role</th>
                <th style={{ padding: '10px 12px' }}>Vulnerability</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '12px', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="1" y="3" width="15" height="13" />
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                    Heavy Fire Tender
                  </div>
                </td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>3.20 m</td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>3.80 m</td>
                <td style={{ padding: '12px', color: 'var(--mute)' }}>Structural fire containment, heavy rescue</td>
                <td style={{ padding: '12px' }}><span style={{ color: 'var(--sig)', fontWeight: 600 }}>High</span> (tight alleys, parked cars)</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '12px', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="1" y="4" width="22" height="16" rx="2" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                    </svg>
                    ALS Ambulance
                  </div>
                </td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>2.40 m</td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>2.60 m</td>
                <td style={{ padding: '12px', color: 'var(--mute)' }}>Critical medical evacuation, life support</td>
                <td style={{ padding: '12px' }}><span style={{ color: 'var(--amb)', fontWeight: 600 }}>Medium</span> (encroachments, low cables)</td>
              </tr>
              <tr>
                <td style={{ padding: '12px', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="5.5" cy="17.5" r="3.5" />
                      <circle cx="18.5" cy="17.5" r="3.5" />
                      <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h4" />
                    </svg>
                    Rapid First Responder Bike
                  </div>
                </td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>1.20 m</td>
                <td style={{ padding: '12px', fontVariantNumeric: 'tabular-nums' }}>1.80 m</td>
                <td style={{ padding: '12px', color: 'var(--mute)' }}>First triage, paramedic stabilization</td>
                <td style={{ padding: '12px' }}><span style={{ color: 'var(--ok)', fontWeight: 600 }}>Low</span> (penetrable through informal lanes)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Navigation CTA Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', padding: '20px 24px', background: 'var(--glass)', border: '1.5px solid var(--line)', borderRadius: '14px', marginBottom: '32px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ink)' }}>
            Ready to explore verified accessibility maps?
          </div>
          <div style={{ fontSize: '13px', color: 'var(--mute)' }}>
            Inspect city corridors, simulate routes, and view recommended physical interventions.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <a className="btn pri" href="#/">
            Back to Overview
          </a>
          <a className="btn" href="#/map" style={{ background: 'transparent' }}>
            Open Access Atlas →
          </a>
        </div>
      </div>

      {/* Statutory Disclaimer */}
      <p className="dis" style={{ maxWidth: '100%', margin: 0 }}>
        <strong>Statutory Notice:</strong> Decision-support prototype for urban emergency preparedness and municipal planning. This system is not a replacement for statutory emergency dispatch (112 / Fire / EMS) or statutory building compliance inspections.
      </p>
    </section>
  );
};

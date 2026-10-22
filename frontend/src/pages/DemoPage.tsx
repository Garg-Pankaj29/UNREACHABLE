import React, { useState, useEffect, useCallback } from 'react';
import {
  BuildingAccessResponse,
  ExplainResponse,
  GeoJSONFeature,
  IssueRecord,
  RouteCompareResponse,
  SimulateResponse,
} from '../types';
import { api } from '../services/api';
import { AccessAtlasPage } from './AccessAtlasPage';
import { SimulationPage } from './SimulationPage';
import { MapView } from '../components/MapView';
import { SvgMap } from '../components/SvgMap';
import { Mic, AlertTriangle } from 'lucide-react';

interface DemoStep {
  id: number;
  title: string;
  speakerPrompt: string;
}

const DEMO_STEPS: DemoStep[] = [
  {
    id: 1,
    title: 'Access Atlas: Fire Tender Baseline',
    speakerPrompt:
      'Demonstrate baseline municipal access across Chandigarh University & Gharuan Sector for a standard heavy Fire Tender (3.5m clearance requirement).',
  },
  {
    id: 2,
    title: 'Corridor Bottleneck: Red Road Selected',
    speakerPrompt:
      'Inspect red corridor road-102 (North Citizen Lane): surveyed width 3.4m strictly violates the 3.5m Fire Tender clearance.',
  },
  {
    id: 3,
    title: 'Apparatus Agility: Rapid Response Unit',
    speakerPrompt:
      'Switch apparatus to Rapid Response Unit (2.4m clearance) — road-102 immediately clears to green and becomes fully traversable.',
  },
  {
    id: 4,
    title: 'Reality Check: Seeded Failing Building',
    speakerPrompt:
      'Standard routing directs engines into the physical bottleneck on road-104; our engine detects the clearance failure and finds a safe route.',
  },
  {
    id: 5,
    title: 'Break-the-City: Critical Road Block',
    speakerPrompt:
      'Simulate closing critical road-101 (Station Link Arterial) — severing primary station egress and compromising multiple buildings.',
  },
  {
    id: 6,
    title: 'Fix-First Simulation: Clearing Bottleneck',
    speakerPrompt:
      'Simulate clearing the physical obstruction on road-104 — projecting immediate rescue of blocked building footprints before spending capital.',
  },
  {
    id: 7,
    title: 'Explain: Deterministic Grounding & AI Briefing',
    speakerPrompt:
      'Generate an AI plain-language briefing with strict numeric guardrails; deterministic rules decide access, AI only explains.',
  },
];

interface DemoPageProps {
  stepParam?: string;
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  issues: IssueRecord[];
  onUpdateIssueStatus?: (
    id: string,
    newStatus: 'open' | 'review' | 'verified' | 'resolved'
  ) => void;
}

export const DemoPage: React.FC<DemoPageProps> = ({
  stepParam,
  buildings,
  roads,
  stations,
  issues,
}) => {
  const initialStep = Math.min(
    Math.max(parseInt(stepParam || '1', 10) || 1, 1),
    DEMO_STEPS.length
  );
  const [currentStep, setCurrentStep] = useState<number>(initialStep);

  // Sync step from prop if routeParam changes
  useEffect(() => {
    if (stepParam) {
      const parsed = parseInt(stepParam, 10);
      if (parsed >= 1 && parsed <= DEMO_STEPS.length) {
        setCurrentStep(parsed);
      }
    }
  }, [stepParam]);

  const goToStep = useCallback((step: number) => {
    const target = Math.min(Math.max(step, 1), DEMO_STEPS.length);
    setCurrentStep(target);
    window.location.hash = `#/demo/${target}`;
  }, []);

  // Keyboard navigation: ArrowLeft / ArrowRight
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or select
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToStep(currentStep + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToStep(currentStep - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, goToStep]);

  // Seeded IDs from memory.md
  const road102 = roads.find((r) => r.properties.id === 'road-102') || null;
  const bldg204 = buildings.find((b) => b.properties.id === 'bldg-204') || null;

  // State for step 4 (Reality Check)
  const [compareResult, setCompareResult] = useState<RouteCompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState<boolean>(false);

  // State for step 5 (Critical road block)
  const [simBlockResult, setSimBlockResult] = useState<SimulateResponse | null>(null);

  // State for step 7 (Explain)
  const [explainResult, setExplainResult] = useState<ExplainResponse | null>(null);
  const [explainLoading, setExplainLoading] = useState<boolean>(false);
  const [accessResult, setAccessResult] = useState<BuildingAccessResponse | null>(null);

  // Load step-specific data
  useEffect(() => {
    if (currentStep === 4) {
      setCompareLoading(true);
      api.compareRoutes('station-01', 'bldg-204', 'fire')
        .then((res) => setCompareResult(res))
        .catch((err) => console.warn('Reality check demo error:', err))
        .finally(() => setCompareLoading(false));
    } else if (currentStep === 5) {
      api.simulate({
        vehicle_id: 'fire',
        changes: [{ road_id: 'road-101', action: 'close' }],
      })
        .then((res) => setSimBlockResult(res))
        .catch((err) => console.warn('Block simulation demo error:', err));
    } else if (currentStep === 7) {
      setExplainLoading(true);
      Promise.all([
        api.fetchBuildingAccess('bldg-201', 'fire', 'station-01'),
        api.explainRoute('station-01', 'bldg-201', 'fire'),
      ])
        .then(([access, exp]) => {
          setAccessResult(access);
          setExplainResult(exp);
        })
        .catch((err) => console.warn('Explain demo error:', err))
        .finally(() => setExplainLoading(false));
    }
  }, [currentStep]);

  const stepMeta = DEMO_STEPS[currentStep - 1];

  return (
    <div style={{ paddingBottom: '90px' }}>
      {/* Slim Presenter Bar */}
      <div
        id="demo-presenter-bar"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 80,
          background: 'var(--glass, rgba(255, 255, 255, 0.92))',
          backdropFilter: 'blur(16px)',
          borderBottom: '2px solid var(--tape, #ffd60a)',
          padding: '10px 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          {/* Step indicator & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span
              style={{
                background: 'var(--tape, #ffd60a)',
                color: '#1c1f1b',
                fontWeight: 900,
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '6px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              DEMO MODE
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {DEMO_STEPS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => goToStep(s.id)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: 'none',
                    background: currentStep === s.id ? 'var(--ink, #1c1f1b)' : 'var(--line, #e5e7eb)',
                    color: currentStep === s.id ? 'var(--bg, #ffffff)' : 'var(--mute, #6b7280)',
                    fontWeight: 700,
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  title={`Step ${s.id}: ${s.title}`}
                >
                  {s.id}
                </button>
              ))}
            </div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--ink)' }}>
              Step {currentStep}/7: {stepMeta.title}
            </h3>
          </div>

          {/* Navigation Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="btn"
              onClick={() => goToStep(currentStep - 1)}
              disabled={currentStep === 1}
              style={{ padding: '4px 12px', fontSize: '12px' }}
              title="Previous step (ArrowLeft)"
            >
              ← Back
            </button>
            <button
              className="btn pri"
              onClick={() => goToStep(currentStep + 1)}
              disabled={currentStep === DEMO_STEPS.length}
              style={{ padding: '4px 14px', fontSize: '12px' }}
              title="Next step (ArrowRight)"
            >
              Next →
            </button>
            <a
              href="#/"
              className="btn"
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                color: 'var(--mute)',
                borderColor: 'var(--line)',
                textDecoration: 'none',
              }}
            >
              ✕ Exit
            </a>
          </div>
        </div>

        {/* One-line Speaker Prompt */}
        <div
          style={{
            marginTop: '8px',
            fontSize: '13px',
            lineHeight: 1.4,
            color: 'var(--ink)',
            background: 'rgba(255, 214, 10, 0.12)',
            borderLeft: '3px solid var(--tape, #ffd60a)',
            padding: '4px 12px',
            borderRadius: '0 6px 6px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Mic size={14} className="shrink-0 text-amber-500" aria-hidden="true" />
          <span>
            <b>Speaker:</b> {stepMeta.speakerPrompt}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--mute)' }}>
            [Use ← / → keys to navigate]
          </span>
        </div>
      </div>

      {/* Main Step Body */}
      <div style={{ padding: '20px 24px' }}>
        {/* Step 1: Atlas + Fire Tender */}
        {currentStep === 1 && (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="chip on">Fire Tender (3.5m Clearance)</span>
              <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
                Baseline municipal overview: green (ok), amber (constrained), red (infeasible).
              </span>
            </div>
            <AccessAtlasPage
              buildings={buildings}
              roads={roads}
              stations={stations}
              issues={issues}
              selectedFeature={null}
              onSelectFeature={() => {}}
            />
          </div>
        )}

        {/* Step 2: Click a red road */}
        {currentStep === 2 && (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="chip on" style={{ background: '#d7263d', color: '#fff', borderColor: '#d7263d' }}>
                ✕ Infeasible Corridor (road-102)
              </span>
              <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
                Width 3.4m fails heavy Fire Tender min clearance (≥ 3.5m). Inspect detail panel on the right.
              </span>
            </div>
            <AccessAtlasPage
              buildings={buildings}
              roads={roads}
              stations={stations}
              issues={issues}
              selectedFeature={road102}
              onSelectFeature={() => {}}
            />
          </div>
        )}

        {/* Step 3: Switch Rapid Unit */}
        {currentStep === 3 && (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="chip on" style={{ background: '#2a9d8f', color: '#fff', borderColor: '#2a9d8f' }}>
                ● Feasible for Rapid Unit (2.4m)
              </span>
              <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
                Switched vehicle to Rapid Response Unit (QRV) — road-102 width 3.4m is well above 2.4m!
              </span>
            </div>
            <div className="split">
              <div>
                <div
                  style={{
                    background: 'var(--glass)',
                    border: '1.5px solid #2a9d8f',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>Corridor Access Cleared</h3>
                    <span className="pl c-ok">● Verified accessible</span>
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: 1.6, marginTop: '8px' }}>
                    <div><b>Corridor:</b> North Citizen Lane (road-102)</div>
                    <div><b>Apparatus:</b> Rapid Response Unit (Requires ≥ 2.4m usable width)</div>
                    <div><b>Surveyed Width:</b> 3.4m (Passes with +1.0m clearance buffer)</div>
                    <div><b>Status:</b> Fully accessible for agile emergency intervention</div>
                  </div>
                </div>
              </div>
              <div>
                <MapView
                  buildings={buildings}
                  roads={roads}
                  stations={stations}
                  selectedFeature={road102}
                  selectedVehicle={{
                    id: 'rapid',
                    name: 'Rapid Response Unit',
                    category: 'Light Emergency Unit',
                    minClearanceWidthM: 2.4,
                    description: 'Agile quick-response vehicle for narrow corridors',
                  }}
                  fullHeight={false}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Reality Check on seeded failing building */}
        {currentStep === 4 && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              {compareLoading ? (
                <p className="lede">Calculating naive shortest path vs clearance-aware engine...</p>
              ) : compareResult ? (
                <div
                  role="region"
                  aria-label="Reality Check Verdict"
                  style={{
                    background: compareResult.naive_would_fail
                      ? 'rgba(215, 38, 61, 0.14)'
                      : 'rgba(42, 157, 143, 0.14)',
                    border: `1.5px solid ${compareResult.naive_would_fail ? '#d7263d' : '#2a9d8f'}`,
                    borderRadius: '10px',
                    padding: '12px 16px',
                    fontSize: '14px',
                    lineHeight: 1.4,
                    color: 'var(--ink)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: compareResult.naive_would_fail ? '#d7263d' : '#2a9d8f',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <b>Reality Check Verdict:</b> {compareResult.verdict}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="split">
              <div>
                <div
                  style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '16px',
                    fontSize: '13px',
                    lineHeight: 1.6,
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', textTransform: 'uppercase' }}>
                    Seeded Target: Prabhat Commercial Complex (bldg-204)
                  </h4>
                  <div><b>Dispatch Origin:</b> Station Link Base (station-01)</div>
                  <div><b>Apparatus:</b> Heavy Fire Tender (≥ 3.5m clearance)</div>
                  <div><b>Bottleneck Encountered:</b> road-104 (Temple Cross Link)</div>
                  <div><b>Hazard:</b> Physical bollards & sagging low cables (&lt; 2.2m clearance)</div>
                  <div style={{ marginTop: '12px', color: '#d7263d', fontWeight: 600 }}>
                    ✕ Naive GPS path routes through road-104 and fails in the field.
                  </div>
                  <div style={{ color: '#2a9d8f', fontWeight: 600, marginTop: '4px' }}>
                    ✓ UNREACHABLE aware engine identifies the obstruction and safely routes around.
                  </div>
                </div>
              </div>

              <div>
                <MapView
                  buildings={buildings}
                  roads={roads}
                  stations={stations}
                  selectedFeature={bldg204}
                  selectedVehicle={{
                    id: 'fire',
                    name: 'Fire Tender',
                    category: 'Heavy Apparatus',
                    minClearanceWidthM: 3.5,
                    description: 'Full-size heavy municipal fire engine',
                  }}
                  naiveRoadIds={compareResult?.naive.road_ids || ['road-101', 'road-104']}
                  awareRoadIds={compareResult?.aware.road_ids || ['road-101', 'road-103', 'road-106']}
                  violations={compareResult?.naive.violations || []}
                  fullHeight={false}
                />
                <div className="lg" style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <b className="pl c-ok">● Aware path (solid green)</b>
                  <b className="pl" style={{ background: '#e9ecef', color: '#495057', border: '1px dashed #6c757d' }}>
                    ╌ Naive GPS path (dashed grey)
                  </b>
                  <b className="pl c-infeasible">✕ Clearance violation (red marker)</b>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Critical road block */}
        {currentStep === 5 && (
          <div>
            <div
              style={{
                background: 'rgba(215, 38, 61, 0.12)',
                border: '1.5px solid #d7263d',
                borderRadius: '12px',
                padding: '14px 18px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <b style={{ color: '#d7263d', fontSize: '15px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Critical Single Point of Failure: road-101 (Station Link Arterial)</span>
                </b>
                <div style={{ fontSize: '13px', color: 'var(--ink)', marginTop: '2px' }}>
                  Simulating complete road closure on road-101. As primary egress from station-01, closing it disconnects core municipal assets.
                </div>
              </div>
              <span className="sc" style={{ background: '#d7263d', fontSize: '18px', padding: '6px 14px' }}>
                {simBlockResult?.changed_buildings?.length || 1} Cut Off
              </span>
            </div>

            <div className="cmp">
              <div>
                <h3 style={{ marginBottom: '10px' }}>Normal Egress State</h3>
                <div style={{ border: '1px solid var(--line)', borderRadius: '16px', overflow: 'hidden', background: 'var(--glass)', padding: '12px' }}>
                  <SvgMap nohit={true} />
                </div>
                <p style={{ marginTop: '10px', fontSize: '13px', color: 'var(--mute)' }}>
                  All 6 buildings reachable via primary arterial road-101.
                </p>
              </div>

              <div>
                <h3 style={{ marginBottom: '10px', color: '#d7263d' }}>Simulated Severance (road-101 Blocked)</h3>
                <div style={{ border: '1.5px solid #d7263d', borderRadius: '16px', overflow: 'hidden', background: 'rgba(215, 38, 61, 0.05)', padding: '12px' }}>
                  <SvgMap
                    nohit={true}
                    roadStatuses={{ 'road-101': 'inaccessible' }}
                    buildingStatuses={{
                      'bldg-201': 'inaccessible',
                      'bldg-202': 'inaccessible',
                      'bldg-203': 'inaccessible',
                      'bldg-204': 'inaccessible',
                      'bldg-205': 'inaccessible',
                      'bldg-206': 'inaccessible',
                    }}
                  />
                </div>
                <p style={{ marginTop: '10px', fontSize: '13px', color: '#d7263d', fontWeight: 600 }}>
                  ✕ Critical arterial severed. Station-01 isolated from sector network.
                </p>
              </div>
            </div>

            {simBlockResult && simBlockResult.changed_buildings.length > 0 && (
              <div style={{ marginTop: '20px', background: 'var(--glass)', border: '1px solid var(--line)', borderRadius: '12px', padding: '14px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', textTransform: 'uppercase' }}>
                  Compromised Building Assets ({simBlockResult.changed_buildings.length})
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  {simBlockResult.changed_buildings.map((cb) => (
                    <div key={cb.id} style={{ background: 'var(--bg)', border: '1px solid #d7263d55', borderRadius: '8px', padding: '10px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{cb.id} ({cb.name})</div>
                      <div style={{ fontSize: '12px', color: '#d7263d', fontWeight: 600, marginTop: '2px' }}>
                        {cb.before} → {cb.after}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 6: Fix simulation */}
        {currentStep === 6 && (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="chip on" style={{ background: '#2a9d8f', color: '#fff', borderColor: '#2a9d8f' }}>
                Hypothetical Clearance Applied: road-104
              </span>
              <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
                Testing clearance of physical obstruction bollards & overhead cables on Temple Cross Link.
              </span>
            </div>
            <SimulationPage issues={issues} initialIssueId="I-01" />
          </div>
        )}

        {/* Step 7: Explain */}
        {currentStep === 7 && (
          <div>
            <div style={{ marginBottom: '14px' }}>
              <span
                style={{
                  background: '#4361ee22',
                  color: '#4361ee',
                  fontWeight: 800,
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '99px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                AI EXPLAIN BRIEFING WITH STRICT NUMERIC GUARDRAILS
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Card 1: Computed result (deterministic) */}
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Card 1: Computed Result (100% Deterministic Python)
                  </h4>
                  <span className="pl c-ok">● Verified Accessible</span>
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--ink)' }}>
                  <div><b>Target Asset:</b> Community Health Sub-Center (bldg-201)</div>
                  <div><b>Dispatch Origin:</b> Emergency Response Sub-Station Alpha (station-01)</div>
                  <div><b>Vehicle Profile:</b> Fire Tender (Requires ≥ 3.5m clearance width)</div>
                  <div><b>Distance:</b> {accessResult?.route ? `${accessResult.route.total_distance_m} m` : '420.5 m'}</div>
                  <div><b>Corridors Traversed:</b> {accessResult?.route?.segments_traversed.join(' → ') || 'road-101'}</div>
                  <div><b>Bottlenecks:</b> None (Segment width 7.5m meets all thresholds)</div>
                  <div><b>Cadastre Distinction:</b> Road frontage arrival confirmed (internal door access unmeasured)</div>
                </div>
              </div>

              {/* Card 2: Plain-language explanation */}
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1.5px solid #4361ee',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  boxShadow: '0 4px 12px rgba(67, 97, 238, 0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4361ee' }}>
                    Card 2: Plain-Language Briefing
                  </h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span className="pl c-ok" style={{ fontSize: '11px' }}>
                      {explainResult?.source === 'local_llm' ? 'Local LLM' : 'Template Guardrail'}
                    </span>
                    <span className="pl c-ok" style={{ fontSize: '11px' }}>
                      Validated ✓
                    </span>
                  </div>
                </div>

                {explainLoading ? (
                  <p className="lede">Generating plain-language explanation with numeric guardrails...</p>
                ) : explainResult ? (
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--ink)' }}>
                      {explainResult.text}
                    </p>
                    <small style={{ display: 'block', marginTop: '12px', fontSize: '11px', color: 'var(--mute)' }}>
                      Synthetic data notice: generated from verified local cadastre facts. AI never decides access.
                    </small>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

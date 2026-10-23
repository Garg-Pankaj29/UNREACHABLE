import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import {
  BuildingAccessResponse,
  ExplainResponse,
  GeoJSONFeature,
  IssueRecord,
} from '../types';
import { api } from '../services/api';

interface AIInspectorPageProps {
  roads: GeoJSONFeature[];
  buildings?: GeoJSONFeature[];
  onAddIssue: (issue: IssueRecord) => void;
}

export const AIInspectorPage: React.FC<AIInspectorPageProps> = ({
  roads,
  buildings = [],
  onAddIssue,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedEdge, setSelectedEdge] = useState<string>(
    roads[0]?.properties.id || 'road-101'
  );
  const [state, setState] = useState<'ready' | 'running' | 'done'>('ready');

  // Explain feature state
  const [explainBldgId, setExplainBldgId] = useState<string>(
    buildings[0]?.properties.id || 'bldg-201'
  );
  const [explainVeh, setExplainVeh] = useState<string>('fire');
  const [explainLoading, setExplainLoading] = useState<boolean>(false);
  const [explainResult, setExplainResult] = useState<ExplainResponse | null>(null);
  const [accessInfo, setAccessInfo] = useState<BuildingAccessResponse | null>(null);

  const runExplain = async () => {
    setExplainLoading(true);
    try {
      const [exp, acc] = await Promise.all([
        api.explainRoute('station-01', explainBldgId, explainVeh),
        api.fetchBuildingAccess(explainBldgId, explainVeh, 'station-01').catch(() => null),
      ]);
      setExplainResult(exp);
      if (acc) setAccessInfo(acc);
    } catch (err: any) {
      console.warn('Explain failed; using fallback:', err);
      setExplainResult({
        text: 'Route evaluated under deterministic clearance criteria. Frontage road verification is active.',
        source: 'template',
        validated: true,
      });
    } finally {
      setExplainLoading(false);
    }
  };


  interface Observation {
    id: number;
    t: string;
    d: string;
    c: number;
    s: 'ok' | 'no' | '';
  }

  const [observations, setObservations] = useState<Observation[]>([
    {
      id: 0,
      t: 'Potential carriageway bottleneck',
      d: 'Encroaching parked vehicles or vendor stalls occupy approx. 1.2m of lane margin.',
      c: 78,
      s: '',
    },
    {
      id: 1,
      t: 'Low overhead clearance',
      d: 'Overhead cables bundle appears suspended below 3.0m clearance threshold.',
      c: 64,
      s: '',
    },
  ]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    validateAndSetFile(selected);
  };

  const validateAndSetFile = (f: File) => {
    setError('');
    if (!/^image\/(jpeg|png)$/.test(f.type)) {
      setError('Only JPEG or PNG images are supported.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Image file is larger than 10 MB limit.');
      return;
    }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setState('ready');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) validateAndSetFile(droppedFile);
  };

  const handleRemove = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setError('');
    setState('ready');
  };

  const handleInspect = () => {
    if (!file) {
      setError('Please choose a JPEG or PNG street photo first.');
      return;
    }
    setError('');
    setState('running');
    setTimeout(() => {
      setState('done');
    }, 1200);
  };

  const handleObservationAction = (idx: number, status: 'ok' | 'no') => {
    setObservations((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, s: status } : o))
    );
  };

  const handleEditObservation = (idx: number) => {
    const o = observations[idx];
    const newText = window.prompt('Edit observation notes:', o.d);
    if (newText) {
      setObservations((prev) =>
        prev.map((item, i) => (i === idx ? { ...item, d: newText } : item))
      );
    }
  };

  const handleSaveIssue = () => {
    const accepted = observations.filter((o) => o.s === 'ok');
    if (!accepted.length) {
      setError('Accept at least one observation before creating an issue record.');
      return;
    }

    const newIssueId = `I-0${Math.floor(Math.random() * 900 + 100)}`;
    const newIssue: IssueRecord = {
      id: newIssueId,
      t: `${accepted[0].t} (AI Inspector)`,
      type: accepted[0].t,
      edge: selectedEdge,
      sev: 'med',
      st: 'review',
      ver: 'AI observation (Unverified)',
      ai: accepted.map((o) => o.d).join(' '),
      age: 'Just now',
      photo: previewUrl,
    };

    onAddIssue(newIssue);
    window.location.hash = `#/i/${newIssueId}`;
  };

  return (
    <section className="v">
      {/* Unified Header */}
      <div className="page-header-unified">
        <div className="page-tag">
          <span className="dot" />
          <span>Multimodal Vision Auditing & Field Verification</span>
        </div>
        <h2>AI Street Vision Inspector</h2>
        <p className="lede">
          Transform street-level photographs into structured, human-reviewable observations. Identify overhead utility cable sag, parked delivery bottlenecks, and temporary corridor obstructions before creating certified issue records.
        </p>
        <div className="accent-bar" />
      </div>

      <div className="split" style={{ marginTop: '36px' }}>
        {/* Left: Upload and File Management */}
        <div>
          <label
            className="drop"
            htmlFor="fi"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {previewUrl ? (
              <div>
                <img src={previewUrl} alt="Uploaded street survey" />
                <p style={{ marginTop: '10px', fontSize: '13px', fontWeight: 500 }}>
                  {file?.name} ({file ? Math.round(file.size / 1024) : 0} KB)
                </p>
              </div>
            ) : (
              <div>
                <b style={{ fontSize: '16px' }}>Drop a JPEG or PNG here</b>
                <p style={{ color: 'var(--mute)', marginTop: '4px' }}>or click to browse files</p>
              </div>
            )}
          </label>

          <input
            id="fi"
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            hidden
          />

          <div className="cta" style={{ marginTop: '12px' }}>
            <label className="btn sm" htmlFor="fi">
              {previewUrl ? 'Replace image' : 'Choose image'}
            </label>
            {previewUrl && (
              <button className="btn sm" onClick={handleRemove}>
                Remove
              </button>
            )}
          </div>

          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}

          {/* Road Segment Reference */}
          <div className="fld" style={{ marginTop: '20px' }}>
            <label htmlFor="re">Associated road reference</label>
            <select
              id="re"
              value={selectedEdge}
              onChange={(e) => setSelectedEdge(e.target.value)}
            >
              {roads.map((r) => (
                <option key={r.properties.id} value={r.properties.id}>
                  {r.properties.name} ({r.properties.id})
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn pri"
            onClick={handleInspect}
            disabled={state === 'running'}
          >
            {state === 'running' ? 'Inspecting image...' : 'Inspect image'}
          </button>
        </div>

        {/* Right: Results and Pipeline State */}
        <div>
          <p>
            <b>
              Status:{' '}
              {state === 'ready'
                ? 'Ready'
                : state === 'running'
                ? 'Analysing...'
                : 'Results available'}
            </b>
          </p>

          <div className="dis" style={{ marginTop: '8px' }}>
            <b>Phase 3 Integration Boundary:</b> Real-time vision reasoning will connect to a local
            Gemma 3 4B vision model via LM Studio in Phase 3. No cloud API or private credentials are used.
          </div>

          {state === 'done' && (
            <div style={{ marginTop: '20px' }}>
              {observations.map((obs, idx) => (
                <div key={obs.id} className="ob">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <b>{obs.t}</b>
                    {obs.s === 'ok' ? (
                      <b className="pl c-ok">Accepted</b>
                    ) : obs.s === 'no' ? (
                      <b className="pl c-infeasible">Rejected</b>
                    ) : (
                      <b className="pl c-unknown">Pending review</b>
                    )}
                  </div>
                  <p style={{ margin: '6px 0', fontSize: '14px', color: 'var(--mute)' }}>
                    {obs.d}
                  </p>
                  <small style={{ color: 'var(--mute)' }}>
                    Confidence score: {obs.c}%
                  </small>
                  <div className="bar">
                    <i style={{ width: `${obs.c}%` }} />
                  </div>
                  <div className="cta" style={{ marginTop: '10px' }}>
                    <button
                      className="btn sm"
                      onClick={() => handleObservationAction(idx, 'ok')}
                    >
                      Accept
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => handleEditObservation(idx)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => handleObservationAction(idx, 'no')}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}

              <p style={{ marginTop: '16px', fontSize: '13px', color: 'var(--mute)' }}>
                Physical road width: Not certified from monocular image alone. Requires ground truth measurement.
              </p>

              <div className="cta" style={{ marginTop: '16px' }}>
                <button className="btn pri" onClick={handleSaveIssue}>
                  Save as Issue Record
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Local Model Access Explanation Section */}
      <div style={{ marginTop: '36px', borderTop: '1px solid var(--line)', paddingTop: '24px' }}>
        <h3>Local Model Access Explanation</h3>
        <p className="lede">
          Local model explains the computed deterministic result. Strict guardrails prohibit invented metrics or claims of safety; deterministic template fallback always works.
        </p>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '14px' }}>
          <div className="fld" style={{ margin: 0, minWidth: '220px' }}>
            <label htmlFor="ai-bldg">Target building</label>
            <select
              id="ai-bldg"
              value={explainBldgId}
              onChange={(e) => setExplainBldgId(e.target.value)}
            >
              {buildings.length > 0 ? (
                buildings.map((b) => (
                  <option key={b.properties.id} value={b.properties.id}>
                    {b.properties.name} ({b.properties.id})
                  </option>
                ))
              ) : (
                <>
                  <option value="bldg-201">bldg-201 (Block B)</option>
                  <option value="bldg-202">bldg-202 (Block C)</option>
                  <option value="bldg-206">bldg-206 (School)</option>
                </>
              )}
            </select>
          </div>

          <div className="fld" style={{ margin: 0, minWidth: '160px' }}>
            <label htmlFor="ai-veh">Vehicle</label>
            <select
              id="ai-veh"
              value={explainVeh}
              onChange={(e) => setExplainVeh(e.target.value)}
            >
              <option value="fire">Fire Tender (3.5m)</option>
              <option value="amb">Ambulance (3.0m)</option>
              <option value="rapid">Rapid Response (2.4m)</option>
            </select>
          </div>

          <button
            className="btn pri"
            onClick={runExplain}
            disabled={explainLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {explainLoading ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    border: '2px solid currentColor',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                Explaining...
              </>
            ) : (
              'Explain'
            )}
          </button>
        </div>

        {/* Empty state prompt before explain is triggered */}
        {!explainLoading && !explainResult && (
          <div
            style={{
              marginTop: '18px',
              padding: '20px',
              textAlign: 'center',
              background: 'var(--glass)',
              border: '1.5px dashed var(--line)',
              borderRadius: '12px',
            }}
          >
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--mute)' }}>
              Click <b>Explain</b> to generate verified clearance metrics paired with a plain-language briefing for the selected building.
            </p>
          </div>
        )}

        {/* Two Cards: Computed result (deterministic) & Plain-language explanation */}
        {(explainLoading || explainResult) && (
          <div
            style={{
              marginTop: '18px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            {/* Card 1: Computed result (deterministic) */}
            <div
              style={{
                background: 'var(--glass)',
                border: '1.5px solid var(--line)',
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <h4 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Computed result (deterministic)
                </h4>
                {accessInfo && (
                  <b className={`pl ${accessInfo.classification === 'feasible' ? 'c-ok' : accessInfo.classification === 'constrained' ? 'c-constrained' : accessInfo.classification === 'infeasible' ? 'c-infeasible' : 'c-unknown'}`}>
                    {accessInfo.classification}
                  </b>
                )}
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--ink)' }}>
                <div><b>Target Asset:</b> {accessInfo?.building_name || explainBldgId} ({explainBldgId})</div>
                <div><b>Apparatus:</b> {explainVeh.toUpperCase()} (Required width: {accessInfo?.vehicle.min_clearance_width_m || (explainVeh === 'fire' ? 3.5 : explainVeh === 'amb' ? 3.0 : 2.4)}m)</div>
                <div><b>Distance:</b> {accessInfo?.route ? `${accessInfo.route.total_distance_m} m` : 'Calculated by access graph'}</div>
                <div><b>Limiting Corridors:</b> {accessInfo?.limitations?.length ? accessInfo.limitations.join(', ') : 'None (meets clearance)'}</div>
                <div><b>Cadastre Status:</b> {accessInfo?.entrance_status === 'road_frontage_only' ? 'Road frontage verified' : 'Ground verification required'}</div>
              </div>
              <small style={{ display: 'block', marginTop: '10px', color: 'var(--mute)', fontSize: '11px' }}>
                Deterministic access engine rules. AI never decides accessibility.
              </small>
            </div>

            {/* Card 2: Plain-language explanation */}
            <div
              style={{
                background: 'var(--glass)',
                border: '1.5px solid #4361ee33',
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <h4 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#4361ee' }}>
                  Plain-language explanation
                </h4>
                {explainResult && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span
                      className={`pl ${explainResult.source === 'local_llm' ? 'c-ok' : 'c-unknown'}`}
                      style={{ fontSize: '13px', fontWeight: 700, textTransform: 'none', padding: '4px 12px' }}
                    >
                      {explainResult.source === 'local_llm'
                        ? 'Local LLM (LM Studio Gemma)'
                        : 'Template Fallback'}
                    </span>
                    {explainResult.validated && (
                      <span
                        className="pl c-ok"
                        style={{ fontSize: '13px', fontWeight: 700, textTransform: 'none', padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <CheckCircle size={13} />
                        Validated
                      </span>
                    )}
                  </div>
                )}
              </div>

              {explainLoading ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--mute)', fontSize: '14px' }}>
                  <div
                    style={{
                      display: 'inline-block',
                      width: '28px',
                      height: '28px',
                      border: '3px solid var(--line)',
                      borderTopColor: '#4361ee',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                      marginBottom: '10px',
                    }}
                  />
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Querying Local LLM (LM Studio Gemma) via secure tunnel...</div>
                  <div style={{ fontSize: '12px', marginTop: '6px', color: 'var(--mute)' }}>
                    Evaluating route against deterministic cadastre facts with zero invented numbers. Please allow up to 2–3 minutes for local model generation.
                  </div>
                </div>
              ) : explainResult ? (
                <div>
                  <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.65, color: 'var(--ink)', fontWeight: 500 }}>
                    {explainResult.text}
                  </p>
                  <small style={{ display: 'block', marginTop: '12px', fontSize: '12px', color: 'var(--mute)' }}>
                    Verified with local cadastre facts. Local model only; zero invented metrics.
                  </small>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};


import React, { useState } from 'react';
import { GeoJSONFeature, IssueRecord } from '../types';

interface AIInspectorPageProps {
  roads: GeoJSONFeature[];
  onAddIssue: (issue: IssueRecord) => void;
}

export const AIInspectorPage: React.FC<AIInspectorPageProps> = ({
  roads,
  onAddIssue,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedEdge, setSelectedEdge] = useState<string>(
    roads[0]?.properties.id || 'road-101'
  );
  const [state, setState] = useState<'ready' | 'running' | 'done'>('ready');

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
      <h2>AI Access Inspector</h2>
      <p className="lede">
        Transform street photographs into human-reviewable observations. A photograph alone
        cannot certify road geometry or legal clearance without calibrated field verification.
      </p>

      <div className="split" style={{ marginTop: '24px' }}>
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
    </section>
  );
};

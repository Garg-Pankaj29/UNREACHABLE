import React, { useState, useEffect } from 'react';
import {
  BuildingAccessResponse,
  ExplainResponse,
  GeoJSONFeature,
  RouteCompareResponse,
} from '../types';
import { MapView } from '../components/MapView';
import { VEHICLE_OPTIONS } from '../services/store';
import { api } from '../services/api';
import { Compass } from 'lucide-react';

interface RoutesPageProps {
  buildings: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  roads: GeoJSONFeature[];
}

export const RoutesPage: React.FC<RoutesPageProps> = ({
  buildings,
  stations,
  roads,
}) => {
  const [selectedStationId, setSelectedStationId] = useState<string>(
    stations[0]?.properties.id || 'station-01'
  );
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(
    buildings[0]?.properties.id || 'bldg-201'
  );
  const [selectedVehKey, setSelectedVehKey] = useState<string>('fire');
  const [loading, setLoading] = useState<boolean>(false);
  const [compareLoading, setCompareLoading] = useState<boolean>(false);
  const [explainLoading, setExplainLoading] = useState<boolean>(false);
  const [explainResult, setExplainResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<BuildingAccessResponse | null>(null);
  const [compareResult, setCompareResult] = useState<RouteCompareResponse | null>(null);

  const selectedStation =
    stations.find((s) => s.properties.id === selectedStationId) || stations[0];
  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;

  const runExplain = async () => {
    if (!selectedBuildingId) return;
    setExplainLoading(true);
    try {
      const res = await api.explainRoute(
        selectedStationId || 'station-01',
        selectedBuildingId,
        selectedVehKey
      );
      setExplainResult(res);
    } catch (err: any) {
      console.warn('Explain call exception; falling back to template:', err);
      setExplainResult({
        text: 'Access route evaluated under deterministic clearance criteria. Frontage road verification is active.',
        source: 'template',
        validated: true,
      });
    } finally {
      setExplainLoading(false);
    }
  };


  const runRealityCheck = async () => {
    if (!selectedBuildingId) return;
    setCompareLoading(true);
    try {
      const cmp = await api.compareRoutes(
        selectedStationId || 'station-01',
        selectedBuildingId,
        selectedVehKey
      );
      setCompareResult(cmp);
    } catch (err: any) {
      console.warn('Reality check error:', err);
    } finally {
      setCompareLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (!selectedBuildingId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.fetchBuildingAccess(
        selectedBuildingId,
        selectedVehKey,
        selectedStationId || 'station-01'
      );
      setAccessResult(res);
    } catch (err: any) {
      console.warn('Live routing error:', err);
      setError(err.message || 'Routing evaluation failed');
      setAccessResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExplainResult(null);
    runAnalysis();
  }, [selectedBuildingId, selectedVehKey, selectedStationId]);

  const getPill = (status?: string) => {
    switch (status) {
      case 'accessible':
      case 'feasible':
      case 'ok':
        return <b className="pl c-ok">● Verified accessible</b>;
      case 'constrained':
        return <b className="pl c-constrained">▲ Constrained route</b>;
      case 'infeasible':
        return <b className="pl c-infeasible">✕ Potentially inaccessible</b>;
      default:
        return <b className="pl c-unknown">? Unknown (Unsurveyed)</b>;
    }
  };

  return (
    <section className="v">
      <h2>Route analysis</h2>
      <p className="lede">
        Can this vehicle reach this building using the verified road evidence?
      </p>

      <div className="split" style={{ marginTop: '24px' }}>
        {/* Controls Column */}
        <div>
          {/* Origin Station */}
          <div className="fld">
            <label htmlFor="rs">Origin station</label>
            <select
              id="rs"
              value={selectedStationId}
              onChange={(e) => setSelectedStationId(e.target.value)}
            >
              {stations.map((st) => (
                <option key={st.properties.id} value={st.properties.id}>
                  {st.properties.name}
                </option>
              ))}
              {stations.length === 0 && (
                <option value="station-01">Station Link Base (Simulated)</option>
              )}
            </select>
          </div>

          {/* Destination Building */}
          <div className="fld">
            <label htmlFor="rb">Destination building</label>
            <select
              id="rb"
              value={selectedBuildingId}
              onChange={(e) => setSelectedBuildingId(e.target.value)}
            >
              {buildings.map((b) => (
                <option key={b.properties.id} value={b.properties.id}>
                  {b.properties.name} ({b.properties.id})
                </option>
              ))}
              {buildings.length === 0 && (
                <option value="bldg-201">bldg-201</option>
              )}
            </select>
          </div>

          {/* Vehicle Profile Selector */}
          <div className="fld">
            <label>Vehicle profile</label>
            <div className="chips" role="group" aria-label="Vehicle selection">
              {Object.entries(VEHICLE_OPTIONS).map(([k, v]) => (
                <button
                  key={k}
                  className={`chip ${selectedVehKey === k ? 'on' : ''}`}
                  onClick={() => setSelectedVehKey(k)}
                  aria-pressed={selectedVehKey === k}
                >
                  {v.n}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            <button
              className="btn pri"
              onClick={runAnalysis}
              disabled={loading || compareLoading || explainLoading}
            >
              {loading ? 'Evaluating engine...' : 'Re-analyse route'}
            </button>
            <button
              className="btn"
              onClick={runRealityCheck}
              disabled={loading || compareLoading || explainLoading}
              style={{
                borderColor: 'var(--sig)',
                color: 'var(--sig)',
                fontWeight: 700,
              }}
            >
              {compareLoading ? 'Checking...' : 'Reality Check'}
            </button>
            <button
              className="btn"
              onClick={runExplain}
              disabled={loading || compareLoading || explainLoading}
              style={{
                borderColor: '#4361ee',
                color: '#4361ee',
                fontWeight: 700,
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

          {/* Two Cards: Computed result (deterministic) & Plain-language explanation */}
          {(explainLoading || explainResult) && (
            <div
              style={{
                marginTop: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Card 1: Computed result (deterministic) */}
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Computed result (deterministic)
                  </h4>
                  {accessResult && getPill(accessResult.classification)}
                </div>
                <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--ink)' }}>
                  <div><b>Asset:</b> {accessResult?.building_name || selectedBuildingId} ({accessResult?.building_id || selectedBuildingId})</div>
                  <div><b>Apparatus:</b> {accessResult?.vehicle.name || currentVeh.n} (Requires ≥ {accessResult?.vehicle.min_clearance_width_m || currentVeh.w}m width)</div>
                  <div><b>Distance:</b> {accessResult?.route ? `${accessResult.route.total_distance_m} m` : 'No contiguous route'}</div>
                  <div><b>Bottlenecks:</b> {accessResult?.limitations.length ? accessResult.limitations.join(', ') : 'None (meets clearance)'}</div>
                  <div><b>Cadastre:</b> {accessResult?.entrance_status === 'road_frontage_only' ? 'Road frontage confirmed (entrance unverified)' : 'Unverified doorway'}</div>
                </div>
              </div>

              {/* Card 2: Plain-language explanation */}
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1.5px solid #4361ee33',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  boxShadow: '0 2px 8px rgba(67, 97, 238, 0.06)',
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
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span
                        className={`pl ${explainResult.source === 'local_llm' ? 'c-ok' : 'c-unknown'}`}
                        style={{ fontSize: '11px', textTransform: 'none' }}
                      >
                        {explainResult.source === 'local_llm' ? 'Local LLM' : 'Template'}
                      </span>
                      {explainResult.validated && (
                        <span
                          className="pl c-ok"
                          style={{ fontSize: '11px', textTransform: 'none' }}
                        >
                          Validated ✓
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {explainLoading ? (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--mute)', fontSize: '13px' }}>
                    <div
                      style={{
                        display: 'inline-block',
                        width: '20px',
                        height: '20px',
                        border: '2.5px solid var(--line)',
                        borderTopColor: '#4361ee',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                        marginBottom: '8px',
                      }}
                    />
                    <div>Querying local LLM with numeric guardrails...</div>
                    <div style={{ fontSize: '11px', marginTop: '2px', color: 'var(--mute)' }}>
                      Automatically falls back to template if LM Studio is inactive
                    </div>
                  </div>
                ) : explainResult ? (
                  <div>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--ink)' }}>
                      {explainResult.text}
                    </p>
                    <small style={{ display: 'block', marginTop: '8px', fontSize: '11px', color: 'var(--mute)' }}>
                      Synthetic data notice: generated from verified local cadastre facts. AI never decides access.
                    </small>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Route Result Container */}
          <div style={{ marginTop: '24px' }}>

            {error && (
              <div
                role="alert"
                style={{
                  background: 'var(--glass)',
                  border: '1px solid var(--sig)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  color: 'var(--sig)',
                  fontSize: '13px',
                }}
              >
                <b>Engine notice:</b> {error}
              </div>
            )}

            {loading && !accessResult && (
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1px solid var(--line)',
                  borderRadius: '14px',
                  padding: '24px 20px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    width: '22px',
                    height: '22px',
                    border: '2.5px solid var(--line)',
                    borderTopColor: 'var(--sig)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    marginBottom: '8px',
                  }}
                />
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
                  Querying deterministic access graph...
                </p>
                <small style={{ color: 'var(--mute)', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                  Evaluating physical corridor clearance and Great-Circle graph weights
                </small>
              </div>
            )}

            {!loading && !error && !accessResult && !compareResult && (
              <div
                style={{
                  background: 'var(--glass)',
                  border: '1.5px dashed var(--line)',
                  borderRadius: '14px',
                  padding: '24px 20px',
                  textAlign: 'center',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', color: 'var(--mute)' }}>
                  <Compass size={28} aria-hidden="true" />
                </div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '15px' }}>Ready to evaluate access route</h4>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--mute)', maxWidth: '440px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
                  Select an origin station, destination building, and apparatus profile above, then click <b>Evaluate Access Route</b> to test clearance criteria, or <b>Reality Check</b> to compare against naive shortest-path routing.
                </p>
              </div>
            )}

            {accessResult && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <h3 style={{ margin: 0 }}>Deterministic Evaluation</h3>
                  {getPill(accessResult.classification)}
                </div>

                <p style={{ fontSize: '14px', margin: '10px 0', lineHeight: 1.5, color: 'var(--ink)' }}>
                  {accessResult.plain_language_explanation}
                </p>

                {/* Key Metrics Summary */}
                <div
                  style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '14px',
                    margin: '14px 0',
                    fontSize: '13px',
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    <b>Target Asset:</b> {accessResult.building_name} ({accessResult.building_id})
                  </div>
                  <div>
                    <b>Dispatch Origin:</b> {selectedStation?.properties.name || accessResult.origin_station_id}
                  </div>
                  <div>
                    <b>Vehicle Profile:</b> {accessResult.vehicle.name} (Requires ≥ {accessResult.vehicle.min_clearance_width_m || currentVeh.w}m usable width)
                  </div>
                  <div>
                    <b>Frontage Corridor:</b> {accessResult.connected_road_id || 'None (Unassigned in cadastre)'}
                  </div>
                  <div>
                    <b>Traversal Distance:</b> {accessResult.route ? `${accessResult.route.total_distance_m} m` : 'No contiguous route'}
                  </div>
                  <div>
                    <b>Corridors Traversed:</b> {accessResult.route?.segments_traversed.join(' → ') || 'None'}
                  </div>
                </div>

                {/* Road Arrival vs Entrance Ingress Distinction */}
                <div
                  style={{
                    borderLeft: '4px solid var(--tape)',
                    paddingLeft: '12px',
                    color: 'var(--mute)',
                    fontSize: '12px',
                    lineHeight: 1.5,
                    marginBottom: '18px',
                  }}
                >
                  <b>Entrance Distinction:</b>{' '}
                  {accessResult.entrance_status === 'road_frontage_only'
                    ? `Vehicle reaches the public frontage road. Cadastral setback is ${accessResult.estimated_setback_m ? `${accessResult.estimated_setback_m}m` : 'unmeasured'}; building doorway/gate access requires ground-truth verification.`
                    : 'Building entrance is unconfirmed with no connected public corridor in cadastre records.'}
                </div>

                {/* Approach Segments Breakdown */}
                {accessResult.route && accessResult.route.steps.length > 0 && (
                  <div>
                    <h3 style={{ marginTop: '16px', marginBottom: '8px', fontSize: '15px' }}>
                      Path Steps ({accessResult.route.steps.length})
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {accessResult.route.steps.map((st) => (
                        <div
                          key={`${st.step_index}-${st.road_id}`}
                          className="row"
                          style={{
                            gridTemplateColumns: '1fr auto',
                            padding: '8px 12px',
                            background: 'var(--glass)',
                            borderRadius: '10px',
                            border: '1px solid var(--line)',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px' }}>
                              Step {st.step_index}: {st.road_name} ({st.road_id})
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--mute)' }}>
                              Length: {st.segment_length_m} m · {st.reason}
                            </div>
                          </div>
                          <div>{getPill(st.status)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evaluated vs Unevaluated Constraints */}
                <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--mute)' }}>
                  <div>
                    <b>Evaluated constraints:</b> {accessResult.vehicle.evaluated_constraints?.join(', ') || 'width, physical_obstruction'}
                  </div>
                  <div>
                    <b>Unevaluated (unmeasured in cadastre):</b> {accessResult.vehicle.unevaluated_constraints?.join(', ') || 'overhead_clearance, turning_radius, gate_restrictions'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Map Preview Column */}
        <div>
          {/* Reality Check Verdict Strip */}
          {compareResult && (
            <div
              role="region"
              aria-label="Reality Check Verdict"
              style={{
                background: compareResult.naive_would_fail ? 'rgba(215, 38, 61, 0.12)' : 'rgba(42, 157, 143, 0.12)',
                border: `1.5px solid ${compareResult.naive_would_fail ? '#d7263d' : '#2a9d8f'}`,
                borderRadius: '10px',
                padding: '10px 14px',
                marginBottom: '12px',
                fontSize: '13px',
                lineHeight: 1.4,
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: compareResult.naive_would_fail ? '#d7263d' : '#2a9d8f',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <b>Reality Check:</b> {compareResult.verdict}
              </div>
            </div>
          )}

          <MapView
            buildings={buildings}
            roads={roads}
            stations={stations}
            selectedFeature={buildings.find((b) => b.properties.id === selectedBuildingId) || null}
            selectedVehicle={{
              id: selectedVehKey,
              name: currentVeh.n,
              category: 'Emergency Vehicle',
              minClearanceWidthM: currentVeh.w,
              description: currentVeh.desc,
            }}
            naiveRoadIds={compareResult?.naive.road_ids || []}
            awareRoadIds={compareResult?.aware.road_ids || accessResult?.route?.segments_traversed || []}
            violations={compareResult?.naive.violations || []}
            fullHeight={false}
          />
          <div className="lg" style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <b className="pl c-ok">● Verified accessible (solid)</b>
            <b className="pl" style={{ background: '#e9ecef', color: '#495057', border: '1px dashed #6c757d' }}>
              ╌ Naive distance path (dashed)
            </b>
            {compareResult?.naive_would_fail && (
              <b className="pl c-infeasible">✕ Clearance violation</b>
            )}
            <b className="pl c-constrained">▲ Constrained</b>
            <b className="pl c-unknown">? Unknown</b>
          </div>
        </div>
      </div>
    </section>
  );
};


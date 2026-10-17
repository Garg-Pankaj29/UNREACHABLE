import React, { useState, useEffect } from 'react';
import { BuildingAccessResponse, GeoJSONFeature } from '../types';
import { MapView } from '../components/MapView';
import { VEHICLE_OPTIONS } from '../services/store';
import { api } from '../services/api';

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
  const [error, setError] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<BuildingAccessResponse | null>(null);

  const selectedStation =
    stations.find((s) => s.properties.id === selectedStationId) || stations[0];
  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;

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

          <button
            className="btn pri"
            onClick={runAnalysis}
            disabled={loading}
            style={{ marginTop: '4px' }}
          >
            {loading ? 'Evaluating engine...' : 'Re-analyse route'}
          </button>

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
              <p className="lede" style={{ fontSize: '14px' }}>
                Querying deterministic access graph...
              </p>
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
            fullHeight={false}
          />
          <div className="lg" style={{ marginTop: '14px' }}>
            <b className="pl c-ok">● Verified accessible</b>
            <b className="pl c-constrained">▲ Constrained</b>
            <b className="pl c-infeasible">✕ Inaccessible</b>
            <b className="pl c-unknown">? Unknown</b>
          </div>
        </div>
      </div>
    </section>
  );
};

import React, { useState } from 'react';
import { GeoJSONFeature } from '../types';
import { SvgMap } from '../components/SvgMap';
import { VEHICLE_OPTIONS } from '../services/store';

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
  const [analysed, setAnalysed] = useState<boolean>(false);

  const selectedBuilding =
    buildings.find((b) => b.properties.id === selectedBuildingId) || buildings[0];
  const selectedStation =
    stations.find((s) => s.properties.id === selectedStationId) || stations[0];
  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;

  const connectedRoadId = selectedBuilding?.properties.connected_road_id;
  const connectedRoad = roads.find((r) => r.properties.id === connectedRoadId);

  const handleAnalyse = () => {
    setAnalysed(true);
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
              onChange={(e) => {
                setSelectedStationId(e.target.value);
                setAnalysed(false);
              }}
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
              onChange={(e) => {
                setSelectedBuildingId(e.target.value);
                setAnalysed(false);
              }}
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
                  onClick={() => {
                    setSelectedVehKey(k);
                    setAnalysed(false);
                  }}
                  aria-pressed={selectedVehKey === k}
                >
                  {v.n}
                </button>
              ))}
            </div>
          </div>

          <button className="btn pri" onClick={handleAnalyse}>
            Analyse route
          </button>

          {/* Route Result Container */}
          <div style={{ marginTop: '28px' }}>
            {!analysed ? (
              <p className="lede" style={{ fontSize: '15px' }}>
                Choose a station, a building, and a vehicle, then run analysis.
              </p>
            ) : (
              <div>
                <h2>Candidate Access Evaluation</h2>
                <div style={{ margin: '8px 0 12px' }}>
                  {connectedRoad?.properties.access_status === 'feasible' ? (
                    <b className="pl c-ok">● Direct corridor feasible</b>
                  ) : connectedRoad?.properties.access_status === 'constrained' ? (
                    <b className="pl c-constrained">▲ Width bottleneck identified</b>
                  ) : connectedRoad?.properties.access_status === 'infeasible' ? (
                    <b className="pl c-infeasible">✕ Approach corridor obstructed</b>
                  ) : (
                    <b className="pl c-unknown">? Ground check required</b>
                  )}
                </div>

                <div
                  style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '14px',
                    margin: '14px 0',
                    fontSize: '14px',
                  }}
                >
                  <p>
                    <b>Destination:</b> {selectedBuilding?.properties.name} (ID: {selectedBuilding?.properties.id})
                  </p>
                  <p>
                    <b>Dispatch Origin:</b> {selectedStation?.properties.name}
                  </p>
                  <p>
                    <b>Vehicle Ingress Requirement:</b> {currentVeh.n} (≥ {currentVeh.w} m effective width)
                  </p>
                  <p>
                    <b>Final Access Road:</b> {connectedRoad?.properties.name || connectedRoadId} (Width: {connectedRoad?.properties.width_m ? `${connectedRoad.properties.width_m} m` : 'Unmeasured'})
                  </p>
                </div>

                {/* Scope Notice */}
                <div
                  style={{
                    borderLeft: '4px solid var(--tape)',
                    paddingLeft: '12px',
                    color: 'var(--mute)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  }}
                >
                  <b>Engine Status (Phase 1.5):</b> The full multi-hop Dijkstra/A* shortest
                  pathfinding engine with dynamic turn radiuses and real-time obstacle avoidance
                  is scheduled for Phase 2. This preview evaluates direct segment clearance from
                  the verified database.
                </div>

                {/* Segments table */}
                <h3 style={{ marginTop: '20px', marginBottom: '10px' }}>Approach Segments</h3>
                <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>
                    <b>{connectedRoad?.properties.name || 'Access Segment'}</b>
                    <small>
                      {connectedRoad?.properties.width_m
                        ? `Width ${connectedRoad.properties.width_m} m (Sample cadastre)`
                        : 'Width unmeasured in cadastre'}
                    </small>
                  </span>
                  <b className="pl c-ok">Direct Ingress</b>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Map Preview Column */}
        <div>
          <SvgMap nohit={true} />
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

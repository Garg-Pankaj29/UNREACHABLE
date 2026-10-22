import React, { useState, useEffect } from 'react';
import { GeoJSONFeature, IssueRecord, VehicleProfile } from '../types';
import { MapView } from '../components/MapView';
import { VEHICLE_OPTIONS } from '../services/store';

interface AccessAtlasPageProps {
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  issues: IssueRecord[];
  selectedFeature: GeoJSONFeature | null;
  onSelectFeature: (feature: GeoJSONFeature | null) => void;
  onSelectVehicle?: (vehicle: VehicleProfile) => void;
}

export const AccessAtlasPage: React.FC<AccessAtlasPageProps> = ({
  buildings,
  roads,
  stations,
  issues,
  selectedFeature,
  onSelectFeature,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehKey, setSelectedVehKey] = useState<string>('fire');

  const [statusFilters, setStatusFilters] = useState<{
    ok: boolean;
    constrained: boolean;
    infeasible: boolean;
    unknown: boolean;
  }>({
    ok: true,
    constrained: true,
    infeasible: true,
    unknown: true,
  });

  const [layers, setLayers] = useState({
    roads: true,
    buildings: true,
    stations: true,
    issues: true,
  });

  // Keyboard navigation: Escape key deselects currently active feature
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSelectFeature(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectFeature]);

  const toggleStatus = (key: 'ok' | 'constrained' | 'infeasible' | 'unknown') => {
    setStatusFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleLayer = (key: 'roads' | 'buildings' | 'stations' | 'issues') => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;
  const currentVehProfile: VehicleProfile = {
    id: selectedVehKey,
    name: currentVeh.n,
    category: 'Emergency Vehicle',
    minClearanceWidthM: currentVeh.w,
    description: currentVeh.desc,
    typicalEquipment: 'Standard emergency equipment',
  };

  const props = selectedFeature?.properties;
  const isBuilding = props?.feature_type === 'building';
  const isRoad = props?.feature_type === 'road';
  const isStation = props?.feature_type === 'station';
  const isIssue = (props?.feature_type as string) === 'issue';

  // Compute effective vehicle-aware status matching map visuals
  let effectiveStatus = props?.access_status || 'unknown';
  if (isRoad) {
    const reqW = currentVeh.w;
    const roadWidth = props?.width_m;
    const hasObstruction = props?.obstruction && String(props.obstruction).trim() && String(props.obstruction).toLowerCase() !== 'null';
    if (hasObstruction) {
      effectiveStatus = 'infeasible';
    } else if (roadWidth !== null && roadWidth !== undefined) {
      if (roadWidth < reqW) {
        effectiveStatus = 'infeasible';
      } else if (roadWidth < reqW + 0.4) {
        effectiveStatus = 'constrained';
      } else {
        effectiveStatus = 'ok';
      }
    } else {
      effectiveStatus = 'unknown';
    }
  } else if (isBuilding) {
    const connRoad = roads.find((r) => r.properties?.id === props?.connected_road_id);
    if (connRoad) {
      const roadW = connRoad.properties?.width_m;
      const roadObs = connRoad.properties?.obstruction && String(connRoad.properties.obstruction).trim() && String(connRoad.properties.obstruction).toLowerCase() !== 'null';
      if (roadObs) {
        effectiveStatus = 'infeasible';
      } else if (roadW !== null && roadW !== undefined) {
        if (roadW < currentVeh.w) {
          effectiveStatus = 'infeasible';
        } else if (roadW < currentVeh.w + 0.4) {
          effectiveStatus = 'constrained';
        } else {
          effectiveStatus = 'ok';
        }
      } else {
        effectiveStatus = 'unknown';
      }
    }
  }

  const getPill = (status?: string) => {
    switch (status) {
      case 'feasible':
      case 'ok':
        return <b className="pl c-ok">● Verified accessible</b>;
      case 'constrained':
        return <b className="pl c-constrained">▲ Constrained ({currentVeh.n})</b>;
      case 'infeasible':
        return <b className="pl c-infeasible">✕ Inaccessible ({currentVeh.n})</b>;
      default:
        return <b className="pl c-unknown">? Unknown (Unsurveyed)</b>;
    }
  };

  return (
    <div className="stage">
      {/* Full Map Canvas */}
      <MapView
        buildings={buildings}
        roads={roads}
        stations={stations}
        issues={issues}
        selectedFeature={selectedFeature}
        selectedVehicle={currentVehProfile}
        layers={layers}
        statusFilters={statusFilters}
        searchQuery={searchQuery}
        onSelectFeature={onSelectFeature}
        fullHeight={true}
      />

      {/* Floating Control Panel (Upper Left) */}
      <div className="ctl" aria-label="Access Atlas controls">
        <h3>Access Atlas</h3>

        {/* Search */}
        <div className="fld">
          <label htmlFor="atlas-search">Search building or road</label>
          <input
            id="atlas-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. bldg-201 or Station Link"
          />
        </div>

        {/* Vehicle Profile */}
        <div className="fld">
          <label>Vehicle profile</label>
          <div className="chips" role="group" aria-label="Vehicle profile selector">
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

        {/* Access Status Filter */}
        <div className="fld">
          <label>Access status</label>
          <div className="chips" role="group" aria-label="Status filters">
            <button
              className={`chip ${statusFilters.ok ? 'on' : ''}`}
              onClick={() => toggleStatus('ok')}
              aria-pressed={statusFilters.ok}
            >
              ● Verified
            </button>
            <button
              className={`chip ${statusFilters.constrained ? 'on' : ''}`}
              onClick={() => toggleStatus('constrained')}
              aria-pressed={statusFilters.constrained}
            >
              ▲ Constrained
            </button>
            <button
              className={`chip ${statusFilters.infeasible ? 'on' : ''}`}
              onClick={() => toggleStatus('infeasible')}
              aria-pressed={statusFilters.infeasible}
            >
              ✕ Inaccessible
            </button>
            <button
              className={`chip ${statusFilters.unknown ? 'on' : ''}`}
              onClick={() => toggleStatus('unknown')}
              aria-pressed={statusFilters.unknown}
            >
              ? Unknown
            </button>
          </div>
        </div>

        {/* Layers Visibility */}
        <div className="fld">
          <label>Layers</label>
          <div className="chips" role="group" aria-label="Layer toggles">
            <button
              className={`chip ${layers.roads ? 'on' : ''}`}
              onClick={() => toggleLayer('roads')}
              aria-pressed={layers.roads}
            >
              Roads
            </button>
            <button
              className={`chip ${layers.buildings ? 'on' : ''}`}
              onClick={() => toggleLayer('buildings')}
              aria-pressed={layers.buildings}
            >
              Buildings
            </button>
            <button
              className={`chip ${layers.stations ? 'on' : ''}`}
              onClick={() => toggleLayer('stations')}
              aria-pressed={layers.stations}
            >
              Stations
            </button>
            <button
              className={`chip ${layers.issues ? 'on' : ''}`}
              onClick={() => toggleLayer('issues')}
              aria-pressed={layers.issues}
            >
              Issues ({issues.length})
            </button>
          </div>
        </div>

        {buildings.length === 0 && roads.length === 0 && (
          <p style={{ fontSize: '12px', color: 'var(--sig)', marginTop: '8px', lineHeight: 1.4 }}>
            Loading municipal spatial layers from backend...
          </p>
        )}

        <p style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '6px', lineHeight: 1.4 }}>
          Grey is unknown, never assumed inaccessible. Synthetic demo dataset.
        </p>
      </div>

      {/* Floating Inspection Panel (Right on desktop, compact bottom sheet on mobile) */}
      {selectedFeature && props && (
        <aside className="pan" aria-label="Selected feature details">
          <div className="pan-header">
            <div>
              <span className="pan-badge">
                {props.feature_type?.toUpperCase()} · {props.id}
              </span>
              <h3>{props.name}</h3>
            </div>
            <button
              className="pan-close"
              onClick={() => onSelectFeature(null)}
              aria-label="Close feature details"
              title="Close panel (Esc)"
            >
              ✕
            </button>
          </div>

          <div className="pan-status">{getPill(effectiveStatus)}</div>

          {/* Issue Hazard Details */}
          {isIssue && (
            <>
              <div className="pan-props">
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Hazard type</span>
                  <span className="pan-prop-val">{props.type || 'Physical bottleneck'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Corridor link</span>
                  <span className="pan-prop-val">{props.edge} ({props.road_name})</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Priority level</span>
                  <span className="pan-prop-val" style={{ textTransform: 'uppercase', fontWeight: 800, color: props.severity === 'high' ? '#d7263d' : '#e8710a' }}>
                    {props.severity}
                  </span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Verification</span>
                  <span className="pan-prop-val">{props.verification_status || 'Unverified report'}</span>
                </div>
              </div>

              {props.ai && (
                <div style={{ fontSize: '13px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '10px', padding: '10px 12px', margin: '12px 0' }}>
                  <b>AI Inspector Notes:</b> {props.ai}
                </div>
              )}

              <div className="cta" style={{ marginTop: '16px' }}>
                <a className="btn pri sm" href={`#/i/${props.id}`}>
                  Inspect Issue
                </a>
                <a className="btn sm" href="#/simulation">
                  Simulate Remedy
                </a>
              </div>
            </>
          )}

          {/* Building Details */}
          {isBuilding && (
            <>
              <div className="pan-props">
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Use type</span>
                  <span className="pan-prop-val">{props.use_type || 'General'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Access road</span>
                  <span className="pan-prop-val">{props.connected_road_id || 'Not assigned'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Frontage setback</span>
                  <span className="pan-prop-val">
                    {props.estimated_setback_m ? `${props.estimated_setback_m} m` : 'Unsurveyed'}
                  </span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Verification</span>
                  <span className="pan-prop-val">{props.verification_status || 'unverified'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Source</span>
                  <span className="pan-prop-val">{props.data_source || 'Synthetic Cadastre'}</span>
                </div>
              </div>

              {props.notes && (
                <p style={{ fontSize: '12px', color: 'var(--mute)', margin: '8px 0 12px' }}>
                  {props.notes}
                </p>
              )}

              <div className="cta">
                <a className="btn pri sm" href={`#/b/${props.id}`}>
                  View Details
                </a>
                <a className="btn sm" href="#/routes">
                  Analyse Route
                </a>
              </div>
            </>
          )}

          {/* Road Details */}
          {isRoad && (
            <>
              <div className="pan-props">
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Usable width</span>
                  <span className="pan-prop-val">
                    {props.width_m !== null && props.width_m !== undefined
                      ? `${props.width_m} m`
                      : 'Unmeasured (Null)'}
                  </span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Road class</span>
                  <span className="pan-prop-val">{props.road_class || 'Local'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Surface</span>
                  <span className="pan-prop-val">{props.surface || 'Unknown'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">{currentVeh.n} Clearance</span>
                  <span className="pan-prop-val">Requires ≥ {currentVeh.w} m</span>
                </div>
              </div>

              {props.obstruction && (
                <div className="pan-obstruction">
                  Constraint: {props.obstruction}
                </div>
              )}

              {props.access_status === 'unknown' && (
                <p style={{ fontSize: '12px', color: 'var(--mute)', margin: '8px 0' }}>
                  Width is missing, so this segment is Unknown, not inaccessible.
                </p>
              )}

              <div className="cta">
                <a className="btn pri sm" href="#/interventions">
                  View Issues
                </a>
                <a className="btn sm" href="#/simulation">
                  Simulate Impact
                </a>
              </div>
            </>
          )}

          {/* Station Details */}
          {isStation && (
            <>
              <div className="pan-props">
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Facility type</span>
                  <span className="pan-prop-val">{props.station_type || 'Dispatch Base'}</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Apparatus bays</span>
                  <span className="pan-prop-val">{props.vehicle_bays || 2} bays</span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Primary exit</span>
                  <span className="pan-prop-val">{props.primary_access_road || 'road-101'}</span>
                </div>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--mute)', margin: '8px 0 12px' }}>
                Simulated emergency deployment anchor anchoring neighbourhood response.
              </p>

              <div className="cta">
                <a className="btn pri sm" href="#/routes">
                  Analyse from here
                </a>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
};

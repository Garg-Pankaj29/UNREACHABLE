import React from 'react';
import { GeoJSONFeature } from '../types';
import { SvgMap } from '../components/SvgMap';

interface BuildingDetailPageProps {
  buildingId: string;
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
}

export const BuildingDetailPage: React.FC<BuildingDetailPageProps> = ({
  buildingId,
  buildings,
  roads,
}) => {
  const building = buildings.find(
    (b) =>
      b.properties.id?.toLowerCase() === buildingId.toLowerCase() ||
      b.properties.id === `bldg-${buildingId}` ||
      b.properties.id === buildingId
  );

  if (!building) {
    return (
      <section className="v nf">
        <h2>Building not found</h2>
        <p className="lede">
          That building ID wasn't found in the current demonstration area.
        </p>
        <div className="cta">
          <a className="btn pri" href="#/map">
            Open Access Atlas
          </a>
        </div>
      </section>
    );
  }

  const props = building.properties;
  const connectedRoadId = props.connected_road_id;
  const connectedRoad = roads.find((r) => r.properties.id === connectedRoadId);

  const getPill = (status?: string) => {
    switch (status) {
      case 'feasible':
      case 'ok':
        return <b className="pl c-ok">● Verified accessible</b>;
      case 'constrained':
        return <b className="pl c-constrained">▲ Constrained</b>;
      case 'infeasible':
        return <b className="pl c-infeasible">✕ Potentially inaccessible</b>;
      default:
        return <b className="pl c-unknown">? Unknown</b>;
    }
  };

  const roadWidth = connectedRoad?.properties.width_m;

  return (
    <section className="v">
      <p style={{ fontSize: '13px', color: 'var(--mute)', marginBottom: '4px' }}>
        <a href="#/map" style={{ textDecoration: 'underline' }}>
          Access Atlas
        </a>{' '}
        / Building {props.id}
      </p>

      <h2>{props.name} ({props.id})</h2>

      <div className="cta" style={{ margin: '8px 0 24px' }}>
        {getPill(props.access_status)}
        <b className="pl c-unknown">Synthetic municipal building</b>
      </div>

      <div className="split">
        {/* Left Column */}
        <div>
          <p style={{ fontSize: '16px', lineHeight: 1.5 }}>
            {props.notes ||
              'Access evaluation based on direct street frontage and municipal cadastral footprints.'}
          </p>

          <p style={{ marginTop: '14px', lineHeight: 1.6 }}>
            <b>Access road:</b>{' '}
            <a href="#/map" style={{ textDecoration: 'underline' }}>
              {connectedRoad?.properties.name || connectedRoadId}
            </a>
            <br />
            <b>Physical width:</b>{' '}
            {roadWidth !== null && roadWidth !== undefined
              ? `${roadWidth} m`
              : 'Measurement unverified'}
            <br />
            <b>Frontage Setback:</b>{' '}
            {props.estimated_setback_m ? `${props.estimated_setback_m} m` : 'Unsurveyed'}
            <br />
            <b>Source:</b> {props.data_source || 'Synthetic Municipal Cadastre'}
            <br />
            <b>Verification status:</b> {props.verification_status || 'unverified'}
          </p>

          <h3 style={{ marginTop: '22px', marginBottom: '10px' }}>
            Accessibility by Emergency Vehicle Type
          </h3>

          <div style={{ borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}>
              <span>
                <b>Fire Water Tender</b>
                <small>Requires ≥ 3.5 m clearance</small>
              </span>
              {roadWidth && roadWidth >= 3.5 ? (
                <b className="pl c-ok">● Feasible</b>
              ) : roadWidth ? (
                <b className="pl c-infeasible">✕ Impassable (&lt; 3.5m)</b>
              ) : (
                <b className="pl c-unknown">? Unknown</b>
              )}
            </div>

            <div className="row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}>
              <span>
                <b>Type C / ALS Ambulance</b>
                <small>Requires ≥ 3.0 m clearance</small>
              </span>
              {roadWidth && roadWidth >= 3.0 ? (
                <b className="pl c-ok">● Feasible</b>
              ) : roadWidth ? (
                <b className="pl c-infeasible">✕ Impassable (&lt; 3.0m)</b>
              ) : (
                <b className="pl c-unknown">? Unknown</b>
              )}
            </div>

            <div className="row" style={{ gridTemplateColumns: '1fr auto', padding: '12px 8px' }}>
              <span>
                <b>Quick Response Unit (QRV)</b>
                <small>Requires ≥ 2.4 m clearance</small>
              </span>
              {roadWidth && roadWidth >= 2.4 ? (
                <b className="pl c-ok">● Feasible</b>
              ) : roadWidth ? (
                <b className="pl c-constrained">▲ Bottleneck (Narrow)</b>
              ) : (
                <b className="pl c-unknown">? Unknown</b>
              )}
            </div>
          </div>

          <div className="cta" style={{ marginTop: '24px' }}>
            <a className="btn pri" href="#/map">
              Open on map
            </a>
            <a className="btn" href="#/routes">
              Analyse route
            </a>
            <a className="btn" href="#/inspector">
              Report an issue
            </a>
          </div>
        </div>

        {/* Right Column */}
        <div>
          <SvgMap nohit={true} />
        </div>
      </div>
    </section>
  );
};

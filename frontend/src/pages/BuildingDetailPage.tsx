import React, { useState, useEffect } from 'react';
import { GeoJSONFeature, BuildingAccessResponse } from '../types';
import { api } from '../services/api';
import { VEHICLE_OPTIONS } from '../services/store';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Navigation,
  FileQuestion,
  MapPin,
  Loader2,
} from 'lucide-react';

interface BuildingDetailPageProps {
  buildingId: string;
  buildings: GeoJSONFeature[];
  roads?: GeoJSONFeature[];
  datasetMode?: 'pilot' | 'sample';
  loading?: boolean;
  error?: string | null;
}

export const BuildingDetailPage: React.FC<BuildingDetailPageProps> = ({
  buildingId,
  buildings,
  datasetMode = 'pilot',
  loading: parentLoading = false,
  error: parentError = null,
}) => {
  const [selectedVehKey, setSelectedVehKey] = useState<string>('fire');
  const [assessment, setAssessment] = useState<BuildingAccessResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const matchedBuilding = buildings.find(
    (b) =>
      b.properties?.id?.toLowerCase() === buildingId.toLowerCase() ||
      b.properties?.id === `bldg-${buildingId}` ||
      b.properties?.id === buildingId ||
      b.id === buildingId
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setFetchError(null);

    api
      .fetchBuildingAccess(buildingId, selectedVehKey, undefined, datasetMode)
      .then((res) => {
        if (isMounted) {
          setAssessment(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to load building access assessment:', err);
          setFetchError(err.message || 'Unable to assess building access');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [buildingId, selectedVehKey, datasetMode]);

  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;

  const getStatusBadge = (status?: string, classification?: string) => {
    if (status === 'verified_inaccessible' || classification === 'inaccessible' || classification === 'infeasible') {
      return (
        <span
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#dc2626',
            border: '1.5px solid #ef4444',
            padding: '4px 10px',
            borderRadius: '99px',
            fontSize: '12px',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <XCircle size={14} /> POTENTIALLY INACCESSIBLE
        </span>
      );
    }
    if (status === 'partial_unverified' || classification === 'unknown') {
      return (
        <span
          style={{
            background: 'rgba(100, 116, 139, 0.15)',
            color: '#475569',
            border: '1.5px solid #94a3b8',
            padding: '4px 10px',
            borderRadius: '99px',
            fontSize: '12px',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <HelpCircle size={14} /> PARTIAL ASSESSMENT (UNVERIFIED)
        </span>
      );
    }
    if (classification === 'constrained') {
      return (
        <span
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#d97706',
            border: '1.5px solid #f59e0b',
            padding: '4px 10px',
            borderRadius: '99px',
            fontSize: '12px',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <AlertTriangle size={14} /> CONSTRAINED APPROACH
        </span>
      );
    }
    return (
      <span
        style={{
          background: 'rgba(16, 185, 129, 0.15)',
          color: '#059669',
          border: '1.5px solid #10b981',
          padding: '4px 10px',
          borderRadius: '99px',
          fontSize: '12px',
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
        }}
      >
        <CheckCircle size={14} /> ROAD CORRIDOR REACHABLE
      </span>
    );
  };

  if ((loading || parentLoading) && !assessment) {
    return (
      <section className="v nf" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 16px', color: 'var(--sig)' }} />
        <h2>Assessing Building Emergency Access...</h2>
        <p className="lede">
          Calculating proximity to connected road network, setback distances, and vehicle clearance from nearest emergency facility...
        </p>
      </section>
    );
  }

  if ((fetchError || parentError) && !assessment) {
    return (
      <section className="v nf">
        <h2>Building Assessment Unavailable</h2>
        <p className="lede">
          {fetchError || parentError || 'Unable to retrieve building accessibility records from backend.'}
        </p>
        <div className="cta">
          <a className="btn pri" href="#/map">
            Open Access Atlas
          </a>
          <a className="btn" href="#/routes">
            Route Planner
          </a>
        </div>
      </section>
    );
  }

  const bName = assessment?.building_name || matchedBuilding?.properties?.name || buildingId;
  const bId = assessment?.building_id || buildingId;
  const useType = assessment?.use_type || matchedBuilding?.properties?.use_type || 'General Structure';
  const setbackM = assessment?.estimated_setback_m;
  const approachRoad = assessment?.approach_road_name || assessment?.connected_road_id || 'Nearest connected road corridor';
  const originStation = assessment?.origin_station_name || assessment?.origin_station_id || 'Emergency Dispatch Anchor';
  const route = assessment?.route;

  return (
    <section className="v" style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* Breadcrumb Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
        <p style={{ fontSize: '13px', color: 'var(--mute)', margin: 0 }}>
          <a href="#/map" style={{ textDecoration: 'underline' }}>
            Access Atlas
          </a>{' '}
          / Building Emergency Access / <b>{bId}</b>
        </p>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span
            style={{
              background: datasetMode === 'pilot' ? 'rgba(13, 148, 136, 0.12)' : 'rgba(100, 116, 139, 0.12)',
              color: datasetMode === 'pilot' ? '#0d9488' : '#475569',
              border: `1px solid ${datasetMode === 'pilot' ? '#99f6e4' : '#cbd5e1'}`,
              fontSize: '10px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            {datasetMode === 'pilot' ? 'REAL OSM PILOT CADASTRE' : 'SYNTHETIC DEMO CADASTRE'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', margin: '12px 0 20px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 4px', letterSpacing: '-0.5px' }}>
            {bName}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: 'var(--mute)', fontSize: '13px' }}>
            <span>ID: <b>{bId}</b></span>
            <span>•</span>
            <span>Use: <b style={{ textTransform: 'capitalize' }}>{useType}</b></span>
            {assessment?.building_coordinates && (
              <>
                <span>•</span>
                <span>Coordinates: [{assessment.building_coordinates[1].toFixed(4)}, {assessment.building_coordinates[0].toFixed(4)}]</span>
              </>
            )}
          </div>
        </div>

        <div>
          {getStatusBadge(assessment?.assessment_status, assessment?.classification)}
        </div>
      </div>

      {/* Critical Access Distinction Banner (Requirement 5) */}
      <div
        style={{
          background: 'rgba(217, 119, 6, 0.08)',
          border: '1.5px solid #d97706',
          borderRadius: '10px',
          padding: '14px 18px',
          margin: '0 0 24px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
        }}
      >
        <ShieldAlert size={22} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--ink)' }}>
          <b style={{ color: '#d97706', display: 'block', fontSize: '14px', marginBottom: '3px' }}>
            CRITICAL ACCESS DISTINCTION: Road-Network Reachability vs. Physical Building Entrance
          </b>
          <span>
            Emergency vehicle reachability indicates that apparatus can traverse public road corridors to the nearest mapped frontage road access point.
            <b> It does NOT guarantee that apparatus can physically enter through property gates, boundary walls, courtyard setbacks, or private fire lanes.</b>{' '}
            Unless an on-site property ingress survey exists, emergency responders must plan for curbside deployment with pedestrian hose relays or manual equipment carry.
          </span>
        </div>
      </div>

      {/* Vehicle Profile Switcher */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div>
            <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--mute)', letterSpacing: '0.5px' }}>
              Select Emergency Apparatus Profile
            </span>
            <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>
              Testing clearance for: <span style={{ color: 'var(--sig)' }}>{currentVeh.n}</span> (Requires ≥ {currentVeh.w}m physical width)
            </div>
          </div>
          {loading && (
            <span style={{ fontSize: '12px', color: 'var(--mute)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Loader2 className="animate-spin" size={14} /> Reassessing...
            </span>
          )}
        </div>

        <div className="chips" role="group" aria-label="Vehicle profile selector">
          {Object.entries(VEHICLE_OPTIONS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={`chip ${selectedVehKey === k ? 'on' : ''}`}
              onClick={() => setSelectedVehKey(k)}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              {v.n} ({v.w}m)
            </button>
          ))}
        </div>
      </div>

      {/* Two Column Assessment Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '28px' }}>
        {/* Column 1: Proximity & Road Access Point */}
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin size={18} style={{ color: 'var(--sig)' }} />
            Road Proximity & Access Point
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Nearest Approach Road:</span>
              <span style={{ fontWeight: 700, textAlign: 'right' }}>{approachRoad}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Road-to-Building Setback:</span>
              <span style={{ fontWeight: 800, color: setbackM && setbackM > 100 ? '#d97706' : 'var(--ink)' }}>
                {setbackM !== null && setbackM !== undefined ? `${setbackM} meters` : 'Unsurveyed'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Entrance / Gate Status:</span>
              <span style={{ fontWeight: 700, color: '#d97706' }}>
                {assessment?.entrance_status === 'road_frontage_only'
                  ? 'Road Frontage Only (Gate Unsurveyed)'
                  : 'Unconfirmed Property Ingress'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Road Physical Width:</span>
              <span style={{ fontWeight: 700 }}>
                {route?.segment_assessments?.[route.segment_assessments.length - 1]?.width_m !== null &&
                route?.segment_assessments?.[route.segment_assessments.length - 1]?.width_m !== undefined
                  ? `${route.segment_assessments[route.segment_assessments.length - 1].width_m} m`
                  : 'Unmeasured (Null in Cadastre)'}
              </span>
            </div>

            {assessment?.road_access_coordinates && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--mute)' }}>Connected Access Coordinates:</span>
                <span style={{ fontWeight: 600, fontSize: '12px', fontFamily: 'monospace' }}>
                  {assessment.road_access_coordinates[1].toFixed(5)}, {assessment.road_access_coordinates[0].toFixed(5)}
                </span>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 'auto',
              padding: '12px',
              background: 'rgba(0,0,0,0.03)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--mute)',
              lineHeight: 1.4,
            }}
          >
            {assessment?.plain_language_explanation}
          </div>
        </div>

        {/* Column 2: Vehicle-Aware Route from Origin Facility */}
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Navigation size={18} style={{ color: '#2563eb' }} />
            Vehicle-Aware Emergency Route
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Origin Emergency Facility:</span>
              <span style={{ fontWeight: 700, textAlign: 'right' }}>{originStation}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Estimated Route Distance:</span>
              <span style={{ fontWeight: 800, color: 'var(--sig)' }}>
                {route?.total_distance_m ? `${(route.total_distance_m / 1000).toFixed(2)} km (${Math.round(route.total_distance_m)} m)` : 'No contiguous route'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Road Segments Traversed:</span>
              <span style={{ fontWeight: 700 }}>
                {route?.segments_traversed?.length || 0} segments ({route?.steps?.length || 0} topological nodes)
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Corridor Clearance Status:</span>
              <span style={{ fontWeight: 700 }}>
                {route?.classification === 'accessible'
                  ? '● Fully Passable (Clear)'
                  : route?.classification === 'constrained'
                  ? '▲ Bottlenecks Present'
                  : route?.classification === 'inaccessible'
                  ? '✕ Physically Blocked'
                  : '? Unknown (Unmeasured Widths)'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--mute)' }}>Limiting Corridors:</span>
              <span style={{ fontWeight: 700, color: route?.limiting_segments?.length ? '#dc2626' : 'var(--mute)' }}>
                {route?.limiting_segments?.length ? `${route.limiting_segments.length} segment(s)` : 'None detected'}
              </span>
            </div>
          </div>

          <div className="cta" style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <a className="btn pri sm" href={`#/routes/${bId}`} style={{ flex: 1, textAlign: 'center' }}>
              Inspect Full Turn-by-Turn Route
            </a>
            <a className="btn sm" href="#/map" style={{ flex: 1, textAlign: 'center' }}>
              View in Atlas
            </a>
          </div>
        </div>
      </div>

      {/* Missing Evidence & Unverified Data Checklist (Requirement 6) */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '28px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 800, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#d97706' }}>
          <FileQuestion size={18} />
          Missing Evidence & Ground-Truth Verification Checklist
        </h3>

        <p style={{ fontSize: '13px', color: 'var(--mute)', margin: '0 0 14px', lineHeight: 1.4 }}>
          In accordance with municipal engineering safety standards, UNREACHABLE explicitly labels unsurveyed parameters as missing evidence and never invents measurements.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
          {(assessment?.missing_evidence && assessment.missing_evidence.length > 0
            ? assessment.missing_evidence
            : [
                'Property entrance gate location is unsurveyed in cadastre.',
                'Approach road width is unmeasured in open cadastre records.',
                'Aerial ladder turntable clearance and building façade standoff are unverified.',
              ]
          ).map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                background: 'rgba(245, 158, 11, 0.06)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '8px',
                fontSize: '12px',
                lineHeight: 1.4,
              }}
            >
              <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: '1px' }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Vehicle Clearance Comparison Table */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '28px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 800, margin: '0 0 16px' }}>
          Apparatus Ingress Feasibility Matrix
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Object.entries(VEHICLE_OPTIONS).map(([k, v]) => {
            const isCurrent = selectedVehKey === k;
            return (
              <div
                key={k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: isCurrent ? 'rgba(255, 214, 10, 0.08)' : 'transparent',
                  border: isCurrent ? '1.5px solid #ffd60a' : '1px solid var(--line)',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--ink)' }}>{v.n}</div>
                  <div style={{ fontSize: '11px', color: 'var(--mute)' }}>
                    Requires ≥ {v.w}m clear corridor • {v.desc}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {assessment?.assessment_status === 'verified_inaccessible' ? (
                    <span style={{ color: '#dc2626', fontWeight: 800, fontSize: '12px' }}>✕ Blocked</span>
                  ) : assessment?.assessment_status === 'partial_unverified' ? (
                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>? Unverified Width</span>
                  ) : (
                    <span style={{ color: '#059669', fontWeight: 800, fontSize: '12px' }}>● Corridor Reachable</span>
                  )}
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setSelectedVehKey(k)}
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                  >
                    Select
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Engineering Disclaimer */}
      <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--mute)', maxWidth: '700px', margin: '0 auto', lineHeight: 1.5 }}>
        {assessment?.disclaimer ||
          'MUNICIPAL CADASTRE ASSESSMENT. ROAD NETWORK REACHABILITY DOES NOT GUARANTEE PHYSICAL BUILDING ENTRANCE INGRESS.'}
      </div>
    </section>
  );
};

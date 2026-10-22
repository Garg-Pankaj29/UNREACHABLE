import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON as LeafletGeoJSON,
  Marker,
  Popup,
  Polyline,
  ZoomControl,
  useMap,
} from 'react-leaflet';
import L, { LatLngExpression, PathOptions } from 'leaflet';
import { GeoJSONFeature, IssueRecord, RouteViolation, VehicleProfile } from '../types';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface MapViewProps {
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  issues?: IssueRecord[];
  selectedFeature: GeoJSONFeature | null;
  selectedVehicle?: VehicleProfile;
  naiveRoadIds?: string[];
  awareRoadIds?: string[];
  violations?: RouteViolation[];
  layers?: {
    roads: boolean;
    buildings: boolean;
    stations: boolean;
    issues?: boolean;
  };

  statusFilters?: {
    ok?: boolean;
    feasible?: boolean;
    constrained?: boolean;
    infeasible?: boolean;
    unknown?: boolean;
  };
  searchQuery?: string;
  onSelectFeature?: (feature: GeoJSONFeature | null) => void;
  fullHeight?: boolean;
}

// Center of Chandigarh University Gharuan sector synthetic neighborhood
const DEFAULT_CENTER: LatLngExpression = [30.7686, 76.5750];
const DEFAULT_ZOOM = 16;

// Compact, recognizable emergency station marker
const createStationIcon = (isSelected: boolean) =>
  L.divIcon({
    className: 'custom-station-marker',
    html: `
      <div style="
        background: ${isSelected ? '#ffd60a' : 'var(--ink, #1c1f1b)'};
        color: ${isSelected ? '#1c1f1b' : 'var(--bg, #e4e7df)'};
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid ${isSelected ? '#1c1f1b' : 'var(--tape, #ffd60a)'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        cursor: pointer;
        transition: transform 0.15s ease;
      " title="Emergency Response Base">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v20M2 12h20"/>
        </svg>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });

// Compact, recognizable hazard issue marker
const createIssueIcon = (sev: string = 'high') => {
  const bg = sev === 'high' ? '#d7263d' : sev === 'med' ? '#e8710a' : '#7d837a';
  return L.divIcon({
    className: 'custom-issue-marker',
    html: `
      <div style="
        background: ${bg};
        color: #ffffff;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1.5px solid #ffffff;
        box-shadow: 0 3px 8px rgba(0,0,0,0.35);
        font-weight: 900;
        font-size: 13px;
        cursor: pointer;
        transform: rotate(45deg);
      " title="Access Hazard Constraint">
        <span style="transform: rotate(-45deg); line-height: 1;">!</span>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
};

// Red violation marker for naive route failure points
const createViolationIcon = () =>
  L.divIcon({
    className: 'custom-violation-marker',
    html: `
      <div style="
        background: #d7263d;
        color: #ffffff;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #ffffff;
        box-shadow: 0 0 10px rgba(215,38,61,0.8);
        font-weight: 900;
        font-size: 13px;
        cursor: pointer;
        animation: pulse 1.5s infinite;
      " title="Route Clearance Violation Point">
        <span>✕</span>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });


function MapViewportManager({
  features,
  selectedFeature,
  resetCount,
}: {
  features: GeoJSONFeature[];
  selectedFeature: GeoJSONFeature | null;
  resetCount: number;
}) {
  const map = useMap();
  const initialFitDone = useRef(false);

  // Invalidate size on mount and window resize
  useEffect(() => {
    map.invalidateSize();
    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener('resize', handleResize);
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 450);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);

  // Fit bounds to all features
  const fitToFeatures = useCallback(() => {
    if (!features || features.length === 0) return;
    try {
      const bounds = L.latLngBounds([]);
      features.forEach((f) => {
        const geom = f.geometry;
        if (!geom) return;
        if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
          bounds.extend([geom.coordinates[1], geom.coordinates[0]]);
        } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach((c: any) => {
            if (Array.isArray(c) && c.length >= 2) bounds.extend([c[1], c[0]]);
          });
        } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach((ring: any) => {
            if (Array.isArray(ring)) {
              ring.forEach((c: any) => {
                if (Array.isArray(c) && c.length >= 2) bounds.extend([c[1], c[0]]);
              });
            }
          });
        }
      });

      if (bounds.isValid()) {
        const isMobile = window.innerWidth <= 768;
        map.fitBounds(bounds, {
          paddingTopLeft: isMobile ? [16, 90] : [320, 80],
          paddingBottomRight: isMobile ? [16, 120] : [60, 90],
          maxZoom: 17,
        });
      }
    } catch (err) {
      console.warn('fitBounds error:', err);
    }
  }, [features, map]);

  // Initial fit when data loads
  useEffect(() => {
    if (!initialFitDone.current && features.length > 0) {
      fitToFeatures();
      initialFitDone.current = true;
    }
  }, [features, fitToFeatures]);

  // Reset trigger
  useEffect(() => {
    if (resetCount > 0) {
      fitToFeatures();
    }
  }, [resetCount, fitToFeatures]);

  // Pan to selected feature
  useEffect(() => {
    if (!selectedFeature) return;
    const geom = selectedFeature.geometry;
    if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
      map.panTo([geom.coordinates[1], geom.coordinates[0]], { animate: true });
    } else if (
      geom?.type === 'LineString' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0
    ) {
      const midCoord = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
      map.panTo([midCoord[1], midCoord[0]], { animate: true });
    } else if (
      geom?.type === 'Polygon' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates[0]?.length > 0
    ) {
      const ring = geom.coordinates[0];
      const midCoord = ring[0];
      map.panTo([midCoord[1], midCoord[0]], { animate: true });
    }
  }, [selectedFeature, map]);

  return null;
}

export const MapView: React.FC<MapViewProps> = ({
  buildings,
  roads,
  stations,
  issues = [],
  selectedFeature,
  selectedVehicle,
  naiveRoadIds = [],
  awareRoadIds = [],
  violations = [],
  layers = { roads: true, buildings: true, stations: true, issues: true },
  statusFilters = { ok: true, feasible: true, constrained: true, infeasible: true, unknown: true },
  searchQuery = '',
  onSelectFeature,
  fullHeight = false,
}) => {
  const [tileError, setTileError] = useState(false);
  const [resetCount, setResetCount] = useState(0);

  const q = searchQuery.toLowerCase().trim();

  // Filter features based on search and status
  const visibleRoads = layers.roads
    ? roads.filter((r) => {
        const props = r.properties || {};
        const st = props.access_status || 'unknown';
        const isStatusAllowed =
          st === 'feasible' || st === 'ok'
            ? statusFilters.ok ?? statusFilters.feasible ?? true
            : statusFilters[st as keyof typeof statusFilters] ?? true;

        if (!isStatusAllowed) return false;
        if (!q) return true;
        return (
          props.name?.toLowerCase().includes(q) ||
          props.id?.toLowerCase().includes(q)
        );
      })
    : [];

  const visibleBuildings = layers.buildings
    ? buildings.filter((b) => {
        const props = b.properties || {};
        const st = props.access_status || 'unknown';
        const isStatusAllowed =
          st === 'feasible' || st === 'ok'
            ? statusFilters.ok ?? statusFilters.feasible ?? true
            : statusFilters[st as keyof typeof statusFilters] ?? true;

        if (!isStatusAllowed) return false;
        if (!q) return true;
        return (
          props.name?.toLowerCase().includes(q) ||
          props.id?.toLowerCase().includes(q)
        );
      })
    : [];

  const visibleStations = layers.stations
    ? stations.filter((s) => {
        if (!q) return true;
        const props = s.properties || {};
        return (
          props.name?.toLowerCase().includes(q) ||
          props.id?.toLowerCase().includes(q)
        );
      })
    : [];

  // All active features for bounding box calculation
  const allFeatures = [...visibleBuildings, ...visibleRoads, ...visibleStations];

  // Refined GIS Road styling: clean stroke widths, clear contrast, restrained
  const getRoadStyle = (feature: any): PathOptions => {
    const props = feature.properties || {};
    const status = props.access_status;
    const width = props.width_m;
    const isSelected = selectedFeature?.properties?.id === props.id;

    const reqW = selectedVehicle?.minClearanceWidthM ?? selectedVehicle?.min_clearance_width_m;
    const isVehicleConstrained =
      reqW !== undefined &&
      width !== null &&
      width !== undefined &&
      width < reqW;

    let color = '#7d837a'; // unknown
    let dashArray: string | undefined = '4, 6';
    let weight = 3.5;
    let opacity = 0.85;

    if (status === 'feasible' || status === 'ok') {
      if (isVehicleConstrained) {
        color = '#e8710a'; // amber
        dashArray = '5, 5';
      } else {
        color = '#168a5c'; // green
        dashArray = undefined;
      }
    } else if (status === 'constrained') {
      color = '#e8710a'; // amber
      dashArray = '5, 5';
    } else if (status === 'infeasible') {
      color = '#d7263d'; // red
      dashArray = undefined;
    }

    if (isSelected) {
      color = '#ffd60a'; // highlight accent
      weight = 5.5;
      opacity = 1.0;
      dashArray = undefined;
    }

    return {
      color,
      weight,
      opacity,
      dashArray,
      lineCap: 'round',
      lineJoin: 'round',
    };
  };

  // Refined GIS Building styling: restrained translucent fills, crisp outlines
  const getBuildingStyle = (feature: any): PathOptions => {
    const props = feature.properties || {};
    const status = props.access_status;
    const isSelected = selectedFeature?.properties?.id === props.id;

    let fillColor = '#7d837a';
    let borderColor = '#5d635a';

    if (status === 'feasible' || status === 'ok') {
      fillColor = '#168a5c';
      borderColor = '#10724c';
    } else if (status === 'constrained') {
      fillColor = '#e8710a';
      borderColor = '#b35606';
    } else if (status === 'infeasible') {
      fillColor = '#d7263d';
      borderColor = '#b81e32';
    }

    return {
      fillColor,
      fillOpacity: isSelected ? 0.40 : 0.22,
      color: isSelected ? '#ffd60a' : borderColor,
      weight: isSelected ? 2.5 : 1.5,
      opacity: isSelected ? 1 : 0.85,
    };
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const props = feature.properties || {};

    layer.on({
      click: () => {
        onSelectFeature?.(feature);
      },
      mouseover: (e) => {
        const l = e.target;
        if (l.setStyle && selectedFeature?.properties?.id !== props.id) {
          l.setStyle({ opacity: 1 });
        }
      },
      mouseout: (e) => {
        const l = e.target;
        if (l.setStyle && selectedFeature?.properties?.id !== props.id) {
          l.setStyle({ opacity: 0.85 });
        }
      },
    });

    // Compute effective vehicle-aware status for popup badge
    const reqW = selectedVehicle?.minClearanceWidthM ?? selectedVehicle?.min_clearance_width_m;
    let effectiveStatus = props.access_status || 'unknown';
    if (props.feature_type === 'road' && reqW !== undefined) {
      const roadWidth = props.width_m;
      const hasObstruction = props.obstruction && String(props.obstruction).trim() && String(props.obstruction).toLowerCase() !== 'null';
      if (hasObstruction) {
        effectiveStatus = 'infeasible';
      } else if (roadWidth !== null && roadWidth !== undefined) {
        if (roadWidth < reqW) {
          effectiveStatus = 'infeasible';
        } else if (roadWidth < reqW + 0.4) {
          effectiveStatus = 'constrained';
        } else {
          effectiveStatus = 'feasible';
        }
      } else {
        effectiveStatus = 'unknown';
      }
    }

    const statusBadge =
      effectiveStatus === 'feasible' || effectiveStatus === 'ok'
        ? '<span style="color:#168a5c; font-weight:700;">● Verified accessible</span>'
        : effectiveStatus === 'constrained'
        ? '<span style="color:#e8710a; font-weight:700;">▲ Constrained</span>'
        : effectiveStatus === 'infeasible'
        ? '<span style="color:#d7263d; font-weight:700;">✕ Inaccessible</span>'
        : '<span style="color:#7d837a; font-weight:700;">? Unknown (Unsurveyed)</span>';

    const content = `
      <div style="font-family: 'Inter', system-ui, sans-serif; min-width: 190px;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--mute, #5d635a); margin-bottom: 2px;">
          ${props.feature_type || 'Asset'} · ${props.id}
        </div>
        <div style="font-size: 14px; font-weight: 800; color: var(--ink, #1c1f1b); margin-bottom: 4px;">
          ${props.name || 'Feature'}
        </div>
        <div style="margin-bottom: 6px; font-size: 12px;">
          ${statusBadge}
        </div>
        ${
          props.width_m
            ? `<div style="font-size: 12px; color: var(--mute);">Road Width: <b>${props.width_m} m</b></div>`
            : ''
        }
        ${
          props.floors
            ? `<div style="font-size: 12px; color: var(--mute);">Storeys: <b>${props.floors}</b></div>`
            : ''
        }
        <div style="margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--ink);">
          Click to inspect details →
        </div>
      </div>
    `;

    layer.bindPopup(content);
  };

  return (
    <div
      className={`relative w-full overflow-hidden ${
        fullHeight ? 'h-full w-full' : 'h-[520px] rounded-2xl border border-line shadow-xs'
      }`}
      style={{ background: 'var(--bg)' }}
    >
      {/* Reset Center control placed cleanly above zoom controls */}
      {fullHeight && (
        <div
          className="absolute z-[800]"
          style={{
            bottom: '158px',
            right: '16px',
          }}
        >
          <button
            type="button"
            onClick={() => setResetCount((c) => c + 1)}
            title="Recenter and frame all features"
            className="btn sm"
            style={{
              background: 'var(--glass)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
              fontWeight: 600,
              fontSize: '13px',
              height: '32px',
              padding: '0 12px',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            <span>Reset view</span>
          </button>
        </div>
      )}

      {/* Offline Tile Graceful Fallback Notice */}
      {tileError && (
        <div
          className="absolute bottom-20 left-4 z-[900] p-2 px-3 rounded-lg text-xs flex items-center space-x-2"
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span>Base map offline; vector GeoJSON layers rendered directly.</span>
        </div>
      )}

      {/* Leaflet Map Container with Zoom Control at bottomright */}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <ZoomControl position="bottomright" />
        <MapViewportManager
          features={allFeatures}
          selectedFeature={selectedFeature}
          resetCount={resetCount}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileerror: () => setTileError(true),
            load: () => setTileError(false),
          }}
        />

        {visibleRoads.length > 0 && (
          <LeafletGeoJSON
            key={`rds-${selectedVehicle?.id}-${selectedFeature?.properties?.id}-${visibleRoads.length}`}
            data={
              {
                type: 'FeatureCollection',
                features: visibleRoads,
              } as any
            }
            style={getRoadStyle}
            onEachFeature={onEachFeature}
          />
        )}

        {visibleBuildings.length > 0 && (
          <LeafletGeoJSON
            key={`bldgs-${selectedFeature?.properties?.id}-${visibleBuildings.length}`}
            data={
              {
                type: 'FeatureCollection',
                features: visibleBuildings,
              } as any
            }
            style={getBuildingStyle}
            onEachFeature={onEachFeature}
          />
        )}

        {/* Emergency Station Markers */}
        {visibleStations.map((st) => {
          const coords = st.geometry.coordinates;
          const isSelected = selectedFeature?.properties?.id === st.properties.id;
          return (
            <Marker
              key={st.properties.id}
              position={[coords[1], coords[0]]}
              icon={createStationIcon(isSelected)}
              eventHandlers={{
                click: () => onSelectFeature?.(st),
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 700 }}>
                    Emergency Hub · {st.properties.id}
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>
                    {st.properties.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '4px' }}>
                    Type: {st.properties.station_type}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '2px' }}>
                    Primary Access: <b>{st.properties.primary_access_road}</b>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
                    Click to inspect station →
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Road Hazard Issue Markers */}
        {layers.issues &&
          issues.map((iss) => {
            const road = roads.find((r) => r.properties?.id === iss.edge);
            if (!road || road.geometry?.type !== 'LineString') return null;
            const coords = road.geometry.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return null;
            const mid = coords[Math.floor(coords.length / 2)];
            return (
              <Marker
                key={iss.id}
                position={[mid[1], mid[0]]}
                icon={createIssueIcon(iss.sev)}
                eventHandlers={{
                  click: () => {
                    onSelectFeature?.({
                      type: 'Feature',
                      id: iss.id,
                      geometry: {
                        type: 'Point',
                        coordinates: mid,
                      },
                      properties: {
                        id: iss.id,
                        feature_type: 'issue',
                        name: iss.t,
                        type: iss.type,
                        severity: iss.sev,
                        edge: iss.edge,
                        road_name: road.properties?.name || iss.edge,
                        verification_status: iss.ver,
                        status: iss.st,
                        fixW: iss.fixW,
                        ai: iss.ai,
                        age: iss.age,
                        access_status: iss.sev === 'high' ? 'infeasible' : 'constrained',
                      },
                    } as any);
                  },
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'Inter, system-ui, sans-serif', minWidth: 200 }}>
                    <div
                      style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        fontWeight: 800,
                        color: iss.sev === 'high' ? '#d7263d' : '#e8710a',
                        marginBottom: '2px',
                      }}
                    >
                      Hazard Alert · {iss.id} ({iss.sev?.toUpperCase()})
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>
                      {iss.t}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '4px' }}>
                      Segment: <b>{iss.edge}</b> ({iss.type})
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--ink)', marginTop: '4px' }}>
                      {iss.ver}
                    </div>
                    <div
                      style={{
                        marginTop: '8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--ink)',
                      }}
                    >
                      Click to inspect road details →
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {/* Reality Check: Aware Route Polyline (Solid blue/teal) */}
        {awareRoadIds.length > 0 &&
          awareRoadIds.map((rId) => {
            const road = roads.find((r) => r.properties?.id === rId);
            if (!road || road.geometry?.type !== 'LineString') return null;
            const positions: [number, number][] = (road.geometry.coordinates || []).map((c: any) => [c[1], c[0]]);
            return (
              <Polyline
                key={`aware-${rId}`}
                positions={positions}
                pathOptions={{
                  color: '#2a9d8f',
                  weight: 6,
                  opacity: 0.9,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            );
          })}

        {/* Reality Check: Naive Route Polyline (Grey dashed) */}
        {naiveRoadIds.length > 0 &&
          naiveRoadIds.map((rId) => {
            const road = roads.find((r) => r.properties?.id === rId);
            if (!road || road.geometry?.type !== 'LineString') return null;
            const positions: [number, number][] = (road.geometry.coordinates || []).map((c: any) => [c[1], c[0]]);
            return (
              <Polyline
                key={`naive-${rId}`}
                positions={positions}
                pathOptions={{
                  color: '#6c757d',
                  weight: 4,
                  opacity: 0.85,
                  dashArray: '8, 8',
                  lineCap: 'round',
                }}
              />
            );
          })}

        {/* Reality Check: Red Violation Markers along Naive Path */}
        {violations.map((violation) => {
          const road = roads.find((r) => r.properties?.id === violation.road_id);
          if (!road || road.geometry?.type !== 'LineString') return null;
          const coords = road.geometry.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return null;
          const mid = coords[Math.floor(coords.length / 2)];
          return (
            <Marker
              key={`violation-${violation.road_id}`}
              position={[mid[1], mid[0]]}
              icon={createViolationIcon()}
            >
              <Popup>
                <div style={{ fontFamily: 'Inter, system-ui, sans-serif', minWidth: 200 }}>
                  <div
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      fontWeight: 800,
                      color: '#d7263d',
                      marginBottom: '2px',
                    }}
                  >
                    Clearance Violation · {violation.road_id}
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
                    {violation.reason}
                  </div>
                  {violation.width_m !== null && violation.width_m !== undefined && (
                    <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '4px' }}>
                      Measured: <b>{violation.width_m}m</b> · Required: <b>{violation.required_m}m</b>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

      </MapContainer>
    </div>
  );
};

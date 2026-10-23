import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON as LeafletGeoJSON,
  Marker,
  Popup,
  Polyline,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L, { LatLngExpression, PathOptions } from 'leaflet';
import { AlternativeRoute, GeoJSONFeature, IssueRecord, RouteViolation, VehicleProfile } from '../types';
import { RefreshCw } from 'lucide-react';

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
  onViewportChange?: (bbox: string, zoom: number) => void;
  routeGeometry?: { type: string; coordinates: [number, number][] } | null;
  routeClassification?: string;
  alternativeRoutes?: AlternativeRoute[];
  selectedRouteId?: string;
  onSelectRoute?: (routeId: string) => void;
  destinationCoords?: [number, number] | null;
  destinationName?: string;
  center?: LatLngExpression;
  zoom?: number;
  fullHeight?: boolean;
  showLegend?: boolean;
  datasetMode?: 'pilot' | 'sample';
}

// Default center: Punjab & Chandigarh State-wide Emergency Network
const DEFAULT_PILOT_CENTER: LatLngExpression = [31.05, 75.75];
const DEFAULT_CENTER: LatLngExpression = [30.7686, 76.5750];
const DEFAULT_ZOOM = 13;

// Distinct emergency facility markers for hospitals, fire stations, clinics, and doctors
const createStationIcon = (isSelected: boolean, facilityType?: string) => {
  let bg = '#1c1f1b';
  let border = '#ffd60a';
  let label = '+';
  let title = 'Emergency Response Base';
  let badgeColor = '#ffffff';
  let size = 20;

  const ft = (facilityType || '').toLowerCase();
  if (ft === 'hospital') {
    bg = '#2563eb'; // Blue
    border = '#bfdbfe';
    label = 'H';
    title = 'Hospital';
    size = 20;
  } else if (ft === 'fire_station' || ft === 'fire') {
    bg = '#dc2626'; // Red
    border = '#fecaca';
    label = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3.5z"/></svg>';
    title = 'Fire Station';
    size = 24;
  } else if (ft === 'clinic') {
    bg = '#0d9488'; // Teal
    border = '#99f6e4';
    label = '+';
    title = 'Medical Clinic';
    size = 18;
  } else if (ft === 'doctors') {
    bg = '#0284c7'; // Sky
    border = '#bae6fd';
    label = 'Dr';
    title = 'Health Clinic / Doctor';
    size = 18;
  } else if (ft === 'place' || ft === 'landmark' || ft === 'location') {
    bg = '#d97706'; // Amber
    border = '#fde68a';
    label = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
    title = 'Search Location / Landmark';
    size = 20;
  }

  if (isSelected) {
    size = 28;
    border = '#ffd60a';
    if (ft !== 'place' && ft !== 'landmark' && ft !== 'location') {
      bg = '#ffd60a';
      badgeColor = '#1c1f1b';
    } else {
      border = '#ffd60a';
      badgeColor = '#ffffff';
    }
  }

  const half = Math.round(size / 2);

  return L.divIcon({
    className: `custom-station-marker custom-facility-${ft || 'base'}`,
    html: `
      <div style="
        background: ${bg};
        color: ${badgeColor};
        width: ${size}px;
        height: ${size}px;
        border-radius: ${size > 20 ? '7px' : '5px'};
        display: flex;
        align-items: center;
        justify-content: center;
        border: ${isSelected ? '2.5px' : '1.5px'} solid ${border};
        box-shadow: ${isSelected ? '0 0 14px rgba(255, 214, 10, 0.9)' : '0 2px 6px rgba(0,0,0,0.3)'};
        cursor: pointer;
        font-family: system-ui, sans-serif;
        font-weight: 800;
        font-size: ${size < 18 ? '10px' : label.length > 1 ? '11px' : '12px'};
        transition: transform 0.15s ease;
      " title="${title}">
        <span>${label}</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half - 2],
  });
};

// Destination marker for searched/selected route destinations
const createDestinationIcon = (label: string = 'Destination') => {
  return L.divIcon({
    className: 'custom-destination-marker',
    html: `
      <div style="
        background: #d97706;
        color: #ffffff;
        padding: 4px 8px;
        border-radius: 6px;
        border: 2px solid #fde68a;
        font-size: 11px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        transform: translate(-50%, -100%);
        white-space: nowrap;
        font-family: 'Bricolage Grotesque', system-ui, sans-serif;
      ">
        <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
        <span>${label}</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
};

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
  routeGeometry,
  alternativeRoutes,
  datasetMode,
}: {
  features: GeoJSONFeature[];
  selectedFeature: GeoJSONFeature | null;
  resetCount: number;
  routeGeometry?: { type: string; coordinates: [number, number][] } | null;
  alternativeRoutes?: AlternativeRoute[];
  datasetMode?: string;
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
          const [lon, lat] = geom.coordinates;
          if (lon && lat && Math.abs(lat) > 1 && Math.abs(lon) > 1) {
            bounds.extend([lat, lon]);
          }
        } else if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach((c: any) => {
            if (Array.isArray(c) && c.length >= 2 && c[0] && c[1] && Math.abs(c[1]) > 1 && Math.abs(c[0]) > 1) {
              bounds.extend([c[1], c[0]]);
            }
          });
        } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
          geom.coordinates.forEach((ring: any) => {
            if (Array.isArray(ring)) {
              ring.forEach((c: any) => {
                if (Array.isArray(c) && c.length >= 2 && c[0] && c[1] && Math.abs(c[1]) > 1 && Math.abs(c[0]) > 1) {
                  bounds.extend([c[1], c[0]]);
                }
              });
            }
          });
        }
      });

      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [28, 28],
          maxZoom: 16,
        });
      }
    } catch (err) {
      console.warn('fitBounds error:', err);
    }
  }, [features, map]);

  // Initial fit only once when data first loads
  useEffect(() => {
    if (!initialFitDone.current && features.length > 0) {
      fitToFeatures();
      initialFitDone.current = true;
    }
  }, [features.length > 0, fitToFeatures]);

  // Refit when dataset mode explicitly toggles
  const prevMode = useRef(datasetMode);
  useEffect(() => {
    if (datasetMode && prevMode.current && prevMode.current !== datasetMode) {
      fitToFeatures();
      prevMode.current = datasetMode;
    } else if (datasetMode) {
      prevMode.current = datasetMode;
    }
  }, [datasetMode, fitToFeatures]);

  // Reset trigger
  useEffect(() => {
    if (resetCount > 0) {
      fitToFeatures();
    }
  }, [resetCount, fitToFeatures]);

  // Fit to calculated emergency route or multiple alternative routes
  useEffect(() => {
    if (alternativeRoutes && alternativeRoutes.length > 0) {
      try {
        const bounds = L.latLngBounds([]);
        alternativeRoutes.forEach((r) => {
          if (r.geometry_geojson?.coordinates) {
            r.geometry_geojson.coordinates.forEach((c: [number, number]) => {
              bounds.extend([c[1], c[0]]);
            });
          }
        });
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true });
        }
      } catch (err) {
        console.warn('fit alternative routes error:', err);
      }
    } else if (routeGeometry && routeGeometry.coordinates && routeGeometry.coordinates.length > 1) {
      try {
        const bounds = L.latLngBounds(routeGeometry.coordinates.map((c: [number, number]) => [c[1], c[0]]));
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true });
        }
      } catch (err) {
        console.warn('fit route bounds error:', err);
      }
    }
  }, [routeGeometry, alternativeRoutes, map]);

  // Pan and zoom to selected feature (only if not displaying alternative routes)
  useEffect(() => {
    if (!selectedFeature || (alternativeRoutes && alternativeRoutes.length > 0)) return;
    const geom = selectedFeature.geometry;
    if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
      const lat = geom.coordinates[1];
      const lon = geom.coordinates[0];
      const targetZoom = Math.max(map.getZoom(), 16);
      map.setView([lat, lon], targetZoom, { animate: true });
    } else if (
      geom?.type === 'LineString' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates.length > 0
    ) {
      const bounds = L.latLngBounds([]);
      geom.coordinates.forEach((c: any) => {
        if (Array.isArray(c) && c.length >= 2) bounds.extend([c[1], c[0]]);
      });
      if (bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 16, padding: [40, 40], animate: true });
      } else {
        const midCoord = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
        map.setView([midCoord[1], midCoord[0]], Math.max(map.getZoom(), 15), { animate: true });
      }
    } else if (
      geom?.type === 'Polygon' &&
      Array.isArray(geom.coordinates) &&
      geom.coordinates[0]?.length > 0
    ) {
      const bounds = L.latLngBounds([]);
      geom.coordinates[0].forEach((c: any) => {
        if (Array.isArray(c) && c.length >= 2) bounds.extend([c[1], c[0]]);
      });
      if (bounds.isValid()) {
        map.fitBounds(bounds, { maxZoom: 17, padding: [40, 40], animate: true });
      } else {
        const midCoord = geom.coordinates[0][0];
        map.setView([midCoord[1], midCoord[0]], Math.max(map.getZoom(), 16), { animate: true });
      }
    }
  }, [selectedFeature, map]);

  return null;
}

function MapEventsWatcher({
  onViewportChange,
  onZoomChange,
}: {
  onViewportChange?: (bbox: string, zoom: number) => void;
  onZoomChange?: (zoom: number) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      onZoomChange?.(map.getZoom());
      if (!onViewportChange) return;
      const b = map.getBounds();
      const bboxStr = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
      onViewportChange(bboxStr, map.getZoom());
    },
    zoomend: () => {
      onZoomChange?.(map.getZoom());
      if (!onViewportChange) return;
      const b = map.getBounds();
      const bboxStr = `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b.getNorth().toFixed(4)}`;
      onViewportChange(bboxStr, map.getZoom());
    },
  });
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
  searchQuery: _searchQuery = '',
  onSelectFeature,
  onViewportChange,
  routeGeometry,
  routeClassification,
  alternativeRoutes,
  selectedRouteId,
  onSelectRoute,
  destinationCoords,
  destinationName,
  center,
  zoom,
  fullHeight = false,
  showLegend = true,
  datasetMode,
}) => {
  const [tileError, setTileError] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [currentZoom, setCurrentZoom] = useState<number>(zoom || DEFAULT_ZOOM);

  const isPilotMode = stations.length > 5 || roads.length > 50;
  const mapCenter = center || (isPilotMode ? DEFAULT_PILOT_CENTER : DEFAULT_CENTER);
  const mapZoom = zoom || (isPilotMode ? 8 : DEFAULT_ZOOM);

  // Filter features based on status
  const visibleRoads = layers.roads
    ? roads.filter((r) => {
        const props = r.properties || {};
        const st = props.access_status || 'unknown';
        return st === 'feasible' || st === 'ok'
          ? statusFilters.ok ?? statusFilters.feasible ?? true
          : statusFilters[st as keyof typeof statusFilters] ?? true;
      })
    : [];

  const visibleBuildings = layers.buildings
    ? buildings.filter((b) => {
        const props = b.properties || {};
        const st = props.access_status || 'unknown';
        return st === 'feasible' || st === 'ok'
          ? statusFilters.ok ?? statusFilters.feasible ?? true
          : statusFilters[st as keyof typeof statusFilters] ?? true;
      })
    : [];

  const visibleStations = useMemo(() => {
    if (!layers.stations) return [];
    // At neighborhood zoom (>= 14) or for compact datasets, show all facilities
    if (stations.length <= 40 || currentZoom >= 14) return stations;

    const selectedId = selectedFeature?.properties?.id || selectedFeature?.id;
    const prioritized: GeoJSONFeature[] = [];
    const seen = new Set<string>();

    // 1. Always prioritize all fire stations (primary emergency dispatch origins)
    stations.forEach((s) => {
      const ft = (s.properties?.facility_type || s.properties?.station_type || '').toLowerCase();
      if (ft === 'fire_station' || ft === 'fire') {
        const id = s.properties?.id || s.id;
        if (id) {
          seen.add(id);
          prioritized.push(s);
        }
      }
    });

    // 2. Always include selected station
    if (selectedId) {
      const sel = stations.find((s) => (s.properties?.id || s.id) === selectedId);
      if (sel && !seen.has(selectedId)) {
        seen.add(selectedId);
        prioritized.push(sel);
      }
    }

    // 3. Balanced sample of major hospitals across the region (up to 40)
    const hospitals = stations.filter((s) => {
      const ft = (s.properties?.facility_type || s.properties?.station_type || '').toLowerCase();
      return ft === 'hospital';
    });
    const hStep = Math.max(1, Math.floor(hospitals.length / 40));
    for (let i = 0; i < hospitals.length; i += hStep) {
      const h = hospitals[i];
      const id = h.properties?.id || h.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        prioritized.push(h);
      }
    }

    // 4. Prominently include medical clinics across the sectors (up to 40)
    const clinics = stations.filter((s) => {
      const ft = (s.properties?.facility_type || s.properties?.station_type || '').toLowerCase();
      return ft === 'clinic';
    });
    const cStep = Math.max(1, Math.floor(clinics.length / 40));
    for (let i = 0; i < clinics.length; i += cStep) {
      const c = clinics[i];
      const id = c.properties?.id || c.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        prioritized.push(c);
      }
    }

    // 5. Doctors and health dispensaries across the sectors (up to 20)
    const doctors = stations.filter((s) => {
      const ft = (s.properties?.facility_type || s.properties?.station_type || '').toLowerCase();
      return ft === 'doctors' || ft === 'dispensary';
    });
    const dStep = Math.max(1, Math.floor(doctors.length / 20));
    for (let i = 0; i < doctors.length; i += dStep) {
      const d = doctors[i];
      const id = d.properties?.id || d.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        prioritized.push(d);
      }
    }

    return prioritized;
  }, [layers.stations, stations, selectedFeature, currentZoom]);

  // All active features for bounding box calculation
  const allFeatures = useMemo(() => {
    return [...visibleStations, ...visibleRoads, ...visibleBuildings];
  }, [visibleRoads, visibleBuildings, visibleStations]);

  // Refined GIS Road styling: clean stroke widths, clear contrast, restrained
  const getRoadStyle = (feature: any): PathOptions => {
    const props = feature.properties || {};
    const status = props.access_status;
    const width = props.width_m;
    const isSelected = selectedFeature?.properties?.id === props.id;
    const isTraversed = awareRoadIds.includes(props.id);

    const reqW = selectedVehicle?.minClearanceWidthM ?? selectedVehicle?.min_clearance_width_m;

    const accessTag = props.access || props.tags?.access;
    const vehicleTag = props.vehicle || props.tags?.vehicle;
    const hasRestriction = accessTag === 'no' || accessTag === 'private' || vehicleTag === 'no' || vehicleTag === 'private';
    const hasObstruction = Boolean(props.obstruction && String(props.obstruction).trim() && String(props.obstruction).toLowerCase() !== 'null');

    // Vector-only basemap requires crisp, continuous road lines with solid visual presence
    let color = '#64748b'; // solid visible road corridor
    let dashArray: string | undefined = undefined; // Solid line so streets are continuous!
    let weight = isTraversed ? 5.5 : 3.5;
    let opacity = isTraversed ? 1.0 : 0.85;

    if (hasRestriction || hasObstruction || status === 'infeasible' || status === 'inaccessible') {
      color = '#d7263d'; // red — confirmed inaccessible
      weight = 4.0;
    } else if (width !== null && width !== undefined && reqW !== undefined) {
      if (width < reqW) {
        color = '#d7263d'; // red — confirmed inaccessible
        weight = 4.0;
      } else if (width < reqW + 0.4) {
        color = '#e8710a'; // amber — constrained
        weight = 4.0;
      } else {
        color = '#168a5c'; // green — confirmed feasible
        weight = 4.0;
      }
    } else if (status === 'constrained') {
      color = '#e8710a'; // amber — constrained
      weight = 4.0;
    } else if (status === 'feasible' || status === 'ok' || status === 'accessible') {
      color = '#168a5c'; // green — confirmed feasible
      weight = 4.0;
    } else {
      // Unmeasured / unknown status: solid visible slate road
      color = '#64748b';
      weight = 3.5;
      opacity = 0.85;
    }

    if (isSelected) {
      color = '#ffd60a'; // highlight accent
      weight = 6.5;
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

    let fillColor = '#475569';
    let borderColor = '#64748b';

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
      fillOpacity: isSelected ? 0.60 : 0.35,
      color: isSelected ? '#ffd60a' : borderColor,
      weight: isSelected ? 2.5 : 1.2,
      opacity: isSelected ? 1 : 0.8,
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

    const isOutsidePilot = props.inside_pilot_area === false;
    const statusBadge = isOutsidePilot
      ? '<span style="color:#d97706; font-weight:700;">Outside Pilot Boundary</span>'
      : props.access_status === 'feasible' || props.access_status === 'ok'
      ? '<span style="color:#168a5c; font-weight:700;">Verified accessible</span>'
      : props.access_status === 'constrained'
      ? '<span style="color:#e8710a; font-weight:700;">Constrained</span>'
      : props.access_status === 'infeasible'
      ? '<span style="color:#d7263d; font-weight:700;">Potentially inaccessible</span>'
      : '<span style="color:#7d837a; font-weight:700;">Unknown (Unsurveyed)</span>';

    const coverageWarningHtml = isOutsidePilot
      ? `<div style="margin-bottom: 6px; padding: 5px 7px; background: rgba(217, 119, 6, 0.14); border: 1px solid #d97706; border-radius: 4px; font-size: 11px; color: #92400e; font-weight: 600; line-height: 1.3;">
          Outside pilot coverage • Detailed access analysis unavailable
         </div>`
      : '';

    const content = `
      <div style="font-family: 'Bricolage Grotesque', system-ui, sans-serif; min-width: 190px;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--mute, #5d635a); margin-bottom: 2px;">
          ${props.feature_type || 'Asset'} · ${props.source === 'online_osm' ? 'ONLINE OSM' : props.id || 'Location'}
        </div>
        <div style="font-size: 14px; font-weight: 800; color: var(--ink, #1c1f1b); margin-bottom: 4px;">
          ${props.name || 'Feature'}
        </div>
        ${coverageWarningHtml}
        <div style="margin-bottom: 6px; font-size: 12px;">
          ${statusBadge}
        </div>
        ${
          props.details
            ? `<div style="font-size: 11px; color: var(--mute); margin-bottom: 4px; line-height: 1.3;">${props.details}</div>`
            : ''
        }
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
      {/* Reset Center control placed cleanly above zoom controls with comfortable clearance */}
      {fullHeight && (
        <div
          className="absolute z-[800]"
          style={{
            bottom: '204px',
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
            color: 'var(--mute)',
          }}
        >
          <span>Basemap tiles unavailable (operating in offline fallback mode)</span>
        </div>
      )}

      {/* Leaflet Map Container with Zoom Control at bottomright */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        zoomControl={false}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <ZoomControl position="bottomright" />
        <MapEventsWatcher onViewportChange={onViewportChange} onZoomChange={setCurrentZoom} />
        <MapViewportManager
          features={allFeatures}
          selectedFeature={selectedFeature}
          resetCount={resetCount}
          routeGeometry={routeGeometry}
          alternativeRoutes={alternativeRoutes}
          datasetMode={datasetMode}
        />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
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

        {/* Simultaneous Multiple Colour-Coded Alternative Routes */}
        {alternativeRoutes && alternativeRoutes.length > 0 ? (
          alternativeRoutes.map((route) => {
            const coords = route.geometry_geojson?.coordinates;
            if (!coords || coords.length < 2) return null;
            const isSelected = selectedRouteId ? selectedRouteId === route.route_id : route.route_index === 1;
            const latlngs = coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);

            const statusBadge =
              route.classification === 'accessible' || route.classification === 'feasible' || route.classification === 'ok'
                ? { label: 'Verified Accessible', bg: '#168a5c' }
                : route.classification === 'constrained'
                ? { label: 'Constrained Margin', bg: '#e8710a' }
                : route.classification === 'inaccessible' || route.classification === 'infeasible'
                ? { label: 'Blocked / Inaccessible', bg: '#d7263d' }
                : { label: 'Unknown (Unsurveyed)', bg: '#7d837a' };

            return (
              <React.Fragment key={route.route_id}>
                {/* Background high-contrast dark casing */}
                <Polyline
                  positions={latlngs}
                  pathOptions={{
                    color: isSelected ? '#090d16' : '#1e293b',
                    weight: isSelected ? 10 : 6,
                    opacity: isSelected ? 0.85 : 0.45,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
                {/* Distinct route line with identity colour */}
                <Polyline
                  positions={latlngs}
                  eventHandlers={{
                    click: () => onSelectRoute?.(route.route_id),
                  }}
                  pathOptions={{
                    color: route.color,
                    weight: isSelected ? 6 : 3.5,
                    opacity: isSelected ? 1.0 : 0.65,
                    lineCap: 'round',
                    lineJoin: 'round',
                    dashArray: isSelected ? undefined : '8, 6',
                  }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: route.color }}>
                          {route.name}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: statusBadge.bg,
                            color: '#ffffff',
                          }}
                        >
                          {statusBadge.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
                        {route.total_distance_m >= 1000
                          ? `${(route.total_distance_m / 1000).toFixed(2)} km`
                          : `${Math.round(route.total_distance_m)} m`}{' '}
                        · {route.segment_count} road corridors
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--mute)', marginTop: '4px', lineHeight: 1.3 }}>
                        {route.explanation}
                      </div>
                      <div style={{ marginTop: '6px', fontSize: '11px', fontWeight: 700, color: '#2563eb', cursor: 'pointer' }}>
                        {isSelected ? '● Currently Focused Route' : 'Click to select this alternative →'}
                      </div>
                    </div>
                  </Popup>
                </Polyline>
              </React.Fragment>
            );
          })
        ) : routeGeometry && routeGeometry.coordinates && routeGeometry.coordinates.length > 1 ? (
          <>
            {/* Dark casing shadow for visual contrast */}
            <Polyline
              key={`route-casing-${routeGeometry.coordinates.length}`}
              positions={routeGeometry.coordinates.map((c: [number, number]) => [c[1], c[0]])}
              pathOptions={{
                color: '#090d16',
                weight: 8,
                opacity: 0.7,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {/* Color-coded route path following deterministic classification */}
            <Polyline
              key={`route-line-${routeGeometry.coordinates.length}-${routeClassification}`}
              positions={routeGeometry.coordinates.map((c: [number, number]) => [c[1], c[0]])}
              pathOptions={{
                color:
                  routeClassification === 'accessible' || routeClassification === 'feasible' || routeClassification === 'ok'
                    ? '#168a5c' // Green
                    : routeClassification === 'constrained'
                    ? '#e8710a' // Amber
                    : routeClassification === 'inaccessible' || routeClassification === 'infeasible'
                    ? '#d7263d' // Red
                    : '#0284c7', // Active blue
                weight: 5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        ) : null}

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

        {/* Emergency Station / Facility Markers */}
        {visibleStations.map((st) => {
          const coords = st.geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          const isSelected = selectedFeature?.properties?.id === st.properties?.id;
          const facType = st.properties?.facility_type || st.properties?.station_type || 'station';
          return (
            <Marker
              key={st.properties?.id || st.id}
              position={[coords[1], coords[0]]}
              icon={createStationIcon(isSelected, facType)}
              eventHandlers={{
                click: () => onSelectFeature?.(st),
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--mute)', fontWeight: 700 }}>
                    {facType.replace('_', ' ').toUpperCase()} · {st.properties?.id}
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>
                    {st.properties?.name || 'Emergency Facility'}
                  </div>
                  {st.properties?.operator && (
                    <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '2px' }}>
                      Operator: <b>{st.properties.operator}</b>
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '4px' }}>
                    Type: <b style={{ textTransform: 'capitalize' }}>{facType.replace('_', ' ')}</b>
                  </div>
                  <div style={{ fontSize: '11px', color: '#7d837a', marginTop: '2px' }}>
                    Verification: {st.properties?.verification_status || 'unverified_osm'}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
                    Click to inspect facility →
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Route Target Destination Marker */}
        {destinationCoords && destinationCoords.length >= 2 && (
          <Marker
            position={[destinationCoords[1], destinationCoords[0]]}
            icon={createDestinationIcon(destinationName || 'Destination')}
          >
            <Popup>
              <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#d97706', fontWeight: 800 }}>
                  Route Destination
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>
                  {destinationName || 'Destination Location'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--mute)', marginTop: '2px' }}>
                  Coordinates: {destinationCoords[1].toFixed(4)}, {destinationCoords[0].toFixed(4)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

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
                  click: () => onSelectFeature?.(road),
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', minWidth: 200 }}>
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
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', minWidth: 200 }}>
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

        {/* Highlighted Selected Feature if not in current visible collections */}
        {selectedFeature &&
          selectedFeature.geometry &&
          !visibleBuildings.some((b) => b.properties?.id === selectedFeature.properties?.id) &&
          !visibleRoads.some((r) => r.properties?.id === selectedFeature.properties?.id) &&
          !visibleStations.some((s) => s.properties?.id === selectedFeature.properties?.id) && (
            <LeafletGeoJSON
              key={`selected-solo-${selectedFeature.properties?.id || selectedFeature.id}`}
              data={selectedFeature as any}
              style={() => ({
                color: '#ffd60a',
                weight: 6,
                opacity: 1,
                fillColor: '#ffd60a',
                fillOpacity: 0.4,
              })}
              pointToLayer={(_, latlng) => {
                const ft =
                  selectedFeature.properties?.facility_type ||
                  selectedFeature.properties?.sub_type ||
                  selectedFeature.properties?.feature_type ||
                  'place';
                return L.marker(latlng, { icon: createStationIcon(true, ft) });
              }}
              onEachFeature={onEachFeature}
            />
          )}

      </MapContainer>

      {/* Accessibility Legend Overlay (Consistent: Green=Feasible, Amber=Constrained, Red=Inaccessible, Grey=Unknown) */}
      {showLegend && (
        <div
          className="map-accessibility-legend"
          style={{
            position: 'absolute',
            bottom: '84px',
            left: '16px',
            zIndex: 850,
            background: 'var(--glass)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1.5px solid var(--line)',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: '13px',
            fontFamily: 'Inter, system-ui, sans-serif',
            maxWidth: '340px',
            pointerEvents: 'auto',
          }}
          aria-label="Map Accessibility Legend"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--line)',
              paddingBottom: '6px',
              gap: '14px',
            }}
          >
            <span
              style={{
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--ink)',
                fontSize: '12px',
              }}
            >
              Accessibility Legend
            </span>
            <span style={{ fontSize: '11px', color: 'var(--mute)' }}>Deterministic Engine</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '3px',
                  background: '#059669',
                  border: '1px solid #047857',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Feasible</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '3px',
                  background: '#d97706',
                  border: '1px solid #b45309',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Constrained</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '3px',
                  background: '#dc2626',
                  border: '1px solid #b91c1c',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Inaccessible</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '3px',
                  background: '#64748b',
                  border: '1px solid #475569',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--mute)', fontWeight: 600 }}>Unknown</span>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

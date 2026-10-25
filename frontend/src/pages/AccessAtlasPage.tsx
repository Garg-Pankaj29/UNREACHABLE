import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Loader2, ShieldAlert, Sparkles, AlertTriangle } from 'lucide-react';
import { GeoJSONFeature, IssueRecord, VehicleProfile, BuildingAccessResponse, RouteResponse } from '../types';
import { MapView, getRoadAccessStatus } from '../components/MapView';
import { VEHICLE_OPTIONS } from '../services/store';
import { api, SearchResultItem } from '../services/api';

interface AccessAtlasPageProps {
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  issues: IssueRecord[];
  selectedFeature: GeoJSONFeature | null;
  onSelectFeature: (feature: GeoJSONFeature | null) => void;
  onSelectVehicle?: (vehicle: VehicleProfile) => void;
  datasetMode?: 'pilot' | 'sample';
  onToggleDataset?: (mode: 'pilot' | 'sample') => void;
  onViewportChange?: (bbox: string, zoom: number) => void;
}

export const AccessAtlasPage: React.FC<AccessAtlasPageProps> = ({
  buildings,
  roads,
  stations,
  issues,
  selectedFeature,
  onSelectFeature,
  datasetMode = 'pilot',
  onToggleDataset,
  onViewportChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedVehKey, setSelectedVehKey] = useState<string>('fire');
  const [onlineAvailable, setOnlineAvailable] = useState<boolean>(true);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const [bldgAssessment, setBldgAssessment] = useState<BuildingAccessResponse | null>(null);
  const [bldgLoading, setBldgLoading] = useState<boolean>(false);
  const [activeRoadRoute, setActiveRoadRoute] = useState<RouteResponse | null>(null);
  const [blockedRoadIds, setBlockedRoadIds] = useState<string[]>([]);
  const [unitPosition, setUnitPosition] = useState<[number, number] | null>(null);
  const [routeRefreshNonce, setRouteRefreshNonce] = useState<number>(0);
  const [isTogglingBlock, setIsTogglingBlock] = useState<boolean>(false);

  // 1. Initial incidents load & SSE stream connection
  useEffect(() => {
    api.getIncidents().then((res) => {
      if (res && res.blocked_roads) {
        setBlockedRoadIds(res.blocked_roads);
      }
    });

    let es: EventSource | null = null;
    try {
      es = new EventSource(api.getStreamUrl());

      es.addEventListener('init', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.blocked_roads) setBlockedRoadIds(data.blocked_roads);
        } catch (err) {
          console.warn('SSE init parse error:', err);
        }
      });

      es.addEventListener('incident', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.blocked_roads) {
            setBlockedRoadIds(data.blocked_roads);
            setRouteRefreshNonce((n) => n + 1);
          }
        } catch (err) {
          console.warn('SSE incident parse error:', err);
        }
      });

      es.addEventListener('unit_position', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.coordinates && Array.isArray(data.coordinates) && data.coordinates.length >= 2) {
            // Backend yields [lon, lat]; Leaflet expects [lat, lon]
            setUnitPosition([data.coordinates[1], data.coordinates[0]]);
          }
        } catch (err) {
          console.warn('SSE unit_position parse error:', err);
        }
      });

      es.onerror = (err) => {
        console.debug('SSE connection state change / reconnecting:', err);
      };
    } catch (err) {
      console.warn('EventSource initialization failed:', err);
    }

    return () => {
      if (es) es.close();
    };
  }, []);

  // 2. Building Access Evaluation with live recompute
  useEffect(() => {
    const isBldg = selectedFeature?.properties?.feature_type === 'building';
    const bId = selectedFeature?.properties?.id || (selectedFeature?.id as string);
    if (isBldg && bId) {
      let isMounted = true;
      setBldgLoading(true);
      api
        .fetchBuildingAccess(bId, selectedVehKey, undefined, datasetMode)
        .then((res) => {
          if (isMounted) {
            setBldgAssessment(res);
            setBldgLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.warn('Building assessment fetch error:', err);
            setBldgAssessment(null);
            setBldgLoading(false);
          }
        });
      return () => {
        isMounted = false;
      };
    } else {
      setBldgAssessment(null);
    }
  }, [selectedFeature?.properties?.id, selectedFeature?.id, selectedFeature?.properties?.feature_type, selectedVehKey, datasetMode, routeRefreshNonce]);

  useEffect(() => {
    if (!selectedFeature) {
      setUnitPosition(null);
    }
  }, [selectedFeature]);

  // Memoized midpoint coordinates for selected road
  const roadMid = useMemo<[number, number] | null>(() => {
    if (selectedFeature?.properties?.feature_type !== 'road') return null;
    const geom = selectedFeature.geometry;
    if (geom?.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
      const m = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
      return [m[0], m[1]]; // [lon, lat]
    }
    return null;
  }, [selectedFeature]);

  // 3. Road Segment Route Evaluation with live recompute
  useEffect(() => {
    const isRoad = selectedFeature?.properties?.feature_type === 'road';
    const rId = selectedFeature?.properties?.id || (selectedFeature?.id as string);
    if (isRoad && rId) {
      let isMounted = true;

      let originStationId = 'station-01';
      if (datasetMode === 'pilot' && stations.length > 0) {
        if (roadMid) {
          // Find closest facility with valid coordinates
          let minDist = Infinity;
          let closestId: string | undefined = undefined;
          stations.forEach((s) => {
            const sc = s.geometry?.coordinates;
            if (Array.isArray(sc) && sc.length >= 2) {
              const dx = sc[0] - roadMid[0];
              const dy = sc[1] - roadMid[1];
              const distSq = dx * dx + dy * dy;
              if (distSq < minDist) {
                minDist = distSq;
                closestId = (s.properties?.id || s.id) as string | undefined;
              }
            }
          });
          originStationId = closestId || 'osm_emergency_way_1216904632';
        } else {
          originStationId =
            stations.find((s) => (s.properties?.facility_type || s.properties?.station_type || '').toLowerCase().includes('fire'))?.properties?.id ||
            stations[0]?.properties?.id ||
            'osm_emergency_way_1216904632';
        }
      }

      api
        .fetchRoute(originStationId, undefined, selectedVehKey, rId, undefined, undefined, datasetMode)
        .then((res) => {
            if (res) {
              setActiveRoadRoute(res);
            } else {
              setActiveRoadRoute(null);
            }
        })
        .catch(() => {
          if (isMounted) setActiveRoadRoute(null);
        });
      return () => {
        isMounted = false;
      };
    } else {
      setActiveRoadRoute(null);
    }
  }, [selectedFeature?.properties?.id, selectedFeature?.id, selectedFeature?.properties?.feature_type, selectedVehKey, datasetMode, routeRefreshNonce, stations, roadMid]);

  const [layers, setLayers] = useState({
    roads: true,
    buildings: true,
    stations: true,
    issues: true,
  });

  // Debounced search effect
  const isSelectingRef = useRef<boolean>(false);

  useEffect(() => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }

    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      setIsSearching(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (datasetMode === 'pilot') {
          const resp = await api.searchPilot(q, 15);
          if (isMounted) {
            setSearchResults(resp.results || []);
            if (resp.online_available !== undefined) {
              setOnlineAvailable(resp.online_available);
            }
            setIsDropdownOpen(true);
            setActiveIndex(0);
          }
        } else {
          // Demo/sample mode search across loaded sample features
          const qLower = q.toLowerCase();
          const matches: SearchResultItem[] = [];

          stations.forEach((s) => {
            const p = s.properties || {};
            if (p.name?.toLowerCase().includes(qLower) || p.id?.toLowerCase().includes(qLower)) {
              matches.push({
                id: p.id || (s.id as string),
                name: p.name || 'Emergency Station',
                feature_type: 'facility',
                sub_type: 'station',
                details: `Emergency Station • ${p.data_source || 'Demo Station'}`,
                coordinates: s.geometry?.coordinates,
                geometry: s.geometry,
                properties: p,
                verification_status: p.verification_status || 'verified_sample',
              });
            }
          });

          buildings.forEach((b) => {
            const p = b.properties || {};
            if (p.name?.toLowerCase().includes(qLower) || p.id?.toLowerCase().includes(qLower)) {
              matches.push({
                id: p.id || (b.id as string),
                name: p.name || `Building ${p.id}`,
                feature_type: 'building',
                sub_type: p.use_type || 'building',
                details: `Building • Status: ${p.access_status || 'unknown'}`,
                coordinates: b.geometry?.type === 'Polygon' ? b.geometry.coordinates[0]?.[0] : undefined,
                geometry: b.geometry,
                properties: p,
                verification_status: p.verification_status,
              });
            }
          });

          roads.forEach((r) => {
            const p = r.properties || {};
            if (p.name?.toLowerCase().includes(qLower) || p.id?.toLowerCase().includes(qLower)) {
              matches.push({
                id: p.id || (r.id as string),
                name: p.name || `Road ${p.id}`,
                feature_type: 'road',
                sub_type: p.road_class || 'road',
                details: `Road • Width: ${p.width_m ? `${p.width_m}m` : 'unknown'}`,
                coordinates: r.geometry?.type === 'LineString' ? r.geometry.coordinates[Math.floor(r.geometry.coordinates.length / 2)] : undefined,
                geometry: r.geometry,
                properties: p,
                verification_status: p.verification_status,
              });
            }
          });

          if (isMounted) {
            setSearchResults(matches.slice(0, 15));
            setIsDropdownOpen(true);
            setActiveIndex(0);
          }
        }
      } catch (err) {
        console.error('Search error:', err);
        if (isMounted) {
          setSearchResults([]);
          setIsDropdownOpen(true);
        }
      } finally {
        if (isMounted) {
          setIsSearching(false);
        }
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, datasetMode, stations, buildings, roads]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation: Escape key deselects currently active feature if dropdown is closed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onSelectFeature(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDropdownOpen, onSelectFeature]);

  const handleSelectResult = (item: SearchResultItem) => {
    isSelectingRef.current = true;
    const feature: GeoJSONFeature = {
      type: 'Feature',
      id: item.id,
      geometry: item.geometry || {
        type: 'Point',
        coordinates: item.coordinates || [76.7794, 30.7333],
      },
      properties: {
        id: item.id,
        name: item.name,
        feature_type: item.feature_type,
        sub_type: item.sub_type,
        details: item.details,
        source: item.source || (datasetMode === 'pilot' ? 'local_pilot' : 'sample'),
        inside_pilot_area: item.inside_pilot_area !== false,
        coverage_notice: item.coverage_notice,
        verification_status: item.verification_status,
        ...item.properties,
      },
    };
    onSelectFeature(feature);
    setIsDropdownOpen(false);
    setSearchResults([]);
    setSearchQuery(item.name);
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setIsDropdownOpen(true);
        setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setIsDropdownOpen(true);
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isDropdownOpen && searchResults.length > 0) {
        handleSelectResult(searchResults[activeIndex] || searchResults[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsDropdownOpen(false);
    }
  };

  const renderBadge = (item: SearchResultItem) => {
    const isOutsidePilot = item.inside_pilot_area === false;
    let typeBadge: React.ReactNode = null;

    if (item.feature_type === 'facility') {
      const ft = (item.sub_type || '').toLowerCase();
      if (ft === 'hospital') {
        typeBadge = <span style={{ background: '#2563eb', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>HOSPITAL</span>;
      } else if (ft === 'fire_station' || ft === 'fire') {
        typeBadge = <span style={{ background: '#dc2626', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>FIRE STATION</span>;
      } else if (ft === 'clinic') {
        typeBadge = <span style={{ background: '#0d9488', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>CLINIC</span>;
      } else if (ft === 'doctors') {
        typeBadge = <span style={{ background: '#0284c7', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>DOCTOR</span>;
      } else {
        typeBadge = <span style={{ background: '#10b981', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>FACILITY</span>;
      }
    } else if (item.feature_type === 'road') {
      typeBadge = <span style={{ background: '#64748b', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>ROAD</span>;
    } else if (item.feature_type === 'place') {
      typeBadge = <span style={{ background: '#d97706', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>LOCATION</span>;
    } else {
      typeBadge = <span style={{ background: '#475569', color: '#fff', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>BUILDING</span>;
    }

    const sourceBadge = item.source === 'online_osm' ? (
      <span style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#2563eb', border: '1px solid #93c5fd', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>ONLINE</span>
    ) : item.source === 'local_pilot' ? (
      <span style={{ background: 'rgba(13, 148, 136, 0.12)', color: '#0d9488', border: '1px solid #99f6e4', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>PILOT DB</span>
    ) : null;

    const outsideBadge = isOutsidePilot ? (
      <span style={{ background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', border: '1px solid #fde68a', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }} title="Outside pilot dataset corridor">OUTSIDE PILOT</span>
    ) : null;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        {sourceBadge}
        {outsideBadge}
        {typeBadge}
      </div>
    );
  };

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

  const getPill = (status?: string, isOutside?: boolean, isRoadFeature?: boolean, roadProps?: any) => {
    if (isOutside) {
      return <b className="pl" style={{ background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', border: '1px solid #fde68a' }}>Outside pilot coverage</b>;
    }
    if (isRoadFeature && roadProps) {
      const roadStatus = getRoadAccessStatus(roadProps, currentVeh.w, blockedRoadIds);
      if (roadStatus === 'inaccessible') {
        const isBlocked = blockedRoadIds.includes(roadProps.id) || roadProps.is_blocked || roadProps.incident_active;
        return <b className="pl c-infeasible" style={{ background: 'rgba(215, 38, 61, 0.2)', color: '#d7263d', border: '1px solid #d7263d' }}>{isBlocked ? 'Blocked (Incident)' : 'Inaccessible for ' + currentVeh.n}</b>;
      }
      if (roadStatus === 'constrained') {
        return <b className="pl c-constrained" style={{ background: 'rgba(232, 113, 10, 0.2)', color: '#e8710a', border: '1px solid #e8710a' }}>Constrained Passage</b>;
      }
      if (roadStatus === 'feasible') {
        return <b className="pl c-ok" style={{ background: 'rgba(22, 138, 92, 0.2)', color: '#168a5c', border: '1px solid #168a5c' }}>Feasible Passage</b>;
      }
      return <b className="pl c-unknown" style={{ background: 'rgba(100, 116, 139, 0.2)', color: '#94a3b8', border: '1px solid #64748b' }}>Unknown (Unmeasured)</b>;
    }
    switch (status) {
      case 'feasible':
      case 'ok':
        return <b className="pl c-ok">Verified accessible</b>;
      case 'constrained':
        return <b className="pl c-constrained">Constrained</b>;
      case 'infeasible':
        return <b className="pl c-infeasible">Potentially inaccessible</b>;
      default:
        return <b className="pl c-unknown">Unknown</b>;
    }
  };

  const props = selectedFeature?.properties;
  const isOutsidePilot = props?.inside_pilot_area === false;
  const isBuilding = props?.feature_type === 'building';
  const isRoad = props?.feature_type === 'road';
  const isStation = props?.feature_type === 'station' || props?.feature_type === 'facility';
  const isPlace = props?.feature_type === 'place' || (!isBuilding && !isRoad && !isStation);

  const activeRouteGeometry = isBuilding
    ? (bldgAssessment?.route?.geometry_geojson || null)
    : isRoad && activeRoadRoute?.geometry_geojson
    ? (activeRoadRoute.geometry_geojson || null)
    : null;

  const activeRouteClassification = isBuilding
    ? bldgAssessment?.classification
    : isRoad
    ? activeRoadRoute?.classification
    : undefined;

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
        onViewportChange={onViewportChange}
        fullHeight={true}
        datasetMode={datasetMode}
        routeGeometry={activeRouteGeometry}
        routeClassification={activeRouteClassification}
        destinationCoords={
          isBuilding
            ? (bldgAssessment?.route?.geometry_geojson?.coordinates
                ? bldgAssessment.route.geometry_geojson.coordinates[
                    bldgAssessment.route.geometry_geojson.coordinates.length - 1
                  ]
                : (selectedFeature?.geometry?.type === 'Point'
                ? (selectedFeature.geometry.coordinates as [number, number])
                : null))
            : isRoad && roadMid
            ? roadMid
            : null
        }
        destinationName={
          isBuilding
            ? props?.name || props?.id || 'Target Building'
            : isRoad
            ? props?.name || props?.id || 'Selected Road Segment'
            : undefined
        }
        unitPosition={activeRouteGeometry ? unitPosition : null}
        blockedRoadIds={blockedRoadIds}
      />

      {/* Floating Control Panel (Upper Left) */}
      <div className="ctl" aria-label="Access Atlas controls">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3 style={{ margin: 0 }}>Access Atlas</h3>
          {onToggleDataset && (
            <div className="chips" style={{ margin: 0 }}>
              <button
                type="button"
                className={`chip ${datasetMode === 'pilot' ? 'on' : ''}`}
                onClick={() => onToggleDataset('pilot')}
                style={{ fontSize: '11px', padding: '2px 8px' }}
                title="Real Pilot state-wide network (Punjab & Chandigarh)"
              >
                ● Real Pilot (Punjab)
              </button>
              <button
                type="button"
                className={`chip ${datasetMode === 'sample' ? 'on' : ''}`}
                onClick={() => onToggleDataset('sample')}
                style={{ fontSize: '11px', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                title="Synthetic demonstration dataset (Gharuan)"
              >
                <Sparkles size={12} />
                <span>Demo</span>
              </button>
            </div>
          )}
        </div>

        {/* Quick Shortcut to Emergency Routes */}
        <a
          href="#/routes"
          className="btn sm"
          id="atlas-open-routes-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            marginBottom: '12px',
            background: 'var(--tape, #ffd60a)',
            color: '#1c1f1b',
            fontWeight: 800,
            fontSize: '12px',
            textDecoration: 'none',
            border: '1.5px solid #1c1f1b',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
          title="Switch to Emergency Station Selection & Multi-Alternative Route Console"
        >
          <span>↗ Open Emergency Route Console</span>
        </a>

        {/* Search */}
        <div className="fld atlas-search-container" ref={searchContainerRef} style={{ width: '100%', marginBottom: '14px' }}>
          <label htmlFor="atlas-search" style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
            Search building or road
          </label>
          <div className="atlas-search-input-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
            <span className="atlas-search-icon-left" style={{ position: 'absolute', left: '12px', pointerEvents: 'none', color: 'var(--ink)', display: 'flex', alignItems: 'center', zIndex: 4 }}>
              {isSearching ? (
                <Loader2 className="atlas-search-spinner" style={{ width: 18, height: 18, color: 'var(--tape, #ffd60a)' }} />
              ) : (
                <Search style={{ width: 18, height: 18, color: 'var(--ink)' }} />
              )}
            </span>
            <input
              id="atlas-search"
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={isDropdownOpen}
              aria-autocomplete="list"
              aria-controls="atlas-search-results"
              aria-activedescendant={
                searchResults[activeIndex] ? `result-${searchResults[activeIndex].id}` : undefined
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setIsDropdownOpen(true);
              }}
              onKeyDown={handleSearchInputKeyDown}
              placeholder="Search hospitals, fire stations, roads, buildings…"
              autoComplete="off"
              style={{
                display: 'block',
                width: '100%',
                minHeight: '40px',
                height: '42px',
                padding: '8px 36px 8px 38px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--ink)',
                background: 'var(--bg)',
                border: '2px solid var(--ink)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="atlas-search-btn-clear"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setIsDropdownOpen(false);
                  inputRef.current?.focus();
                }}
                title="Clear search"
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--mute)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  zIndex: 4,
                }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            )}
          </div>

          {/* Results Dropdown */}
          {isDropdownOpen && (
            <div
              id="atlas-search-results"
              role="listbox"
              className="atlas-search-dropdown"
              aria-label="Search results"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                width: '100%',
                maxHeight: '260px',
                overflowY: 'auto',
                background: 'var(--bg)',
                border: '1.5px solid var(--ink)',
                borderRadius: '8px',
                boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                zIndex: 9999,
                padding: '4px 0',
                boxSizing: 'border-box',
              }}
            >
              {!onlineAvailable && (
                <div style={{ padding: '6px 10px', background: 'rgba(100, 116, 139, 0.12)', fontSize: '11px', color: 'var(--mute)', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--line)' }}>
                  <AlertTriangle size={12} style={{ color: '#d97706' }} />
                  <span>Online search offline • Local pilot database active</span>
                </div>
              )}
              {searchResults.length > 0 ? (
                searchResults.map((item, idx) => (
                  <button
                    key={`${item.id}-${idx}`}
                    id={`result-${item.id}`}
                    role="option"
                    aria-selected={activeIndex === idx}
                    type="button"
                    className={`atlas-search-item ${activeIndex === idx ? 'active' : ''}`}
                    onClick={() => handleSelectResult(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      width: '100%',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--line)',
                      background: activeIndex === idx ? 'rgba(255, 214, 10, 0.15)' : 'transparent',
                      borderLeft: activeIndex === idx ? '3px solid #ffd60a' : '3px solid transparent',
                      textAlign: 'left',
                    }}
                  >
                    <div className="atlas-search-item-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                      <span className="atlas-search-item-name" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>{item.name}</span>
                      {renderBadge(item)}
                    </div>
                    {item.details && (
                      <span className="atlas-search-item-sub" style={{ fontSize: '11px', color: 'var(--mute)', marginTop: '2px', lineHeight: '1.3' }}>{item.details}</span>
                    )}
                    {item.inside_pilot_area === false && (
                      <span style={{ fontSize: '11px', color: '#d97706', marginTop: '2px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={12} />
                        <span>Detailed access analysis unavailable outside Chandigarh pilot</span>
                      </span>
                    )}
                  </button>
                ))
              ) : isSearching ? (
                <div className="atlas-search-empty" style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--mute)', textAlign: 'center' }}>
                  <Loader2
                    className="atlas-search-spinner"
                    style={{ display: 'inline', width: 14, height: 14, marginRight: 6, verticalAlign: 'middle' }}
                  />
                  Searching {datasetMode === 'pilot' ? 'pilot corridor & universal places' : 'demo data'}...
                </div>
              ) : (
                <div className="atlas-search-empty" style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--mute)', textAlign: 'center' }}>
                  No matching locations, roads, or facilities found for "{searchQuery}"
                </div>
              )}
            </div>
          )}
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

          <div className="pan-status">{getPill(props.access_status, isOutsidePilot, isRoad, props)}</div>

          {/* Outside pilot dataset notice banner */}
          {isOutsidePilot && (
            <div
              style={{
                margin: '10px 0',
                padding: '10px 12px',
                background: 'rgba(217, 119, 6, 0.1)',
                border: '1.5px solid #d97706',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--ink)',
                lineHeight: '1.4',
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  color: '#d97706',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                }}
              >
                <ShieldAlert size={16} />
                <span>Pilot Boundary Notice</span>
              </div>
              <div>
                {props.coverage_notice ||
                  'This location is outside the Chandigarh pilot corridor. Detailed road width measurements, emergency vehicle clearances, and access feasibility analysis are not available.'}
              </div>
            </div>
          )}

          {/* Building Details */}
          {isBuilding && (
            <>
              {/* Building Emergency Access Assessment Card */}
              <div
                style={{
                  margin: '12px 0',
                  padding: '14px',
                  background: 'rgba(255, 214, 10, 0.05)',
                  border: '1.5px solid #ffd60a',
                  borderRadius: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--mute)', letterSpacing: '0.5px' }}>
                    Emergency Access Assessment
                  </span>
                  {bldgLoading ? (
                    <span style={{ fontSize: '11px', color: 'var(--mute)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Loader2 className="animate-spin" size={12} /> Evaluating...
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background:
                          bldgAssessment?.classification === 'accessible'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : bldgAssessment?.classification === 'constrained'
                            ? 'rgba(245, 158, 11, 0.15)'
                            : bldgAssessment?.classification === 'inaccessible'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(100, 116, 139, 0.15)',
                        color:
                          bldgAssessment?.classification === 'accessible'
                            ? '#059669'
                            : bldgAssessment?.classification === 'constrained'
                            ? '#d97706'
                            : bldgAssessment?.classification === 'inaccessible'
                            ? '#dc2626'
                            : '#475569',
                      }}
                    >
                      {bldgAssessment?.classification === 'accessible'
                        ? '● CORRIDOR REACHABLE'
                        : bldgAssessment?.classification === 'constrained'
                        ? '▲ CONSTRAINED'
                        : bldgAssessment?.classification === 'inaccessible'
                        ? '✕ BLOCKED'
                        : '? UNVERIFIED'}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--mute)' }}>Approach Road:</span>
                    <span style={{ fontWeight: 700, textAlign: 'right', maxWidth: '170px' }}>
                      {bldgAssessment?.approach_road_name || props.connected_road_id || 'Nearest connected corridor'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--mute)' }}>Road Frontage Setback:</span>
                    <span style={{ fontWeight: 800 }}>
                      {bldgAssessment?.estimated_setback_m !== null && bldgAssessment?.estimated_setback_m !== undefined
                        ? `${bldgAssessment.estimated_setback_m} m`
                        : props.estimated_setback_m
                        ? `${props.estimated_setback_m} m`
                        : 'Unsurveyed'}
                    </span>
                  </div>

                  {bldgAssessment?.origin_station_name && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--mute)' }}>Dispatch Origin:</span>
                      <span style={{ fontWeight: 700, textAlign: 'right', maxWidth: '170px' }}>
                        {bldgAssessment.origin_station_name}
                      </span>
                    </div>
                  )}

                  {bldgAssessment?.route?.total_distance_m !== undefined && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--mute)' }}>Route Distance:</span>
                      <span style={{ fontWeight: 800, color: 'var(--sig)' }}>
                        {(bldgAssessment.route.total_distance_m / 1000).toFixed(1)} km
                      </span>
                    </div>
                  )}
                </div>

                {/* Road vs Entrance Distinction */}
                <div
                  style={{
                    marginTop: '10px',
                    padding: '8px 10px',
                    background: 'rgba(217, 119, 6, 0.08)',
                    border: '1px solid rgba(217, 119, 6, 0.25)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    lineHeight: 1.4,
                    color: 'var(--ink)',
                  }}
                >
                  <b style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <ShieldAlert size={13} />
                    Road Reachability Only
                  </b>
                  <span>
                    Building entrance gates and courtyard driveways are unsurveyed. Apparatus holds on the street; crew advances on foot or hose relay.
                  </span>
                </div>

                {bldgAssessment?.missing_evidence && bldgAssessment.missing_evidence.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--mute)' }}>
                    <b>Missing Evidence:</b> {bldgAssessment.missing_evidence.slice(0, 2).join(' • ')}
                  </div>
                )}
              </div>

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
                  <span className="pan-prop-val">{props.data_source || (datasetMode === 'pilot' ? 'OpenStreetMap Pilot' : 'Synthetic Cadastre')}</span>
                </div>
              </div>

              {props.notes && (
                <p style={{ fontSize: '12px', color: 'var(--mute)', margin: '8px 0 12px' }}>
                  {props.notes}
                </p>
              )}

              <div className="cta" style={{ marginTop: '12px' }}>
                <a className="btn pri sm" href={`#/b/${props.id}`}>
                  Full Assessment Report
                </a>
                <a className="btn sm" href={`#/routes/${props.id}`}>
                  Analyse Full Route
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
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Access Verdict</span>
                  <span className="pan-prop-val" style={{ fontWeight: 800 }}>
                    {(() => {
                      const st = getRoadAccessStatus(props, currentVeh.w, blockedRoadIds);
                      if (st === 'feasible') return <span style={{ color: '#168a5c' }}>Feasible (Passable)</span>;
                      if (st === 'constrained') return <span style={{ color: '#e8710a' }}>Constrained (Tight)</span>;
                      if (st === 'inaccessible') return <span style={{ color: '#d7263d' }}>Inaccessible / Blocked</span>;
                      return <span style={{ color: '#94a3b8' }}>Unmeasured (Unknown)</span>;
                    })()}
                  </span>
                </div>
              </div>

              {props.obstruction && (
                <div className="pan-obstruction">
                  Constraint: {props.obstruction}
                </div>
              )}

              {getRoadAccessStatus(props, currentVeh.w, blockedRoadIds) === 'unknown' && (
                <p style={{ fontSize: '12px', color: 'var(--mute)', margin: '8px 0' }}>
                  Width is missing from municipal survey data; classified as Unknown, not assumed blocked.
                </p>
              )}

              {/* Incident Road Blockage Button (Phase 5) */}
              {(() => {
                const isRoadBlocked = Boolean(
                  props.id && (blockedRoadIds.includes(props.id) || props.is_blocked || props.incident_active)
                );
                return (
                  <div style={{ margin: '14px 0 10px' }}>
                    <button
                      type="button"
                      id="toggle-road-incident-block-btn"
                      className={`btn sm ${isRoadBlocked ? 'sec' : 'pri'}`}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontWeight: 800,
                        fontSize: '12px',
                        background: isRoadBlocked ? 'rgba(22, 138, 92, 0.15)' : 'rgba(215, 38, 61, 0.92)',
                        borderColor: isRoadBlocked ? '#168a5c' : '#d7263d',
                        color: isRoadBlocked ? '#168a5c' : '#ffffff',
                        cursor: isTogglingBlock ? 'wait' : 'pointer',
                        boxShadow: isRoadBlocked ? 'none' : '0 2px 8px rgba(215, 38, 61, 0.35)',
                      }}
                      disabled={isTogglingBlock}
                      onClick={async () => {
                        if (!props.id) return;
                        setIsTogglingBlock(true);
                        const nextAction = isRoadBlocked ? 'clear' : 'block';
                        try {
                          const res = await api.setIncident(props.id, nextAction);
                          if (res && res.blocked_roads) {
                            setBlockedRoadIds(res.blocked_roads);
                          }
                          setRouteRefreshNonce((n) => n + 1);
                        } catch (err) {
                          console.error('Failed to toggle road blockage:', err);
                        } finally {
                          setIsTogglingBlock(false);
                        }
                      }}
                      title={isRoadBlocked ? "Reopen this road to emergency passage" : "Block this road with an emergency incident"}
                    >
                      {isTogglingBlock ? (
                        <Loader2 size={13} className="spin" />
                      ) : isRoadBlocked ? (
                        <span>✓ Clear Blockage (Reopen Road)</span>
                      ) : (
                        <>
                          <AlertTriangle size={13} />
                          <span>Block this road (Incident Closure)</span>
                        </>
                      )}
                    </button>
                    {isRoadBlocked && (
                      <div style={{ fontSize: '11px', color: '#d7263d', marginTop: '6px', fontWeight: 600 }}>
                        ● Road actively blocked by incident overlay. Route re-computed live.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Live Route to this road display */}
              {activeRoadRoute && (
                <div
                  style={{
                    margin: '8px 0 14px',
                    padding: '10px 12px',
                    background:
                      activeRoadRoute.route_found && activeRoadRoute.classification !== 'inaccessible'
                        ? 'rgba(22, 138, 92, 0.08)'
                        : 'rgba(215, 38, 61, 0.12)',
                    border: `1px solid ${
                      activeRoadRoute.route_found && activeRoadRoute.classification !== 'inaccessible'
                        ? 'rgba(22, 138, 92, 0.3)'
                        : '#d7263d'
                    }`,
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                    <span>Live Route to Road:</span>
                    <span
                      style={{
                        textTransform: 'uppercase',
                        color:
                          activeRoadRoute.route_found && activeRoadRoute.classification !== 'inaccessible'
                            ? '#168a5c'
                            : '#d7263d',
                      }}
                    >
                      {activeRoadRoute.classification}
                    </span>
                  </div>
                  {activeRoadRoute.route_found && activeRoadRoute.classification !== 'inaccessible' ? (
                    <div style={{ marginTop: '4px', color: 'var(--mute)' }}>
                      Distance: <b>{(activeRoadRoute.total_distance_m / 1000).toFixed(2)} km</b> • Segments:{' '}
                      <b>{activeRoadRoute.segments_traversed.length}</b>
                    </div>
                  ) : (
                    <div style={{ marginTop: '4px', color: '#d7263d', fontWeight: 600 }}>
                      No feasible emergency route found. Road or approach is blocked.
                    </div>
                  )}
                </div>
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
                <a
                  className="btn pri sm"
                  href={`#/routes?origin=${encodeURIComponent(props.id)}`}
                  title="Compute emergency routes departing from this facility"
                >
                  Plan Routes from Here →
                </a>
              </div>
            </>
          )}

          {/* Landmark / Location / Search Result Details */}
          {isPlace && (
            <>
              <div className="pan-props">
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Location Type</span>
                  <span className="pan-prop-val" style={{ textTransform: 'capitalize' }}>
                    {props.sub_type || 'Landmark / Locality'}
                  </span>
                </div>
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Source</span>
                  <span className="pan-prop-val">
                    {props.source === 'online_osm' ? 'OpenStreetMap Nominatim' : 'Local Pilot Dataset'}
                  </span>
                </div>
                {props.details && (
                  <div className="pan-prop-row">
                    <span className="pan-prop-label">Locality</span>
                    <span
                      className="pan-prop-val"
                      style={{ maxWidth: '170px', textAlign: 'right', wordBreak: 'break-word' }}
                    >
                      {props.details}
                    </span>
                  </div>
                )}
                <div className="pan-prop-row">
                  <span className="pan-prop-label">Pilot Coverage</span>
                  <span className="pan-prop-val">
                    {props.inside_pilot_area !== false ? 'Within Pilot Area' : 'Outside Pilot Area'}
                  </span>
                </div>
              </div>

              {props.inside_pilot_area !== false && (
                <div className="cta" style={{ marginTop: '12px' }}>
                  <a
                    className="btn pri sm"
                    href={`#/routes?dest=${encodeURIComponent(props.name || props.id)}&coords=${
                      selectedFeature?.geometry?.type === 'Point' && Array.isArray(selectedFeature.geometry.coordinates)
                        ? `${selectedFeature.geometry.coordinates[0]},${selectedFeature.geometry.coordinates[1]}`
                        : ''
                    }`}
                    title="Calculate emergency vehicle routes to this destination"
                  >
                    Analyse Emergency Route →
                  </a>
                </div>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
};

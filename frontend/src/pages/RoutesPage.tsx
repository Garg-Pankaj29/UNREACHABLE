import React, { useState, useEffect, useRef } from 'react';
import {
  AlternativeRoute,
  BuildingAccessResponse,
  GeoJSONFeature,
  MultiRouteResponse,
  RouteCompareResponse,
} from '../types';
import { MapView } from '../components/MapView';
import { VEHICLE_OPTIONS } from '../services/store';
import { api, SearchResultItem } from '../services/api';
import {
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ShieldAlert,
  Building,
  RotateCcw,
  MapPin,
  HelpCircle,
  Info,
  Flame,
  Stethoscope,
  UserCheck,
  ChevronDown,
  X,
} from 'lucide-react';

interface RoutesPageProps {
  buildings: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  datasetMode?: 'pilot' | 'sample';
  initialTarget?: GeoJSONFeature | null;
  targetId?: string;
}

export const RoutesPage: React.FC<RoutesPageProps> = ({
  buildings,
  stations,
  roads,
  datasetMode = 'pilot',
  initialTarget,
  targetId,
}) => {
  // Origin emergency facility state
  const [selectedStationId, setSelectedStationId] = useState<string>(() => {
    if (stations.length > 0) {
      const fire = stations.find((s) => s.properties?.facility_type === 'fire_station');
      if (fire) return fire.properties.id || (fire.id as string);
      return stations[0].properties.id || (stations[0].id as string);
    }
    return datasetMode === 'pilot' ? 'osm_emergency_way_129774350' : 'station-01';
  });

  const [facilityCategory, setFacilityCategory] = useState<string>('all');
  const [facilitySearch, setFacilitySearch] = useState<string>('');
  const [isFacilityDropdownOpen, setIsFacilityDropdownOpen] = useState<boolean>(false);
  const facilityContainerRef = useRef<HTMLDivElement>(null);
  const facilityInputRef = useRef<HTMLInputElement>(null);

  // Destination state
  const [destinationSearch, setDestinationSearch] = useState<string>(
    initialTarget?.properties?.name || ''
  );
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(() => {
    if (initialTarget?.geometry?.type === 'Point' && Array.isArray(initialTarget.geometry.coordinates)) {
      return [initialTarget.geometry.coordinates[0], initialTarget.geometry.coordinates[1]];
    }
    return null;
  });
  const [destinationName, setDestinationName] = useState<string>(
    initialTarget?.properties?.name || (datasetMode === 'pilot' ? 'Sector 17 Plaza' : 'bldg-201')
  );
  const [destinationBuildingId, setDestinationBuildingId] = useState<string | undefined>(
    initialTarget?.properties?.feature_type === 'building' ? initialTarget.properties.id : undefined
  );
  const [destinationRoadId, setDestinationRoadId] = useState<string | undefined>(
    initialTarget?.properties?.feature_type === 'road' ? initialTarget.properties.id : undefined
  );
  const [isOutsidePilot, setIsOutsidePilot] = useState<boolean>(
    initialTarget?.properties?.inside_pilot_area === false
  );

  // Vehicle profile state
  const [selectedVehKey, setSelectedVehKey] = useState<string>('fire');
  const [requestedK, setRequestedK] = useState<number>(3);

  // Route evaluation state
  const [loading, setLoading] = useState<boolean>(false);
  const [compareLoading, setCompareLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [multiRouteResult, setMultiRouteResult] = useState<MultiRouteResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<RouteCompareResponse | null>(null);
  const [bldgAssessment, setBldgAssessment] = useState<BuildingAccessResponse | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const isUserTyping = useRef(false);
  const currentVeh = VEHICLE_OPTIONS[selectedVehKey] || VEHICLE_OPTIONS.fire;
  const selectedStation = stations.find((s) => (s.properties?.id || s.id) === selectedStationId);

  // Filter facilities by category and search query
  const filteredStations = stations.filter((st) => {
    const p = st.properties || {};
    const facType = p.facility_type || p.station_type || '';
    if (facilityCategory !== 'all') {
      if (facilityCategory === 'fire_station' && facType !== 'fire_station' && facType !== 'fire') return false;
      if (facilityCategory === 'hospital' && facType !== 'hospital') return false;
      if (facilityCategory === 'clinic' && facType !== 'clinic') return false;
      if (facilityCategory === 'doctors' && facType !== 'doctors') return false;
    }
    if (facilitySearch.trim()) {
      const q = facilitySearch.toLowerCase();
      const name = (p.name || '').toLowerCase();
      const id = (p.id || '').toLowerCase();
      const op = (p.operator || '').toLowerCase();
      return name.includes(q) || id.includes(q) || op.includes(q);
    }
    return true;
  });

  // Sync destination if targetId URL param is passed
  useEffect(() => {
    if (!targetId) return;
    if (targetId.startsWith('osm_bldg_') || targetId.startsWith('bldg-')) {
      const match = buildings.find((b) => b.properties?.id === targetId);
      const name =
        match?.properties?.name ||
        (targetId === 'osm_bldg_409434941'
          ? 'Park Plaza'
          : targetId === 'osm_bldg_1477354108'
          ? 'CCET Diploma Wing'
          : targetId === 'osm_bldg_1101860130'
          ? 'Dhillon Plaza'
          : `Building ${targetId}`);
      setDestinationName(name);
      setDestinationSearch(name);
      setDestinationBuildingId(targetId);
      setDestinationCoords(null);
      setDestinationRoadId(undefined);
      setIsOutsidePilot(false);
    } else if (targetId.startsWith('osm_road_') || targetId.startsWith('road-')) {
      const match = roads.find((r) => r.properties?.id === targetId);
      const name = match?.properties?.name || `Road ${targetId}`;
      setDestinationName(name);
      setDestinationSearch(name);
      setDestinationRoadId(targetId);
      setDestinationCoords(null);
      setDestinationBuildingId(undefined);
      setIsOutsidePilot(false);
    }
  }, [targetId, buildings, roads]);

  // Sync state if URL hash contains query parameters (?dest=...&coords=...&origin=...)
  useEffect(() => {
    const rawHash = window.location.hash;
    if (rawHash.includes('?')) {
      const qStr = rawHash.split('?')[1];
      const params = new URLSearchParams(qStr);
      const originParam = params.get('origin');
      const destParam = params.get('dest');
      const coordsParam = params.get('coords');
      const bldgParam = params.get('building_id');
      const roadParam = params.get('road_id');
      const vehParam = params.get('vehicle');

      if (originParam) {
        setSelectedStationId(originParam);
      }
      if (destParam) {
        setDestinationName(destParam);
        setDestinationSearch(destParam);
      }
      if (bldgParam) {
        setDestinationBuildingId(bldgParam);
        setDestinationCoords(null);
        setDestinationRoadId(undefined);
      } else if (roadParam) {
        setDestinationRoadId(roadParam);
        setDestinationCoords(null);
        setDestinationBuildingId(undefined);
      } else if (coordsParam) {
        const parts = coordsParam.split(',').map((p) => parseFloat(p.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          setDestinationCoords([parts[0], parts[1]]);
          setDestinationBuildingId(undefined);
          setDestinationRoadId(undefined);
        }
      }
      if (vehParam && ['fire', 'amb', 'rapid'].includes(vehParam)) {
        setSelectedVehKey(vehParam);
      }
    }
  }, []);

  // Ensure a valid station is selected once stations prop loads asynchronously
  useEffect(() => {
    if (stations.length > 0) {
      const exists = stations.some((s) => (s.properties?.id || s.id) === selectedStationId);
      if (!selectedStationId || !exists) {
        const fire = stations.find((s) => s.properties?.facility_type === 'fire_station');
        if (fire) {
          setSelectedStationId(fire.properties?.id || (fire.id as string));
        } else {
          setSelectedStationId(stations[0].properties?.id || (stations[0].id as string));
        }
      }
    }
  }, [stations, selectedStationId]);

  // Sync destination if initialTarget prop changes
  useEffect(() => {
    if (initialTarget && initialTarget.properties?.id) {
      const p = initialTarget.properties;
      const name = p.name || `Location ${p.id}`;
      setDestinationName(name);
      setDestinationSearch(name);
      setIsOutsidePilot(p.inside_pilot_area === false);
      if (p.feature_type === 'building') {
        setDestinationBuildingId(p.id);
        setDestinationCoords(null);
        setDestinationRoadId(undefined);
      } else if (p.feature_type === 'road') {
        setDestinationRoadId(p.id);
        setDestinationCoords(null);
        setDestinationBuildingId(undefined);
      } else if (initialTarget.geometry?.type === 'Point' && Array.isArray(initialTarget.geometry.coordinates)) {
        setDestinationCoords([initialTarget.geometry.coordinates[0], initialTarget.geometry.coordinates[1]]);
        setDestinationBuildingId(undefined);
        setDestinationRoadId(undefined);
      }
    }
  }, [initialTarget]);

  // Load Building Emergency Access details if destination is a building (without modifying origin station!)
  useEffect(() => {
    if (!destinationBuildingId || !selectedStationId) {
      setBldgAssessment(null);
      return;
    }
    let isMounted = true;
    api
      .fetchBuildingAccess(destinationBuildingId, selectedVehKey, selectedStationId, datasetMode)
      .then((res) => {
        if (isMounted) {
          setBldgAssessment(res);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch building access in routes:', err);
      });
    return () => {
      isMounted = false;
    };
  }, [destinationBuildingId, datasetMode, selectedVehKey, selectedStationId]);

  // Set default destination coordinates if in pilot mode and none set
  useEffect(() => {
    if (datasetMode === 'pilot' && !targetId && !initialTarget && !destinationCoords && !destinationBuildingId && !destinationRoadId) {
      setDestinationCoords([76.7794, 30.7415]);
      setDestinationName('Sector 17 Plaza');
      setDestinationSearch('Sector 17 Plaza');
    }
  }, [datasetMode, targetId, initialTarget]);

  // Debounced Universal Search for Destination
  useEffect(() => {
    const q = destinationSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsDropdownOpen(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (datasetMode === 'pilot') {
          const resp = await api.searchPilot(q, 10);
          if (isMounted) {
            setSearchResults(resp.results || []);
            if (isUserTyping.current) {
              setIsDropdownOpen(true);
            }
          }
        } else {
          const qLower = q.toLowerCase();
          const matches: SearchResultItem[] = [];
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
                details: `Road • ${p.road_class || 'corridor'} • Width: ${p.width_m ? p.width_m + 'm' : 'Unmeasured'}`,
                geometry: r.geometry,
                properties: p,
              });
            }
          });
          if (isMounted) {
            setSearchResults(matches.slice(0, 10));
            if (isUserTyping.current) {
              setIsDropdownOpen(true);
            }
          }
        }
      } catch (err) {
        console.warn('Search error in routes:', err);
      } finally {
        if (isMounted) setIsSearching(false);
      }
    }, 250);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [destinationSearch, datasetMode, buildings, roads]);

  // Click outside to close search dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        isUserTyping.current = false;
        setIsDropdownOpen(false);
      }
      if (facilityContainerRef.current && !facilityContainerRef.current.contains(e.target as Node)) {
        setIsFacilityDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSearchResult = (item: SearchResultItem) => {
    isUserTyping.current = false;
    setDestinationName(item.name);
    setDestinationSearch(item.name);
    setIsOutsidePilot(item.inside_pilot_area === false);
    setIsDropdownOpen(false);

    if (item.coordinates && item.coordinates.length >= 2) {
      setDestinationCoords([item.coordinates[0], item.coordinates[1]]);
      setDestinationBuildingId(undefined);
      setDestinationRoadId(undefined);
    } else if (item.feature_type === 'building') {
      setDestinationBuildingId(item.id);
      setDestinationCoords(null);
      setDestinationRoadId(undefined);
    } else if (item.feature_type === 'road') {
      setDestinationRoadId(item.id);
      setDestinationCoords(null);
      setDestinationBuildingId(undefined);
    }
  };

  // Calculate Multiple Alternative Routes
  const runRouteAnalysis = async () => {
    if (!selectedStationId) {
      setMultiRouteResult(null);
      return;
    }
    if (!destinationSearch && !destinationCoords && !destinationBuildingId && !destinationRoadId) {
      setMultiRouteResult(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await api.fetchAlternativeRoutes(
        selectedStationId,
        destinationBuildingId,
        selectedVehKey,
        destinationRoadId,
        destinationCoords || undefined,
        destinationName,
        datasetMode,
        requestedK
      );
      setMultiRouteResult(resp);
      if (resp.routes && resp.routes.length > 0) {
        setSelectedRouteId((prev) => {
          const exists = resp.routes.some((r) => r.route_id === prev);
          return exists ? prev : resp.routes[0].route_id;
        });
      } else {
        setSelectedRouteId(null);
      }
    } catch (err: any) {
      console.warn('Alternative routing calculation error:', err);
      setError(err.message || 'Routing calculation failed');
      setMultiRouteResult(null);
      setSelectedRouteId(null);
    } finally {
      setLoading(false);
    }
  };

  // Run Reality Check (Naive vs Vehicle-Aware)
  const runRealityCheck = async () => {
    if (!selectedStationId) return;
    setCompareLoading(true);
    try {
      const cmp = await api.compareRoutes(
        selectedStationId,
        destinationBuildingId,
        selectedVehKey,
        destinationRoadId,
        destinationCoords || undefined,
        destinationName,
        datasetMode
      );
      setCompareResult(cmp);
    } catch (err: any) {
      console.warn('Reality check error:', err);
    } finally {
      setCompareLoading(false);
    }
  };

  // Auto-calculate when selections change
  useEffect(() => {
    if (selectedStationId && (destinationCoords || destinationBuildingId || destinationRoadId || destinationName)) {
      runRouteAnalysis();
    }
  }, [selectedStationId, destinationCoords, destinationBuildingId, destinationRoadId, destinationName, selectedVehKey, requestedK, datasetMode]);

  const getPill = (status?: string, outside?: boolean) => {
    if (outside) {
      return (
        <b className="pl" style={{ background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', border: '1px solid #fde68a' }}>
          Outside pilot corridor
        </b>
      );
    }
    switch (status) {
      case 'accessible':
      case 'feasible':
      case 'ok':
        return <b className="pl c-ok">Verified accessible</b>;
      case 'constrained':
        return <b className="pl c-constrained">Constrained margin</b>;
      case 'infeasible':
      case 'inaccessible':
        return <b className="pl c-infeasible">Confirmed blocked</b>;
      default:
        return <b className="pl c-unknown">Unknown width</b>;
    }
  };

  // Quick destinations for easy one-click testing
  const quickDestinations =
    datasetMode === 'pilot'
      ? [
          { name: 'Dispesary', coords: [76.7984, 30.6776] as [number, number] },
          { name: 'Sector 17 Plaza', coords: [76.7794, 30.7415] as [number, number] },
          { name: 'Sukhna Lake Promenade', coords: [76.8143, 30.7422] as [number, number] },
          { name: 'Park Plaza (Building)', id: 'osm_bldg_409434941', type: 'building' },
          { name: 'CCET Diploma Wing', id: 'osm_bldg_1477354108', type: 'building' },
          { name: 'Dhillon Plaza', id: 'osm_bldg_1101860130', type: 'building' },
          { name: 'New Delhi (Outside Pilot)', coords: [77.2090, 28.6139] as [number, number], outside: true },
        ]
      : [
          { name: 'bldg-201 (Clinic)', id: 'bldg-201', type: 'building' },
          { name: 'bldg-204 (Residential)', id: 'bldg-204', type: 'building' },
          { name: 'road-102 (Connector)', id: 'road-102', type: 'road' },
        ];

  // Currently focused alternative route
  const activeRoute: AlternativeRoute | undefined =
    multiRouteResult?.routes?.find((r) => r.route_id === selectedRouteId) ||
    multiRouteResult?.routes?.[0];

  return (
    <section className="v">
      {/* Unified Title & Dataset Badge */}
      <div className="page-header-unified">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div className="page-tag">
            <span className="dot" />
            <span>Multi-Criteria Corridors & Clearance Routing</span>
          </div>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 12px',
              borderRadius: '99px',
              background: datasetMode === 'pilot' ? 'rgba(22, 138, 92, 0.12)' : 'var(--glass)',
              color: datasetMode === 'pilot' ? 'var(--ok)' : 'var(--mute)',
              border: `1.5px solid ${datasetMode === 'pilot' ? 'var(--ok)' : 'var(--line)'}`,
            }}
          >
            {datasetMode === 'pilot' ? '● Real Pilot Network (41,373 Roads • 422 Centres)' : 'Demo Network (6 Roads)'}
          </span>
        </div>

        <h2>Emergency Route Clearance & Alternatives</h2>
        <p className="lede">
          Evaluate multi-path ingress options from dispatch centres to target buildings. Corridors are tested against real vehicle envelopes with instant identification of choke points and turning radius barriers.
        </p>
        <div className="accent-bar" />
      </div>

      <div className="split" style={{ marginTop: '36px' }}>
        {/* Controls Column */}
        <div>
          {/* Emergency Centre Selection */}
          <div className="fld" style={{ background: 'var(--glass)', padding: '24px 26px', borderRadius: '16px', border: '1.5px solid var(--line)', marginBottom: '32px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <label style={{ margin: 0, fontWeight: 800, fontSize: '16px', color: 'var(--ink)', letterSpacing: '-0.2px' }}>
                1. Emergency Dispatch Origin Facility
              </label>
              {selectedStationId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStationId('');
                    setMultiRouteResult(null);
                  }}
                  className="btn sm"
                  style={{ fontSize: '13px', padding: '4px 12px', height: '30px', fontWeight: 600 }}
                  title="Deselect to test 'No origin selected' state"
                >
                  <RotateCcw size={14} style={{ marginRight: 6 }} />
                  Clear Origin
                </button>
              )}
            </div>

            {/* Category Filter Buttons */}
            {datasetMode === 'pilot' && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                {[
                  { key: 'all', label: 'All (422)', icon: null },
                  { key: 'fire_station', label: 'Fire Stations (5)', icon: <Flame size={14} style={{ color: '#ef4444' }} /> },
                  { key: 'hospital', label: 'Hospitals (199)', icon: <Building size={14} style={{ color: '#3b82f6' }} /> },
                  { key: 'clinic', label: 'Clinics (189)', icon: <Stethoscope size={14} style={{ color: '#10b981' }} /> },
                  { key: 'doctors', label: 'Doctors (29)', icon: <UserCheck size={14} style={{ color: '#06b6d4' }} /> },
                ].map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setFacilityCategory(cat.key)}
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: facilityCategory === cat.key ? '2px solid var(--ink)' : '1px solid var(--line)',
                      background: facilityCategory === cat.key ? 'var(--ink)' : 'var(--surface)',
                      color: facilityCategory === cat.key ? 'var(--bg)' : 'var(--ink)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {cat.icon}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Unified Searchable Facility Combobox Dropdown */}
            <div ref={facilityContainerRef} style={{ position: 'relative', width: '100%', zIndex: isFacilityDropdownOpen ? 900 : 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'var(--bg)',
                  border: isFacilityDropdownOpen ? '2px solid var(--ink)' : '1.5px solid var(--line)',
                  borderRadius: '10px',
                  padding: '4px 12px',
                  boxShadow: isFacilityDropdownOpen ? '0 4px 16px rgba(0,0,0,0.18)' : 'none',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <Search size={16} style={{ color: 'var(--mute)', marginRight: '10px', flexShrink: 0 }} />
                <input
                  ref={facilityInputRef}
                  type="text"
                  placeholder={
                    selectedStation
                      ? `Selected: ${selectedStation.properties?.name || selectedStationId}`
                      : 'Search or scroll to select emergency facility...'
                  }
                  value={facilitySearch}
                  onFocus={() => setIsFacilityDropdownOpen(true)}
                  onChange={(e) => {
                    setFacilitySearch(e.target.value);
                    setIsFacilityDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsFacilityDropdownOpen(false);
                    }
                  }}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--ink)',
                    fontSize: '14px',
                    fontWeight: 600,
                    padding: '8px 0',
                    height: 'auto',
                  }}
                />
                {facilitySearch && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFacilitySearch('');
                      facilityInputRef.current?.focus();
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--mute)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: '50%',
                    }}
                    title="Clear filter text"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFacilityDropdownOpen((prev) => !prev)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mute)',
                    cursor: 'pointer',
                    padding: '4px',
                    marginLeft: '4px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Toggle facility list"
                >
                  <ChevronDown
                    size={18}
                    style={{
                      transform: isFacilityDropdownOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>

              {/* Scrollable Dropdown List - solid opaque background & high z-index to prevent overlapping see-through */}
              {isFacilityDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'var(--bg)',
                    border: '2px solid var(--ink)',
                    borderRadius: '12px',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    zIndex: 9999,
                    padding: '6px',
                  }}
                >
                  {/* Option to clear selection */}
                  <div
                    onClick={() => {
                      setSelectedStationId('');
                      setIsFacilityDropdownOpen(false);
                      setFacilitySearch('');
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--mute)',
                      background: !selectedStationId ? 'rgba(125, 131, 122, 0.15)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--line)',
                      marginBottom: '4px',
                    }}
                  >
                    <span>-- No Emergency Centre Selected --</span>
                    {!selectedStationId && <CheckCircle size={15} style={{ color: 'var(--ok)' }} />}
                  </div>

                  {filteredStations.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--mute)', fontSize: '13px' }}>
                      No facilities matching "{facilitySearch}" in this category
                    </div>
                  ) : (
                    filteredStations.map((st) => {
                      const p = st.properties || {};
                      const stId = p.id || (st.id as string);
                      const isSelected = selectedStationId === stId;
                      const facType = (p.facility_type || p.station_type || 'facility').toLowerCase();

                      // Solid, high-contrast badge colors
                      let badgeBg = '#475569';
                      let badgeColor = '#ffffff';
                      if (facType === 'fire_station' || facType === 'fire') {
                        badgeBg = '#dc2626';
                        badgeColor = '#ffffff';
                      } else if (facType === 'hospital') {
                        badgeBg = '#2563eb';
                        badgeColor = '#ffffff';
                      } else if (facType === 'clinic') {
                        badgeBg = '#0d9488';
                        badgeColor = '#ffffff';
                      } else if (facType === 'doctors') {
                        badgeBg = '#0284c7';
                        badgeColor = '#ffffff';
                      }

                      return (
                        <div
                          key={stId}
                          onClick={() => {
                            setSelectedStationId(stId);
                            setFacilitySearch('');
                            setIsFacilityDropdownOpen(false);
                          }}
                          style={{
                            padding: '9px 12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: isSelected ? 'var(--ink)' : 'transparent',
                            color: isSelected ? 'var(--bg)' : 'var(--ink)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            marginBottom: '2px',
                            transition: 'background 0.1s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'rgba(125, 131, 122, 0.12)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = 'transparent';
                            }
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                background: isSelected ? '#ffd60a' : badgeBg,
                                color: isSelected ? '#1c1f1b' : badgeColor,
                                flexShrink: 0,
                                letterSpacing: '0.04em',
                              }}
                            >
                              {facType.replace('_', ' ')}
                            </span>
                            <span
                              style={{
                                fontSize: '13px',
                                fontWeight: isSelected ? 800 : 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {p.name || stId}
                            </span>
                          </div>
                          {isSelected && (
                            <CheckCircle size={16} style={{ color: isSelected ? 'var(--bg)' : 'var(--ok)', flexShrink: 0 }} />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Selected Facility Details Card */}
            {selectedStation ? (
              <div
                style={{
                  marginTop: '14px',
                  padding: '14px 16px',
                  background: 'var(--surface)',
                  border: '1.5px solid var(--line)',
                  borderRadius: '10px',
                  fontSize: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: '15px' }}>
                    {selectedStation.properties?.name || selectedStationId}
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background:
                        selectedStation.properties?.facility_type === 'fire_station'
                          ? 'rgba(220, 38, 38, 0.15)'
                          : 'rgba(37, 99, 235, 0.15)',
                      color:
                        selectedStation.properties?.facility_type === 'fire_station' ? '#dc2626' : '#2563eb',
                      border: '1px solid var(--line)',
                    }}
                  >
                    {(selectedStation.properties?.facility_type || 'Station').toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 12px', marginTop: '10px', fontSize: '13px', color: 'var(--mute)' }}>
                  <div>
                    Coordinates:{' '}
                    <b style={{ color: 'var(--ink)' }}>
                      {selectedStation.geometry?.coordinates
                        ? `${selectedStation.geometry.coordinates[1].toFixed(4)}, ${selectedStation.geometry.coordinates[0].toFixed(4)}`
                        : 'Mapped'}
                    </b>
                  </div>
                  <div>
                    Network Node: <b style={{ color: 'var(--ink)' }}>Road-attached junction</b>
                  </div>
                  {selectedStation.properties?.operator && (
                    <div style={{ gridColumn: 'span 2' }}>
                      Operator: <b style={{ color: 'var(--ink)' }}>{selectedStation.properties.operator}</b>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px 14px',
                  background: 'rgba(217, 119, 6, 0.08)',
                  border: '1.5px dashed #d97706',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={16} />
                <span>No dispatch origin facility is selected. Select an emergency centre above.</span>
              </div>
            )}
          </div>

          {/* Destination Search & Vehicle Profile */}
          <div className="fld" ref={searchContainerRef} style={{ position: 'relative', background: 'var(--glass)', padding: '18px 20px', borderRadius: '12px', border: '1.5px solid var(--line)', marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <label htmlFor="destination-search-input" style={{ margin: 0, fontWeight: 800, fontSize: '16px', color: 'var(--ink)', letterSpacing: '-0.2px' }}>
                2. Destination Location (Search or Select)
              </label>
              {(destinationSearch || destinationCoords) && (
                <button
                  type="button"
                  onClick={() => {
                    setDestinationSearch('');
                    setDestinationName('');
                    setDestinationCoords(null);
                    setDestinationBuildingId(undefined);
                    setDestinationRoadId(undefined);
                    setIsOutsidePilot(false);
                    setMultiRouteResult(null);
                  }}
                  className="btn sm"
                  style={{ fontSize: '13px', padding: '4px 12px', height: '30px', fontWeight: 600 }}
                  title="Clear destination to test 'No destination selected' state"
                >
                  <RotateCcw size={14} style={{ marginRight: 6 }} />
                  Clear Destination
                </button>
              )}
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                <input
                  id="destination-search-input"
                  type="text"
                  value={destinationSearch}
                  onChange={(e) => {
                    isUserTyping.current = true;
                    setDestinationSearch(e.target.value);
                    setDestinationName(e.target.value);
                    setIsDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (searchResults.length > 0) {
                        handleSelectSearchResult(searchResults[0]);
                      } else {
                        setIsDropdownOpen(false);
                        runRouteAnalysis();
                      }
                    }
                  }}
                  onFocus={() => {
                    if (searchResults.length > 0 && isUserTyping.current) setIsDropdownOpen(true);
                  }}
                  placeholder="Search destination buildings, hospitals, streets, addresses, landmarks..."
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 42px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--line)',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '15px',
                  }}
                />
                <Search
                  style={{
                    position: 'absolute',
                    left: 14,
                    width: 18,
                    height: 18,
                    color: 'var(--mute)',
                    pointerEvents: 'none',
                  }}
                />
                {isSearching && (
                  <Loader2
                    style={{
                      position: 'absolute',
                      right: 14,
                      width: 18,
                      height: 18,
                      color: 'var(--mute)',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                )}
              </div>
              <button
                type="button"
                id="calculate-routes-action-btn"
                className="btn pri"
                onClick={() => {
                  setIsDropdownOpen(false);
                  if (searchResults.length > 0 && !destinationCoords && !destinationBuildingId && !destinationRoadId) {
                    handleSelectSearchResult(searchResults[0]);
                  } else {
                    runRouteAnalysis();
                  }
                }}
                style={{
                  height: '46px',
                  padding: '0 20px',
                  fontWeight: 800,
                  fontSize: '14px',
                  background: 'var(--ink)',
                  color: 'var(--bg)',
                  borderRadius: '8px',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
                title="Calculate multiple alternative routes"
              >
                Calculate Routes
              </button>

              {/* Search Dropdown Results positioned directly below search input row */}
              {isDropdownOpen && searchResults.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'var(--surface)',
                    backdropFilter: 'blur(16px)',
                    border: '1.5px solid var(--line)',
                    borderRadius: '10px',
                    boxShadow: '0 14px 36px rgba(0,0,0,0.5)',
                    maxHeight: '280px',
                    overflowY: 'auto',
                    zIndex: 9999,
                  }}
                >
                  {searchResults.map((item) => (
                    <button
                      key={`${item.id}-${item.name}`}
                      type="button"
                      onClick={() => handleSelectSearchResult(item)}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        border: 'none',
                        borderBottom: '1px solid var(--line)',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>{item.name}</span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: item.inside_pilot_area === false ? 'rgba(217, 119, 6, 0.15)' : 'rgba(37, 99, 235, 0.12)',
                            color: item.inside_pilot_area === false ? '#d97706' : '#2563eb',
                          }}
                        >
                          {item.inside_pilot_area === false ? 'OUTSIDE PILOT' : item.feature_type.toUpperCase()}
                        </span>
                      </div>
                      {item.details && (
                        <span style={{ fontSize: '12px', color: 'var(--mute)', marginTop: '3px' }}>{item.details}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick destination suggestion chips */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--mute)', fontWeight: 600 }}>Quick:</span>
              {quickDestinations.map((qd: any) => (
                <button
                  key={qd.name}
                  type="button"
                  onClick={() => {
                    setDestinationName(qd.name);
                    setDestinationSearch(qd.name);
                    setIsOutsidePilot(Boolean(qd.outside));
                    setIsDropdownOpen(false);
                    if (qd.coords) {
                      setDestinationCoords(qd.coords);
                      setDestinationBuildingId(undefined);
                      setDestinationRoadId(undefined);
                    } else if (qd.type === 'building') {
                      setDestinationBuildingId(qd.id);
                      setDestinationCoords(null);
                      setDestinationRoadId(undefined);
                    } else if (qd.type === 'road') {
                      setDestinationRoadId(qd.id);
                      setDestinationCoords(null);
                      setDestinationBuildingId(undefined);
                    }
                  }}
                  className="chip"
                  style={{
                    fontSize: '13px',
                    height: '32px',
                    padding: '0 12px',
                    border: destinationName === qd.name ? '2px solid #ffd60a' : '1px solid var(--line)',
                    background: destinationName === qd.name ? 'rgba(255, 214, 10, 0.2)' : 'transparent',
                    color: destinationName === qd.name ? 'var(--ink)' : 'var(--mute)',
                    fontWeight: destinationName === qd.name ? 800 : 500,
                  }}
                >
                  {qd.name}
                </button>
              ))}
            </div>
          </div>

          {/* Vehicle Profile Selector & Requested Alternatives */}
          <div className="fld" style={{ background: 'var(--glass)', padding: '18px 20px', borderRadius: '12px', border: '1.5px solid var(--line)', marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <label style={{ margin: 0, fontWeight: 800, fontSize: '16px', color: 'var(--ink)', letterSpacing: '-0.2px' }}>
                3. Emergency Apparatus Profile
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--mute)', fontWeight: 600 }}>Routes:</span>
                {[2, 3, 4].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRequestedK(k)}
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: requestedK === k ? '2px solid var(--ink)' : '1px solid var(--line)',
                      background: requestedK === k ? 'var(--ink)' : 'var(--surface)',
                      color: requestedK === k ? 'var(--bg)' : 'var(--ink)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="chips" role="group" aria-label="Vehicle selection" style={{ marginTop: '10px', gap: '10px' }}>
              {Object.entries(VEHICLE_OPTIONS).map(([k, v]) => (
                <button
                  key={k}
                  className={`chip ${selectedVehKey === k ? 'on' : ''}`}
                  onClick={() => setSelectedVehKey(k)}
                  aria-pressed={selectedVehKey === k}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', height: '38px', padding: '0 16px', fontWeight: 600 }}
                >
                  <span>{v.n}</span>
                  <span style={{ fontSize: '12px', opacity: 0.85 }}>(≥{v.w}m)</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--mute)', marginTop: '10px', lineHeight: 1.5 }}>
              Physical clearance constraint: <b style={{ color: 'var(--ink)' }}>{currentVeh.w}m minimum usable corridor width</b> ({currentVeh.desc})
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px', marginBottom: '28px', flexWrap: 'wrap' }}>
            <button
              className="btn pri"
              onClick={runRouteAnalysis}
              disabled={loading || compareLoading || !selectedStationId || (!destinationSearch && !destinationCoords && !destinationBuildingId && !destinationRoadId)}
            >
              {loading ? (
                <>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                  Calculating Alternatives...
                </>
              ) : (
                'Calculate Multiple Routes'
              )}
            </button>
            <button
              className="btn"
              onClick={runRealityCheck}
              disabled={loading || compareLoading || !selectedStationId}
              style={{
                borderColor: 'var(--sig)',
                color: 'var(--sig)',
                fontWeight: 700,
              }}
            >
              {compareLoading ? 'Comparing...' : 'Reality Check'}
            </button>
          </div>

          {/* =========================================================================
              UI STATES: Handling all 9 required states
             ========================================================================= */}

          {/* UI State 1: No Origin Selected */}
          {!selectedStationId && (
            <div
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                background: 'var(--glass)',
                border: '1.5px dashed var(--line)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--mute)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <HelpCircle size={20} style={{ color: 'var(--mute)', flexShrink: 0 }} />
              <div>
                <b>No dispatch origin selected.</b> Select an emergency facility (fire station, hospital, or clinic) in the dispatch selector above to calculate routes.
              </div>
            </div>
          )}

          {/* UI State 2: No Destination Selected */}
          {selectedStationId && !destinationSearch && !destinationCoords && !destinationBuildingId && !destinationRoadId && (
            <div
              style={{
                marginTop: '16px',
                padding: '14px 16px',
                background: 'var(--glass)',
                border: '1.5px dashed var(--line)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--mute)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <MapPin size={20} style={{ color: 'var(--mute)', flexShrink: 0 }} />
              <div>
                <b>No destination selected.</b> Search or choose a target building, road, or place above to evaluate alternative paths.
              </div>
            </div>
          )}

          {/* UI State 3: Loading Routes */}
          {loading && (
            <div
              style={{
                marginTop: '16px',
                padding: '16px',
                background: 'var(--glass)',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', color: '#2563eb' }} />
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>
                Evaluating Road Network Corridors...
              </div>
              <div style={{ fontSize: '11px', color: 'var(--mute)', marginTop: '4px' }}>
                Executing bounded k-shortest path analysis and checking vehicle clearance constraints
              </div>
            </div>
          )}

          {/* UI State 8: Backend Unavailable / Error */}
          {error && !loading && (
            <div
              style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: 'rgba(215, 38, 61, 0.1)',
                border: '1.5px solid #d7263d',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#d7263d',
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <XCircle size={16} />
                <span>Backend Routing Service Unavailable</span>
              </div>
              <div style={{ fontSize: '12px' }}>{error}</div>
              <button
                type="button"
                className="btn sm"
                onClick={runRouteAnalysis}
                style={{ marginTop: '8px', borderColor: '#d7263d', color: '#d7263d' }}
              >
                Retry Request
              </button>
            </div>
          )}

          {/* UI State 7: Origin or Destination Outside Pilot Area */}
          {(isOutsidePilot || multiRouteResult?.status === 'outside_pilot') && (
            <div
              style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: 'rgba(217, 119, 6, 0.1)',
                border: '1.5px solid #d97706',
                borderRadius: '8px',
                fontSize: '12px',
                lineHeight: 1.4,
                color: 'var(--ink)',
              }}
            >
              <div style={{ fontWeight: 800, color: '#d97706', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={16} />
                <span>Pilot Corridor Boundary Notice</span>
              </div>
              <div>
                Destination <b>'{destinationName}'</b> is outside the Chandigarh-Mohali-Gharuan pilot corridor.
                Detailed road-network routing, clearance width analysis, and access feasibility are unavailable until geographic road data exists for this region.
              </div>
            </div>
          )}

          {/* UI State 6: No Route Found */}
          {multiRouteResult && multiRouteResult.routes_found_count === 0 && multiRouteResult.status !== 'outside_pilot' && !loading && (
            <div
              style={{
                marginTop: '16px',
                padding: '14px',
                background: multiRouteResult.status === 'blocked' ? 'rgba(215, 38, 61, 0.08)' : 'var(--glass)',
                border: `1.5px solid ${multiRouteResult.status === 'blocked' ? '#d7263d' : 'var(--line)'}`,
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <XCircle size={18} style={{ color: multiRouteResult.status === 'blocked' ? '#d7263d' : 'var(--mute)' }} />
                <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--ink)' }}>
                  {multiRouteResult.status === 'blocked' ? 'No Accessible Route Found (Blocked)' : 'No Route Found (Disconnected)'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink)', lineHeight: 1.4 }}>
                {multiRouteResult.notes}
              </div>
            </div>
          )}

          {/* UI State 5: Fewer Routes Than Requested Notice */}
          {multiRouteResult && multiRouteResult.status === 'fewer_found' && (
            <div
              style={{
                marginTop: '16px',
                padding: '10px 12px',
                background: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid #93c5fd',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#1d4ed8',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <b>Fewer routes than requested:</b> Found {multiRouteResult.routes_found_count} of {multiRouteResult.requested_count} requested routes. {multiRouteResult.notes}
              </div>
            </div>
          )}

          {/* UI State 4 & 9: Multiple Routes Found & Selected Route Details */}
          {multiRouteResult && multiRouteResult.routes && multiRouteResult.routes.length > 0 && (
            <div style={{ marginTop: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800 }}>
                  Alternative Route Comparison ({multiRouteResult.routes.length} paths)
                </h3>
                <span style={{ fontSize: '13px', color: 'var(--mute)' }}>
                  Click route to highlight on map
                </span>
              </div>

              {/* Alternative Route Cards Stack */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {multiRouteResult.routes.map((rt) => {
                  const isSelected = rt.route_id === (selectedRouteId || multiRouteResult.routes[0].route_id);
                  return (
                    <div
                      key={rt.route_id}
                      onClick={() => setSelectedRouteId(rt.route_id)}
                      style={{
                        padding: '14px 16px',
                        background: isSelected ? 'var(--surface)' : 'var(--glass)',
                        border: isSelected ? `2.5px solid ${rt.color}` : '1.5px solid var(--line)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        boxShadow: isSelected ? `0 0 16px ${rt.color}35` : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {/* Header with Swatch & Status Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '5px',
                              background: rt.color,
                              flexShrink: 0,
                              display: 'inline-block',
                            }}
                          />
                          <span style={{ fontWeight: 800, fontSize: '16px', color: 'var(--ink)' }}>
                            {rt.name}
                          </span>
                        </div>
                        <div>{getPill(rt.classification)}</div>
                      </div>

                      {/* Route Key Metrics */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: '10px',
                          marginTop: '12px',
                          textAlign: 'center',
                          fontSize: '14px',
                        }}
                      >
                        <div style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ color: 'var(--mute)' }}>Distance: </span>
                          <b>
                            {rt.total_distance_m >= 1000
                              ? `${(rt.total_distance_m / 1000).toFixed(2)} km`
                              : `${Math.round(rt.total_distance_m)} m`}
                          </b>
                        </div>
                        <div style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ color: 'var(--mute)' }}>Corridors: </span>
                          <b>{rt.segment_count} segments</b>
                        </div>
                        <div style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--line)' }}>
                          <span style={{ color: 'var(--mute)' }}>Clearance: </span>
                          <b style={{ color: rt.is_recommended ? '#168a5c' : '#d7263d' }}>
                            {rt.is_recommended ? 'Passable' : 'Conditional'}
                          </b>
                        </div>
                      </div>

                      {/* Restrictions / Limitations */}
                      {rt.known_restrictions && rt.known_restrictions.length > 0 && (
                        <div style={{ marginTop: '10px', fontSize: '14px', color: '#e8710a', fontWeight: 600 }}>
                          <b>Known Constraints:</b> {rt.known_restrictions.join('; ')}
                        </div>
                      )}

                      {/* Unknown evidence alert */}
                      {rt.unknown_evidence_segments && rt.unknown_evidence_segments.length > 0 && (
                        <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--mute)', fontWeight: 600 }}>
                          <b>Unsurveyed Segments:</b> {rt.unknown_evidence_segments.length} corridors lack measured width
                        </div>
                      )}

                      {/* Explanation */}
                      <div style={{ marginTop: '10px', fontSize: '14px', color: 'var(--mute)', lineHeight: 1.55 }}>
                        {rt.explanation}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Honest limitation callout if all alternatives contain unknown widths */}
              {multiRouteResult.routes.every((r) => r.classification === 'unknown') && (
                <div
                  style={{
                    marginTop: '16px',
                    padding: '14px 16px',
                    background: 'rgba(100, 116, 139, 0.1)',
                    border: '1.5px solid #94a3b8',
                    borderRadius: '8px',
                    fontSize: '14px',
                    lineHeight: 1.55,
                    color: 'var(--ink)',
                  }}
                >
                  <b style={{ color: 'var(--ink)' }}>Cadastral Ground Truth Limitation:</b> All candidate alternative routes traverse unmeasured road corridors. UNREACHABLE honestly flags these as unverified unknown widths rather than falsely claiming verified safety.
                </div>
              )}

              {/* Building Emergency Access & Ingress Caveat */}
              {(destinationBuildingId || multiRouteResult.destination_type === 'building') && (
                <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div
                    style={{
                      background: 'rgba(255, 214, 10, 0.08)',
                      border: '1.5px solid #ffd60a',
                      borderRadius: '8px',
                      padding: '16px 18px',
                      fontSize: '14px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--ink)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building size={18} style={{ color: '#d97706' }} />
                        Building Emergency Assessment
                      </span>
                      <a
                        href={`#/b/${destinationBuildingId || multiRouteResult.destination_id}`}
                        style={{ fontSize: '14px', fontWeight: 700, color: '#2563eb', textDecoration: 'underline' }}
                      >
                        Inspect Full Assessment Report →
                      </a>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 16px', marginBottom: '12px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: 'var(--mute)' }}>Approach Road: </span>
                        <b style={{ color: 'var(--ink)' }}>
                          {bldgAssessment?.approach_road_name || 'Nearest connected road corridor'}
                        </b>
                      </div>
                      <div>
                        <span style={{ color: 'var(--mute)' }}>Frontage Setback: </span>
                        <b style={{ color: 'var(--ink)' }}>
                          {bldgAssessment?.estimated_setback_m !== undefined && bldgAssessment?.estimated_setback_m !== null
                            ? `${bldgAssessment.estimated_setback_m} m`
                            : 'Unsurveyed'}
                        </b>
                      </div>
                      <div>
                        <span style={{ color: 'var(--mute)' }}>Entrance Clearance: </span>
                        <b style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>
                          {bldgAssessment?.entrance_status || 'Unsurveyed / unknown'}
                        </b>
                      </div>
                      <div>
                        <span style={{ color: 'var(--mute)' }}>Assessment Status: </span>
                        <b style={{ color: '#d97706' }}>
                          {bldgAssessment?.assessment_status === 'partial_unverified'
                            ? 'Partial (Unverified)'
                            : bldgAssessment?.assessment_status || 'Partial'}
                        </b>
                      </div>
                    </div>

                    {bldgAssessment?.missing_evidence && bldgAssessment.missing_evidence.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--line)', paddingTop: '8px', fontSize: '13px', color: 'var(--mute)' }}>
                        <b>Missing Field Evidence:</b>{' '}
                        <span>{bldgAssessment.missing_evidence.join(' • ')}</span>
                      </div>
                    )}
                  </div>

                  {/* Road vs Entrance Ingress Caveat */}
                  <div
                    style={{
                      padding: '16px 18px',
                      background: 'rgba(217, 119, 6, 0.1)',
                      border: '1.5px solid #d97706',
                      borderRadius: '8px',
                      fontSize: '14px',
                      lineHeight: '1.55',
                      color: 'var(--ink)',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#d97706', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
                      <ShieldAlert size={20} />
                      <span>Critical Ingress Caveat: Public Road Reachability ≠ Property Entrance Ingress</span>
                    </div>
                    <div>
                      This route reaches the connected road access point in the public corridor. Road reachability does not guarantee apparatus can enter property gates or courtyard setbacks.
                    </div>
                  </div>
                </div>
              )}

              {/* Turn-by-Turn Steps for Selected Alternative Route */}
              {activeRoute && activeRoute.steps && activeRoute.steps.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>
                      Selected: {activeRoute.name} ({activeRoute.steps.length} segments)
                    </h4>
                    <span style={{ fontSize: '14px', color: 'var(--mute)', fontWeight: 600 }}>
                      Highlighted on map ({activeRoute.color})
                    </span>
                  </div>

                  <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                    {activeRoute.steps.slice(0, 50).map((st) => (
                      <div
                        key={`${st.step_index}-${st.road_id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '14px',
                          padding: '12px 16px',
                          background: 'var(--glass)',
                          borderRadius: '8px',
                          border: '1.5px solid var(--line)',
                          fontSize: '15px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Step {st.step_index}: {st.road_name || st.road_id}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--mute)', marginTop: '3px' }}>
                            Length: {st.segment_length_m}m · {st.reason}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0 }}>{getPill(st.status)}</div>
                      </div>
                    ))}
                    {activeRoute.steps.length > 50 && (
                      <div style={{ textAlign: 'center', fontSize: '14px', color: 'var(--mute)', padding: '8px' }}>
                        + {activeRoute.steps.length - 50} additional road segments traversed along road network
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Map Preview Column */}
        <div>
          {/* Reality Check Verdict Banner */}
          {compareResult && (
            <div
              role="region"
              aria-label="Reality Check Verdict"
              style={{
                background: compareResult.naive_would_fail ? 'rgba(215, 38, 61, 0.12)' : 'rgba(42, 157, 143, 0.12)',
                border: `1.5px solid ${compareResult.naive_would_fail ? '#d7263d' : '#2a9d8f'}`,
                borderRadius: '8px',
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
              {compareResult.naive_would_fail ? (
                <XCircle style={{ width: 18, height: 18, color: '#d7263d', flexShrink: 0 }} />
              ) : (
                <CheckCircle style={{ width: 18, height: 18, color: '#2a9d8f', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <b>Reality Check:</b> {compareResult.verdict}
              </div>
            </div>
          )}

          <MapView
            buildings={buildings}
            roads={roads}
            stations={stations}
            selectedFeature={
              selectedStation ||
              (destinationBuildingId
                ? buildings.find((b) => b.properties?.id === destinationBuildingId) || null
                : null)
            }
            selectedVehicle={{
              id: selectedVehKey,
              name: currentVeh.n,
              category: 'Emergency Vehicle',
              minClearanceWidthM: currentVeh.w,
              description: currentVeh.desc,
            }}
            alternativeRoutes={multiRouteResult?.routes || []}
            selectedRouteId={selectedRouteId || undefined}
            onSelectRoute={(id) => setSelectedRouteId(id)}
            destinationCoords={destinationCoords}
            destinationName={destinationName}
            awareRoadIds={activeRoute?.segments_traversed || compareResult?.aware.road_ids || []}
            naiveRoadIds={compareResult?.naive.road_ids || []}
            fullHeight={false}
          />

          {/* Map Color Legend with Route Identity AND Accessibility Indicators */}
          <div
            style={{
              marginTop: '16px',
              padding: '14px 16px',
              background: 'var(--glass)',
              border: '1.5px solid var(--line)',
              borderRadius: '10px',
              fontSize: '13px',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '8px', color: 'var(--ink)' }}>
              Map Legend: Alternative Route Colours & Accessibility Status
            </div>

            {/* Route Identity Colours */}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: 18, height: 6, background: '#2563eb', borderRadius: 3 }} />
                <span><b>Route 1:</b> Primary (Blue)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: 18, height: 6, background: '#9333ea', borderRadius: 3 }} />
                <span><b>Route 2:</b> Alternative A (Purple)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: 18, height: 6, background: '#0d9488', borderRadius: 3 }} />
                <span><b>Route 3:</b> Alternative B (Teal)</span>
              </div>
            </div>

            {/* Separate Accessibility Status Indicators */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
              <b className="pl c-ok">● Verified accessible (Green)</b>
              <b className="pl c-constrained">▲ Constrained margin (Amber)</b>
              <b className="pl c-infeasible">✕ Confirmed blocked (Red)</b>
              <b className="pl c-unknown">? Unknown width / Unsurveyed (Grey)</b>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

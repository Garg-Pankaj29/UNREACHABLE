import {
  BuildingAccessResponse,
  CriticalRoad,
  ExplainResponse,
  FeatureCollection,
  HealthResponse,
  MultiRouteResponse,
  RoadAccessResponse,
  RouteCompareResponse,
  RouteResponse,
  SimulateRequest,
  SimulateResponse,
  StatsResponse,
  VehicleGapResponse,
  VehicleProfile,
} from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';

const FIXTURES_BASE = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/fixtures`;

let replayModeActive = false;
type ReplayListener = (active: boolean) => void;
const replayListeners = new Set<ReplayListener>();

export function isReplayActive(): boolean {
  return replayModeActive;
}

export function onReplayChange(cb: ReplayListener): () => void {
  replayListeners.add(cb);
  cb(replayModeActive);
  return () => {
    replayListeners.delete(cb);
  };
}

function activateReplay() {
  if (!replayModeActive) {
    replayModeActive = true;
    replayListeners.forEach((fn) => fn(true));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('unreachable:replay-mode', { detail: true }));
    }
  }
}

async function handleResponse<T>(res: Response, endpoint: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson.detail || res.statusText;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`API error at ${endpoint} (${res.status}): ${detail}`);
  }
  return res.json();
}

async function fetchWithFallback<T>(
  url: string,
  fixtureCandidates: string[],
  fetchOptions?: RequestInit
): Promise<T> {
  try {
    const res = await fetch(url, fetchOptions);
    if (!res.ok && res.status >= 500) {
      throw new Error(`Backend server error status ${res.status}`);
    }
    return await handleResponse<T>(res, url);
  } catch (liveErr: any) {
    if (liveErr.name === 'TypeError' || liveErr.message?.includes('Failed to fetch') || liveErr.message?.includes('NetworkError')) {
      activateReplay();
    }
    for (const cand of fixtureCandidates) {
      try {
        const fixUrl = `${FIXTURES_BASE}/${cand}`;
        const fixRes = await fetch(fixUrl);
        if (fixRes.ok) {
          return (await fixRes.json()) as T;
        }
      } catch {
        // try next fixture candidate
      }
    }
    throw liveErr;
  }
}

export const api = {
  getBaseUrl(): string {
    return API_BASE_URL;
  },

  isReplay(): boolean {
    return isReplayActive();
  },

  onReplayChange(cb: ReplayListener): () => void {
    return onReplayChange(cb);
  },

  async fetchHealth(): Promise<HealthResponse> {
    return fetchWithFallback<HealthResponse>(
      `${API_BASE_URL}/health`,
      ['health.json']
    );
  },

  async fetchBuildings(): Promise<FeatureCollection> {
    return fetchWithFallback<FeatureCollection>(
      `${API_BASE_URL}/buildings`,
      ['buildings.json']
    );
  },

  async fetchRoads(): Promise<FeatureCollection> {
    return fetchWithFallback<FeatureCollection>(
      `${API_BASE_URL}/roads`,
      ['roads.json']
    );
  },

  async fetchStats(vehicleId?: string): Promise<StatsResponse> {
    const url = vehicleId
      ? `${API_BASE_URL}/stats?vehicle_id=${encodeURIComponent(vehicleId)}`
      : `${API_BASE_URL}/stats`;
    const candidates = vehicleId
      ? [`stats_${vehicleId}.json`, 'stats.json']
      : ['stats.json'];
    return fetchWithFallback<StatsResponse>(url, candidates);
  },

  async fetchVehicleGap(): Promise<VehicleGapResponse> {
    return fetchWithFallback<VehicleGapResponse>(
      `${API_BASE_URL}/analysis/vehicle-gap`,
      ['vehicle-gap.json']
    );
  },

  async fetchNeighbourhood(): Promise<FeatureCollection> {
    return fetchWithFallback<FeatureCollection>(
      `${API_BASE_URL}/neighbourhood`,
      ['neighbourhood.json']
    );
  },

  async fetchPilotSummary(): Promise<any> {
    return fetchWithFallback<any>(
      `${API_BASE_URL}/pilot/summary`,
      ['pilot_summary.json']
    );
  },

  async fetchPilotFeatures(params?: {
    bbox?: string;
    zoom?: number;
    layer?: string;
    limit?: number;
  }): Promise<FeatureCollection> {
    const q = new URLSearchParams();
    if (params?.bbox) q.append('bbox', params.bbox);
    if (params?.zoom !== undefined) q.append('zoom', params.zoom.toString());
    if (params?.layer) q.append('layer', params.layer);
    if (params?.limit) q.append('limit', params.limit.toString());
    const qs = q.toString();
    const url = qs ? `${API_BASE_URL}/pilot/features?${qs}` : `${API_BASE_URL}/pilot/features`;
    return fetchWithFallback<FeatureCollection>(url, ['neighbourhood.json']);
  },

  async fetchPilotFacilities(category?: string): Promise<FeatureCollection> {
    const q = category ? `?category=${encodeURIComponent(category)}` : '';
    return fetchWithFallback<FeatureCollection>(
      `${API_BASE_URL}/pilot/facilities${q}`,
      ['neighbourhood.json']
    );
  },

  async searchPilot(query: string, limit: number = 15): Promise<SearchResponse> {
    const q = new URLSearchParams({ q: query, limit: limit.toString() });
    return fetchWithFallback<SearchResponse>(
      `${API_BASE_URL}/pilot/search?${q.toString()}`,
      ['neighbourhood.json']
    );
  },

  async fetchVehicles(): Promise<VehicleProfile[]> {
    return fetchWithFallback<VehicleProfile[]>(
      `${API_BASE_URL}/vehicles`,
      ['vehicles.json']
    );
  },

  async fetchRoute(
    origin: string,
    destinationBuilding?: string,
    vehicle: string = 'fire',
    destinationRoad?: string,
    destinationCoords?: [number, number],
    destinationName?: string,
    datasetMode?: string
  ): Promise<RouteResponse> {
    const params = new URLSearchParams({
      origin,
      vehicle,
    });
    if (destinationBuilding) params.append('destination_building', destinationBuilding);
    if (destinationRoad) params.append('destination_road', destinationRoad);
    if (destinationCoords) params.append('destination_coords', `${destinationCoords[0]},${destinationCoords[1]}`);
    if (destinationName) params.append('destination_name', destinationName);
    if (datasetMode) params.append('mode', datasetMode);

    const candidates = [
      `route_${origin}_${destinationBuilding || ''}_${destinationRoad || ''}_${vehicle}.json`,
      `route_${origin}_${destinationBuilding || ''}__${vehicle}.json`,
      `route_${origin}_${destinationBuilding || ''}_${vehicle}.json`,
    ];
    if (origin === 'station-01' && (!destinationBuilding || destinationBuilding === 'bldg-201') && !destinationRoad) {
      candidates.push('route_station-01_bldg-201_fire.json');
    }

    return fetchWithFallback<RouteResponse>(
      `${API_BASE_URL}/routing/route?${params.toString()}`,
      candidates
    );
  },

  async fetchAlternativeRoutes(
    origin: string,
    destinationBuilding?: string,
    vehicle: string = 'fire',
    destinationRoad?: string,
    destinationCoords?: [number, number],
    destinationName?: string,
    datasetMode?: string,
    k: number = 3
  ): Promise<MultiRouteResponse> {
    const params = new URLSearchParams({
      origin,
      vehicle,
      k: k.toString(),
    });
    if (destinationBuilding) params.append('destination_building', destinationBuilding);
    if (destinationRoad) params.append('destination_road', destinationRoad);
    if (destinationCoords) params.append('destination_coords', `${destinationCoords[0]},${destinationCoords[1]}`);
    if (destinationName) params.append('destination_name', destinationName);
    if (datasetMode) params.append('mode', datasetMode);

    return fetchWithFallback<MultiRouteResponse>(
      `${API_BASE_URL}/routing/alternatives?${params.toString()}`,
      ['neighbourhood.json']
    );
  },

  async fetchBuildingAccess(
    buildingId: string,
    vehicle: string = 'fire',
    origin?: string,
    datasetMode?: 'pilot' | 'sample'
  ): Promise<BuildingAccessResponse> {
    const params = new URLSearchParams({ vehicle });
    if (origin) params.append('origin', origin);
    if (datasetMode) params.append('dataset_mode', datasetMode);
    const candidates = [
      `building-access_${buildingId}_${vehicle}_${origin || 'default'}.json`,
      `building-access_${buildingId}_fire_station-01.json`,
      `building-access_bldg-201_fire_station-01.json`,
    ];
    return fetchWithFallback<BuildingAccessResponse>(
      `${API_BASE_URL}/routing/building-access/${encodeURIComponent(buildingId)}?${params.toString()}`,
      candidates
    );
  },

  async fetchRoadAccess(
    roadId: string,
    vehicle: string = 'fire'
  ): Promise<RoadAccessResponse> {
    const params = new URLSearchParams({ vehicle });
    const candidates = [
      `road-access_${roadId}_${vehicle}.json`,
      `road-access_${roadId}_fire.json`,
      `road-access_road-101_fire.json`,
    ];
    return fetchWithFallback<RoadAccessResponse>(
      `${API_BASE_URL}/routing/road-access/${roadId}?${params.toString()}`,
      candidates
    );
  },

  async compareRoutes(
    stationId: string = 'station-01',
    buildingId?: string,
    vehicleId: string = 'fire',
    roadId?: string,
    destinationCoords?: [number, number],
    destinationName?: string,
    datasetMode?: string
  ): Promise<RouteCompareResponse> {
    const params = new URLSearchParams({
      station_id: stationId,
      vehicle_id: vehicleId,
    });
    if (buildingId) params.append('building_id', buildingId);
    if (roadId) params.append('road_id', roadId);
    if (destinationCoords) params.append('destination_coords', `${destinationCoords[0]},${destinationCoords[1]}`);
    if (destinationName) params.append('destination_name', destinationName);
    if (datasetMode) params.append('mode', datasetMode);

    const candidates = [
      `compare_${stationId}_${buildingId || ''}_${vehicleId}.json`,
      `compare_${stationId}_${buildingId || ''}__${vehicleId}.json`,
      `compare_station-01_${buildingId || 'bldg-201'}_fire.json`,
      `compare_station-01_bldg-204_fire.json`,
    ];
    return fetchWithFallback<RouteCompareResponse>(
      `${API_BASE_URL}/routing/compare?${params.toString()}`,
      candidates
    );
  },

  async simulate(request: SimulateRequest): Promise<SimulateResponse> {
    const changes = request.changes || [];
    const hasBlock101 = changes.some((c) => c.road_id === 'road-101');
    const hasClear104 = changes.some((c) => c.road_id === 'road-104');

    let candidates: string[] = [];
    if (hasBlock101) {
      candidates = [
        `simulate_block_road-101_${request.vehicle_id || 'fire'}.json`,
        'simulate_block_road-101_fire.json',
        'simulate_default.json',
      ];
    } else if (hasClear104) {
      candidates = [
        `simulate_clear_road-104_${request.vehicle_id || 'fire'}.json`,
        'simulate_clear_road-104_fire.json',
        'simulate_issue_I-01_fire.json',
        'simulate_default.json',
      ];
    } else {
      candidates = [
        `simulate_baseline_${request.vehicle_id || 'fire'}.json`,
        'simulate_baseline_fire.json',
        'simulate_default.json',
      ];
    }

    return fetchWithFallback<SimulateResponse>(
      `${API_BASE_URL}/simulate`,
      candidates,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    );
  },

  async fetchCriticalRoads(
    vehicleId: string = 'fire',
    limit: number = 5
  ): Promise<CriticalRoad[]> {
    const params = new URLSearchParams({
      vehicle_id: vehicleId,
      limit: String(limit),
    });
    const candidates = [
      `critical-roads_${vehicleId}_${limit}.json`,
      `critical-roads_${vehicleId}.json`,
      `critical-roads_fire.json`,
    ];
    return fetchWithFallback<CriticalRoad[]>(
      `${API_BASE_URL}/analysis/critical-roads?${params.toString()}`,
      candidates
    );
  },

  async explainRoute(
    stationId: string = 'station-01',
    buildingId: string,
    vehicleId: string = 'fire'
  ): Promise<ExplainResponse> {
    const candidates = [
      `explain_${stationId}_${buildingId}_${vehicleId}.json`,
      `explain_station-01_${buildingId}_fire.json`,
      `explain_station-01_bldg-201_fire.json`,
    ];
    return fetchWithFallback<ExplainResponse>(
      `${API_BASE_URL}/explain`,
      candidates,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_id: stationId,
          building_id: buildingId,
          vehicle_id: vehicleId,
        }),
      }
    );
  },

  async fetchAuditWorkOrder(
    vehicleId: string = 'fire'
  ): Promise<WorkOrderItem[]> {
    const params = new URLSearchParams({
      vehicle_id: vehicleId,
    });
    const candidates = [
      `audit_work_order_${vehicleId}.json`,
      'audit_work_order_fire.json',
      'audit_work_order_default.json',
    ];
    return fetchWithFallback<WorkOrderItem[]>(
      `${API_BASE_URL}/audit/work-order?${params.toString()}`,
      candidates
    );
  },

  getIncidents: async (): Promise<{ incidents: any[]; blocked_roads: string[]; count: number }> => {
    try {
      const res = await fetch(`${API_BASE_URL}/incidents`);
      return await handleResponse(res, '/incidents');
    } catch {
      return { incidents: [], blocked_roads: [], count: 0 };
    }
  },

  setIncident: async (
    roadId: string,
    action: 'block' | 'clear' = 'block',
    reason: string = 'Manual emergency closure'
  ): Promise<{ status: string; action: string; road_id: string; blocked_roads: string[] }> => {
    const res = await fetch(`${API_BASE_URL}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ road_id: roadId, action, reason }),
    });
    return handleResponse(res, '/incidents');
  },

  getStreamUrl: (): string => {
    return `${API_BASE_URL}/stream`;
  },
};

export const apiService = api;

export interface WorkOrderItem {
  road_id: string;
  name: string;
  reason: string;
  buildings_affected: number;
  data_source?: string | null;
}

export interface SearchResultItem {
  id: string;
  osm_id?: number;
  name: string;
  feature_type: 'facility' | 'road' | 'building' | 'place' | 'station' | 'landmark';
  sub_type?: string;
  details?: string;
  coordinates?: [number, number];
  geometry?: any;
  properties?: any;
  source?: 'local_pilot' | 'sample_demo' | 'online_osm';
  inside_pilot_area?: boolean;
  coverage_notice?: string;
  verification_status?: string;
}

export interface SearchResponse {
  query: string;
  count: number;
  local_count?: number;
  online_count?: number;
  online_available?: boolean;
  results: SearchResultItem[];
}





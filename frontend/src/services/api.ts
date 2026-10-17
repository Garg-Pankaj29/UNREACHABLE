import {
  BuildingAccessResponse,
  FeatureCollection,
  HealthResponse,
  RoadAccessResponse,
  RouteResponse,
  StatsResponse,
  VehicleProfile,
} from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';

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

export const api = {
  getBaseUrl(): string {
    return API_BASE_URL;
  },

  async fetchHealth(): Promise<HealthResponse> {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      return await handleResponse<HealthResponse>(res, '/health');
    } catch (err: any) {
      throw new Error(
        `Unable to connect to backend at ${API_BASE_URL}/health. Make sure the FastAPI server is running.`
      );
    }
  },

  async fetchBuildings(): Promise<FeatureCollection> {
    const res = await fetch(`${API_BASE_URL}/buildings`);
    return handleResponse<FeatureCollection>(res, '/buildings');
  },

  async fetchRoads(): Promise<FeatureCollection> {
    const res = await fetch(`${API_BASE_URL}/roads`);
    return handleResponse<FeatureCollection>(res, '/roads');
  },

  async fetchStats(): Promise<StatsResponse> {
    const res = await fetch(`${API_BASE_URL}/stats`);
    return handleResponse<StatsResponse>(res, '/stats');
  },

  async fetchNeighbourhood(): Promise<FeatureCollection> {
    const res = await fetch(`${API_BASE_URL}/neighbourhood`);
    return handleResponse<FeatureCollection>(res, '/neighbourhood');
  },

  async fetchVehicles(): Promise<VehicleProfile[]> {
    const res = await fetch(`${API_BASE_URL}/vehicles`);
    return handleResponse<VehicleProfile[]>(res, '/vehicles');
  },

  async fetchRoute(
    origin: string,
    destinationBuilding?: string,
    vehicle: string = 'fire',
    destinationRoad?: string
  ): Promise<RouteResponse> {
    const params = new URLSearchParams({
      origin,
      vehicle,
    });
    if (destinationBuilding) params.append('destination_building', destinationBuilding);
    if (destinationRoad) params.append('destination_road', destinationRoad);

    const res = await fetch(`${API_BASE_URL}/routing/route?${params.toString()}`);
    return handleResponse<RouteResponse>(res, '/routing/route');
  },

  async fetchBuildingAccess(
    buildingId: string,
    vehicle: string = 'fire',
    origin: string = 'station-01'
  ): Promise<BuildingAccessResponse> {
    const params = new URLSearchParams({
      vehicle,
      origin,
    });
    const res = await fetch(
      `${API_BASE_URL}/routing/building-access/${buildingId}?${params.toString()}`
    );
    return handleResponse<BuildingAccessResponse>(
      res,
      `/routing/building-access/${buildingId}`
    );
  },

  async fetchRoadAccess(
    roadId: string,
    vehicle: string = 'fire'
  ): Promise<RoadAccessResponse> {
    const params = new URLSearchParams({ vehicle });
    const res = await fetch(
      `${API_BASE_URL}/routing/road-access/${roadId}?${params.toString()}`
    );
    return handleResponse<RoadAccessResponse>(
      res,
      `/routing/road-access/${roadId}`
    );
  },
};

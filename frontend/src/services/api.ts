import { FeatureCollection, HealthResponse, StatsResponse } from '../types';

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
};

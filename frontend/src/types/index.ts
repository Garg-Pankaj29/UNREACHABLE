export type AccessStatus = 'feasible' | 'constrained' | 'infeasible' | 'unknown';

export type FeatureType = 'building' | 'road' | 'station';

export interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}

export interface FeatureProperties {
  id: string;
  feature_type: FeatureType;
  name: string;
  access_status?: AccessStatus;
  data_source?: string;
  verification_status?: string;
  notes?: string;
  // Road specific
  road_class?: string;
  width_m?: number | null;
  surface?: string;
  obstruction?: string | null;
  // Building specific
  use_type?: string;
  floors?: number;
  connected_road_id?: string;
  estimated_setback_m?: number;
  // Station specific
  station_type?: string;
  vehicle_bays?: number;
  primary_access_road?: string;
  [key: string]: any;
}

export interface GeoJSONFeature {
  type: 'Feature';
  id?: string;
  geometry: GeoJSONGeometry;
  properties: FeatureProperties;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  metadata?: {
    name?: string;
    description?: string;
    crs?: string;
    disclaimer?: string;
    [key: string]: any;
  };
  features: GeoJSONFeature[];
}

export interface AccessStatusCounts {
  feasible: number;
  constrained: number;
  infeasible: number;
  unknown: number;
  total: number;
}

export interface StatsResponse {
  area_name: string;
  total_features: number;
  station_count: number;
  buildings: AccessStatusCounts;
  roads: AccessStatusCounts;
  disclaimer: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  service: string;
  dataset_loaded: boolean;
  sample_file_path: string;
}

export interface VehicleProfile {
  id: string;
  name: string;
  category: string;
  minClearanceWidthM: number;
  description: string;
  typicalEquipment: string;
}

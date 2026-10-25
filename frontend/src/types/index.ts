export type AccessStatus = 'feasible' | 'constrained' | 'infeasible' | 'unknown' | 'ok' | 'accessible' | 'inaccessible';

export type FeatureType = 'building' | 'road' | 'station' | 'facility' | 'place';

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

export interface VehicleGapStats {
  counts: AccessStatusCounts;
  verified_reachable_pct: number;
  evidence_coverage_pct: number;
}

export interface VehicleGapResponse {
  fire: VehicleGapStats;
  amb: VehicleGapStats;
  rapid: VehicleGapStats;
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
  minClearanceWidthM?: number;
  min_clearance_width_m?: number;
  min_clearance_height_m?: number;
  turning_radius_m?: number;
  weight_tons?: number;
  description: string;
  typicalEquipment?: string;
  typical_equipment?: string;
  evaluated_constraints?: string[];
  unevaluated_constraints?: string[];
}

export interface SegmentAssessment {
  road_id: string;
  name: string;
  road_class?: string | null;
  width_m?: number | null;
  required_width_m: number;
  surface?: string | null;
  obstruction?: string | null;
  status: AccessStatus;
  is_passable: boolean;
  length_m: number;
  limiting_factors: string[];
  notes?: string | null;
}

export interface RouteStep {
  step_index: number;
  from_node: string;
  to_node: string;
  road_id: string;
  road_name: string;
  segment_length_m: number;
  status: AccessStatus;
  reason: string;
}

export interface RouteResponse {
  origin_id: string;
  origin_name?: string;
  destination_id: string;
  destination_name?: string;
  destination_type: 'building' | 'road' | 'location';
  vehicle: VehicleProfile;
  classification: AccessStatus;
  route_found: boolean;
  total_distance_m: number;
  segments_traversed: string[];
  geometry_geojson?: {
    type: string;
    coordinates: [number, number][];
  };
  steps: RouteStep[];
  segment_assessments: SegmentAssessment[];
  limiting_segments: string[];
  evaluated_constraints: string[];
  unevaluated_constraints: string[];
  explanation: string;
  disclaimer: string;
}

export interface BuildingAccessResponse {
  building_id: string;
  building_name: string;
  use_type?: string | null;
  connected_road_id?: string | null;
  approach_road_name?: string | null;
  estimated_setback_m?: number | null;
  entrance_status: string;
  assessment_status?: string;
  vehicle: VehicleProfile;
  classification: AccessStatus;
  origin_station_id: string;
  origin_station_name?: string | null;
  origin_facility_type?: string | null;
  road_access_coordinates?: [number, number] | null;
  building_coordinates?: [number, number] | null;
  route?: RouteResponse | null;
  limitations: string[];
  missing_evidence?: string[];
  plain_language_explanation: string;
  disclaimer: string;
}

export interface RoadAccessResponse {
  road_id: string;
  road_name: string;
  vehicle: VehicleProfile;
  assessment: SegmentAssessment;
  plain_language_explanation: string;
}

export interface RouteViolation {
  road_id: string;
  reason: string;
  width_m?: number | null;
  required_m: number;
}

export interface NaiveRouteSummary {
  road_ids: string[];
  distance_m: number;
  violations: RouteViolation[];
}

export interface AwareRouteSummary {
  road_ids: string[];
  distance_m: number;
  classification: AccessStatus;
}

export interface RouteCompareResponse {
  naive: NaiveRouteSummary;
  aware: AwareRouteSummary;
  verdict: string;
  naive_would_fail: boolean;
}

export interface SimulateChange {
  road_id: string;
  action: 'close' | 'clear_obstruction' | 'set_width';
  value?: number;
}

export interface SimulateRequest {
  vehicle_id?: string;
  changes: SimulateChange[];
}

export interface ChangedBuilding {
  id: string;
  name: string;
  before: string;
  after: string;
}

export interface SimulateResponse {
  before: Record<string, number>;
  after: Record<string, number>;
  changed_buildings: ChangedBuilding[];
  assumptions: string[];
}

export interface CriticalRoad {
  road_id: string;
  name: string;
  buildings_affected: number;
  building_ids: string[];
}



export interface IssueRecord {
  id: string;
  t: string; // Title
  type: string; // e.g. Obstruction, Unknown width, Width constraint, Restricted entrance
  edge: string; // Associated road segment ID
  sev: 'high' | 'med' | 'low';
  st: 'open' | 'review' | 'verified' | 'resolved';
  ver: string; // Verification note
  blocked?: number | boolean;
  fixW?: number | null;
  ai?: string;
  age?: string;
  photo?: string;
}

export interface AIObservation {
  t: string;
  d: string;
  c: number;
  s: 'ok' | 'no' | '';
}

export interface ExplainRequest {
  station_id?: string;
  building_id: string;
  vehicle_id?: string;
}

export interface ExplainResponse {
  text: string;
  source: 'gemini_api' | 'local_llm' | 'template';
  validated: boolean;
}

export interface AlternativeRoute {
  route_id: string;
  route_index: number;
  name: string;
  color: string;
  classification: AccessStatus;
  route_found: boolean;
  total_distance_m: number;
  segment_count: number;
  segments_traversed: string[];
  geometry_geojson?: {
    type: string;
    coordinates: [number, number][];
  };
  steps: RouteStep[];
  segment_assessments: SegmentAssessment[];
  limiting_segments: string[];
  known_restrictions: string[];
  unknown_evidence_segments: string[];
  explanation: string;
  is_recommended: boolean;
}

export interface MultiRouteResponse {
  origin_id: string;
  origin_name: string;
  origin_facility_type?: string | null;
  origin_coordinates?: [number, number] | null;
  destination_id: string;
  destination_name: string;
  destination_type: 'building' | 'road' | 'location';
  destination_coordinates?: [number, number] | null;
  vehicle: VehicleProfile;
  requested_count: number;
  routes_found_count: number;
  status: 'multiple_found' | 'fewer_found' | 'single_found' | 'none_found' | 'outside_pilot' | 'disconnected' | 'blocked';
  routes: AlternativeRoute[];
  notes: string;
  disclaimer: string;
}

export interface VisionObservationItem {
  id: number;
  title: string;
  description: string;
  confidence: number;
  category: string;
  status: 'ok' | 'no' | '';
}

export interface VisionInspectResponse {
  source: string;
  model: string;
  carriageway_width_est_m?: number | null;
  overhead_clearance_est_m?: number | null;
  passable_for_fire?: boolean | null;
  passable_for_ambulance?: boolean | null;
  observations: VisionObservationItem[];
  raw_reasoning?: string;
  disclaimer: string;
}

export interface CertifyRoadResponse {
  status: string;
  road_id: string;
  road_name: string;
  old_width_m?: number | null;
  new_width_m: number;
  notes?: string;
  message: string;
}




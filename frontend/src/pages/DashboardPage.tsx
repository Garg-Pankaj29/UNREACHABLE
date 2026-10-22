import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import {
  GeoJSONFeature,
  HealthResponse,
  StatsResponse,
  VehicleProfile,
} from '../types';
import { NavigationHeader } from '../components/NavigationHeader';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { VehicleSelector, VEHICLE_PROFILES } from '../components/VehicleSelector';
import { AccessLegend } from '../components/AccessLegend';
import { StatsSummary } from '../components/StatsSummary';
import { DetailPanel } from '../components/DetailPanel';
import { MapView } from '../components/MapView';
import {
  RefreshCw,
  ServerOff,
  Building,
  Route as RouteIcon,
  ShieldAlert,
  Truck,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [buildings, setBuildings] = useState<GeoJSONFeature[]>([]);
  const [roads, setRoads] = useState<GeoJSONFeature[]>([]);
  const [stations, setStations] = useState<GeoJSONFeature[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleProfile>(VEHICLE_PROFILES[0]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Check health
      const health = await api.fetchHealth();
      setBackendHealth(health);

      // 2. Fetch stats
      const statsData = await api.fetchStats();
      setStats(statsData);

      // 3. Fetch neighbourhood features
      const neighbourhoodData = await api.fetchNeighbourhood();
      const feats = neighbourhoodData.features || [];

      const bldgs = feats.filter((f) => f.properties?.feature_type === 'building');
      const rds = feats.filter((f) => f.properties?.feature_type === 'road');
      const stns = feats.filter((f) => f.properties?.feature_type === 'station');

      setBuildings(bldgs);
      setRoads(rds);
      setStations(stns);

      // Default selection to first building or constrained road to demonstrate inspection immediately
      if (bldgs.length > 0 && !selectedFeature) {
        setSelectedFeature(bldgs[0]);
      }
    } catch (err: any) {
      console.error('Failed to load UNREACHABLE backend data:', err);
      setError(err.message || 'Error communicating with backend service');
      setBackendHealth(null);
    } finally {
      setLoading(false);
    }
  }, [selectedFeature]);

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Navigation Header */}
      <NavigationHeader
        backendConnected={!!backendHealth && backendHealth.dataset_loaded}
        datasetLoaded={backendHealth?.dataset_loaded ?? false}
        areaName={stats?.area_name}
      />

      <main className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-4 flex-1">
        {/* Prototype Disclaimer Banner */}
        <DisclaimerBanner customText={stats?.disclaimer} />

        {/* Connection Error State */}
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-300 rounded-lg p-5 shadow-xs text-red-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-red-100 rounded-full text-red-700 shrink-0">
                <ServerOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-red-900">Backend Communication Error</h2>
                <p className="text-xs text-red-800 mt-1 leading-relaxed">{error}</p>
                <div className="text-[11px] text-red-700 mt-2 font-mono bg-red-100/70 p-2 rounded">
                  Configured API Endpoint: {api.getBaseUrl()}
                </div>
              </div>
            </div>

            <button
              onClick={loadData}
              className="shrink-0 flex items-center space-x-1.5 bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-xs font-semibold shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && !error && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500 shadow-xs flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-700">
              Querying municipal accessibility features from FastAPI backend...
            </p>
          </div>
        )}

        {/* Main Content (when data loaded or active) */}
        {!loading && !error && (
          <>
            {/* Top Row: Baseline Stats & Vehicle Profile Selector */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <StatsSummary stats={stats} loading={loading} />
              </div>
              <div className="lg:col-span-1">
                <VehicleSelector
                  selectedVehicleId={selectedVehicle.id}
                  onSelectVehicle={(v) => setSelectedVehicle(v)}
                />
              </div>
            </div>

            {/* Middle Row: Access Legend */}
            <AccessLegend />

            {/* Core Map & Asset Inspection Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Map Column (2/3 width) */}
              <div className="lg:col-span-2 space-y-2">
                <MapView
                  buildings={buildings}
                  roads={roads}
                  stations={stations}
                  selectedFeature={selectedFeature}
                  selectedVehicle={selectedVehicle}
                  onSelectFeature={(feat) => setSelectedFeature(feat)}
                />

                {/* Quick Asset Navigator Strip */}
                <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                      Direct Feature Directory
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {buildings.length} Buildings · {roads.length} Roads · {stations.length} Station
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {stations.map((st) => (
                      <button
                        key={st.properties.id}
                        onClick={() => setSelectedFeature(st)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border shrink-0 transition-colors inline-flex items-center gap-1.5 ${
                          selectedFeature?.properties.id === st.properties.id
                            ? 'bg-blue-600 text-white border-blue-700 font-semibold'
                            : 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                        }`}
                      >
                        <Truck size={12} aria-hidden="true" />
                        <span>{st.properties.name}</span>
                      </button>
                    ))}

                    {roads.map((rd) => (
                      <button
                        key={rd.properties.id}
                        onClick={() => setSelectedFeature(rd)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border shrink-0 transition-colors flex items-center gap-1 ${
                          selectedFeature?.properties.id === rd.properties.id
                            ? 'bg-slate-900 text-white border-slate-950 font-semibold'
                            : 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        <RouteIcon className="w-3 h-3 text-slate-500" />
                        <span>{rd.properties.name}</span>
                        {rd.properties.width_m && (
                          <span className="text-[10px] opacity-75 font-mono">
                            ({rd.properties.width_m}m)
                          </span>
                        )}
                      </button>
                    ))}

                    {buildings.map((bd) => (
                      <button
                        key={bd.properties.id}
                        onClick={() => setSelectedFeature(bd)}
                        className={`px-2 py-1 rounded text-[11px] font-medium border shrink-0 transition-colors flex items-center gap-1 ${
                          selectedFeature?.properties.id === bd.properties.id
                            ? 'bg-slate-900 text-white border-slate-950 font-semibold'
                            : 'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        <Building className="w-3 h-3 text-slate-500" />
                        <span className="truncate max-w-[140px]">{bd.properties.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Inspection Detail Column (1/3 width) */}
              <div className="lg:col-span-1">
                <DetailPanel
                  feature={selectedFeature}
                  onClose={() => setSelectedFeature(null)}
                />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 text-xs py-3 px-4 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div>
            <strong className="text-slate-200 font-bold">UNREACHABLE</strong> — Emergency Accessibility Intelligence Platform for Indian Cities.
          </div>
          <div className="text-[11px] text-slate-400">
            Phase 1 Foundation · MIT License · Local Synthetic Dataset
          </div>
        </div>
      </footer>
    </div>
  );
};

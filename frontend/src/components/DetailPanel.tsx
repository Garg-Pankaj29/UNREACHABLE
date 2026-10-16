import React from 'react';
import {
  Building2,
  Route,
  Flame,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  X,
  ShieldCheck,
  Database,
  Ruler,
  AlertOctagon,
  FileText,
} from 'lucide-react';
import { GeoJSONFeature } from '../types';

interface DetailPanelProps {
  feature: GeoJSONFeature | null;
  onClose: () => void;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ feature, onClose }) => {
  if (!feature) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs text-center text-slate-500 h-full flex flex-col items-center justify-center min-h-[320px]">
        <Building2 className="w-8 h-8 text-slate-300 mb-2 stroke-1" />
        <h3 className="text-sm font-semibold text-slate-700">No Asset Selected</h3>
        <p className="text-xs text-slate-500 max-w-[240px] mt-1">
          Click any building polygon, road segment, or station icon on the map to inspect its municipal accessibility profile.
        </p>
      </div>
    );
  }

  const { properties } = feature;
  const isBuilding = properties.feature_type === 'building';
  const isRoad = properties.feature_type === 'road';
  const isStation = properties.feature_type === 'station';

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'feasible':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Feasible Access
          </span>
        );
      case 'constrained':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Constrained Bottleneck
          </span>
        );
      case 'infeasible':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
            <XCircle className="w-3.5 h-3.5 text-red-600" />
            Infeasible / Impassable
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-300">
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            Unknown Access
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-3">
        <div className="flex items-start space-x-2.5">
          <div className="p-2 bg-slate-100 rounded text-slate-700 mt-0.5">
            {isBuilding && <Building2 className="w-5 h-5 text-blue-600" />}
            {isRoad && <Route className="w-5 h-5 text-indigo-600" />}
            {isStation && <Flame className="w-5 h-5 text-red-600" />}
          </div>
          <div>
            <div className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">
              {properties.feature_type} · ID: {properties.id}
            </div>
            <h3 className="text-sm font-bold text-slate-900 leading-snug">{properties.name}</h3>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close asset details"
          className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Access Status Banner */}
      <div className="mb-4 flex items-center justify-between bg-slate-50 p-2.5 rounded border border-slate-200">
        <span className="text-xs font-medium text-slate-600">Accessibility Status</span>
        <div>{getStatusBadge(properties.access_status)}</div>
      </div>

      {/* Property Details Grid */}
      <div className="space-y-3 text-xs mb-4">
        {/* Verification Status */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            Verification Status
          </span>
          <span className="font-medium text-slate-800 text-right">
            {properties.verification_status || 'unverified'}
          </span>
        </div>

        {/* Data Source */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            Data Source
          </span>
          <span className="font-mono text-[11px] text-slate-700 text-right">
            {properties.data_source || 'Synthetic Municipal Record'}
          </span>
        </div>

        {/* Road Specific Attributes */}
        {isRoad && (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-slate-400" />
                Physical Width
              </span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {properties.width_m !== null && properties.width_m !== undefined
                  ? `${properties.width_m} meters`
                  : 'Unmeasured (Null)'}
              </span>
            </div>

            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Surface Type</span>
              <span className="font-medium text-slate-800 capitalize text-right">
                {properties.surface || 'Unknown'}
              </span>
            </div>

            {properties.obstruction && (
              <div className="bg-red-50 border border-red-200 rounded p-2.5 text-red-900 mt-2">
                <div className="flex items-center gap-1.5 font-bold text-[11px] text-red-800 mb-1">
                  <AlertOctagon className="w-3.5 h-3.5 text-red-600" />
                  Simulated Physical Constraint
                </div>
                <p className="text-[11px] leading-relaxed">{properties.obstruction}</p>
              </div>
            )}
          </>
        )}

        {/* Building Specific Attributes */}
        {isBuilding && (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Occupancy / Use Type</span>
              <span className="font-medium text-slate-800 text-right">
                {properties.use_type || 'Unspecified'}
              </span>
            </div>

            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Storeys / Floors</span>
              <span className="font-mono font-medium text-slate-800 text-right">
                {properties.floors ?? 'N/A'}
              </span>
            </div>

            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Connected Ingress Road</span>
              <span className="font-mono text-blue-700 font-semibold text-right">
                {properties.connected_road_id || 'None identified'}
              </span>
            </div>

            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Estimated Frontage Setback</span>
              <span className="font-mono text-slate-800 text-right">
                {properties.estimated_setback_m ? `${properties.estimated_setback_m}m` : 'Unsurveyed'}
              </span>
            </div>
          </>
        )}

        {/* Station Specific */}
        {isStation && (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Station Type</span>
              <span className="font-medium text-slate-800 text-right">
                {properties.station_type || 'Emergency Dispatch Unit'}
              </span>
            </div>
            <div className="flex items-start justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500">Apparatus Bays</span>
              <span className="font-mono font-bold text-slate-800 text-right">
                {properties.vehicle_bays ?? 1}
              </span>
            </div>
          </>
        )}

        {/* Notes */}
        {properties.notes && (
          <div className="pt-1">
            <span className="text-slate-500 block mb-1 font-medium flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              Operational Notes
            </span>
            <p className="text-[11px] text-slate-700 bg-slate-50 p-2 rounded border border-slate-200 leading-relaxed">
              {properties.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

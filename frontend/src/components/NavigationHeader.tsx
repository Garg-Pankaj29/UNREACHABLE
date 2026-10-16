import React from 'react';
import { ShieldAlert, Activity, Database, CheckCircle2, AlertTriangle } from 'lucide-react';

interface NavigationHeaderProps {
  backendConnected: boolean;
  datasetLoaded: boolean;
  areaName?: string;
}

export const NavigationHeader: React.FC<NavigationHeaderProps> = ({
  backendConnected,
  datasetLoaded,
  areaName,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 px-4 py-3 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-red-600/90 rounded-md text-white flex items-center justify-center shadow-inner">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white">UNREACHABLE</h1>
              <span className="text-[11px] font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 tracking-wide">
                PHASE 1 MVP
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Know the access. Find the constraint. Fix it before an emergency.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 text-xs">
          {areaName && (
            <div className="flex items-center space-x-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700 text-slate-200">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-medium text-slate-400">Area:</span>
              <span className="font-semibold text-slate-100">{areaName}</span>
            </div>
          )}

          <div
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded border ${
              backendConnected && datasetLoaded
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : 'bg-amber-950/60 border-amber-800 text-amber-300'
            }`}
          >
            {backendConnected ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="font-medium">
              {backendConnected ? 'FastAPI API Connected' : 'Backend Disconnected'}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700 text-slate-300">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span>GIS CRS: WGS84</span>
          </div>
        </div>
      </div>
    </header>
  );
};

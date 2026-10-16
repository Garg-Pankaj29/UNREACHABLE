import React from 'react';
import { Building2, Route, ShieldAlert, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import { StatsResponse } from '../types';

interface StatsSummaryProps {
  stats: StatsResponse | null;
  loading: boolean;
}

export const StatsSummary: React.FC<StatsSummaryProps> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="h-16 bg-slate-100 rounded"></div>
          <div className="h-16 bg-slate-100 rounded"></div>
          <div className="h-16 bg-slate-100 rounded"></div>
          <div className="h-16 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs">
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-slate-700" />
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Network Accessibility Baseline
          </h2>
        </div>
        <span className="text-[11px] font-mono text-slate-500">
          Total Features: <strong className="text-slate-800">{stats.total_features}</strong>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buildings Card */}
        <div className="bg-slate-50/70 rounded-md border border-slate-200/80 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              Building Footprints
            </span>
            <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
              {stats.buildings.total} Total
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            <div className="bg-white p-1.5 rounded border border-emerald-200 shadow-xs">
              <div className="flex items-center justify-center text-emerald-600 mb-0.5">
                <CheckCircle2 className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-emerald-700">{stats.buildings.feasible}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Feasible</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-amber-200 shadow-xs">
              <div className="flex items-center justify-center text-amber-600 mb-0.5">
                <AlertTriangle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-amber-700">{stats.buildings.constrained}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Constrained</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-red-200 shadow-xs">
              <div className="flex items-center justify-center text-red-600 mb-0.5">
                <XCircle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-red-700">{stats.buildings.infeasible}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Infeasible</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-slate-300 shadow-xs">
              <div className="flex items-center justify-center text-slate-500 mb-0.5">
                <HelpCircle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-slate-700">{stats.buildings.unknown}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Unknown</div>
            </div>
          </div>
        </div>

        {/* Roads Card */}
        <div className="bg-slate-50/70 rounded-md border border-slate-200/80 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Route className="w-3.5 h-3.5 text-indigo-600" />
              Road Network Segments
            </span>
            <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
              {stats.roads.total} Segments
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            <div className="bg-white p-1.5 rounded border border-emerald-200 shadow-xs">
              <div className="flex items-center justify-center text-emerald-600 mb-0.5">
                <CheckCircle2 className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-emerald-700">{stats.roads.feasible}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Feasible</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-amber-200 shadow-xs">
              <div className="flex items-center justify-center text-amber-600 mb-0.5">
                <AlertTriangle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-amber-700">{stats.roads.constrained}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Constrained</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-red-200 shadow-xs">
              <div className="flex items-center justify-center text-red-600 mb-0.5">
                <XCircle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-red-700">{stats.roads.infeasible}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Infeasible</div>
            </div>

            <div className="bg-white p-1.5 rounded border border-slate-300 shadow-xs">
              <div className="flex items-center justify-center text-slate-500 mb-0.5">
                <HelpCircle className="w-3 h-3" />
              </div>
              <div className="text-base font-bold text-slate-700">{stats.roads.unknown}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-tight">Unknown</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Layers } from 'lucide-react';

export const AccessLegend: React.FC = () => {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs">
      <div className="flex items-center space-x-1.5 mb-2.5 pb-2 border-b border-slate-100 text-slate-800">
        <Layers className="w-3.5 h-3.5 text-slate-500" />
        <h3 className="text-xs font-bold uppercase tracking-wider">Access Classification Legend</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {/* Feasible */}
        <div className="flex items-center space-x-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-emerald-600 border border-emerald-700 shrink-0" />
          <div>
            <div className="font-semibold text-slate-800 text-[11px]">Feasible</div>
            <div className="text-[10px] text-slate-500">Unconstrained ingress</div>
          </div>
        </div>

        {/* Constrained */}
        <div className="flex items-center space-x-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-amber-500 border border-amber-600 shrink-0" />
          <div>
            <div className="font-semibold text-slate-800 text-[11px]">Constrained</div>
            <div className="text-[10px] text-slate-500">Narrow width / bottle-neck</div>
          </div>
        </div>

        {/* Infeasible */}
        <div className="flex items-center space-x-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-red-600 border border-red-700 shrink-0" />
          <div>
            <div className="font-semibold text-slate-800 text-[11px]">Infeasible</div>
            <div className="text-[10px] text-slate-500">Blocked / obstructed</div>
          </div>
        </div>

        {/* Unknown */}
        <div className="flex items-center space-x-2">
          <span className="w-3.5 h-3.5 rounded-sm bg-slate-400 border border-slate-500 shrink-0" />
          <div>
            <div className="font-semibold text-slate-800 text-[11px]">Unknown</div>
            <div className="text-[10px] text-slate-500">Unmeasured / uninspected</div>
          </div>
        </div>
      </div>
    </div>
  );
};

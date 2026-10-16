import React from 'react';
import { Truck, Siren, Bike, Info } from 'lucide-react';
import { VehicleProfile } from '../types';

export const VEHICLE_PROFILES: VehicleProfile[] = [
  {
    id: 'heavy_tender',
    name: 'Type 1 Fire Water Tender',
    category: 'Heavy Apparatus',
    minClearanceWidthM: 2.5,
    description: 'Standard heavy fire tender requiring ≥ 2.5m effective lane clearance and 3.5m overhead clearance.',
    typicalEquipment: '12,000L water tank, heavy suction hoses, high-pressure pump',
  },
  {
    id: 'medium_als_ambulance',
    name: 'Type C / ALS Emergency Ambulance',
    category: 'Medical Responder',
    minClearanceWidthM: 2.2,
    description: 'Full-size Advanced Life Support ambulance requiring ≥ 2.2m clearance for patient stretcher ingress.',
    typicalEquipment: 'Defibrillator, oxygen manifold, trauma trolley',
  },
  {
    id: 'qrv_two_wheeler',
    name: 'Quick Response Unit (QRV / 2-Wheeler)',
    category: 'Rapid First Responder',
    minClearanceWidthM: 1.2,
    description: 'Agile two-wheeler / mini utility unit suited for high-density historical quarters and narrow gullies (< 2.2m).',
    typicalEquipment: 'First-aid kit, mini chemical extinguisher, automated defibrillator',
  },
];

interface VehicleSelectorProps {
  selectedVehicleId: string;
  onSelectVehicle: (profile: VehicleProfile) => void;
}

export const VehicleSelector: React.FC<VehicleSelectorProps> = ({
  selectedVehicleId,
  onSelectVehicle,
}) => {
  const currentVehicle =
    VEHICLE_PROFILES.find((v) => v.id === selectedVehicleId) || VEHICLE_PROFILES[0];

  const getIcon = (id: string) => {
    switch (id) {
      case 'heavy_tender':
        return <Truck className="w-4 h-4" />;
      case 'medium_als_ambulance':
        return <Siren className="w-4 h-4" />;
      case 'qrv_two_wheeler':
        return <Bike className="w-4 h-4" />;
      default:
        return <Truck className="w-4 h-4" />;
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Truck className="w-4 h-4 text-slate-600" />
          Vehicle Profile Evaluation
        </label>
        <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
          Min Width: {currentVehicle.minClearanceWidthM}m
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        {VEHICLE_PROFILES.map((profile) => {
          const isSelected = profile.id === selectedVehicleId;
          return (
            <button
              key={profile.id}
              onClick={() => onSelectVehicle(profile)}
              className={`text-left p-2.5 rounded-md border transition-all text-xs flex flex-col justify-between ${
                isSelected
                  ? 'border-blue-600 bg-blue-50/70 text-blue-900 shadow-xs ring-1 ring-blue-600'
                  : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
              }`}
            >
              <div className="flex items-center space-x-2 font-medium mb-1">
                <span className={isSelected ? 'text-blue-700' : 'text-slate-500'}>
                  {getIcon(profile.id)}
                </span>
                <span className="font-semibold truncate">{profile.name}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                <span>{profile.category}</span>
                <span className="font-mono font-semibold text-slate-800">
                  ≥ {profile.minClearanceWidthM}m
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-xs text-slate-600 flex items-start gap-2">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-slate-800 mb-0.5">{currentVehicle.description}</p>
          <p className="text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">Payload profile:</span>{' '}
            {currentVehicle.typicalEquipment}
          </p>
        </div>
      </div>
    </div>
  );
};

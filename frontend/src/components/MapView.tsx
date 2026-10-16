import React, { useState, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON as LeafletGeoJSON,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L, { LatLngExpression, PathOptions } from 'leaflet';
import { GeoJSONFeature, VehicleProfile } from '../types';
import { Layers, RefreshCw, AlertTriangle } from 'lucide-react';

interface MapViewProps {
  buildings: GeoJSONFeature[];
  roads: GeoJSONFeature[];
  stations: GeoJSONFeature[];
  selectedFeature: GeoJSONFeature | null;
  selectedVehicle: VehicleProfile;
  onSelectFeature: (feature: GeoJSONFeature) => void;
}

// Center point of the synthetic neighbourhood
const DEFAULT_CENTER: LatLngExpression = [12.9723, 77.5955];
const DEFAULT_ZOOM = 16;

// Custom Marker Icon for Emergency Dispatch Station
const stationIcon = L.divIcon({
  className: 'custom-station-marker',
  html: `
    <div style="
      background-color: #1e3a8a;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
      box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      font-weight: bold;
      font-size: 14px;
    ">
      🚒
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

// Component to dynamically re-center map if requested
function MapController() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}

export const MapView: React.FC<MapViewProps> = ({
  buildings,
  roads,
  stations,
  selectedFeature,
  selectedVehicle,
  onSelectFeature,
}) => {
  const [tileError, setTileError] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  // Road styling based on access status and vehicle clearance
  const getRoadStyle = (feature: any): PathOptions => {
    const props = feature.properties || {};
    const status = props.access_status;
    const width = props.width_m;
    const isSelected = selectedFeature?.properties?.id === props.id;

    // Check if current vehicle clearance is constrained on this road
    const isVehicleConstrained =
      width !== null && width !== undefined && width < selectedVehicle.minClearanceWidthM;

    let color = '#64748b'; // unknown
    let dashArray: string | undefined = '4, 4';
    let weight = 4;

    if (status === 'feasible') {
      if (isVehicleConstrained) {
        color = '#d97706'; // becomes constrained for this vehicle!
        dashArray = '5, 5';
        weight = 5;
      } else {
        color = '#15803d'; // green
        dashArray = undefined;
        weight = 6;
      }
    } else if (status === 'constrained') {
      color = '#d97706'; // amber
      dashArray = '6, 6';
      weight = 5;
    } else if (status === 'infeasible') {
      color = '#dc2626'; // red
      dashArray = undefined;
      weight = 6;
    }

    if (isSelected) {
      weight += 3;
    }

    return {
      color,
      weight,
      opacity: 0.9,
      dashArray,
      lineCap: 'round',
      lineJoin: 'round',
    };
  };

  // Building styling based on accessibility status
  const getBuildingStyle = (feature: any): PathOptions => {
    const props = feature.properties || {};
    const status = props.access_status;
    const isSelected = selectedFeature?.properties?.id === props.id;

    let fillColor = '#94a3b8';
    let color = '#475569';

    if (status === 'feasible') {
      fillColor = '#22c55e';
      color = '#15803d';
    } else if (status === 'constrained') {
      fillColor = '#f59e0b';
      color = '#b45309';
    } else if (status === 'infeasible') {
      fillColor = '#ef4444';
      color = '#b91c1c';
    }

    return {
      fillColor,
      fillOpacity: isSelected ? 0.75 : 0.45,
      color: isSelected ? '#0f172a' : color,
      weight: isSelected ? 3 : 1.5,
    };
  };

  // Feature click handler
  const onEachFeature = (feature: any, layer: L.Layer) => {
    const props = feature.properties || {};
    layer.on({
      click: () => {
        onSelectFeature(feature);
      },
    });

    const statusBadge =
      props.access_status === 'feasible'
        ? '<span style="color:#15803d; font-weight:bold;">● Feasible Access</span>'
        : props.access_status === 'constrained'
        ? '<span style="color:#d97706; font-weight:bold;">▲ Constrained Access</span>'
        : props.access_status === 'infeasible'
        ? '<span style="color:#dc2626; font-weight:bold;">✖ Impassable / Infeasible</span>'
        : '<span style="color:#64748b; font-weight:bold;">? Unknown Access</span>';

    const content = `
      <div style="font-family: Inter, sans-serif; min-width: 180px;">
        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 2px;">
          ${props.feature_type || 'Asset'} · ${props.id}
        </div>
        <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">
          ${props.name || 'Feature'}
        </div>
        <div style="margin-bottom: 6px; font-size: 12px;">
          ${statusBadge}
        </div>
        ${props.width_m ? `<div style="font-size: 11px; color:#334155;">Road Width: <b>${props.width_m}m</b></div>` : ''}
        ${props.floors ? `<div style="font-size: 11px; color:#334155;">Floors: <b>${props.floors}</b></div>` : ''}
        <div style="margin-top: 6px; font-size: 11px; color: #2563eb; font-weight: 600;">
          Click to inspect attributes →
        </div>
      </div>
    `;

    layer.bindPopup(content);
  };

  return (
    <div className="relative w-full h-[520px] rounded-lg overflow-hidden border border-slate-300 bg-slate-100 shadow-inner flex flex-col">
      {/* Top Map Action Bar */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center space-x-2 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-md border border-slate-200 shadow-md text-xs">
        <Layers className="w-3.5 h-3.5 text-slate-600" />
        <span className="font-semibold text-slate-800">Operational Map Layer</span>
        <span className="text-slate-400">|</span>
        <span className="text-slate-600">
          Evaluating for:{' '}
          <strong className="text-slate-900">{selectedVehicle.name}</strong> (≥{' '}
          {selectedVehicle.minClearanceWidthM}m)
        </span>
      </div>

      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => setMapKey((k) => k + 1)}
          title="Reset map view"
          className="flex items-center space-x-1 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-300 shadow-md text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reset Center</span>
        </button>
      </div>

      {/* Offline Tile Graceful Fallback Notice */}
      {tileError && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-amber-100 border border-amber-300 text-amber-900 text-xs px-3 py-1.5 rounded shadow-md flex items-center space-x-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
          <span>External base map tiles unavailable; vector GeoJSON features rendered in offline mode.</span>
        </div>
      )}

      {/* Leaflet Map Container */}
      <MapContainer
        key={mapKey}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <MapController />

        {/* Free OpenStreetMap Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileerror: () => setTileError(true),
            load: () => setTileError(false),
          }}
        />

        {/* Road Network Layer */}
        {roads.length > 0 && (
          <LeafletGeoJSON
            key={`roads-${selectedVehicle.id}-${selectedFeature?.properties?.id}`}
            data={
              {
                type: 'FeatureCollection',
                features: roads,
              } as any
            }
            style={getRoadStyle}
            onEachFeature={onEachFeature}
          />
        )}

        {/* Building Footprint Layer */}
        {buildings.length > 0 && (
          <LeafletGeoJSON
            key={`buildings-${selectedFeature?.properties?.id}`}
            data={
              {
                type: 'FeatureCollection',
                features: buildings,
              } as any
            }
            style={getBuildingStyle}
            onEachFeature={onEachFeature}
          />
        )}

        {/* Emergency Station Markers */}
        {stations.map((st) => {
          const coords = st.geometry.coordinates; // [lon, lat]
          return (
            <Marker
              key={st.properties.id}
              position={[coords[1], coords[0]]}
              icon={stationIcon}
              eventHandlers={{
                click: () => onSelectFeature(st),
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#1e3a8a', fontWeight: 'bold' }}>
                    Emergency Hub
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#0f172a' }}>
                    {st.properties.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                    Type: {st.properties.station_type}
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569' }}>
                    Vehicle Bays: {st.properties.vehicle_bays}
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
                    Click to inspect attributes →
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

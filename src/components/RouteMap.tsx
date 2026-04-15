import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';

// Fix for default marker icons in Leaflet with Vite
// We use CDN URLs to avoid asset resolution issues in this environment
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

L.Marker.prototype.options.icon = defaultIcon;

// Custom icon for user location
const userIcon = L.divIcon({
  className: 'custom-user-location-icon',
  html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(59, 130, 246, 0.5); position: relative;">
          <div style="position: absolute; top: -2px; left: -2px; width: 20px; height: 20px; border-radius: 50%; background-color: #3b82f6; opacity: 0.2; animation: pulse 2s infinite;"></div>
         </div>
         <style>
           @keyframes pulse {
             0% { transform: scale(0.95); opacity: 0.5; }
             70% { transform: scale(1.5); opacity: 0; }
             100% { transform: scale(0.95); opacity: 0; }
           }
         </style>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

interface RouteMapProps {
  items: any[];
  userLocation: [number, number] | null;
  onClientClick?: (clientId: number) => void;
  showRouteLine?: boolean;
  className?: string;
}

// Component to handle map view updates
function MapController({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  return null;
}

export default function RouteMap({ items, userLocation, onClientClick, showRouteLine = true, className }: RouteMapProps) {
  const [initialCenterSet, setInitialCenterSet] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-32.8596, -61.1447]); // Default to Carcaraña, Santa Fe (Edu's house area)

  useEffect(() => {
    if (userLocation && !initialCenterSet) {
      setMapCenter(userLocation);
      setInitialCenterSet(true);
    }
  }, [userLocation, initialCenterSet]);

  const validItems = items.filter(item => item.latitud && item.longitud);

  return (
    <div className={`w-full rounded-[32px] overflow-hidden border border-zinc-200 shadow-xl bg-zinc-100 relative z-0 ${className || 'h-[500px]'}`}>
      <MapContainer 
        center={mapCenter} 
        zoom={14} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {userLocation && (
          <Marker position={userLocation} icon={userIcon}>
            <Popup>
              <div className="p-1">
                <p className="font-bold text-zinc-900">Tu ubicación</p>
                <p className="text-[10px] text-zinc-500">Actualizado en tiempo real</p>
              </div>
            </Popup>
          </Marker>
        )}

        {validItems.map((item) => (
          <Marker 
            key={item.id} 
            position={[item.latitud, item.longitud]}
            eventHandlers={{
              click: () => onClientClick && onClientClick(item.cliente_id),
            }}
          >
            <Popup>
              <div className="p-2 min-w-[150px]">
                <p className="font-bold text-zinc-900 text-sm leading-tight mb-1">{item.nombre_apellido}</p>
                <p className="text-xs text-zinc-500 mb-2">{item.direccion}</p>
                <div className="flex items-center justify-between border-t border-zinc-100 pt-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                    item.status === 'visitado' ? 'bg-emerald-100 text-emerald-700' : 
                    item.status === 'venta realizada' ? 'bg-indigo-100 text-indigo-700' :
                    item.status === 'pedido tomado' ? 'bg-amber-100 text-amber-700' :
                    item.status === 'omitido' ? 'bg-red-100 text-red-700' : 
                    'bg-zinc-100 text-zinc-600'
                  }`}>
                    {item.status}
                  </span>
                  <button 
                    onClick={() => onClientClick && onClientClick(item.cliente_id)}
                    className="text-[10px] font-bold text-zinc-900 hover:underline"
                  >
                    Ver detalle
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {showRouteLine && (
          <Polyline 
            positions={[
              ...(userLocation ? [userLocation] : []),
              ...validItems.map(item => [item.latitud, item.longitud] as [number, number])
            ]}
            color="#3b82f6"
            weight={3}
            opacity={0.6}
            dashArray="10, 10"
          />
        )}
        
        <MapController center={mapCenter} zoom={14} />
      </MapContainer>
      
      {/* Map Overlay Info */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-white/90 backdrop-blur-sm px-4 py-2 rounded-2xl border border-zinc-200 shadow-lg pointer-events-none">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Clientes en mapa</p>
        <p className="text-sm font-black text-zinc-900">{validItems.length} / {items.length}</p>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { MapPin } from 'lucide-react';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

L.Marker.prototype.options.icon = defaultIcon;

const userIcon = L.divIcon({
  className: 'custom-user-location-icon',
  html: `<div style="background-color:#4f46e5;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 6px rgba(79,70,229,.16),0 4px 14px rgba(15,23,42,.28);position:relative;">
          <div style="position:absolute;top:-2px;left:-2px;width:20px;height:20px;border-radius:50%;background-color:#4f46e5;opacity:.2;animation:routePulse 2s infinite;"></div>
         </div>
         <style>
           @keyframes routePulse {
             0% { transform:scale(.95);opacity:.5; }
             70% { transform:scale(1.6);opacity:0; }
             100% { transform:scale(.95);opacity:0; }
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

function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);

  return null;
}

function MapResizeController() {
  const map = useMap();

  useEffect(() => {
    const refresh = () => map.invalidateSize({ animate: false });
    const timeoutId = window.setTimeout(refresh, 120);
    const container = map.getContainer();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
    observer?.observe(container);

    return () => {
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [map]);

  return null;
}

const statusClasses = (status: string) => {
  if (status === 'visitado') return 'bg-emerald-100 text-emerald-700';
  if (status === 'venta realizada') return 'bg-indigo-100 text-indigo-700';
  if (status === 'pedido tomado') return 'bg-amber-100 text-amber-700';
  if (status === 'omitido') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-600';
};

export default function RouteMap({
  items,
  userLocation,
  onClientClick,
  showRouteLine = true,
  className
}: RouteMapProps) {
  const [initialCenterSet, setInitialCenterSet] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-32.8596, -61.1447]);

  useEffect(() => {
    if (userLocation && !initialCenterSet) {
      setMapCenter(userLocation);
      setInitialCenterSet(true);
    }
  }, [userLocation, initialCenterSet]);

  const validItems = items.filter(item => item?.latitud && item?.longitud);
  const routePositions: [number, number][] = [
    ...(userLocation ? [userLocation] : []),
    ...validItems.map(item => [Number(item.latitud), Number(item.longitud)] as [number, number])
  ];

  return (
    <div className={`relative z-0 min-h-[280px] w-full min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100 shadow-sm ${className || 'h-[360px]'}`}>
      <MapContainer
        center={mapCenter}
        zoom={14}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {userLocation && (
          <Marker position={userLocation} icon={userIcon}>
            <Popup>
              <div className="max-w-[220px] p-1">
                <p className="font-black text-slate-900">Tu ubicación</p>
                <p className="mt-1 text-xs text-slate-500">Actualizada en tiempo real</p>
              </div>
            </Popup>
          </Marker>
        )}

        {validItems.map(item => (
          <Marker
            key={item.id ?? item.cliente_id}
            position={[Number(item.latitud), Number(item.longitud)]}
            eventHandlers={{ click: () => onClientClick?.(item.cliente_id ?? item.id) }}
          >
            <Popup>
              <div className="max-w-[240px] p-1">
                <p className="break-words text-sm font-black leading-tight text-slate-900">{item.nombre_apellido || item.razon_social || 'Cliente'}</p>
                <p className="mt-1 break-words text-xs text-slate-500">{item.direccion || 'Sin dirección'}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusClasses(item.status)}`}>{item.status || 'pendiente'}</span>
                  {onClientClick && (
                    <button type="button" onClick={() => onClientClick(item.cliente_id ?? item.id)} className="text-xs font-black text-indigo-700 hover:underline">
                      Ver ficha
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {showRouteLine && routePositions.length > 1 && (
          <Polyline positions={routePositions} color="#4f46e5" weight={4} opacity={0.72} dashArray="10, 10" />
        )}

        <MapController center={mapCenter} zoom={14} />
        <MapResizeController />
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-2xl border border-white/60 bg-slate-950/85 px-4 py-2 text-white shadow-lg backdrop-blur sm:bottom-4 sm:left-4">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-300">Clientes ubicados</p>
        <p className="mt-0.5 text-sm font-black">{validItems.length} de {items.length}</p>
      </div>

      {validItems.length === 0 && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/95 p-3 text-amber-800 shadow-sm backdrop-blur sm:inset-x-auto sm:right-4 sm:top-4 sm:max-w-sm">
          <MapPin size={17} className="mt-0.5 shrink-0" />
          <p className="text-xs font-bold leading-5">Los clientes seleccionados todavía no tienen coordenadas disponibles.</p>
        </div>
      )}
    </div>
  );
}

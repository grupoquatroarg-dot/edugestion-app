import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, MapPin, Search, X } from 'lucide-react';

interface Suggestion {
  place_id?: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
    hamlet?: string;
    road?: string;
    pedestrian?: string;
    house_number?: string;
    state?: string;
    province?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

interface SelectedAddress {
  direccion: string;
  localidad: string;
  provincia: string;
  codigo_postal: string;
  latitud: number;
  longitud: number;
}

interface AddressAutocompleteProps {
  value: string;
  onInputChange: (direccion: string) => void;
  onChange: (address: SelectedAddress) => void;
  placeholder?: string;
}

const BUSINESS_LOCATION = {
  localidad: 'Carcarañá',
  provincia: 'Santa Fe',
  codigoPostal: '2138',
  latitud: -32.8561,
  longitud: -61.1538,
};

const normalizeText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const getSuggestionLocality = (suggestion: Suggestion) => {
  const address = suggestion.address || {};
  return address.city || address.town || address.village || address.municipality || address.suburb || address.hamlet || '';
};

const getSuggestionProvince = (suggestion: Suggestion) => {
  const address = suggestion.address || {};
  return address.state || address.province || '';
};

const distanceFromBusiness = (suggestion: Suggestion) => {
  const latitude = Number(suggestion.lat);
  const longitude = Number(suggestion.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Number.MAX_SAFE_INTEGER;

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(latitude - BUSINESS_LOCATION.latitud);
  const deltaLon = toRadians(longitude - BUSINESS_LOCATION.longitud);
  const originLat = toRadians(BUSINESS_LOCATION.latitud);
  const destinationLat = toRadians(latitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
};

const suggestionPriority = (suggestion: Suggestion) => {
  const locality = normalizeText(getSuggestionLocality(suggestion));
  const province = normalizeText(getSuggestionProvince(suggestion));
  const displayName = normalizeText(suggestion.display_name);
  const isCarcarana = locality.includes('carcarana') || displayName.includes('carcarana');
  const isSantaFe = province.includes('santa fe') || displayName.includes('santa fe');
  const distance = distanceFromBusiness(suggestion);

  if (isCarcarana) return 0;
  if (isSantaFe && distance <= 80) return 1;
  if (isSantaFe) return 2;
  return 3;
};

export default function AddressAutocomplete({ value, onInputChange, onChange, placeholder }: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const requestSuggestions = async (query: string) => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 3) {
      setSuggestions([]);
      setSearchMessage('');
      setShowSuggestions(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setSearchMessage('');

    try {
      const normalizedQuery = normalizeText(cleanQuery);
      const alreadyIncludesLocation =
        normalizedQuery.includes('carcarana') ||
        normalizedQuery.includes('santa fe') ||
        normalizedQuery.includes('argentina') ||
        normalizedQuery.includes('2138');

      const searchAddress = async (searchQuery: string) => {
        const params = new URLSearchParams({
          format: 'jsonv2',
          q: searchQuery,
          addressdetails: '1',
          limit: '8',
          countrycodes: 'ar',
          'accept-language': 'es',
          viewbox: '-61.45,-32.65,-60.90,-33.10',
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) throw new Error(`Geocodificación no disponible (${response.status})`);
        return (await response.json()) as Suggestion[];
      };

      const primaryQuery = alreadyIncludesLocation
        ? cleanQuery
        : `${cleanQuery}, Carcarañá, Santa Fe, 2138, Argentina`;
      const primaryResults = await searchAddress(primaryQuery);
      const fallbackResults =
        !alreadyIncludesLocation && primaryResults.length < 3
          ? await searchAddress(`${cleanQuery}, Santa Fe, Argentina`)
          : [];

      if (requestId !== requestIdRef.current) return;

      const unique = new Map<string, Suggestion>();
      [...primaryResults, ...fallbackResults].forEach((suggestion) => {
        const key = suggestion.place_id
          ? String(suggestion.place_id)
          : `${suggestion.lat}|${suggestion.lon}|${suggestion.display_name}`;
        if (!unique.has(key)) unique.set(key, suggestion);
      });

      const sorted = Array.from(unique.values())
        .sort((a, b) => {
          const priorityDifference = suggestionPriority(a) - suggestionPriority(b);
          if (priorityDifference !== 0) return priorityDifference;
          return distanceFromBusiness(a) - distanceFromBusiness(b);
        })
        .slice(0, 8);

      setSuggestions(sorted);
      setSearchMessage(
        sorted.length === 0
          ? 'No encontramos coincidencias. Podés completar localidad, provincia y código postal manualmente.'
          : ''
      );
      setShowSuggestions(true);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error('Error fetching address suggestions:', error);
      setSuggestions([]);
      setSearchMessage('No pudimos consultar direcciones. Podés cargar el domicilio manualmente.');
      setShowSuggestions(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setInputValue(query);
    onInputChange(query);
    setSearchMessage('');

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => requestSuggestions(query), 650);
  };

  const handleSelectSuggestion = (suggestion: Suggestion) => {
    const address = suggestion.address || {};
    const road = address.road || address.pedestrian || '';
    const houseNumber = address.house_number || '';
    const direccion = `${road} ${houseNumber}`.trim() || suggestion.display_name.split(',')[0].trim();
    const localidad = getSuggestionLocality(suggestion);
    const provincia = getSuggestionProvince(suggestion);
    const normalizedDisplayName = normalizeText(suggestion.display_name);
    const isCarcarana = normalizeText(localidad).includes('carcarana') || normalizedDisplayName.includes('carcarana');
    const isSantaFe = normalizeText(provincia).includes('santa fe') || normalizedDisplayName.includes('santa fe');

    onChange({
      direccion,
      localidad: localidad || (isCarcarana ? BUSINESS_LOCATION.localidad : ''),
      provincia: provincia || (isSantaFe ? BUSINESS_LOCATION.provincia : ''),
      codigo_postal: address.postcode || (isCarcarana ? BUSINESS_LOCATION.codigoPostal : ''),
      latitud: Number(suggestion.lat),
      longitud: Number(suggestion.lon),
    });

    setInputValue(direccion);
    setSuggestions([]);
    setSearchMessage('');
    setShowSuggestions(false);
  };

  const handleClear = () => {
    requestIdRef.current += 1;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setInputValue('');
    setSuggestions([]);
    setSearchMessage('');
    setShowSuggestions(false);
    setLoading(false);
    onInputChange('');
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          id="customer-address"
          type="text"
          autoComplete="street-address"
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-11 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (suggestions.length > 0 || searchMessage) setShowSuggestions(true);
          }}
          placeholder={placeholder || 'Ej.: Av. Belgrano 123, Carcarañá'}
          aria-label="Buscar o escribir dirección del cliente"
          aria-expanded={showSuggestions}
          aria-controls="customer-address-suggestions"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-500" size={18} />
        ) : inputValue ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
            aria-label="Borrar dirección escrita"
            title="Borrar dirección"
          >
            <X size={16} />
          </button>
        ) : (
          <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        )}
      </div>

      {showSuggestions && (
        <div
          id="customer-address-suggestions"
          className="absolute z-[70] mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
          role="listbox"
        >
          {suggestions.map((suggestion) => {
            const locality = getSuggestionLocality(suggestion);
            const province = getSuggestionProvince(suggestion);
            const isCarcarana = normalizeText(locality || suggestion.display_name).includes('carcarana');

            return (
              <button
                key={suggestion.place_id || `${suggestion.lat}-${suggestion.lon}-${suggestion.display_name}`}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion)}
                className="flex min-h-14 w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                role="option"
              >
                <MapPin className={`mt-0.5 shrink-0 ${isCarcarana ? 'text-indigo-600' : 'text-slate-400'}`} size={17} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-bold text-slate-900">{suggestion.display_name}</span>
                  <span className="mt-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {[locality, province, suggestion.address.postcode && `CP ${suggestion.address.postcode}`].filter(Boolean).join(' · ') || 'Argentina'}
                  </span>
                </span>
                {isCarcarana && (
                  <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-indigo-700">
                    Prioridad
                  </span>
                )}
              </button>
            );
          })}

          {searchMessage && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-3 text-xs font-semibold leading-5 text-amber-800">
              <AlertCircle className="mt-0.5 shrink-0" size={16} />
              <span>{searchMessage}</span>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] font-semibold leading-4 text-slate-400">
        Buscamos primero en Carcarañá y localidades cercanas de Santa Fe. También podés escribir la dirección y completar los datos manualmente.
      </p>
    </div>
  );
}

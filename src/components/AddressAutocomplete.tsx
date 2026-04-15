import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, X, Loader2 } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    road?: string;
    house_number?: string;
    state?: string;
    postcode?: string;
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: {
    direccion: string;
    localidad: string;
    provincia: string;
    latitud: number;
    longitud: number;
  }) => void;
  placeholder?: string;
}

export default function AddressAutocomplete({ value, onChange, placeholder }: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isEditing, setIsEditing] = useState(!value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
    setIsEditing(!value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&countrycodes=ar`,
        { credentials: 'omit' }
      );
      const data = await response.json();
      setSuggestions(data);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error fetching address suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setInputValue(query);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      fetchSuggestions(query);
    }, 500);
  };

  const handleSelectSuggestion = (suggestion: Suggestion) => {
    const address = suggestion.address;
    const road = address.road || '';
    const houseNumber = address.house_number || '';
    const direccion = `${road} ${houseNumber}`.trim() || suggestion.display_name.split(',')[0];
    const localidad = address.city || address.town || address.village || address.suburb || '';
    const provincia = address.state || '';
    
    onChange({
      direccion,
      localidad,
      provincia,
      latitud: parseFloat(suggestion.lat),
      longitud: parseFloat(suggestion.lon)
    });
    
    setInputValue(suggestion.display_name);
    setShowSuggestions(false);
    setIsEditing(false);
  };

  const handleClear = () => {
    setInputValue('');
    setSuggestions([]);
    setIsEditing(true);
    onChange({
      direccion: '',
      localidad: '',
      provincia: '',
      latitud: 0,
      longitud: 0
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
        <input
          type="text"
          className={`w-full pl-10 pr-10 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-zinc-900 outline-none transition-all ${
            !isEditing ? 'bg-zinc-100 cursor-default' : ''
          }`}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => inputValue.length >= 3 && setShowSuggestions(true)}
          placeholder={placeholder || "Buscar dirección..."}
          readOnly={!isEditing}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 animate-spin" size={18} />
        )}
        {!loading && inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1 rounded-full hover:bg-zinc-200"
          >
            {isEditing ? <X size={14} /> : <Search size={14} />}
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-[60] w-full mt-2 bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleSelectSuggestion(suggestion)}
              className="w-full px-4 py-3 text-left hover:bg-zinc-50 flex items-start gap-3 border-b border-zinc-50 last:border-0 transition-colors"
            >
              <MapPin className="text-zinc-400 mt-1 shrink-0" size={16} />
              <div>
                <p className="text-sm font-medium text-zinc-900 line-clamp-1">{suggestion.display_name}</p>
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                  {suggestion.address.city || suggestion.address.town || suggestion.address.state}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

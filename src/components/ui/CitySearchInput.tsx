import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, Loader2, MapPin, Plus, Search } from 'lucide-react';
import {
  MIN_PLACE_QUERY_LENGTH,
  offlinePlace,
  popularCities,
  searchPlaces,
  type PlaceSuggestion,
} from '../../lib/destinations';

interface CitySearchInputProps {
  /** Scopes results and quick picks to one country when known. */
  countryCode?: string;
  countryName?: string;
  /** Ids of stops already chosen, so they can be hidden from the suggestions. */
  chosenIds: string[];
  onSelect: (place: PlaceSuggestion) => void;
  placeholder?: string;
}

/** Long enough that a search only fires once a query means something. */
const DEBOUNCE_MS = 450;

/**
 * Type-ahead city search backed by OpenStreetMap. Picking a result carries
 * real coordinates into the profile, so the map never has to guess.
 */
export function CitySearchInput({
  countryCode,
  countryName,
  chosenIds,
  onSelect,
  placeholder = 'Search a city',
}: CitySearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [providerDown, setProviderDown] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const chosenKeys = useMemo(() => new Set(chosenIds), [chosenIds]);
  const quickPicks = useMemo(
    () =>
      popularCities(countryCode)
        .map((city) => offlinePlace(city, countryCode))
        .filter((place) => !chosenKeys.has(place.id))
        .slice(0, 6),
    [countryCode, chosenKeys],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_PLACE_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setProviderDown(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(trimmed, { countryCode, signal: controller.signal });
        if (controller.signal.aborted) return;
        setResults(found.suggestions.filter((place) => !chosenKeys.has(place.id)));
        setProviderDown(Boolean(found.unavailable));
      } catch {
        // Aborted by the next keystroke.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query, countryCode, chosenKeys]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  const choose = (place: PlaceSuggestion) => {
    onSelect(place);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const showPanel = open && (loading || results.length > 0 || query.trim().length >= MIN_PLACE_QUERY_LENGTH);

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--ink-muted)' }} />
        <input
          className="editorial-input w-full"
          style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={countryName ? `Search a city in ${countryName}` : placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Search for a city"
        />
        {loading && (
          <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'var(--ink-muted)' }} />
        )}

        {showPanel && (
          <div
            className="absolute z-30 mt-2 w-full rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lift)' }}
          >
            {providerDown && (
              <p
                className="px-4 py-2 text-xs flex items-center gap-1.5"
                style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}
              >
                <CloudOff className="w-3.5 h-3.5" />
                Place search is unavailable — showing well-known cities.
              </p>
            )}
            {results.length === 0 ? (
              <p className="px-4 py-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {loading ? 'Looking up places…' : 'No place found. Try a different spelling.'}
              </p>
            ) : (
              <ul className="max-h-60 overflow-y-auto py-1">
                {results.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => choose(place)}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 min-h-12"
                      style={{ color: 'var(--ink)' }}
                    >
                      <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold truncate">{place.city}</span>
                        <span className="block text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                          {[place.region, place.country].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {quickPicks.length > 0 && query.trim().length < MIN_PLACE_QUERY_LENGTH && (
        <div className="flex flex-wrap gap-2">
          {/* Adds the city outright: no network needed, no second tap. */}
          {quickPicks.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => choose(place)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}
            >
              <Plus className="w-3 h-3" />
              {place.city}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

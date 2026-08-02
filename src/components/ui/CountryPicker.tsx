import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { countryFlag, findCountry, searchCountries, type CountryProfile } from '../../lib/destinations';

interface CountryPickerProps {
  value: string;
  onChange: (country: CountryProfile) => void;
  placeholder?: string;
}

/**
 * Tap-to-open country list with in-panel search. Avoids the native datalist,
 * which on mobile hides suggestions inside the keyboard's autocomplete strip.
 */
export function CountryPicker({ value, onChange, placeholder = 'Choose a country' }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => findCountry(value), [value]);
  const results = useMemo(() => searchCountries(query, query ? 10 : 60), [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (country: CountryProfile) => {
    onChange(country);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="editorial-input w-full flex items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true">{selected ? countryFlag(selected.code) : '🌍'}</span>
          <span className="truncate" style={{ color: selected ? 'var(--ink)' : 'var(--ink-muted)' }}>
            {selected ? selected.name : placeholder}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-2 w-full rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lift)' }}
        >
          <div className="relative p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ink-muted)' }} />
            <input
              ref={searchRef}
              className="editorial-input is-compact w-full"
              style={{ paddingLeft: '2.25rem', paddingRight: query ? '2.25rem' : undefined }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search countries"
              aria-label="Search countries"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-5 top-1/2 -translate-y-1/2 p-1"
                aria-label="Clear country search"
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--ink-muted)' }} />
              </button>
            )}
          </div>

          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {results.length === 0 && (
              <li className="px-4 py-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
                No match. You can still type cities directly.
              </li>
            )}
            {results.map((country) => {
              const active = selected?.code === country.code;
              return (
                <li key={country.code}>
                  <button
                    type="button"
                    onClick={() => select(country)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-12"
                    style={{ backgroundColor: active ? 'var(--accent-soft)' : 'transparent', color: 'var(--ink)' }}
                    role="option"
                    aria-selected={active}
                  >
                    <span aria-hidden="true">{countryFlag(country.code)}</span>
                    <span className="flex-1 text-sm font-medium truncate">{country.name}</span>
                    <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{country.currency}</span>
                    {active && <Check className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  countryOptionLabel,
  resolveCountrySelection,
  searchCountries,
  type CountryProfile,
} from '../../lib/destinations';
import { CountryMark } from './CountryMark';

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
  const listboxDomId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selection = useMemo(() => resolveCountrySelection(value), [value]);
  const results = useMemo(() => searchCountries(query, query ? 12 : 60), [query]);

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const gutter = 8;
      const searchHeight = 56;
      const width = Math.min(rect.width, viewportWidth - gutter * 2);
      const spaceBelow = viewportTop + viewportHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - viewportTop - gutter;
      const opensUp = spaceBelow < 200 && spaceAbove > spaceBelow;
      const available = (opensUp ? spaceAbove : spaceBelow) - searchHeight;
      const maxHeight = Math.max(140, Math.min(320, available));
      const left = Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));
      setMenuPosition({
        top: opensUp
          ? Math.max(viewportTop + gutter, rect.top - maxHeight - searchHeight - 6)
          : rect.bottom + 8,
        left,
        width,
        maxHeight,
      });
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    updateMenuPosition();
    window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  }, []);

  const select = useCallback((country: CountryProfile) => {
    onChange(country);
    setQuery('');
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  const moveHighlight = useCallback((delta: number) => {
    if (results.length === 0) return;
    setHighlightIndex((current) => {
      const next = current + delta;
      if (next < 0) return results.length - 1;
      if (next >= results.length) return 0;
      return next;
    });
  }, [results.length]);

  const onMenuKeyDown = useCallback((event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(-1);
        break;
      case 'Home':
        event.preventDefault();
        setHighlightIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlightIndex(Math.max(0, results.length - 1));
        break;
      case 'Enter':
        if (results[highlightIndex]) {
          event.preventDefault();
          select(results[highlightIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        closeMenu();
        break;
      default:
        break;
    }
  }, [closeMenu, highlightIndex, moveHighlight, results, select]);

  const triggerLabel = selection.isKnown && selection.currency
    ? countryOptionLabel(selection.country!)
    : selection.displayName || placeholder;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="editorial-input w-full flex items-center justify-between gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxDomId : undefined}
        aria-label={selection.isKnown ? `Country, ${triggerLabel}` : placeholder}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <CountryMark code={selection.displayCode} />
          <span
            className="truncate"
            style={{ color: selection.displayName ? 'var(--ink)' : 'var(--ink-muted)' }}
            title={selection.displayName || undefined}
          >
            {selection.displayName || placeholder}
          </span>
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="country-picker-menu fixed z-[200] rounded-2xl overflow-hidden flex flex-col"
          data-lenis-prevent
          data-lenis-prevent-wheel
          data-lenis-prevent-touch
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lift)',
          }}
          onKeyDown={onMenuKeyDown}
        >
          <div className="country-picker-search relative shrink-0 p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--ink-muted)' }} />
            <input
              ref={searchRef}
              className="editorial-input is-compact w-full"
              style={{ paddingLeft: '2.25rem', paddingRight: query ? '2.25rem' : undefined }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search countries"
              aria-label="Search countries by name or country code"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxDomId}
              aria-autocomplete="list"
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

          <ul
            id={listboxDomId}
            className="country-picker-results min-h-0 overflow-y-auto overscroll-contain py-1"
            style={{
              maxHeight: menuPosition.maxHeight,
              touchAction: 'pan-y',
              WebkitOverflowScrolling: 'touch',
            }}
            data-lenis-prevent
            data-lenis-prevent-wheel
            data-lenis-prevent-touch
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            role="listbox"
            aria-label="Countries"
            aria-activedescendant={results[highlightIndex] ? `country-option-${results[highlightIndex].code}` : undefined}
          >
            {results.length === 0 && (
              <li className="px-4 py-3 text-sm" role="presentation" style={{ color: 'var(--ink-muted)' }}>
                No match. You can still type cities directly.
              </li>
            )}
            {results.map((country, index) => {
              const active = selection.country?.code === country.code;
              const highlighted = highlightIndex === index;
              return (
                <li key={country.code} role="presentation">
                  <button
                    id={`country-option-${country.code}`}
                    type="button"
                    ref={(node) => { optionRefs.current[index] = node; }}
                    onClick={() => select(country)}
                    onMouseEnter={() => setHighlightIndex(index)}
                    className="country-picker-row w-full text-left px-4 py-3 flex items-center gap-3 min-h-12"
                    style={{
                      backgroundColor: highlighted
                        ? 'var(--accent-soft)'
                        : active
                          ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-elevated))'
                          : 'transparent',
                      color: 'var(--ink)',
                    }}
                    role="option"
                    aria-selected={active}
                    aria-label={countryOptionLabel(country)}
                  >
                    <CountryMark code={country.code} compact />
                    <span className="flex-1 min-w-0 text-sm font-medium truncate" title={country.name}>
                      {country.name}
                    </span>
                    <span className="text-xs tabular-nums tracking-wide shrink-0" style={{ color: 'var(--ink-muted)' }}>
                      {country.currency}
                    </span>
                    {active && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

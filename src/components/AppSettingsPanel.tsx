import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { ArrowRight, Check, Coins, Compass, Download, ImagePlus, Link2, Palette, PawPrint, Plus, Trash2, Upload, Wand2, type LucideIcon } from 'lucide-react';
import {
  createPetId,
  DEFAULT_PETS,
  downloadPetPack,
  loadPetPack,
  parsePetPackImport,
  readImageAsDataUrl,
  savePetPack,
  subscribePetPack,
  type PetDefinition,
} from '../lib/petPack';
import {
  JOURNEY_PALETTES,
  applyJourneyPalette,
  loadJourneyPalette,
  saveJourneyPalette,
  type JourneyPaletteId,
} from '../lib/journeyPalette';
import { CurrencyPairSettings } from './CurrencySelector';
import { TripIdentityPanel } from './TripIdentityPanel';
import type { Itinerary } from '../data';

interface AppSettingsPanelProps {
  showPets: boolean;
  onTogglePets: () => void;
  itinerary?: Itinerary;
  onItineraryChange?: (itinerary: Itinerary) => void;
}

function SettingsCategoryHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 px-1 pt-2">
      <div
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <h3 className="font-display text-2xl mt-1" style={{ color: 'var(--ink)' }}>{title}</h3>
        <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--ink-muted)' }}>{description}</p>
      </div>
    </div>
  );
}

export function AppSettingsPanel({ showPets, onTogglePets, itinerary, onItineraryChange }: AppSettingsPanelProps) {
  const [pets, setPets] = useState<PetDefinition[]>(() => loadPetPack());
  const [name, setName] = useState('');
  const [spriteUrl, setSpriteUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [palette, setPalette] = useState<JourneyPaletteId>(() => loadJourneyPalette());

  const choosePalette = (next: JourneyPaletteId) => {
    setPalette(next);
    saveJourneyPalette(next);
    applyJourneyPalette(next);
  };
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [activeSection, setActiveSection] = useState(
    itinerary && onItineraryChange ? 'settings-trip' : 'settings-money',
  );
  const [highlightedSection, setHighlightedSection] = useState<string | null>(null);

  useEffect(() => subscribePetPack(() => setPets(loadPetPack())), []);

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const handleSectionNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const id = event.currentTarget.getAttribute('href')?.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;

    setActiveSection(id);
    setHighlightedSection(id);
    window.history.replaceState(null, '', `#${id}`);
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });

    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedSection((current) => (current === id ? null : current));
    }, 1100);
  };

  const sectionTargetStyle = (id: string) => ({
    borderRadius: '1.5rem',
    outline: highlightedSection === id ? '2px solid var(--accent)' : '2px solid transparent',
    outlineOffset: '0.75rem',
    boxShadow: highlightedSection === id
      ? '0 0 0 0.75rem color-mix(in srgb, var(--accent-soft) 65%, transparent)'
      : 'none',
    transition: 'outline-color 450ms ease, box-shadow 450ms ease',
  });

  const persist = (next: PetDefinition[]) => {
    setPets(next);
    savePetPack(next);
  };

  const updatePet = (id: string, patch: Partial<PetDefinition>) => {
    persist(pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)));
  };

  const removePet = (id: string) => {
    const pet = pets.find((item) => item.id === id);
    if (!pet) return;
    if (pet.source === 'builtin') {
      updatePet(id, { enabled: false });
      setStatus(`${pet.name} hidden. Built-in pets stay available to turn back on.`);
      return;
    }
    if (!window.confirm(`Remove “${pet.name}” from your pet pack?`)) return;
    persist(pets.filter((item) => item.id !== id));
    setStatus(`Removed ${pet.name}.`);
  };

  const addPetFromUrl = () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSprite = spriteUrl.trim();
    if (!trimmedName) {
      setError('Give your pet a name.');
      return;
    }
    if (!trimmedSprite || !/^https?:\/\//i.test(trimmedSprite) && !trimmedSprite.startsWith('data:image/')) {
      setError('Add an image URL (https://...) or upload an image.');
      return;
    }
    const nextPet: PetDefinition = {
      id: createPetId(),
      name: trimmedName,
      sprite: trimmedSprite,
      speed: 1.6,
      enabled: true,
      source: 'custom',
    };
    persist([...pets, nextPet]);
    setName('');
    setSpriteUrl('');
    setStatus(`Added ${trimmedName}. Turn on Animated pets to see it.`);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setSpriteUrl(dataUrl);
      if (!name.trim()) {
        setName(file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My pet');
      }
      setStatus('Image ready. Add the pet to save it to your pack.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to read that image.');
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const imported = parsePetPackImport(text);
      if (!window.confirm(`Import ${imported.length} pet${imported.length === 1 ? '' : 's'} into your pack?`)) return;
      const byId = new Map(pets.map((pet) => [pet.id, pet]));
      imported.forEach((pet) => byId.set(pet.id, pet));
      persist(Array.from(byId.values()));
      setStatus(`Imported ${imported.length} pets into your pack.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to import that pet pack.');
    }
  };

  const handleExport = () => {
    downloadPetPack(pets);
    setStatus('Exported your pet pack as JSON.');
  };

  const resetBuiltins = () => {
    if (!window.confirm('Restore the default Cat, Dog, and Black Puppy pets? Custom pets stay.')) return;
    const customs = pets.filter((pet) => pet.source === 'custom');
    persist([...DEFAULT_PETS.map((pet) => ({ ...pet })), ...customs]);
    setStatus('Built-in pets restored.');
  };

  return (
    <section className="w-full">
      <div className="settings-layout grid grid-cols-1 lg:grid-cols-[13.5rem_minmax(0,1fr)] items-start gap-5 lg:gap-8">
        <aside className="settings-rail lg:rounded-3xl lg:p-3 lg:sticky lg:top-24">
          {/* The heading earns its place beside a column of categories; above a
              scrolling strip on a phone it is one more thing to scroll past. */}
          <div className="hidden lg:block px-2">
            <div className="eyebrow">Settings menu</div>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Jump to a category.
            </p>
          </div>
          <nav className="settings-rail-nav lg:mt-4 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Settings categories">
            {itinerary && onItineraryChange && (
              <a
                href="#settings-trip"
                onClick={handleSectionNavigate}
                className={`settings-rail-link${activeSection === 'settings-trip' ? ' is-active' : ''}`}
              >
                <Compass className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                <span>Trip planning</span>
              </a>
            )}
            {itinerary && onItineraryChange && (
              <a
                href="#settings-design"
                onClick={handleSectionNavigate}
                className={`settings-rail-link${activeSection === 'settings-design' ? ' is-active' : ''}`}
              >
                <Wand2 className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                <span>Handbook design</span>
              </a>
            )}
            <a
              href="#settings-money"
              onClick={handleSectionNavigate}
              className={`settings-rail-link${activeSection === 'settings-money' ? ' is-active' : ''}`}
            >
              <Coins className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <span>Money</span>
            </a>
            <a
              href="#settings-extras"
              onClick={handleSectionNavigate}
              className={`settings-rail-link${activeSection === 'settings-extras' ? ' is-active' : ''}`}
            >
              <PawPrint className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <span>Optional extras</span>
            </a>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="editorial-card p-4 sm:p-5 md:p-8">
            <div className="eyebrow">Settings</div>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
              App preferences.
            </h2>
            <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
              Keep trip planning, handbook design, money, and optional extras in their own place. Pet packs stay on this device and can be exported anytime.
            </p>
          </div>

      {itinerary && onItineraryChange && (
        <section id="settings-trip" className="space-y-3 scroll-mt-24" style={sectionTargetStyle('settings-trip')}>
          <SettingsCategoryHeading
            icon={Compass}
            eyebrow="Trip planning"
            title="Shape the journey"
            description="Dates, cities, stays, and the trip preferences behind your itinerary."
          />
          <div className="editorial-card p-4 sm:p-5 md:p-8 space-y-5">
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Compass className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="eyebrow">Trip details</div>
                <h3 className="font-display text-2xl sm:text-3xl mt-2">Plan the journey.</h3>
                <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  Set the dates, places, stays, and preferences that shape the itinerary.
                </p>
              </div>
            </div>
            <TripIdentityPanel
              itinerary={itinerary}
              onItineraryChange={onItineraryChange}
              isDesignHighlighted={highlightedSection === 'settings-design'}
            />
          </div>
        </section>
      )}

      <section id="settings-money" className="space-y-3 scroll-mt-24" style={sectionTargetStyle('settings-money')}>
        <SettingsCategoryHeading
          icon={Coins}
          eyebrow="Wallet"
          title="Keep money clear"
          description="Choose the currencies and exchange-rate pair used by your trip wallet."
        />
        <div className="editorial-card p-4 sm:p-5 md:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Coins className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="eyebrow">Currency</div>
              <h3 className="font-display text-2xl sm:text-3xl mt-2">Home and trip money.</h3>
              <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                Choose your local currency and the currency for where you are going. The wallet only toggles between these two.
              </p>
            </div>
          </div>
          <CurrencyPairSettings />
        </div>
      </section>

      <section id="settings-extras" className="space-y-3 scroll-mt-24" style={sectionTargetStyle('settings-extras')}>
        <SettingsCategoryHeading
          icon={PawPrint}
          eyebrow="Optional extras"
          title="Personalise the atmosphere"
          description="Choose the handbook colour palette, turn on animated companions, and manage the pet pack that stays on this device."
        />
        <div className="editorial-card p-4 sm:p-5 md:p-8 space-y-5">
        <div
          className="rounded-2xl p-4"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0 flex items-start gap-3">
            <div
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Colour palette</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Choose the paper and ink the handbook is printed in. Light and dark still follow the theme switch.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Colour palette">
            {JOURNEY_PALETTES.map((option) => {
              const selected = palette === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => choosePalette(option.id)}
                  className="flex items-start gap-3 rounded-xl p-3 text-left transition-colors"
                  style={{
                    backgroundColor: selected ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <span className="mt-0.5 flex shrink-0 gap-1" aria-hidden="true">
                    {option.swatches.map((swatch) => (
                      <span
                        key={swatch}
                        className="h-5 w-5 rounded-full"
                        style={{ backgroundColor: swatch, border: '1px solid rgba(0,0,0,.12)' }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {option.label}
                      {selected && <Check className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="journey-palette-preview mt-4" aria-label="Selected colour palette preview">
            <div className="journey-palette-preview-copy">
              <span>Live preview</span>
              <strong>{itinerary?.name || 'Your next journey'}</strong>
              <small>The preview uses your saved app colour, including after you reopen settings.</small>
            </div>
            <div className="journey-palette-preview-route" aria-hidden="true">
              <i />
              <span />
              <span />
              <span />
            </div>
            <span className="journey-palette-preview-action" aria-hidden="true">
              Continue planning <ArrowRight />
            </span>
          </div>
        </div>

        <div
          className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <div className="min-w-0 flex items-start gap-3">
            <div
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <PawPrint className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Animated pets</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Show your enabled pets floating over the handbook. Off by default for a cleaner view.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showPets}
            aria-label="Show animated pets"
            className="editorial-toggle shrink-0 self-start sm:self-center"
            data-checked={showPets ? 'true' : 'false'}
            onClick={onTogglePets}
          >
            <span className="editorial-toggle-thumb" />
          </button>
        </div>

        {(status || error) && (
          <div
            className="rounded-2xl px-4 py-3 text-sm"
            style={{
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              color: error ? 'var(--warn)' : 'var(--ink)',
            }}
            role={error ? 'alert' : 'status'}
          >
            {error || status}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="pill-btn pill-soft justify-center" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export pets
          </button>
          <button
            type="button"
            className="pill-btn pill-soft justify-center"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            Import pets
          </button>
          <button type="button" className="pill-btn pill-ghost justify-center" onClick={resetBuiltins}>
            Restore defaults
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImport(event)}
          />
        </div>

        <div className="space-y-3">
          <div className="eyebrow">Your pet pack</div>
          {pets.map((pet) => (
            <div
              key={pet.id}
              className="rounded-2xl p-3 sm:p-4 flex items-center gap-3"
              style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <img
                src={pet.sprite}
                alt={pet.name}
                className="w-12 h-12 object-contain shrink-0"
                style={{ imageRendering: 'pixelated' }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>{pet.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {pet.source === 'builtin' ? 'Built-in' : 'Custom'} · {pet.enabled ? 'Enabled' : 'Hidden'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={pet.enabled}
                aria-label={`${pet.enabled ? 'Hide' : 'Show'} ${pet.name}`}
                className="editorial-toggle shrink-0"
                data-checked={pet.enabled ? 'true' : 'false'}
                onClick={() => updatePet(pet.id, { enabled: !pet.enabled })}
              >
                <span className="editorial-toggle-thumb" />
              </button>
              <button
                type="button"
                className="p-2 rounded-full shrink-0"
                style={{ color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                aria-label={`Remove ${pet.name}`}
                onClick={() => removePet(pet.id)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div>
            <div className="eyebrow">Add a pet</div>
            <h3 className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>Import your own companion.</h3>
            <p className="text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>
              Use an image URL or upload a small sprite/GIF/PNG, then save it to your pack.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="editorial-input w-full"
                placeholder="Mochi"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Image URL</span>
              <div className="relative">
                <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} />
                <input
                  value={spriteUrl.startsWith('data:image/') ? '' : spriteUrl}
                  onChange={(event) => setSpriteUrl(event.target.value)}
                  className="editorial-input w-full !pl-9"
                  placeholder="https://..."
                />
              </div>
            </label>
          </div>

          {spriteUrl.startsWith('data:image/') && (
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
              <img src={spriteUrl} alt="Pet preview" className="w-12 h-12 object-contain" style={{ imageRendering: 'pixelated' }} />
              Uploaded image ready to save.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pill-btn pill-soft justify-center"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="w-4 h-4" />
              Upload image
            </button>
            <button type="button" className="pill-btn pill-primary justify-center" onClick={addPetFromUrl}>
              <Plus className="w-4 h-4" />
              Add to pack
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void handleImageUpload(event)}
            />
          </div>
        </div>
        </div>
      </section>
        </div>
      </div>
    </section>
  );
}

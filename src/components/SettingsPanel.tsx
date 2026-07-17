import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { ImagePlus, RotateCcw, Save, Trash2, Palette } from 'lucide-react';
import type { Itinerary } from '../data';
import { useTheme } from '../contexts/ThemeContext';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_TRIP_SETTINGS,
  findMatchingThemePreset,
  getPresetsForMode,
  mergeTripSettings,
} from '../lib/tripSettings';
import type { TripAppSettings, TripThemeSettings } from '../lib/tripSettings';

interface SettingsPanelProps {
  itinerary: Itinerary;
  settings: TripAppSettings;
  onSave: (itinerary: Itinerary, settings: TripAppSettings) => void;
  /** Live-apply theme palette changes without waiting for Save. */
  onThemeLiveChange?: (settings: TripAppSettings) => void;
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const isValidHex = (value: string) => /^#?[0-9a-fA-F]{6}$/.test(value.trim());

const normalizeHex = (value: string, fallback: string) => {
  const trimmed = value.trim();
  if (!isValidHex(trimmed)) return fallback.toUpperCase();
  return `#${trimmed.replace('#', '').toUpperCase()}`;
};

const LIGHT_TOKEN_SWATCHES: Record<keyof TripThemeSettings, string[]> = {
  bg: ['#FAF7F2', '#F7F0E8', '#F3F5F4', '#F2F6F9', '#ECE8E1'],
  bgElevated: ['#FFFFFF', '#FFFBF6', '#FBF6EF', '#F2ECE4', '#F7FAFC'],
  ink: ['#0F0E0D', '#15201C', '#132033', '#181614', '#1A140E'],
  inkMuted: ['#5C5853', '#5F6B66', '#5C6B7A', '#6B655D', '#667085'],
  accent: ['#EE4D87', '#2F7D6E', '#3D8FB5', '#C8842A', '#C95C7C'],
  accentSoft: ['#FFE4EE', '#DDEFEA', '#D7EAF3', '#F3E2C8', '#F7D6DD'],
};

const DARK_TOKEN_SWATCHES: Record<keyof TripThemeSettings, string[]> = {
  bg: ['#14110F', '#171A22', '#121714', '#10161C', '#16120C'],
  bgElevated: ['#1F1A17', '#232630', '#1B221D', '#182129', '#221B13'],
  ink: ['#F5EFE4', '#F7F2EB', '#EEF3EC', '#EEF4F7', '#F8F0E3'],
  inkMuted: ['#A39B8C', '#8E8678', '#8FA093', '#8A9AA6', '#A89880'],
  accent: ['#FF6B9A', '#E7685D', '#2F7D6E', '#3D8FB5', '#E0A045'],
  accentSoft: ['#3A1F2A', '#41242C', '#1E332C', '#1A303A', '#3A2C18'],
};

type SettingsSectionId = 'story' | 'copy' | 'theme';

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; description: string }> = [
  { id: 'story', label: 'Trip Story', description: 'Core trip identity, hero, cover, and media.' },
  { id: 'copy', label: 'App Copy', description: 'Navigation labels and itinerary wording.' },
  { id: 'theme', label: 'Theme', description: 'Palette tokens and visual atmosphere.' },
];

const THEME_TOKEN_DESCRIPTIONS: Record<keyof TripThemeSettings, string> = {
  bg: 'Base page background',
  bgElevated: 'Cards and elevated surfaces',
  ink: 'Main headlines and body text',
  inkMuted: 'Secondary copy and labels',
  accent: 'Buttons, highlights, and active states',
  accentSoft: 'Soft fills and decorative tint',
};

function ThemeTokenField({
  label,
  description,
  value,
  defaultValue,
  swatches,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  swatches: string[];
  onChange: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
            {label}
          </label>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {description}
          </p>
        </div>
        <div
          className="shrink-0 rounded-[1rem] border p-1"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <div
            className="h-10 w-10 rounded-[0.75rem] border"
            style={{ backgroundColor: value, borderColor: 'color-mix(in srgb, var(--ink) 12%, transparent)' }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2 flex-wrap">
          {swatches.map((swatch) => {
            const active = swatch.toUpperCase() === value.toUpperCase();
            return (
              <button
                key={swatch}
                type="button"
                aria-label={`${label} ${swatch}`}
                onClick={() => onChange(swatch)}
                className="theme-swatch shrink-0 w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                data-active={active ? 'true' : 'false'}
                style={{
                  backgroundColor: swatch,
                  borderColor: active ? 'var(--accent)' : 'color-mix(in srgb, var(--ink) 10%, transparent)',
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={() => {
              const normalized = normalizeHex(draftValue, value);
              setDraftValue(normalized);
              onChange(normalized);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const normalized = normalizeHex(draftValue, value);
                setDraftValue(normalized);
                onChange(normalized);
              }
            }}
            className="editorial-input w-24 text-center !py-1.5"
            placeholder={defaultValue}
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button
            type="button"
            className="pill-btn pill-soft !py-1.5 px-3"
            onClick={() => {
              setDraftValue(defaultValue);
              onChange(defaultValue);
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ itinerary, settings, onSave, onThemeLiveChange }: SettingsPanelProps) {
  const { theme } = useTheme();
  const [title, setTitle] = useState(itinerary.name);
  const [description, setDescription] = useState(itinerary.description);
  const [cities, setCities] = useState(itinerary.cities.join(', '));
  const [draftSettings, setDraftSettings] = useState<TripAppSettings>(mergeTripSettings(settings));
  const [isSaving, setIsSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('story');
  const themePushRef = useRef(false);

  useEffect(() => {
    setTitle(itinerary.name);
    setDescription(itinerary.description);
    setCities(itinerary.cities.join(', '));
  }, [itinerary]);

  useEffect(() => {
    if (themePushRef.current) {
      themePushRef.current = false;
      setDraftSettings((current) => ({
        ...current,
        theme: { ...settings.theme },
        lightTheme: { ...mergeTripSettings(settings).lightTheme },
      }));
      return;
    }
    setDraftSettings(mergeTripSettings(settings));
  }, [settings]);

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setDraftSettings((current) => ({ ...current, coverImage: dataUrl }));
    } catch (error) {
      console.error('Failed to read cover image', error);
      window.alert('Unable to read that image. Please try another file.');
    } finally {
      event.target.value = '';
    }
  };

  const handleSave = () => {
    setIsSaving(true);

    const nextItinerary: Itinerary = {
      ...itinerary,
      name: title.trim() || 'New Trip',
      description: description.trim() || 'Start planning your travel handbook from scratch.',
      cities: cities
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };

    const nextSettings: TripAppSettings = mergeTripSettings({
      ...draftSettings,
      heroEyebrow: draftSettings.heroEyebrow.trim() || DEFAULT_TRIP_SETTINGS.heroEyebrow,
      heroHeadline: draftSettings.heroHeadline.trim() || DEFAULT_TRIP_SETTINGS.heroHeadline,
      heroDescription: draftSettings.heroDescription.trim() || DEFAULT_TRIP_SETTINGS.heroDescription,
      heroPrimaryCta: draftSettings.heroPrimaryCta.trim() || DEFAULT_TRIP_SETTINGS.heroPrimaryCta,
      heroSecondaryCta: draftSettings.heroSecondaryCta.trim() || DEFAULT_TRIP_SETTINGS.heroSecondaryCta,
      coverLabel: draftSettings.coverLabel.trim() || DEFAULT_TRIP_SETTINGS.coverLabel,
      coverHeadline: draftSettings.coverHeadline.trim() || DEFAULT_TRIP_SETTINGS.coverHeadline,
      coverStatusEmpty: draftSettings.coverStatusEmpty.trim() || DEFAULT_TRIP_SETTINGS.coverStatusEmpty,
      coverStatusFilled: draftSettings.coverStatusFilled.trim() || DEFAULT_TRIP_SETTINGS.coverStatusFilled,
      coverModeEmpty: draftSettings.coverModeEmpty.trim() || DEFAULT_TRIP_SETTINGS.coverModeEmpty,
      coverModeFilled: draftSettings.coverModeFilled.trim() || DEFAULT_TRIP_SETTINGS.coverModeFilled,
      marqueeItems: draftSettings.marqueeItems
        .join(', ')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      labels: {
        ...draftSettings.labels,
      },
      theme: {
        ...draftSettings.theme,
      },
      lightTheme: {
        ...draftSettings.lightTheme,
      },
    });

    onSave(nextItinerary, nextSettings);
    window.setTimeout(() => setIsSaving(false), 200);
  };

  const handleResetCover = () => {
    setDraftSettings((current) => ({ ...current, coverImage: null }));
  };

  const updateLabel = (key: keyof TripAppSettings['labels'], value: string) => {
    setDraftSettings((current) => ({
      ...current,
      labels: {
        ...current.labels,
        [key]: value,
      },
    }));
  };

  const activePalette = theme === 'light' ? draftSettings.lightTheme : draftSettings.theme;
  const defaultPalette = theme === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
  const modePresets = useMemo(() => getPresetsForMode(theme), [theme]);
  const tokenSwatches = theme === 'light' ? LIGHT_TOKEN_SWATCHES : DARK_TOKEN_SWATCHES;
  const activeThemePreset = findMatchingThemePreset(activePalette, theme);

  const commitPalette = (palette: TripThemeSettings) => {
    themePushRef.current = true;
    setDraftSettings((current) => {
      const next =
        theme === 'light'
          ? { ...current, lightTheme: { ...palette } }
          : { ...current, theme: { ...palette } };
      onThemeLiveChange?.(
        mergeTripSettings({
          ...settings,
          theme: next.theme,
          lightTheme: next.lightTheme,
        }),
      );
      return next;
    });
  };

  const updateTheme = (key: keyof TripThemeSettings, value: string) => {
    commitPalette({ ...activePalette, [key]: value });
  };

  const applyThemePreset = (nextTheme: TripThemeSettings) => {
    commitPalette(nextTheme);
  };

  // Preview uses the palette being edited for the current mode, with explicit colors
  // so contrast stays correct regardless of ambient shell tokens.
  const themePreviewStyle = {
    '--bg': activePalette.bg,
    '--bg-elevated': activePalette.bgElevated,
    '--ink': activePalette.ink,
    '--ink-muted': activePalette.inkMuted,
    '--accent': activePalette.accent,
    '--accent-soft': activePalette.accentSoft,
    '--border': theme === 'light' ? '#E8E1D5' : '#2C2521',
    backgroundColor: activePalette.bgElevated,
    color: activePalette.ink,
    borderColor: theme === 'light' ? '#E8E1D5' : '#2C2521',
  } as CSSProperties;

  const activeSectionMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) || SETTINGS_SECTIONS[0];

  return (
    <section className="w-full">
      <div className="editorial-card p-4 sm:p-5 md:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Handbook Settings</div>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[0.95]" style={{ color: 'var(--ink)' }}>
              Make the handbook yours.
            </h2>
            <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: 'var(--ink-muted)' }}>
              Customize the trip copy, labels, cover image, and color system for this handbook without mixing it with account or profile controls.
            </p>
          </div>

          <button onClick={handleSave} className="pill-btn pill-primary w-full sm:w-auto justify-center">
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save settings'}
          </button>
        </div>

        <div className="flex flex-col xl:flex-row gap-6 md:gap-10 mt-6 md:mt-8">
          <aside className="xl:w-1/4 shrink-0 space-y-4 xl:sticky xl:top-24 h-fit">
            <div className="editorial-card p-4 md:p-5">
              <div className="eyebrow">Sections</div>
              <h3 className="font-display text-2xl sm:text-3xl mt-3" style={{ color: 'var(--ink)' }}>
                Edit with focus.
              </h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Open one group at a time so the handbook is easier to tune without scrolling through every setting at once.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-2 mt-5">
                {SETTINGS_SECTIONS.map((section) => {
                  const active = section.id === activeSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className="text-left rounded-2xl px-4 py-3 border transition-colors"
                      style={{
                        backgroundColor: active ? 'var(--bg-elevated)' : 'var(--bg)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        color: 'var(--ink)',
                      }}
                    >
                      <div className="text-sm font-semibold">{section.label}</div>
                      <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                        {section.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="editorial-card p-4 md:p-5 hidden xl:block">
              <div className="eyebrow">Current Focus</div>
              <h4 className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>
                {activeSectionMeta.label}
              </h4>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {activeSectionMeta.description}
              </p>
              <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Handbook
                </div>
                <div className="font-display text-2xl mt-2" style={{ color: 'var(--ink)' }}>
                  {title.trim() || 'New Trip'}
                </div>
                <div className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
                  {cities.trim() || 'No cities added yet'}
                </div>
              </div>
            </div>
          </aside>

          <div className="xl:w-3/4 space-y-4 md:space-y-5">
            {activeSection === 'story' && (
              <div className="flex flex-col xl:flex-row gap-5 items-start">
                <div className="xl:w-3/5 space-y-4">
                  <div className="editorial-card p-4 md:p-5">
                    <div className="eyebrow">Trip Basics</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Trip Title
                        </label>
                        <input value={title} onChange={(event) => setTitle(event.target.value)} className="editorial-input w-full" placeholder="Summer in Japan" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cities
                        </label>
                        <input value={cities} onChange={(event) => setCities(event.target.value)} className="editorial-input w-full" placeholder="Tokyo, Kyoto, Osaka" />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Trip Description
                        </label>
                        <textarea
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          className="editorial-textarea w-full"
                          style={{ minHeight: '7rem' }}
                          placeholder="Short summary shown in the hero and overview."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="editorial-card p-4 md:p-5">
                    <div className="eyebrow">Hero Story</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Hero Eyebrow
                        </label>
                        <input
                          value={draftSettings.heroEyebrow}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, heroEyebrow: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="A custom travel story"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Label
                        </label>
                        <input
                          value={draftSettings.coverLabel}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverLabel: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="Trip cover"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Hero Headline
                        </label>
                        <textarea
                          value={draftSettings.heroHeadline}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, heroHeadline: event.target.value }))}
                          className="editorial-textarea w-full"
                          style={{ minHeight: '6rem' }}
                          placeholder="Plan your next trip your way."
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Hero Supporting Copy
                        </label>
                        <textarea
                          value={draftSettings.heroDescription}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, heroDescription: event.target.value }))}
                          className="editorial-textarea w-full"
                          style={{ minHeight: '5rem' }}
                          placeholder="Add cities, days, notes, budgets, maps, and documents as you build your travel plan."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Primary Button
                        </label>
                        <input
                          value={draftSettings.heroPrimaryCta}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, heroPrimaryCta: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="Open handbook"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Secondary Button
                        </label>
                        <input
                          value={draftSettings.heroSecondaryCta}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, heroSecondaryCta: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="Open maps"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="editorial-card p-4 md:p-5">
                    <div className="eyebrow">Cover Details</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Headline
                        </label>
                        <textarea
                          value={draftSettings.coverHeadline}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverHeadline: event.target.value }))}
                          className="editorial-textarea w-full"
                          style={{ minHeight: '5rem' }}
                          placeholder={'Add your\nown story'}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Marquee Items
                        </label>
                        <input
                          value={draftSettings.marqueeItems.join(', ')}
                          onChange={(event) =>
                            setDraftSettings((current) => ({
                              ...current,
                              marqueeItems: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                            }))
                          }
                          className="editorial-input w-full"
                          placeholder="Tokyo, Temples, Food, Maps, Notes"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Status Empty
                        </label>
                        <input
                          value={draftSettings.coverStatusEmpty}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverStatusEmpty: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="No cities yet"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Status Filled
                        </label>
                        <input
                          value={draftSettings.coverStatusFilled}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverStatusFilled: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="{cities}"
                        />
                        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Use <code>{'{cities}'}</code> to insert the trip cities automatically.</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Mode Empty
                        </label>
                        <input
                          value={draftSettings.coverModeEmpty}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverModeEmpty: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="starter"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                          Cover Mode Filled
                        </label>
                        <input
                          value={draftSettings.coverModeFilled}
                          onChange={(event) => setDraftSettings((current) => ({ ...current, coverModeFilled: event.target.value }))}
                          className="editorial-input w-full"
                          placeholder="handbook"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="xl:w-2/5 space-y-4">
                  <div className="editorial-card p-4 md:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="eyebrow">Cover Image</div>
                        <h3 className="font-display text-2xl sm:text-3xl mt-3">Upload your own photo</h3>
                      </div>
                    </div>

                    <div
                      className="mt-5 rounded-[2rem] overflow-hidden min-h-48 sm:min-h-72 flex items-center justify-center text-center"
                      style={{ backgroundColor: 'var(--bg)', border: '1px dashed var(--border)' }}
                    >
                      {draftSettings.coverImage ? (
                        <img src={draftSettings.coverImage} alt="Trip cover preview" className="w-full h-48 sm:h-72 object-cover" />
                      ) : (
                        <div className="px-6">
                          <ImagePlus className="w-8 h-8 mx-auto" style={{ color: 'var(--accent)' }} />
                          <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
                            Upload a hero image to replace the placeholder cover and make the handbook feel personal immediately.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 mt-5">
                      <label className="pill-btn pill-primary cursor-pointer">
                        <ImagePlus className="w-4 h-4" />
                        Upload image
                        <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                      </label>

                      <button onClick={handleResetCover} className="pill-btn pill-ghost" type="button">
                        <Trash2 className="w-4 h-4" />
                        Remove image
                      </button>
                    </div>
                  </div>

                  <div className="editorial-card p-4 md:p-5">
                    <div className="eyebrow">Quick Reset</div>
                    <h3 className="font-display text-2xl sm:text-3xl mt-3">Reset the form</h3>
                    <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      Revert this editing session back to the last saved handbook settings.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setTitle(itinerary.name);
                        setDescription(itinerary.description);
                        setCities(itinerary.cities.join(', '));
                        setDraftSettings(mergeTripSettings(settings));
                      }}
                      className="pill-btn pill-ghost mt-5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Revert unsaved edits
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'copy' && (
              <div className="space-y-4">
                <div className="editorial-card p-4 md:p-5">
                  <div className="eyebrow">Navigation Labels</div>
                  <h3 className="font-display text-2xl sm:text-3xl mt-3">Name the handbook sections clearly.</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Itinerary Tab</label>
                      <input value={draftSettings.labels.itineraryTab} onChange={(event) => updateLabel('itineraryTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Maps Tab</label>
                      <input value={draftSettings.labels.mapsTab} onChange={(event) => updateLabel('mapsTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Draft Tab</label>
                      <input value={draftSettings.labels.draftTab} onChange={(event) => updateLabel('draftTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Budget Tab</label>
                      <input value={draftSettings.labels.budgetTab} onChange={(event) => updateLabel('budgetTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Checklist Tab</label>
                      <input value={draftSettings.labels.checklistTab} onChange={(event) => updateLabel('checklistTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Documents Tab</label>
                      <input value={draftSettings.labels.documentsTab} onChange={(event) => updateLabel('documentsTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Photos Tab</label>
                      <input value={draftSettings.labels.photosTab} onChange={(event) => updateLabel('photosTab', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2 xl:col-span-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Search Placeholder</label>
                      <input value={draftSettings.labels.searchPlaceholder} onChange={(event) => updateLabel('searchPlaceholder', event.target.value)} className="editorial-input w-full" />
                    </div>
                  </div>
                </div>

                <div className="editorial-card p-4 md:p-5">
                  <div className="eyebrow">Itinerary Copy</div>
                  <h3 className="font-display text-2xl sm:text-3xl mt-3">Tune the trip language used across the planning views.</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Overview Eyebrow</label>
                      <input value={draftSettings.labels.overviewEyebrow} onChange={(event) => updateLabel('overviewEyebrow', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Back Button</label>
                      <input value={draftSettings.labels.backToOverview} onChange={(event) => updateLabel('backToOverview', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Customize Button</label>
                      <input value={draftSettings.labels.customizePlan} onChange={(event) => updateLabel('customizePlan', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Done Button</label>
                      <input value={draftSettings.labels.doneCustomizing} onChange={(event) => updateLabel('doneCustomizing', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Reset Button</label>
                      <input value={draftSettings.labels.resetPlan} onChange={(event) => updateLabel('resetPlan', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Photos Button</label>
                      <input value={draftSettings.labels.photosButton} onChange={(event) => updateLabel('photosButton', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Day Label</label>
                      <input value={draftSettings.labels.dayLabel} onChange={(event) => updateLabel('dayLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Days Badge Label</label>
                      <input value={draftSettings.labels.daysLabel} onChange={(event) => updateLabel('daysLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Current Location Label</label>
                      <input value={draftSettings.labels.currentLocationLabel} onChange={(event) => updateLabel('currentLocationLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Spots Suffix</label>
                      <input value={draftSettings.labels.spotsSuffix} onChange={(event) => updateLabel('spotsSuffix', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Map Action Label</label>
                      <input value={draftSettings.labels.openMapLabel} onChange={(event) => updateLabel('openMapLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Activity Photos Label</label>
                      <input value={draftSettings.labels.activityPhotosLabel} onChange={(event) => updateLabel('activityPhotosLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2 xl:col-span-3">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Filled Overview Intro</label>
                      <input value={draftSettings.labels.overviewIntroFilled} onChange={(event) => updateLabel('overviewIntroFilled', event.target.value)} className="editorial-input w-full" />
                      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Use <code>{'{cities}'}</code> to insert the current trip cities.</p>
                    </div>
                    <div className="space-y-2 xl:col-span-3">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Empty Overview Intro</label>
                      <input value={draftSettings.labels.overviewIntroEmpty} onChange={(event) => updateLabel('overviewIntroEmpty', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2 xl:col-span-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Delete Confirmation</label>
                      <input value={draftSettings.labels.deleteActivityConfirm} onChange={(event) => updateLabel('deleteActivityConfirm', event.target.value)} className="editorial-input w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>Delete Label</label>
                      <input value={draftSettings.labels.deleteActivityLabel} onChange={(event) => updateLabel('deleteActivityLabel', event.target.value)} className="editorial-input w-full" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'theme' && (
              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_320px] gap-4 md:gap-5 items-start">
                <div className="editorial-card p-4 md:p-5">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <div className="eyebrow">Theme Tokens</div>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl mt-3" style={{ color: 'var(--ink)' }}>
                    Shape the mood of this handbook.
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed max-w-2xl" style={{ color: 'var(--ink-muted)' }}>
                    You are editing the {theme === 'light' ? 'light' : 'dark'} mode palette. Presets apply instantly; custom tokens still work the same way.
                  </p>

                  <div className="mt-6">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
                          {theme === 'light' ? 'Light Color Themes' : 'Dark Color Themes'}
                        </div>
                        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                          {activeThemePreset
                            ? `Using ${activeThemePreset.name}. Adjust any token below to make it custom.`
                            : 'Custom palette — choose a preset, or keep editing tokens below.'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {modePresets.map((preset) => {
                        const active = activeThemePreset?.id === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyThemePreset(preset.theme)}
                            className="text-left rounded-2xl p-3 border transition-transform hover:-translate-y-0.5"
                            style={{
                              backgroundColor: active ? 'color-mix(in srgb, var(--accent-soft) 55%, var(--bg-elevated))' : 'var(--bg)',
                              borderColor: active ? 'var(--accent)' : 'var(--border)',
                            }}
                            aria-pressed={active}
                          >
                            <div
                              className="h-12 w-full overflow-hidden rounded-xl border"
                              style={{ borderColor: 'color-mix(in srgb, var(--ink) 10%, transparent)' }}
                              aria-hidden="true"
                            >
                              <div className="flex h-full">
                                <span className="flex-1" style={{ backgroundColor: preset.theme.bg }} />
                                <span className="flex-1" style={{ backgroundColor: preset.theme.bgElevated }} />
                                <span className="w-1/4" style={{ backgroundColor: preset.theme.accent }} />
                                <span className="w-1/5" style={{ backgroundColor: preset.theme.accentSoft }} />
                              </div>
                            </div>
                            <div className="mt-3 flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                                  {preset.name}
                                </div>
                                <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                                  {preset.description}
                                </div>
                              </div>
                              <span
                                className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
                                style={{
                                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-elevated)',
                                  color: active ? '#0F0E0D' : 'var(--ink-muted)',
                                  border: active ? 'none' : '1px solid var(--border)',
                                }}
                              >
                                {active ? 'Active' : 'Use'}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="mt-6 rounded-2xl p-4 md:p-5 border"
                    style={themePreviewStyle}
                    aria-label="Theme token preview"
                  >
                    <div className="eyebrow" style={{ color: 'var(--ink-muted)' }}>Live preview</div>
                    <div className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>
                      Stay in control of the vibe
                    </div>
                    <p className="mt-2 text-sm leading-relaxed max-w-xl" style={{ color: 'var(--ink-muted)' }}>
                      Cards, accents, and supporting UI pick up these tokens together.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {([
                        ['bg', activePalette.bg],
                        ['elevated', activePalette.bgElevated],
                        ['ink', activePalette.ink],
                        ['muted', activePalette.inkMuted],
                        ['accent', activePalette.accent],
                        ['soft', activePalette.accentSoft],
                      ] as const).map(([name, swatch]) => (
                        <div
                          key={name}
                          className="flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                          style={{
                            backgroundColor: 'color-mix(in srgb, var(--bg) 70%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--ink) 14%, transparent)',
                            color: 'var(--ink-muted)',
                          }}
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-full shrink-0"
                            style={{ backgroundColor: swatch, boxShadow: '0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent)' }}
                          />
                          {name}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
                      Custom Tokens
                    </div>
                    <p className="mt-1 text-sm max-w-2xl" style={{ color: 'var(--ink-muted)' }}>
                      Fine-tune any color for {theme === 'light' ? 'light' : 'dark'} mode. Changing a token marks the palette as custom until you pick a preset again.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-6">
                      {([
                        ['bg', 'Background'],
                        ['bgElevated', 'Elevated Surface'],
                        ['ink', 'Text'],
                        ['inkMuted', 'Muted Text'],
                        ['accent', 'Accent'],
                        ['accentSoft', 'Accent Soft'],
                      ] as const).map(([key, label]) => (
                        <ThemeTokenField
                          key={`${theme}-${key}`}
                          label={label}
                          description={THEME_TOKEN_DESCRIPTIONS[key]}
                          value={activePalette[key]}
                          defaultValue={defaultPalette[key]}
                          swatches={tokenSwatches[key]}
                          onChange={(value) => updateTheme(key, value)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 xl:sticky xl:top-24">
                  <div
                    className="rounded-2xl p-4"
                    style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="eyebrow">Effects</div>
                        <div className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>Immersive visual effects</div>
                        <div className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                          Turn on grain and the custom cursor. Keep this off if you want the smoothest performance.
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draftSettings.immersiveEffects}
                        className="editorial-toggle shrink-0 mt-1"
                        data-checked={draftSettings.immersiveEffects ? 'true' : 'false'}
                        onClick={() =>
                          setDraftSettings((current) => ({ ...current, immersiveEffects: !current.immersiveEffects }))
                        }
                      >
                        <span className="editorial-toggle-thumb" />
                      </button>
                    </div>
                  </div>

                  <div className="editorial-card p-4 md:p-5">
                    <div className="eyebrow">Palette Notes</div>
                    <h3 className="font-display text-2xl mt-3" style={{ color: 'var(--ink)' }}>Start with a preset.</h3>
                    <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      Choose a ready-made theme for a balanced look, then adjust individual tokens if you want something more personal.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

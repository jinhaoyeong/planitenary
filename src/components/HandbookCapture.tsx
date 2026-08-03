import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Map as MapIcon, BookOpen, Settings, Wallet } from 'lucide-react';
import type { Itinerary } from '../data';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import { createItineraryFromProfile } from '../lib/trips';
import {
  applyVisualIdentityCss,
  clearVisualIdentityCss,
  resolveVisualIdentity,
  withVisualDesign,
  type DesignRecipeId,
  type VisualIdentityIntensity,
} from '../lib/visualIdentity';
import { ItineraryView } from './ItineraryView';
import { TripIdentityPanel } from './TripIdentityPanel';
import { resolveDisplayedDayBadge } from '../lib/trips';

type CaptureView = 'home' | 'itinerary' | 'settings';

const SCENARIOS: Record<string, {
  label: string;
  expectedRecipe: DesignRecipeId;
  profile: TripProfile;
  longTitle: string;
}> = {
  japan: {
    label: 'Japan — Quiet Editorial',
    expectedRecipe: 'quiet-editorial',
    longTitle: '京都の静かな八日間',
    profile: {
      ...createEmptyProfile('JPY'),
      destinations: [manualDestination('Kyoto', 'Japan')],
      tripTypes: ['relaxation', 'couple'],
      styles: ['temples', 'cafes'],
      moods: ['slow-living'],
      startDate: '2027-10-04',
      endDate: '2027-10-11',
      dayCount: 8,
      brandAfterDestination: true,
    },
  },
  korea: {
    label: 'Korea — Modern Metropolitan',
    expectedRecipe: 'modern-metropolitan',
    longTitle: '서울 · Busan · Jeju Sprint',
    profile: {
      ...createEmptyProfile('KRW'),
      destinations: [manualDestination('Seoul', 'South Korea')],
      tripTypes: ['business'],
      styles: ['shopping', 'nightlife'],
      moods: ['fast-paced'],
      startDate: '2027-05-01',
      endDate: '2027-05-05',
      dayCount: 5,
      brandAfterDestination: true,
    },
  },
  italy: {
    label: 'Italy — Warm Postcard',
    expectedRecipe: 'warm-postcard',
    longTitle: 'A Three-Week Cultural Journey Across Northern Italy',
    profile: {
      ...createEmptyProfile('EUR'),
      destinations: [
        manualDestination('Rome', 'Italy'),
        manualDestination('Florence', 'Italy'),
        manualDestination('Venice', 'Italy'),
      ],
      tripTypes: ['food', 'couple'],
      styles: ['street-food', 'history'],
      moods: ['romantic'],
      startDate: '2027-06-10',
      endDate: '2027-06-17',
      dayCount: 8,
      brandAfterDestination: true,
    },
  },
  switzerland: {
    label: 'Switzerland — Nature Expedition',
    expectedRecipe: 'nature-expedition',
    longTitle: 'Alpine Ridges & Railway Mornings',
    profile: {
      ...createEmptyProfile('CHF'),
      destinations: [manualDestination('Interlaken', 'Switzerland')],
      tripTypes: ['adventure'],
      styles: ['mountains', 'hiking'],
      moods: ['calm'],
      startDate: '2027-08-01',
      endDate: '2027-08-08',
      dayCount: 8,
      brandAfterDestination: true,
    },
  },
};

function readCaptureParams() {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('handbookQa') || 'japan';
  const intensity = (params.get('intensity') || 'balanced') as VisualIdentityIntensity;
  const view = (params.get('view') || 'home') as CaptureView;
  const themeMode = (params.get('theme') === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
  const width = params.get('width') || 'desktop';
  return { scenario, intensity, view, themeMode, width };
}

/**
 * Renders the real handbook surfaces (hero, itinerary, settings) for visual
 * acceptance screenshots — not a schematic QA board.
 *
 * URL: ?handbookQa=japan&intensity=balanced&view=home&theme=light
 */
export function HandbookCapture() {
  const initial = readCaptureParams();
  const [scenarioKey, setScenarioKey] = useState(initial.scenario);
  const [intensity, setIntensity] = useState<VisualIdentityIntensity>(
    ['off', 'subtle', 'balanced', 'immersive'].includes(initial.intensity)
      ? initial.intensity
      : 'balanced',
  );
  const [view, setView] = useState<CaptureView>(
    ['home', 'itinerary', 'settings'].includes(initial.view) ? initial.view : 'home',
  );
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(initial.themeMode);

  const scenario = SCENARIOS[scenarioKey] || SCENARIOS.japan;

  const [itinerary, setItinerary] = useState<Itinerary>(() => {
    // Start on Automatic so Settings can prove manual lock / reset honestly.
    // Destinations still resolve to the expected recipe via the real resolver.
    const profile = withVisualDesign(scenario.profile, {
      intensity,
      recipeOverride: null,
    });
    const created = createItineraryFromProfile(profile, `capture-${scenarioKey}`);
    return { ...created, name: scenario.longTitle };
  });

  // Rebuild when scenario / intensity change so the handbook stays honest.
  // Intentionally resets to Automatic — capture mode is URL-driven, not a
  // storage backend. Durable reload persistence is proven in the real app path.
  useEffect(() => {
    const profile = withVisualDesign(scenario.profile, {
      intensity,
      recipeOverride: null,
    });
    const created = createItineraryFromProfile(profile, `capture-${scenarioKey}`);
    setItinerary({ ...created, name: scenario.longTitle });
  }, [scenarioKey, intensity, scenario]);

  const resolved = useMemo(
    () => resolveVisualIdentity(
      (itinerary.tripProfile as TripProfile) || scenario.profile,
      { theme: themeMode },
    ),
    [itinerary.tripProfile, scenario.profile, themeMode],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
    applyVisualIdentityCss(resolved);
    return () => {
      clearVisualIdentityCss();
      document.documentElement.classList.remove('dark');
    };
  }, [resolved, themeMode]);

  // Keep URL shareable for screenshot scripts.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('handbookQa', scenarioKey);
    url.searchParams.set('intensity', intensity);
    url.searchParams.set('view', view);
    url.searchParams.set('theme', themeMode);
    window.history.replaceState({}, '', url.toString());
  }, [scenarioKey, intensity, view, themeMode]);

  const dayBadge = resolveDisplayedDayBadge(itinerary);
  const brandWords = (itinerary.brandTitle || 'Travel Handbook').trim().split(/\s+/);
  const brandAccent = brandWords[brandWords.length - 1];
  const brandLead = brandWords.slice(0, -1).join(' ');

  const syncUrlAndState = (next: {
    scenario?: string;
    intensity?: VisualIdentityIntensity;
    view?: CaptureView;
    theme?: 'light' | 'dark';
  }) => {
    if (next.scenario) setScenarioKey(next.scenario);
    if (next.intensity) setIntensity(next.intensity);
    if (next.view) setView(next.view);
    if (next.theme) setThemeMode(next.theme);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }} data-handbook-capture="true">
      {/* Compact capture controls — stay out of the product chrome when possible */}
      <div
        className="sticky top-0 z-[60] px-3 py-2 text-[11px] flex flex-wrap gap-2 items-center"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg) 92%, transparent)', borderBottom: '1px solid var(--border)' }}
        data-capture-controls="true"
      >
        {(Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>).map((key) => (
          <button
            key={key}
            type="button"
            className="px-2.5 py-1 rounded-full font-semibold"
            style={{
              backgroundColor: scenarioKey === key ? 'var(--accent)' : 'var(--bg-elevated)',
              color: scenarioKey === key ? 'var(--accent-ink)' : 'var(--ink)',
              border: '1px solid var(--border)',
            }}
            onClick={() => syncUrlAndState({ scenario: key })}
          >
            {SCENARIOS[key].label}
          </button>
        ))}
        <span className="mx-1" style={{ color: 'var(--ink-muted)' }}>|</span>
        {(['subtle', 'balanced', 'immersive'] as VisualIdentityIntensity[]).map((value) => (
          <button
            key={value}
            type="button"
            className="px-2.5 py-1 rounded-full font-semibold capitalize"
            style={{
              backgroundColor: intensity === value ? 'var(--accent-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${intensity === value ? 'var(--accent)' : 'var(--border)'}`,
            }}
            onClick={() => syncUrlAndState({ intensity: value })}
          >
            {value}
          </button>
        ))}
        <span className="mx-1" style={{ color: 'var(--ink-muted)' }}>|</span>
        {(['home', 'itinerary', 'settings'] as CaptureView[]).map((value) => (
          <button
            key={value}
            type="button"
            className="px-2.5 py-1 rounded-full font-semibold capitalize"
            style={{
              backgroundColor: view === value ? 'var(--accent-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${view === value ? 'var(--accent)' : 'var(--border)'}`,
            }}
            onClick={() => syncUrlAndState({ view: value })}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          className="px-2.5 py-1 rounded-full font-semibold ml-auto"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => syncUrlAndState({ theme: themeMode === 'dark' ? 'light' : 'dark' })}
        >
          {themeMode === 'dark' ? 'Light' : 'Dark'}
        </button>
        <span style={{ color: 'var(--ink-muted)' }}>
          {resolved.recipe.id} · {intensity} · {themeMode}
        </span>
      </div>

      {/* Real product header */}
      <header
        className="sticky top-[42px] z-40 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg) 85%, transparent)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 h-16 flex items-center justify-between gap-4">
          <div className="font-display text-xl tracking-tight">
            {brandLead ? <span>{brandLead} </span> : null}
            <span className="font-display-italic" style={{ color: 'var(--accent)' }}>{brandAccent}</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {[
              { id: 'home', label: 'Home', icon: BookOpen },
              { id: 'itinerary', label: 'Itinerary', icon: CalendarDays },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => syncUrlAndState({ view: item.id as CaptureView })}
                className="px-3 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1.5"
                style={{
                  backgroundColor: view === item.id ? 'var(--accent)' : 'transparent',
                  color: view === item.id ? 'var(--accent-ink)' : 'var(--ink-muted)',
                }}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {view === 'home' && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 pt-10 md:pt-16 pb-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
            <div className="md:col-span-7">
              <span className="eyebrow">{itinerary.heroEyebrow || 'A personalized travel starter'}</span>
              <h1
                className="mt-6 font-display handbook-display text-5xl sm:text-6xl md:text-[5rem] leading-[0.95] tracking-tight"
                style={{ color: 'var(--ink)' }}
              >
                {itinerary.name}
              </h1>
              <p className="mt-6 max-w-xl text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {itinerary.description}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="pill-btn pill-primary accent-button"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                  onClick={() => syncUrlAndState({ view: 'itinerary' })}
                >
                  {itinerary.primaryButtonLabel || 'Open the itinerary'}
                </button>
                <button type="button" className="pill-btn pill-ghost">
                  <MapIcon className="w-4 h-4" />
                  {itinerary.secondaryButtonLabel || 'See the map'}
                </button>
              </div>
            </div>

            <div className="md:col-span-5 relative" data-cover-layout={resolved.coverLayout}>
              <div
                className="editorial-card p-3 md:p-4 rotate-[-2deg] relative overflow-hidden"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
                data-cover-layout={resolved.coverLayout}
              >
                <div
                  className="handbook-motif"
                  data-motif={resolved.motifSet !== 'none' ? resolved.motifSet : undefined}
                  aria-hidden="true"
                />
                <div
                  className="relative overflow-hidden handbook-cover-frame z-[1]"
                  data-cover-layout={resolved.coverLayout}
                >
                  <div
                    className="w-full h-[280px] md:h-[360px] flex items-end p-6"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
                  >
                    <div className="relative z-[2]">
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                        {itinerary.coverHeadline || 'Cover'}
                      </p>
                      <p className="font-display handbook-display text-3xl mt-1">
                        {itinerary.cities[0]}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="relative z-[2] flex items-center justify-between px-2 pt-3 pb-1">
                  <span className="font-display-italic text-lg">
                    {itinerary.coverLabel || itinerary.cities.join(' · ')}
                  </span>
                  <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--ink-muted)' }}>
                    {itinerary.coverYear || '2027'}
                  </span>
                </div>
              </div>
              {dayBadge.visible && (
                <div
                  className="absolute -top-6 -right-4 md:-top-8 md:-right-6 w-24 h-24 md:w-28 md:h-28 rounded-full flex flex-col items-center justify-center text-center shadow-xl"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  <span className="font-display text-3xl leading-none">{dayBadge.value}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest mt-1">{dayBadge.unit}</span>
                </div>
              )}
            </div>
          </div>

          <div
            className="mt-10 rounded-2xl px-4 py-3 text-xs"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}
          >
            expected {scenario.expectedRecipe} · resolved {resolved.recipe.id} · intensity {intensity} ·
            accent {resolved.cssVars['--accent'] || 'base'} · radius {resolved.cssVars['--card-radius'] || 'base'} ·
            tracking {resolved.cssVars['--heading-tracking'] || 'base'} · motif cover {resolved.cssVars['--motif-opacity'] || '0'} ·
            motif surface {resolved.cssVars['--motif-opacity-surface'] || '0'} · theme {themeMode}
          </div>
        </section>
      )}

      {view === 'itinerary' && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-8">
          <ItineraryView
            itinerary={itinerary}
            onItineraryChange={setItinerary}
          />
        </div>
      )}

      {view === 'settings' && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 md:px-10 py-10 space-y-6">
          <div>
            <span className="eyebrow">Trip identity</span>
            <h2 className="font-display handbook-display text-4xl mt-2">Profile settings</h2>
            <p className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
              Intensity and recipe controls for this handbook.
            </p>
          </div>
          <TripIdentityPanel
            itinerary={itinerary}
            onItineraryChange={setItinerary}
          />
          <p className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--ink-muted)' }}>
            <Wallet className="w-3.5 h-3.5" />
            Capture evidence · {scenario.label} · {intensity} · {themeMode}
          </p>
        </div>
      )}
    </div>
  );
}

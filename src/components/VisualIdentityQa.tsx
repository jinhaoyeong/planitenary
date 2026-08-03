import { useEffect, useMemo, useState } from 'react';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import {
  DESIGN_RECIPES,
  applyVisualIdentityCss,
  clearVisualIdentityCss,
  resolveVisualIdentity,
  withVisualDesign,
  type DesignRecipeId,
  type VisualIdentityIntensity,
} from '../lib/visualIdentity';

const SCENARIOS: Array<{
  id: string;
  label: string;
  expectedRecipe: DesignRecipeId;
  profile: TripProfile;
}> = [
  {
    id: 'japan',
    label: 'Japan — Quiet Editorial',
    expectedRecipe: 'quiet-editorial',
    profile: {
      ...createEmptyProfile('JPY'),
      destinations: [manualDestination('Kyoto', 'Japan')],
      tripTypes: ['relaxation', 'couple'],
      styles: ['temples', 'cafes'],
      moods: ['slow-living'],
      startDate: '2027-10-04',
      endDate: '2027-10-11',
      dayCount: 8,
    },
  },
  {
    id: 'korea',
    label: 'Korea — Modern Metropolitan',
    expectedRecipe: 'modern-metropolitan',
    profile: {
      ...createEmptyProfile('KRW'),
      destinations: [manualDestination('Seoul', 'South Korea')],
      tripTypes: ['business'],
      styles: ['shopping', 'nightlife'],
      moods: ['fast-paced'],
      startDate: '2027-05-01',
      endDate: '2027-05-05',
      dayCount: 5,
    },
  },
  {
    id: 'italy',
    label: 'Italy — Warm Postcard',
    expectedRecipe: 'warm-postcard',
    profile: {
      ...createEmptyProfile('EUR'),
      destinations: [manualDestination('Rome', 'Italy')],
      tripTypes: ['food', 'couple'],
      styles: ['street-food', 'history'],
      moods: ['romantic'],
      startDate: '2027-06-10',
      endDate: '2027-06-17',
      dayCount: 8,
    },
  },
  {
    id: 'switzerland',
    label: 'Switzerland — Nature Expedition',
    expectedRecipe: 'nature-expedition',
    profile: {
      ...createEmptyProfile('CHF'),
      destinations: [manualDestination('Interlaken', 'Switzerland')],
      tripTypes: ['adventure'],
      styles: ['mountains', 'hiking'],
      moods: ['calm'],
      startDate: '2027-08-01',
      endDate: '2027-08-08',
      dayCount: 8,
    },
  },
];

const INTENSITIES: VisualIdentityIntensity[] = ['subtle', 'balanced', 'immersive'];

/**
 * Controlled visual acceptance board for the four design recipes.
 * Open with ?visualQa=1 — does not invent CSS; applies the same token system
 * as the live handbook surfaces.
 */
export function VisualIdentityQa({ theme, onClose }: { theme: 'light' | 'dark'; onClose: () => void }) {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [intensity, setIntensity] = useState<VisualIdentityIntensity>('balanced');
  const [lockRecipe, setLockRecipe] = useState(true);

  const scenario = SCENARIOS.find((entry) => entry.id === scenarioId) || SCENARIOS[0];
  const profile = useMemo(() => {
    const base = withVisualDesign(scenario.profile, {
      intensity,
      recipeOverride: lockRecipe ? scenario.expectedRecipe : null,
    });
    return base;
  }, [scenario, intensity, lockRecipe]);

  const resolved = useMemo(
    () => resolveVisualIdentity(profile, { theme }),
    [profile, theme],
  );

  useEffect(() => {
    applyVisualIdentityCss(resolved);
    return () => clearVisualIdentityCss();
  }, [resolved]);

  const longTitle = scenario.id === 'italy'
    ? 'A Three-Week Cultural Journey Across Northern Italy'
    : scenario.id === 'korea'
      ? '서울 · Busan · Jeju Sprint'
      : scenario.id === 'japan'
        ? '京都の静かな八日間'
        : 'Alpine Ridges & Railway Mornings';

  return (
    <div className="min-h-screen px-4 py-6 md:px-8" style={{ backgroundColor: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Visual acceptance · Adaptive Destination Design</div>
            <h1 className="font-display handbook-display text-4xl md:text-5xl mt-2 leading-tight">
              Recipe comparison board
            </h1>
            <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--ink-muted)' }}>
              Same handbook surfaces, approved tokens only. Expected recipe: <strong>{DESIGN_RECIPES[scenario.expectedRecipe].label}</strong>
              {' · '}Resolved: <strong>{resolved.recipe.label}</strong>
              {' · '}Intensity: <strong>{intensity}</strong>
              {' · '}Theme: <strong>{theme}</strong>
            </p>
          </div>
          <button type="button" className="pill-btn pill-ghost" onClick={onClose}>Close QA</button>
        </header>

        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="pill-btn"
              style={{
                backgroundColor: scenarioId === entry.id ? 'var(--accent)' : 'var(--bg-elevated)',
                color: scenarioId === entry.id ? 'var(--accent-ink)' : 'var(--ink)',
                border: '1px solid var(--border)',
              }}
              onClick={() => setScenarioId(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {INTENSITIES.map((value) => (
            <button
              key={value}
              type="button"
              className="pill-btn"
              style={{
                backgroundColor: intensity === value ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                border: `1px solid ${intensity === value ? 'var(--accent)' : 'var(--border)'}`,
              }}
              onClick={() => setIntensity(value)}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            className="pill-btn pill-ghost"
            onClick={() => setLockRecipe((current) => !current)}
          >
            {lockRecipe ? 'Recipe locked' : 'Automatic recipe'}
          </button>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          <div className="md:col-span-7 space-y-4">
            <span className="eyebrow">Home hero</span>
            <h2 className="font-display handbook-display text-4xl md:text-6xl leading-[0.95]">
              {longTitle}
            </h2>
            <p className="text-base max-w-xl" style={{ color: 'var(--ink-muted)' }}>
              {scenario.label}. Cover layout <code>{resolved.coverLayout}</code>, motif <code>{resolved.motifSet}</code>,
              density <code>{resolved.density}</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pill-btn pill-primary accent-button">Open the itinerary</button>
              <button type="button" className="pill-btn pill-ghost">See the map</button>
            </div>
          </div>

          <div className="md:col-span-5" data-cover-layout={resolved.coverLayout}>
            <div className="editorial-card p-3 relative overflow-hidden" data-cover-layout={resolved.coverLayout}>
              <div className="handbook-motif" data-motif={resolved.motifSet} aria-hidden="true" />
              <div className="handbook-cover-frame relative z-[1]" data-cover-layout={resolved.coverLayout}>
                <div
                  className="w-full h-56 flex items-end p-4"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
                >
                  <div className="relative z-[2]">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Cover</p>
                    <p className="font-display handbook-display text-3xl mt-1">
                      {scenario.profile.destinations[0]?.city}
                    </p>
                  </div>
                </div>
              </div>
              <div className="relative z-[2] flex justify-between px-2 pt-3 text-sm">
                <span className="font-display-italic">{scenario.profile.destinations[0]?.country}</span>
                <span style={{ color: 'var(--ink-muted)' }}>2027</span>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="eyebrow">Itinerary day cards · surface motifs stay quieter than the cover</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((day) => (
              <div key={day} className="trip-surface-card p-5 relative overflow-hidden min-h-40">
                <div className="handbook-motif" data-motif={resolved.motifSet} aria-hidden="true" />
                <div className="relative z-[1]">
                  <div className="font-display handbook-display text-5xl" style={{ color: 'var(--accent)' }}>
                    {String(day).padStart(2, '0')}
                  </div>
                  <h3 className="font-display handbook-display text-2xl mt-2">Day {day} in {scenario.profile.destinations[0]?.city}</h3>
                  <p className="text-sm mt-2" style={{ color: 'var(--ink-muted)' }}>
                    Sample activity copy stays readable over restrained motifs.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          className="rounded-2xl p-4 text-xs space-y-1"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <div className="eyebrow m-0 mb-2">Resolved tokens</div>
          <p>expected: {scenario.expectedRecipe} · resolved: {resolved.recipe.id} · source: {resolved.recipeSource}</p>
          <p>accent: {resolved.cssVars['--accent'] || '(base)'} · radius: {resolved.cssVars['--card-radius'] || '(base)'} · tracking: {resolved.cssVars['--heading-tracking'] || '(base)'}</p>
          <p>motif cover: {resolved.cssVars['--motif-opacity'] || '0'} · motif surface: {resolved.cssVars['--motif-opacity-surface'] || '0'} · overlay: {resolved.cssVars['--image-overlay'] || 'none'}</p>
          <p>button radius: {resolved.cssVars['--button-radius'] || '(base)'} · border: {resolved.cssVars['--card-border-width'] || '(base)'} · density: {resolved.cssVars['--content-density'] || '(base)'}</p>
        </section>
      </div>
    </div>
  );
}

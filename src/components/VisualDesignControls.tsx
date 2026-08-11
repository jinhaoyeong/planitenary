import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, RotateCcw, Wand2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { TripProfile } from '../lib/tripProfile';
import { sanitizeTripVisualDesign } from '../lib/tripProfile';
import {
  DESIGN_RECIPES,
  VISUAL_INTENSITY_OPTIONS,
  resolveVisualIdentity,
  withVisualDesign,
  type DesignRecipeId,
  type VisualIdentityIntensity,
} from '../lib/visualIdentity';

interface VisualDesignControlsProps {
  profile: TripProfile;
  onChange: (profile: TripProfile) => void;
  /** Compact preview for the create wizard. */
  compact?: boolean;
}

function moveRadio(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  length: number,
  select: (nextIndex: number) => void,
  refs: React.MutableRefObject<Array<HTMLButtonElement | null>>,
) {
  let nextIndex: number | null = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + length) % length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  select(nextIndex);
  refs.current[nextIndex]?.focus();
}

function recipeButtonRadius(shape: 'pill' | 'rounded' | 'square') {
  if (shape === 'pill') return '9999px';
  if (shape === 'rounded') return '0.7rem';
  return '0.25rem';
}

const RECIPE_SHORT_DESCRIPTIONS: Record<DesignRecipeId, string> = {
  'quiet-editorial': 'Soft paper · calm editorial',
  'modern-metropolitan': 'Sharp cards · modern city',
  'warm-postcard': 'Warm paper · postcard style',
  'nature-expedition': 'Crisp layout · outdoor feel',
};

/**
 * Settings for the Adaptive Destination Design System.
 * Intensity = how strongly the app adapts.
 * Recipe = which approved design family is used.
 */
export function VisualDesignControls({ profile, onChange }: VisualDesignControlsProps) {
  const { theme } = useTheme();
  const visual = useMemo(
    () => sanitizeTripVisualDesign(profile.visualDesign, profile.applyVisualIdentity),
    [profile.visualDesign, profile.applyVisualIdentity],
  );
  const resolved = useMemo(() => resolveVisualIdentity(profile, { theme }), [profile, theme]);
  const automaticResolved = useMemo(
    () => resolveVisualIdentity(withVisualDesign(profile, { recipeOverride: null }), { theme }),
    [profile, theme],
  );
  const [previewOpen, setPreviewOpen] = useState(true);
  const intensityLabelId = useId();
  const recipeLabelId = useId();
  const previewId = useId();
  const intensityRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const recipeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setIntensity = (intensity: VisualIdentityIntensity) => {
    onChange(withVisualDesign(profile, { intensity }));
  };

  const setRecipeOverride = (recipeOverride: DesignRecipeId | null) => {
    onChange(withVisualDesign(profile, { recipeOverride }));
  };

  const resetAllDesignSettings = () => {
    onChange(withVisualDesign(profile, {
      intensity: 'balanced',
      recipeOverride: null,
      paletteOverride: null,
    }));
  };

  const hasDesignChanges = visual.intensity !== 'balanced' || Boolean(visual.recipeOverride) || Boolean(visual.paletteOverride);
  const onlyRecipeOverride = Boolean(visual.recipeOverride)
    && visual.intensity === 'balanced'
    && !visual.paletteOverride;
  const resetLabel = onlyRecipeOverride
    ? 'Use automatic design'
    : 'Reset all design settings';
  const handleReset = () => {
    if (onlyRecipeOverride) {
      setRecipeOverride(null);
      return;
    }
    resetAllDesignSettings();
  };
  const destinationLabel = resolved.country.name || profile.destinations[0]?.city || 'your destination';
  const previewIsOff = visual.intensity === 'off';
  const previewRecipeLabel = previewIsOff ? 'Standard handbook design' : resolved.recipe.label;
  const selectionDescription = previewIsOff
    ? 'Destination styling is turned off.'
    : visual.recipeOverride
      ? `Manually selected ${resolved.recipe.label}.`
      : `Chosen automatically for ${destinationLabel}.`;
  const previewCoverLayout = previewIsOff ? 'journal' : resolved.coverLayout;
  const previewMotif = previewIsOff ? 'none' : resolved.motifSet;
  const previewCity = profile.destinations[0]?.city || resolved.country.name || 'Your trip';
  const selectedIntensity = VISUAL_INTENSITY_OPTIONS.find((option) => option.id === visual.intensity) ?? VISUAL_INTENSITY_OPTIONS[2];
  const previewStyle = {
    '--accent': theme === 'dark' ? '#FF6B9A' : '#EE4D87',
    '--accent-soft': theme === 'dark' ? '#3A1F2A' : '#FFE4EE',
    '--accent-ink': '#0F0E0D',
    '--accent-soft-ink': theme === 'dark' ? '#FFFFFF' : '#0F0E0D',
    '--card-radius': '1rem',
    '--card-shadow': theme === 'dark'
      ? '0 1px 0 rgba(255,255,255,0.04), 0 14px 30px -18px rgba(0,0,0,0.6)'
      : '0 1px 0 rgba(15,14,13,0.04), 0 12px 28px -18px rgba(15,14,13,0.18)',
    '--button-radius': '9999px',
    '--heading-tracking': '-0.02em',
    '--heading-transform': 'none',
    '--heading-size-scale': '1',
    '--motif-opacity': '0',
    '--motif-opacity-surface': '0',
    '--image-overlay': 'transparent',
    '--cover-layout': 'journal',
    '--card-border-width': '1px',
    '--cover-frame-padding': '0px',
    '--content-density': '1',
    ...resolved.cssVars,
  } as CSSProperties;

  const recipeChoices: Array<{ id: DesignRecipeId | null; label: string; hint: string }> = [
    {
      id: null,
      label: 'Automatic',
      hint: `Currently using ${automaticResolved.recipe.label} for ${destinationLabel}.`,
    },
    ...(Object.keys(DESIGN_RECIPES) as DesignRecipeId[]).map((id) => ({
      id,
      label: DESIGN_RECIPES[id].label,
      hint: DESIGN_RECIPES[id].hint,
    })),
  ];

  return (
    <div className="visual-design-controls space-y-5">
      <div>
        <div className="eyebrow mb-2">Personalise the handbook design</div>
        <p className="text-xs max-w-2xl" style={{ color: 'var(--ink-muted)' }}>
          Choose how strongly the handbook adapts, then select a visual direction or let the destination guide it.
        </p>
      </div>

      <section aria-labelledby={intensityLabelId}>
        <div id={intensityLabelId} className="eyebrow mb-2">Design intensity</div>
        <div className="visual-radio-grid visual-radio-grid--intensity" role="radiogroup" aria-labelledby={intensityLabelId}>
          {VISUAL_INTENSITY_OPTIONS.map((option, index) => {
            const active = visual.intensity === option.id;
            return (
              <button
                key={option.id}
                ref={(node) => { intensityRefs.current[index] = node; }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setIntensity(option.id)}
                onKeyDown={(event) => moveRadio(event, index, VISUAL_INTENSITY_OPTIONS.length, (next) => setIntensity(VISUAL_INTENSITY_OPTIONS[next].id), intensityRefs)}
                className="visual-choice-card visual-intensity-option text-left rounded-2xl px-3 py-2.5"
                data-selected={active ? 'true' : 'false'}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  {active && <span className="visual-choice-check" aria-hidden="true"><Check className="w-3 h-3" /></span>}
                </span>
              </button>
            );
          })}
        </div>
        <p className="visual-intensity-explanation text-xs mt-2" style={{ color: 'var(--ink-muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{selectedIntensity.label}</strong>{' '}{selectedIntensity.hint}
        </p>
      </section>

      <div className={`visual-design-layout${visual.intensity === 'off' ? ' is-off' : ''}`}>
        {visual.intensity !== 'off' && (
          <div className="min-w-0">
            <section aria-labelledby={recipeLabelId}>
              <div id={recipeLabelId} className="eyebrow mb-2">Design recipe</div>
              <div className="visual-recipe-group" role="radiogroup" aria-labelledby={recipeLabelId}>
                {(() => {
                  const active = visual.recipeOverride === null;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      ref={(node) => { recipeRefs.current[0] = node; }}
                      onClick={() => setRecipeOverride(null)}
                      onKeyDown={(event) => moveRadio(event, 0, recipeChoices.length, (next) => setRecipeOverride(recipeChoices[next].id), recipeRefs)}
                      className="visual-choice-card visual-automatic-card text-left rounded-2xl px-3 py-3"
                      data-selected={active ? 'true' : 'false'}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-sm font-semibold">Automatic <span className="visual-recommended-label">Recommended</span></span>
                          <span className="block text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                            {destinationLabel} currently suggests {automaticResolved.recipe.label}.
                          </span>
                          <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                            It will continue adapting if your destination or trip style changes.
                          </span>
                        </span>
                        {active && <span className="visual-choice-check" aria-hidden="true"><Check className="w-3 h-3" /></span>}
                      </span>
                    </button>
                  );
                })()}
                <div className="visual-manual-heading">Or choose manually</div>
                <div className="visual-radio-grid visual-radio-grid--recipes">
                  {(Object.keys(DESIGN_RECIPES) as DesignRecipeId[]).map((id, index) => {
                    const choiceIndex = index + 1;
                    const active = visual.recipeOverride === id;
                    const recipe = DESIGN_RECIPES[id];
                    return (
                      <button
                        key={id}
                        ref={(node) => { recipeRefs.current[choiceIndex] = node; }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => setRecipeOverride(id)}
                        onKeyDown={(event) => moveRadio(event, choiceIndex, recipeChoices.length, (next) => setRecipeOverride(recipeChoices[next].id), recipeRefs)}
                        className="visual-choice-card visual-recipe-card text-left rounded-2xl px-3 py-2.5"
                        data-selected={active ? 'true' : 'false'}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="block text-sm font-semibold">{recipe.label}</span>
                          {active && <span className="visual-choice-check" aria-hidden="true"><Check className="w-3 h-3" /></span>}
                        </span>
                        <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                          {RECIPE_SHORT_DESCRIPTIONS[id]}
                        </span>
                        <span className="visual-recipe-sample mt-2" style={{ borderRadius: recipe.cardRadius }} aria-hidden="true">
                          <span className="visual-recipe-sample-accent" style={{ backgroundColor: 'var(--accent)' }} />
                          <span
                            className="visual-recipe-sample-title"
                            style={{
                              borderRadius: recipeButtonRadius(recipe.buttonShape),
                              textTransform: recipe.headingTransform,
                              letterSpacing: recipe.headingTracking,
                            }}
                          >
                            {recipe.label}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

          <section className="visual-preview-panel" aria-labelledby="visual-preview-label" data-intensity={visual.intensity} style={previewStyle}>
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <span id="visual-preview-label" className="eyebrow m-0">Live preview</span>
              <span className="visual-preview-accent-label">Accent <span className="visual-preview-accent-swatch" style={{ backgroundColor: 'var(--accent)' }} /></span>
            </div>
            <button
              type="button"
              className="visual-preview-toggle"
              onClick={() => setPreviewOpen((current) => !current)}
              aria-expanded={previewOpen}
              aria-controls={previewId}
            >
              <span>{previewRecipeLabel} · {visual.intensity}</span>
              <span>{previewOpen ? 'Hide' : 'Show'}</span>
            </button>
            <div id={previewId} className="visual-preview-body" hidden={!previewOpen}>
              <p className="visual-preview-title font-display handbook-display text-2xl leading-tight mt-3">{previewRecipeLabel}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>{selectionDescription}</p>
              <div className="visual-preview-stage mt-3" data-cover-layout={previewCoverLayout}>
                <div
                  className="visual-preview-cover handbook-cover-frame"
                >
                  <div className="handbook-motif" data-motif={previewMotif} aria-hidden="true" />
                  <span className="relative z-[2] text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                    {resolved.country.name}
                  </span>
                  <span className="relative z-[2] font-display handbook-display text-xl mt-1">{previewCity} Handbook</span>
                  <span className="relative z-[2] text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                    {previewIsOff ? 'Standard app design' : `${resolved.country.name} · ${resolved.recipe.label}`}
                  </span>
                </div>
                <div className="visual-preview-itinerary">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Day 01</span>
                  <span className="font-display text-base mt-1">A first morning in {previewCity}</span>
                  <span className="text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>Local streets, a slow start, and one good place to linger.</span>
                  <span className="visual-preview-button mt-3">
                    Start day 1
                  </span>
                </div>
              </div>
            </div>
          </section>
      </div>

      {hasDesignChanges && (
        <button type="button" className="visual-reset-action" onClick={handleReset}>
          <RotateCcw className="w-4 h-4" />
          {resetLabel}
        </button>
      )}
    </div>
  );
}

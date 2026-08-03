import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, RotateCcw, Wand2 } from 'lucide-react';
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

/**
 * Settings for the Adaptive Destination Design System.
 * Intensity = how strongly the app adapts.
 * Recipe = which approved design family is used.
 */
export function VisualDesignControls({ profile, onChange }: VisualDesignControlsProps) {
  const visual = useMemo(
    () => sanitizeTripVisualDesign(profile.visualDesign, profile.applyVisualIdentity),
    [profile.visualDesign, profile.applyVisualIdentity],
  );
  const resolved = useMemo(() => resolveVisualIdentity(profile), [profile]);
  const automaticResolved = useMemo(
    () => resolveVisualIdentity(withVisualDesign(profile, { recipeOverride: null })),
    [profile],
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
  const selectionDescription = visual.recipeOverride
    ? `Manually selected ${resolved.recipe.label}.`
    : `Chosen automatically for ${destinationLabel}.`;
  const previewCity = profile.destinations[0]?.city || resolved.country.name || 'Your trip';

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

      <div className="visual-design-layout">
        <div className="space-y-5 min-w-0">
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
                    className="visual-choice-card text-left rounded-2xl px-3 py-3 min-h-14"
                    data-selected={active ? 'true' : 'false'}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="block text-sm font-semibold">{option.label}</span>
                      {active && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                    </span>
                    <span className="block text-[11px] mt-1 leading-snug" style={{ color: 'var(--ink-muted)' }}>
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {visual.intensity !== 'off' && (
            <section aria-labelledby={recipeLabelId}>
              <div id={recipeLabelId} className="eyebrow mb-2">Design recipe</div>
              <div className="visual-radio-grid visual-radio-grid--recipes" role="radiogroup" aria-labelledby={recipeLabelId}>
                {recipeChoices.map((choice, index) => {
                  const active = visual.recipeOverride === choice.id;
                  const recipe = choice.id ? DESIGN_RECIPES[choice.id] : automaticResolved.recipe;
                  return (
                    <button
                      key={choice.id ?? 'automatic'}
                      ref={(node) => { recipeRefs.current[index] = node; }}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setRecipeOverride(choice.id)}
                      onKeyDown={(event) => moveRadio(event, index, recipeChoices.length, (next) => setRecipeOverride(recipeChoices[next].id), recipeRefs)}
                      className="visual-choice-card visual-recipe-card text-left rounded-2xl px-3 py-3"
                      data-selected={active ? 'true' : 'false'}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="block text-sm font-semibold">{choice.label}</span>
                        {active && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                      </span>
                      <span className="block text-[11px] mt-1 leading-snug" style={{ color: 'var(--ink-muted)' }}>
                        {choice.hint}
                      </span>
                      <span className="visual-recipe-sample mt-3" style={{ borderRadius: recipe.cardRadius }} aria-hidden="true">
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
            </section>
          )}
        </div>

        {visual.intensity !== 'off' && (
          <section className="visual-preview-panel" aria-labelledby="visual-preview-label">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <span id="visual-preview-label" className="eyebrow m-0">Live preview</span>
              <span className="ml-auto h-5 w-10 rounded-full" style={{ backgroundColor: 'var(--accent)' }} role="img" aria-label="Current accent colour" />
            </div>
            <button
              type="button"
              className="visual-preview-toggle"
              onClick={() => setPreviewOpen((current) => !current)}
              aria-expanded={previewOpen}
              aria-controls={previewId}
            >
              <span>{resolved.recipe.label} · {visual.intensity}</span>
              <span>{previewOpen ? 'Hide' : 'Show'}</span>
            </button>
            <div id={previewId} className="visual-preview-body" hidden={!previewOpen}>
              <p className="font-display handbook-display text-2xl leading-tight mt-3">{resolved.recipe.label}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>{selectionDescription}</p>
              <div className="visual-preview-stage mt-3" data-cover-layout={resolved.coverLayout}>
                <div
                  className="visual-preview-cover"
                  style={{
                    borderRadius: recipeButtonRadius(resolved.recipe.buttonShape),
                    boxShadow: resolved.recipe.cardShadow,
                  }}
                >
                  <div className="handbook-motif" data-motif={resolved.motifSet} aria-hidden="true" />
                  <span className="relative z-[2] text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                    {resolved.country.name}
                  </span>
                  <span className="relative z-[2] font-display handbook-display text-xl mt-1">{previewCity}</span>
                  <span className="relative z-[2] text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>A handbook shaped around your trip.</span>
                </div>
                <div
                  className="visual-preview-itinerary"
                  style={{
                    borderRadius: resolved.recipe.cardRadius,
                    boxShadow: resolved.recipe.cardShadow,
                  }}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Day 01</span>
                  <span className="font-display text-base mt-1">A first morning in {previewCity}</span>
                  <span className="text-[10px] mt-1" style={{ color: 'var(--ink-muted)' }}>Local streets, a slow start, and one good place to linger.</span>
                  <span
                    className="visual-preview-button mt-3"
                    style={{ borderRadius: recipeButtonRadius(resolved.recipe.buttonShape), backgroundColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                  >
                    Start day 1
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {hasDesignChanges && (
        <button type="button" className="pill-btn pill-ghost" onClick={handleReset}>
          <RotateCcw className="w-4 h-4" />
          {resetLabel}
        </button>
      )}
    </div>
  );
}

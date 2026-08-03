import { useMemo } from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
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

/**
 * Settings for the Adaptive Destination Design System.
 * Intensity always applies; recipe lock is optional (Automatic vs locked family).
 */
export function VisualDesignControls({ profile, onChange, compact = false }: VisualDesignControlsProps) {
  const visual = useMemo(
    () => sanitizeTripVisualDesign(profile.visualDesign, profile.applyVisualIdentity),
    [profile.visualDesign, profile.applyVisualIdentity],
  );
  const resolved = useMemo(() => resolveVisualIdentity(profile), [profile]);

  const setIntensity = (intensity: VisualIdentityIntensity) => {
    onChange(withVisualDesign(profile, { intensity }));
  };

  const setRecipeOverride = (recipeOverride: DesignRecipeId | null) => {
    onChange(withVisualDesign(profile, { recipeOverride }));
  };

  const reset = () => {
    onChange(withVisualDesign(profile, {
      intensity: 'balanced',
      recipeOverride: null,
      paletteOverride: null,
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow mb-2">Personalise the handbook design</div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Adapts colours, typography, cover styling and decorative details to your destination and travel style.
        </p>
      </div>

      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {VISUAL_INTENSITY_OPTIONS.map((option) => {
          const active = visual.intensity === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setIntensity(option.id)}
              className="text-left rounded-2xl px-3 py-3 min-h-16"
              style={{
                backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              }}
              aria-pressed={active}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-[11px] mt-1 leading-snug" style={{ color: 'var(--ink-muted)' }}>
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>

      {visual.intensity !== 'off' && (
        <>
          <div>
            <div className="eyebrow mb-2">Design family</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRecipeOverride(null)}
                className="text-left rounded-2xl px-3 py-3"
                style={{
                  backgroundColor: !visual.recipeOverride ? 'var(--accent-soft)' : 'var(--bg)',
                  border: `1px solid ${!visual.recipeOverride ? 'var(--accent)' : 'var(--border)'}`,
                }}
                aria-pressed={!visual.recipeOverride}
              >
                <span className="block text-sm font-semibold">Automatic</span>
                <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                  Choose from destination and trip style
                </span>
              </button>
              {(Object.keys(DESIGN_RECIPES) as DesignRecipeId[]).map((id) => {
                const recipe = DESIGN_RECIPES[id];
                const active = visual.recipeOverride === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRecipeOverride(id)}
                    className="text-left rounded-2xl px-3 py-3"
                    style={{
                      backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                    aria-pressed={active}
                  >
                    <span className="block text-sm font-semibold">{recipe.label}</span>
                    <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                      {recipe.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="rounded-2xl p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="eyebrow m-0">Live preview</span>
              <span
                className="ml-auto h-5 w-10 rounded-full"
                style={{ backgroundColor: resolved.palette.accent }}
                aria-hidden="true"
              />
            </div>
            <p className="font-display handbook-display text-2xl leading-tight">
              {resolved.recipe.label}
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {resolved.reason}
            </p>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: 'var(--accent-soft)' }}>
                {visual.intensity}
              </span>
              <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: 'var(--accent-soft)' }}>
                {resolved.coverLayout}
              </span>
              <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: 'var(--accent-soft)' }}>
                {resolved.motifSet}
              </span>
              <span className="rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: 'var(--accent-soft)' }}>
                {resolved.recipeSource}
              </span>
            </div>
            <div
              className="trip-surface-card relative p-4 handbook-cover-frame"
              data-cover-layout={resolved.coverLayout}
            >
              <div className="handbook-motif" data-motif={resolved.motifSet} aria-hidden="true" />
              <p className="relative z-[2] text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                Cover sample
              </p>
              <p className="relative z-[2] font-display handbook-display text-xl mt-2">
                {profile.destinations[0]?.city || resolved.country.name || 'Your trip'}
              </p>
            </div>
          </div>
        </>
      )}

      <button type="button" className="pill-btn pill-ghost" onClick={reset}>
        <RotateCcw className="w-4 h-4" />
        Reset design to default
      </button>
    </div>
  );
}

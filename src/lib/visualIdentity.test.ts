import { describe, expect, it } from 'vitest';
import { createEmptyProfile, manualDestination, sanitizeTripProfile, type TripProfile } from './tripProfile';
import {
  DESIGN_RECIPES,
  applyVisualIdentityCss,
  clearVisualIdentityCss,
  resolveVisualIdentity,
  withVisualDesign,
} from './visualIdentity';

const profile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  startDate: '2027-10-04',
  endDate: '2027-10-11',
  dayCount: 8,
  tripTypes: ['relaxation'],
  styles: ['temples', 'cafes'],
  moods: ['slow-living'],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('visual identity recipes', () => {
  it('resolves Kyoto / Japan to quiet editorial', () => {
    const resolved = resolveVisualIdentity(profile());
    expect(resolved.recipe.id).toBe('quiet-editorial');
    expect(resolved.recipeSource).toBe('city');
    expect(resolved.motifSet).toBe('sakura-stamp');
  });

  it('resolves Korea to modern metropolitan', () => {
    const resolved = resolveVisualIdentity(profile({
      destinations: [manualDestination('Seoul', 'South Korea')],
      tripTypes: ['business'],
      moods: ['fast-paced'],
      styles: ['shopping'],
    }));
    expect(resolved.recipe.id).toBe('modern-metropolitan');
  });

  it('resolves Italy to warm postcard', () => {
    const resolved = resolveVisualIdentity(profile({
      destinations: [manualDestination('Rome', 'Italy')],
      tripTypes: ['food'],
      styles: ['street-food'],
      moods: ['romantic'],
    }));
    expect(resolved.recipe.id).toBe('warm-postcard');
  });

  it('resolves Switzerland to nature expedition', () => {
    const resolved = resolveVisualIdentity(profile({
      destinations: [manualDestination('Interlaken', 'Switzerland')],
      tripTypes: ['adventure'],
      styles: ['mountains', 'hiking'],
    }));
    expect(resolved.recipe.id).toBe('nature-expedition');
  });

  it('keeps one primary recipe for a multi-country trip', () => {
    const resolved = resolveVisualIdentity(profile({
      destinations: [
        manualDestination('Tokyo', 'Japan'),
        manualDestination('Tokyo', 'Japan'),
        manualDestination('Seoul', 'South Korea'),
      ],
    }));
    // Tokyo city override wins over country blending.
    expect(resolved.recipe.id).toBe('modern-metropolitan');
    expect(resolved.country.code).toBe('JP');
  });

  it('falls back safely for an unknown destination', () => {
    const resolved = resolveVisualIdentity(profile({
      destinations: [manualDestination('Nowhereville', '')],
      tripTypes: [],
      styles: [],
      moods: [],
    }));
    expect(DESIGN_RECIPES[resolved.recipe.id]).toBeTruthy();
    expect(resolved.palette.accent).toBeTruthy();
  });
});

describe('visual identity intensity', () => {
  it('emits no design tokens when off', () => {
    const resolved = resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'off' }));
    expect(resolved.intensity).toBe('off');
    expect(resolved.cssVars).toEqual({});
    expect(resolved.motifSet).toBe('none');
  });

  it('applies accent only for subtle mode', () => {
    const resolved = resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'subtle' }));
    expect(resolved.cssVars['--accent']).toBeTruthy();
    expect(resolved.cssVars['--card-radius']).toBeUndefined();
    expect(resolved.cssVars['--heading-tracking']).toBeUndefined();
    expect(resolved.coverLayout).toBe('journal');
  });

  it('applies cards and type for balanced mode', () => {
    const resolved = resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'balanced' }));
    expect(resolved.cssVars['--accent']).toBeTruthy();
    expect(resolved.cssVars['--card-radius']).toBe(DESIGN_RECIPES['quiet-editorial'].cardRadius);
    expect(resolved.cssVars['--heading-tracking']).toBeTruthy();
    expect(resolved.coverLayout).toBe('journal');
  });

  it('applies full recipe styling for immersive mode', () => {
    const resolved = resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'immersive' }));
    expect(resolved.cssVars['--card-radius']).toBeTruthy();
    expect(resolved.cssVars['--motif-opacity']).toBeTruthy();
    expect(resolved.cssVars['--image-overlay']).not.toBe('transparent');
    expect(Number(resolved.cssVars['--motif-opacity'])).toBeGreaterThan(
      Number(resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'subtle' })).cssVars['--motif-opacity']),
    );
  });

  it('honours a manual recipe override', () => {
    const resolved = resolveVisualIdentity(withVisualDesign(profile(), {
      intensity: 'balanced',
      recipeOverride: 'nature-expedition',
    }));
    expect(resolved.recipe.id).toBe('nature-expedition');
    expect(resolved.recipeSource).toBe('override');
  });

  it('migrates legacy applyVisualIdentity=false to off', () => {
    const legacy = sanitizeTripProfile({
      ...profile(),
      applyVisualIdentity: false,
      visualDesign: undefined,
    });
    expect(legacy?.visualDesign?.intensity).toBe('off');
    expect(legacy?.applyVisualIdentity).toBe(false);
  });

  it('migrates legacy applyVisualIdentity=true to subtle', () => {
    const legacy = sanitizeTripProfile({
      destinations: [{ city: 'Kyoto', country: 'Japan' }],
      applyVisualIdentity: true,
    });
    expect(legacy?.visualDesign?.intensity).toBe('subtle');
    expect(legacy?.applyVisualIdentity).toBe(true);
  });

  it('defaults new empty profiles to balanced', () => {
    expect(createEmptyProfile().visualDesign?.intensity).toBe('balanced');
  });

  it('reset-via-withVisualDesign restores balanced automatic design', () => {
    const locked = withVisualDesign(profile(), {
      intensity: 'immersive',
      recipeOverride: 'warm-postcard',
    });
    const reset = withVisualDesign(locked, {
      intensity: 'balanced',
      recipeOverride: null,
      paletteOverride: null,
    });
    expect(reset.visualDesign).toEqual({
      intensity: 'balanced',
      recipeOverride: null,
      paletteOverride: null,
    });
    expect(reset.applyVisualIdentity).toBe(true);
  });
});

describe('visual identity CSS application', () => {
  it('writes and clears tokens on a root element', () => {
    const store = {
      values: {} as Record<string, string>,
      attrs: {} as Record<string, string | null>,
    };
    const root = {
      style: {
        setProperty(name: string, value: string) { store.values[name] = value; },
        removeProperty(name: string) { delete store.values[name]; },
        getPropertyValue(name: string) { return store.values[name] || ''; },
      },
      setAttribute(name: string, value: string) { store.attrs[name] = value; },
      removeAttribute(name: string) { store.attrs[name] = null; },
      getAttribute(name: string) { return store.attrs[name] ?? null; },
    } as unknown as HTMLElement;

    const resolved = resolveVisualIdentity(withVisualDesign(profile(), { intensity: 'balanced' }));
    applyVisualIdentityCss(resolved, root);
    expect(root.style.getPropertyValue('--accent')).toBeTruthy();
    expect(root.getAttribute('data-design-recipe')).toBe('quiet-editorial');
    expect(root.getAttribute('data-visual-intensity')).toBe('balanced');

    clearVisualIdentityCss(root);
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.getAttribute('data-design-recipe')).toBeNull();
  });

  it('uses dark palette accents in dark theme', () => {
    const light = resolveVisualIdentity(profile(), { theme: 'light' });
    const dark = resolveVisualIdentity(profile(), { theme: 'dark' });
    expect(light.cssVars['--accent']).toBe(light.palette.accent);
    expect(dark.cssVars['--accent']).toBe(dark.palette.darkAccent);
  });
});

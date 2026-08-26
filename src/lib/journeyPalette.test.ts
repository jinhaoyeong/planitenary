// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNEY_PALETTE,
  JOURNEY_PALETTES,
  JOURNEY_PALETTE_STORAGE_KEY,
  applyJourneyPalette,
  loadJourneyPalette,
  normalizeJourneyPalette,
  saveJourneyPalette,
} from './journeyPalette';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-journey-palette');
});

describe('choosing a journey palette', () => {
  it('starts on the shipped editorial identity', () => {
    expect(loadJourneyPalette()).toBe(DEFAULT_JOURNEY_PALETTE);
    expect(DEFAULT_JOURNEY_PALETTE).toBe('journey-green');
  });

  it('remembers the chosen palette across loads', () => {
    saveJourneyPalette('ink-navy');
    expect(loadJourneyPalette()).toBe('ink-navy');
  });

  it('falls back to the default when the stored value is not a palette', () => {
    window.localStorage.setItem(JOURNEY_PALETTE_STORAGE_KEY, 'chartreuse-disco');
    expect(loadJourneyPalette()).toBe(DEFAULT_JOURNEY_PALETTE);
  });

  it.each([null, undefined, 42, {}])('normalizes %p to the default', (value) => {
    expect(normalizeJourneyPalette(value)).toBe(DEFAULT_JOURNEY_PALETTE);
  });
});

describe('applying a palette to the document', () => {
  it('writes the palette as an attribute so it composes with the theme', () => {
    applyJourneyPalette('vermilion');
    expect(document.documentElement.getAttribute('data-journey-palette')).toBe('vermilion');
  });

  it('never writes an unknown palette onto the document', () => {
    applyJourneyPalette('not-a-palette' as never);
    expect(document.documentElement.getAttribute('data-journey-palette')).toBe(DEFAULT_JOURNEY_PALETTE);
  });

  it('leaves the theme attribute untouched', () => {
    document.documentElement.dataset.theme = 'dark';
    applyJourneyPalette('warm-sand');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('the palette catalogue', () => {
  it('offers a real choice with unique ids', () => {
    const ids = JOURNEY_PALETTES.map((palette) => palette.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every palette a label, a description and three swatches', () => {
    for (const palette of JOURNEY_PALETTES) {
      expect(palette.label.length).toBeGreaterThan(0);
      expect(palette.description.length).toBeGreaterThan(0);
      expect(palette.swatches).toHaveLength(3);
      for (const swatch of palette.swatches) {
        expect(swatch).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

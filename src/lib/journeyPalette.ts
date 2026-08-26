import { safeGetItem, safeSetItem } from './safeLocalStorage';

/**
 * Colour palettes for the editorial journey redesign.
 *
 * The redesign shipped with a single ink-green identity. The palette chosen
 * here only swaps the character-defining tokens — paper, ink, line, accent —
 * so the signal colours (route warnings, verified badges) keep one consistent
 * meaning across every palette. Light and dark are handled by the existing
 * theme switch; a palette is a separate axis on top of it.
 */

export const JOURNEY_PALETTE_STORAGE_KEY = 'journey-palette';

export type JourneyPaletteId = 'journey-green' | 'warm-sand' | 'ink-navy' | 'vermilion';

export interface JourneyPaletteOption {
  id: JourneyPaletteId;
  label: string;
  description: string;
  /** Representative swatches for the picker: paper, accent, ink. */
  swatches: [string, string, string];
}

export const JOURNEY_PALETTES: JourneyPaletteOption[] = [
  {
    id: 'journey-green',
    label: 'Journey green',
    description: 'Warm paper with ink-green type. The original editorial identity.',
    swatches: ['#f6f1e8', '#174b38', '#102f26'],
  },
  {
    id: 'warm-sand',
    label: 'Warm sand',
    description: 'Sun-bleached paper and a soft leather accent, with no green.',
    swatches: ['#f7f2e9', '#9a6b3f', '#3b2d1d'],
  },
  {
    id: 'ink-navy',
    label: 'Ink navy',
    description: 'Cool paper and deep navy ink, closer to a printed atlas.',
    swatches: ['#f4f6f8', '#1f4e79', '#14263c'],
  },
  {
    id: 'vermilion',
    label: 'Vermilion',
    description: 'Warm cream with a red lacquer accent for a bolder feel.',
    swatches: ['#fbf5ef', '#b8442c', '#3a2320'],
  },
];

export const DEFAULT_JOURNEY_PALETTE: JourneyPaletteId = 'journey-green';

const VALID_IDS = new Set<string>(JOURNEY_PALETTES.map((palette) => palette.id));

/** Unknown or corrupted stored values fall back to the shipped identity. */
export const normalizeJourneyPalette = (value: unknown): JourneyPaletteId =>
  typeof value === 'string' && VALID_IDS.has(value)
    ? (value as JourneyPaletteId)
    : DEFAULT_JOURNEY_PALETTE;

export const loadJourneyPalette = (): JourneyPaletteId =>
  normalizeJourneyPalette(safeGetItem(JOURNEY_PALETTE_STORAGE_KEY));

export const saveJourneyPalette = (palette: JourneyPaletteId): void => {
  safeSetItem(JOURNEY_PALETTE_STORAGE_KEY, palette);
};

/**
 * The palette is an attribute rather than a class so it can sit alongside the
 * theme attribute without either one having to know about the other.
 */
export const applyJourneyPalette = (palette: JourneyPaletteId): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.journeyPalette = normalizeJourneyPalette(palette);
};

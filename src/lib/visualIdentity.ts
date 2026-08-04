/**
 * Adaptive Destination Design System.
 *
 * Selects from approved design recipes and CSS tokens. Never invents arbitrary
 * layout CSS. Intensity controls how much of the recipe is applied; navigation,
 * reading order and form behaviour stay stable.
 */

import type { DestinationPalette } from './destinations';
import {
  countryOrFallback,
  findCountry,
  type CountryProfile,
} from './destinations';
import {
  applyVisualIdentityFromIntensity,
  isDesignRecipeId,
  primaryCountry,
  resolveSeason,
  sanitizeTripVisualDesign,
  type DesignRecipeId,
  type Season,
  type TripMood,
  type TripProfile,
  type TravelStyle,
  type TripType,
  type TripVisualDesign,
  type VisualIdentityIntensity,
} from './tripProfile';

export type {
  DesignRecipeId,
  TripVisualDesign,
  VisualIdentityIntensity,
} from './tripProfile';

export {
  applyVisualIdentityFromIntensity,
  defaultVisualDesignForNewTrip,
  intensityFromLegacy,
  isDesignRecipeId,
  isVisualIdentityIntensity,
  sanitizeTripVisualDesign,
} from './tripProfile';

export type DensityToken = 'compact' | 'balanced' | 'spacious';
export type ButtonShapeToken = 'pill' | 'rounded' | 'square';
export type DividerToken = 'solid' | 'ornamental' | 'dotted';
export type BorderStyleToken = 'solid' | 'dotted' | 'double';
export type TabShapeToken = 'pill' | 'rounded' | 'square' | 'ticket';
export type BadgeShapeToken = 'circle' | 'rounded-square' | 'stamp';
export type IconTileShapeToken = 'circle' | 'rounded-square' | 'square';
export type MotionToken = 'gentle' | 'quick' | 'soft' | 'still';
export type CoverLayoutToken = 'journal' | 'postcard' | 'metro' | 'expedition';
export type ImageTreatmentToken = 'muted-paper' | 'warm-postcard' | 'crisp' | 'cool-clean';
export type MotifSetId =
  | 'sakura-stamp'
  | 'metro-grid'
  | 'postcard-arch'
  | 'alpine-line'
  | 'none';

export interface DesignRecipe {
  id: DesignRecipeId;
  label: string;
  hint: string;
  headingTracking: string;
  headingTransform: 'none' | 'uppercase';
  cardRadius: string;
  cardShadow: string;
  buttonShape: ButtonShapeToken;
  radiusPagePanel: string;
  radiusSection: string;
  radiusCard: string;
  radiusCompactCard: string;
  radiusButton: string;
  radiusControl: string;
  radiusChip: string;
  radiusTab: string;
  radiusInput: string;
  radiusModal: string;
  radiusMedia: string;
  radiusIconTile: string;
  borderWidthSurface: string;
  borderWidthControl: string;
  borderStyle: BorderStyleToken;
  panelShadow: string;
  floatingShadow: string;
  tabShape: TabShapeToken;
  badgeShape: BadgeShapeToken;
  iconTileShape: IconTileShapeToken;
  dividerStyle: DividerToken;
  density: DensityToken;
  motifSet: MotifSetId;
  coverLayout: CoverLayoutToken;
  imageTreatment: ImageTreatmentToken;
  motion: MotionToken;
  /** Relative content spacing multiplier (1 = default). */
  densityScale: number;
  motifOpacitySubtle: number;
  motifOpacityBalanced: number;
  motifOpacityImmersive: number;
  motionDurationMs: number;
}

export const DESIGN_RECIPES: Record<DesignRecipeId, DesignRecipe> = {
  'quiet-editorial': {
    id: 'quiet-editorial',
    label: 'Quiet Editorial',
    hint: 'Restrained serif display, soft paper cards, gentle motion.',
    headingTracking: '-0.025em',
    headingTransform: 'none',
    cardRadius: '1.75rem',
    cardShadow: '0 1px 0 rgba(15,14,13,0.03), 0 18px 42px -20px rgba(15,14,13,0.16)',
    buttonShape: 'pill',
    radiusPagePanel: '1.75rem',
    radiusSection: '1.5rem',
    radiusCard: '1.5rem',
    radiusCompactCard: '1rem',
    radiusButton: '9999px',
    radiusControl: '9999px',
    radiusChip: '9999px',
    radiusTab: '9999px',
    radiusInput: '1rem',
    radiusModal: '1.75rem',
    radiusMedia: '1.5rem',
    radiusIconTile: '9999px',
    borderWidthSurface: '1px',
    borderWidthControl: '1px',
    borderStyle: 'solid',
    panelShadow: '0 1px 0 rgba(15,14,13,0.03), 0 22px 52px -24px rgba(15,14,13,0.18)',
    floatingShadow: '0 12px 28px -12px rgba(15,14,13,0.22)',
    tabShape: 'pill',
    badgeShape: 'circle',
    iconTileShape: 'circle',
    dividerStyle: 'solid',
    density: 'spacious',
    motifSet: 'sakura-stamp',
    coverLayout: 'journal',
    imageTreatment: 'muted-paper',
    motion: 'gentle',
    densityScale: 1.12,
    motifOpacitySubtle: 0.06,
    motifOpacityBalanced: 0.14,
    motifOpacityImmersive: 0.26,
    motionDurationMs: 720,
  },
  'modern-metropolitan': {
    id: 'modern-metropolitan',
    label: 'Modern Metropolitan',
    hint: 'Clean spacing, sharper cards, quicker motion.',
    headingTracking: '-0.045em',
    headingTransform: 'none',
    cardRadius: '0.5rem',
    cardShadow: '0 0 0 1px rgba(15,14,13,0.06), 0 8px 20px -14px rgba(15,14,13,0.18)',
    buttonShape: 'rounded',
    radiusPagePanel: '0.75rem',
    radiusSection: '0.65rem',
    radiusCard: '0.5rem',
    radiusCompactCard: '0.4rem',
    radiusButton: '0.45rem',
    radiusControl: '0.45rem',
    radiusChip: '0.35rem',
    radiusTab: '0.4rem',
    radiusInput: '0.4rem',
    radiusModal: '0.75rem',
    radiusMedia: '0.35rem',
    radiusIconTile: '0.4rem',
    borderWidthSurface: '1px',
    borderWidthControl: '1px',
    borderStyle: 'solid',
    panelShadow: '0 0 0 1px rgba(15,14,13,0.06), 0 12px 28px -18px rgba(15,14,13,0.2)',
    floatingShadow: '0 10px 22px -14px rgba(15,14,13,0.24)',
    tabShape: 'rounded',
    badgeShape: 'rounded-square',
    iconTileShape: 'rounded-square',
    dividerStyle: 'solid',
    density: 'compact',
    motifSet: 'metro-grid',
    coverLayout: 'metro',
    imageTreatment: 'cool-clean',
    motion: 'quick',
    densityScale: 0.88,
    motifOpacitySubtle: 0.04,
    motifOpacityBalanced: 0.1,
    motifOpacityImmersive: 0.18,
    motionDurationMs: 380,
  },
  'warm-postcard': {
    id: 'warm-postcard',
    label: 'Warm Postcard',
    hint: 'Romantic headings, postcard borders, soft paper shadow.',
    headingTracking: '-0.01em',
    headingTransform: 'none',
    cardRadius: '1.25rem',
    cardShadow: '0 3px 0 rgba(15,14,13,0.05), 0 22px 44px -18px rgba(15,14,13,0.24)',
    buttonShape: 'rounded',
    radiusPagePanel: '1.25rem',
    radiusSection: '1.1rem',
    radiusCard: '1rem',
    radiusCompactCard: '0.75rem',
    radiusButton: '0.75rem',
    radiusControl: '0.75rem',
    radiusChip: '9999px',
    radiusTab: '0.75rem',
    radiusInput: '0.75rem',
    radiusModal: '1.25rem',
    radiusMedia: '0.25rem',
    radiusIconTile: '0.75rem',
    borderWidthSurface: '1px',
    borderWidthControl: '1px',
    borderStyle: 'double',
    panelShadow: '0 3px 0 rgba(15,14,13,0.05), 0 26px 50px -20px rgba(15,14,13,0.24)',
    floatingShadow: '0 14px 30px -14px rgba(15,14,13,0.28)',
    tabShape: 'ticket',
    badgeShape: 'stamp',
    iconTileShape: 'rounded-square',
    dividerStyle: 'ornamental',
    density: 'balanced',
    motifSet: 'postcard-arch',
    coverLayout: 'postcard',
    imageTreatment: 'warm-postcard',
    motion: 'soft',
    densityScale: 1.02,
    motifOpacitySubtle: 0.08,
    motifOpacityBalanced: 0.18,
    motifOpacityImmersive: 0.3,
    motionDurationMs: 640,
  },
  'nature-expedition': {
    id: 'nature-expedition',
    label: 'Nature Expedition',
    hint: 'Structured labels, crisp cards, landscape-forward cover.',
    headingTracking: '0.06em',
    headingTransform: 'uppercase',
    cardRadius: '0.35rem',
    cardShadow: '0 1px 0 rgba(15,14,13,0.08), 0 14px 28px -14px rgba(15,14,13,0.28)',
    buttonShape: 'square',
    radiusPagePanel: '0.45rem',
    radiusSection: '0.4rem',
    radiusCard: '0.3rem',
    radiusCompactCard: '0.25rem',
    radiusButton: '0.25rem',
    radiusControl: '0.25rem',
    radiusChip: '0.2rem',
    radiusTab: '0.3rem',
    radiusInput: '0.25rem',
    radiusModal: '0.4rem',
    radiusMedia: '0.15rem',
    radiusIconTile: '0.15rem',
    borderWidthSurface: '2px',
    borderWidthControl: '1px',
    borderStyle: 'solid',
    panelShadow: '0 1px 0 rgba(15,14,13,0.08), 0 16px 32px -16px rgba(15,14,13,0.28)',
    floatingShadow: '0 12px 26px -12px rgba(15,14,13,0.32)',
    tabShape: 'square',
    badgeShape: 'rounded-square',
    iconTileShape: 'square',
    dividerStyle: 'dotted',
    density: 'balanced',
    motifSet: 'alpine-line',
    coverLayout: 'expedition',
    imageTreatment: 'crisp',
    motion: 'gentle',
    densityScale: 1,
    motifOpacitySubtle: 0.05,
    motifOpacityBalanced: 0.12,
    motifOpacityImmersive: 0.22,
    motionDurationMs: 540,
  },
};

export const VISUAL_INTENSITY_OPTIONS: Array<{
  id: VisualIdentityIntensity;
  label: string;
  hint: string;
}> = [
  { id: 'off', label: 'Off', hint: 'Standard app design' },
  { id: 'subtle', label: 'Subtle', hint: 'Mostly original — destination accent only' },
  { id: 'balanced', label: 'Balanced', hint: 'Noticeably personalised cards and cover' },
  { id: 'immersive', label: 'Immersive', hint: 'Stronger destination-led cover and surfaces' },
];

/** Country → base recipe. Unknown countries fall back in the resolver. */
const COUNTRY_RECIPE: Record<string, DesignRecipeId> = {
  JP: 'quiet-editorial',
  KR: 'modern-metropolitan',
  SG: 'modern-metropolitan',
  CN: 'quiet-editorial',
  TW: 'quiet-editorial',
  HK: 'modern-metropolitan',
  TH: 'warm-postcard',
  VN: 'warm-postcard',
  MY: 'warm-postcard',
  ID: 'nature-expedition',
  PH: 'warm-postcard',
  IN: 'warm-postcard',
  NP: 'nature-expedition',
  LK: 'nature-expedition',
  MV: 'warm-postcard',
  PT: 'warm-postcard',
  ES: 'warm-postcard',
  IT: 'warm-postcard',
  FR: 'quiet-editorial',
  GR: 'warm-postcard',
  TR: 'warm-postcard',
  AE: 'modern-metropolitan',
  GB: 'modern-metropolitan',
  IE: 'quiet-editorial',
  NL: 'modern-metropolitan',
  BE: 'quiet-editorial',
  DE: 'modern-metropolitan',
  CH: 'nature-expedition',
  AT: 'nature-expedition',
  SE: 'modern-metropolitan',
  NO: 'nature-expedition',
  DK: 'modern-metropolitan',
  FI: 'modern-metropolitan',
  IS: 'nature-expedition',
  US: 'modern-metropolitan',
  CA: 'nature-expedition',
  MX: 'warm-postcard',
  BR: 'warm-postcard',
  AR: 'warm-postcard',
  PE: 'nature-expedition',
  CL: 'nature-expedition',
  AU: 'nature-expedition',
  NZ: 'nature-expedition',
};

/** City overrides where local character differs from the country base. */
const CITY_RECIPE: Record<string, DesignRecipeId> = {
  kyoto: 'quiet-editorial',
  tokyo: 'modern-metropolitan',
  osaka: 'modern-metropolitan',
  seoul: 'modern-metropolitan',
  busan: 'modern-metropolitan',
  singapore: 'modern-metropolitan',
  'new york': 'modern-metropolitan',
  nyc: 'modern-metropolitan',
  paris: 'quiet-editorial',
  rome: 'warm-postcard',
  florence: 'warm-postcard',
  venice: 'warm-postcard',
  barcelona: 'warm-postcard',
  lisbon: 'warm-postcard',
  zurich: 'nature-expedition',
  geneva: 'nature-expedition',
  interlaken: 'nature-expedition',
  queenstown: 'nature-expedition',
  banff: 'nature-expedition',
  kuala: 'warm-postcard',
};

const QUIET_TYPES = new Set<TripType>(['relaxation', 'couple', 'solo', 'luxury']);
const METRO_TYPES = new Set<TripType>(['business', 'friends']);
const POSTCARD_TYPES = new Set<TripType>(['food', 'family', 'photography']);
const EXPEDITION_TYPES = new Set<TripType>(['adventure']);

const QUIET_MOODS = new Set<TripMood>(['calm', 'slow-living', 'romantic', 'minimal']);
const METRO_MOODS = new Set<TripMood>(['fast-paced']);
const EXPEDITION_MOODS = new Set<TripMood>(['festive']);

const QUIET_STYLES = new Set<TravelStyle>(['temples', 'cafes', 'museums', 'history']);
const METRO_STYLES = new Set<TravelStyle>(['shopping', 'nightlife', 'architecture', 'anime']);
const POSTCARD_STYLES = new Set<TravelStyle>(['street-food', 'beaches', 'night-markets']);
const EXPEDITION_STYLES = new Set<TravelStyle>(['mountains', 'hiking', 'nature', 'wildlife', 'scenic-train']);

export interface ResolvedVisualIdentity {
  intensity: VisualIdentityIntensity;
  recipe: DesignRecipe;
  recipeSource: 'override' | 'city' | 'country' | 'trip-personality' | 'fallback';
  country: CountryProfile;
  palette: DestinationPalette;
  season: Season | null;
  reason: string;
  /** CSS custom properties ready to apply (empty when intensity is off). */
  cssVars: Record<string, string>;
  coverLayout: CoverLayoutToken;
  imageTreatment: ImageTreatmentToken;
  motifSet: MotifSetId;
  density: DensityToken;
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}

function recipeFromCity(cities: string[]): DesignRecipeId | null {
  for (const city of cities) {
    const key = normalizeCity(city);
    if (CITY_RECIPE[key]) return CITY_RECIPE[key];
    const hit = Object.entries(CITY_RECIPE).find(([needle]) => key.includes(needle));
    if (hit) return hit[1];
  }
  return null;
}

function recipeFromCountry(country: CountryProfile): DesignRecipeId | null {
  return COUNTRY_RECIPE[country.code] ?? null;
}

function scoreRecipe(profile: TripProfile): DesignRecipeId | null {
  const scores: Record<DesignRecipeId, number> = {
    'quiet-editorial': 0,
    'modern-metropolitan': 0,
    'warm-postcard': 0,
    'nature-expedition': 0,
  };

  for (const type of profile.tripTypes) {
    if (QUIET_TYPES.has(type)) scores['quiet-editorial'] += 2;
    if (METRO_TYPES.has(type)) scores['modern-metropolitan'] += 2;
    if (POSTCARD_TYPES.has(type)) scores['warm-postcard'] += 2;
    if (EXPEDITION_TYPES.has(type)) scores['nature-expedition'] += 2;
  }
  for (const mood of profile.moods) {
    if (QUIET_MOODS.has(mood)) scores['quiet-editorial'] += 2;
    if (METRO_MOODS.has(mood)) scores['modern-metropolitan'] += 2;
    if (mood === 'luxury' || mood === 'romantic') scores['warm-postcard'] += 1;
    if (EXPEDITION_MOODS.has(mood)) scores['nature-expedition'] += 1;
  }
  for (const style of profile.styles) {
    if (QUIET_STYLES.has(style)) scores['quiet-editorial'] += 1;
    if (METRO_STYLES.has(style)) scores['modern-metropolitan'] += 1;
    if (POSTCARD_STYLES.has(style)) scores['warm-postcard'] += 1;
    if (EXPEDITION_STYLES.has(style)) scores['nature-expedition'] += 1;
  }

  const ranked = (Object.entries(scores) as Array<[DesignRecipeId, number]>)
    .sort((left, right) => right[1] - left[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : null;
}

function seasonNudgesRecipe(recipe: DesignRecipeId, season: Season | null): DesignRecipeId {
  if (!season) return recipe;
  if (season === 'winter' && recipe === 'warm-postcard') return 'quiet-editorial';
  return recipe;
}

function motifOpacity(recipe: DesignRecipe, intensity: VisualIdentityIntensity): number {
  if (intensity === 'off') return 0;
  if (intensity === 'subtle') return recipe.motifOpacitySubtle;
  if (intensity === 'balanced') return recipe.motifOpacityBalanced;
  return recipe.motifOpacityImmersive;
}

function imageOverlay(treatment: ImageTreatmentToken, intensity: VisualIdentityIntensity): string {
  if (intensity === 'off' || intensity === 'subtle') return 'transparent';
  const strength = intensity === 'immersive' ? 0.28 : 0.12;
  switch (treatment) {
    case 'muted-paper':
      return `color-mix(in srgb, #F4EFE6 ${Math.round(strength * 100)}%, transparent)`;
    case 'warm-postcard':
      return `color-mix(in srgb, #E8B07A ${Math.round(strength * 100)}%, transparent)`;
    case 'crisp':
      return `color-mix(in srgb, #0F0E0D ${Math.round(strength * 55)}%, transparent)`;
    case 'cool-clean':
      return `color-mix(in srgb, #A8C4D8 ${Math.round(strength * 100)}%, transparent)`;
    default:
      return 'transparent';
  }
}

function readableInk(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#0F0E0D';
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? '#0F0E0D' : '#FFFFFF';
}

function darkCardShadow(recipe: DesignRecipe): string {
  if (recipe.id === 'modern-metropolitan') {
    return '0 0 0 1px rgba(255,255,255,0.06), 0 10px 24px -16px rgba(0,0,0,0.55)';
  }
  if (recipe.id === 'warm-postcard') {
    return '0 3px 0 rgba(255,255,255,0.04), 0 22px 44px -18px rgba(0,0,0,0.55)';
  }
  if (recipe.id === 'nature-expedition') {
    return '0 1px 0 rgba(255,255,255,0.05), 0 16px 30px -14px rgba(0,0,0,0.6)';
  }
  return '0 1px 0 rgba(255,255,255,0.04), 0 18px 42px -20px rgba(0,0,0,0.5)';
}

function buildCssVars(
  intensity: VisualIdentityIntensity,
  recipe: DesignRecipe,
  palette: DestinationPalette,
  theme: 'light' | 'dark',
): Record<string, string> {
  if (intensity === 'off') return {};

  const accent = theme === 'dark' ? palette.darkAccent : palette.accent;
  const accentSoft = theme === 'dark' ? palette.darkAccentSoft : palette.accentSoft;
  const applyType = intensity === 'balanced' || intensity === 'immersive';
  const applyCards = intensity === 'balanced' || intensity === 'immersive';
  const applyMotion = intensity === 'balanced' || intensity === 'immersive';
  const coverMotif = motifOpacity(recipe, intensity);
  const surfaceMotif = coverMotif * (intensity === 'immersive' ? 0.28 : 0.18);
  const themeMotifScale = theme === 'dark' ? 0.85 : 1;

  const vars: Record<string, string> = {
    '--accent': accent,
    '--accent-soft': accentSoft,
    '--accent-ink': readableInk(accent),
    '--accent-button': accent,
    '--accent-fill': accent,
    '--motif-opacity': String(coverMotif * themeMotifScale),
    '--motif-opacity-surface': String(surfaceMotif * themeMotifScale),
  };

  if (applyType) {
    vars['--heading-tracking'] = recipe.headingTracking;
    vars['--heading-transform'] = recipe.headingTransform;
    vars['--heading-size-scale'] = intensity === 'immersive' ? '1.04' : '1';
    vars['--image-overlay'] = imageOverlay(recipe.imageTreatment, intensity);
    vars['--cover-layout'] = recipe.coverLayout;
  }

  if (applyCards) {
    const cardShadow = theme === 'dark' ? darkCardShadow(recipe) : recipe.cardShadow;
    const panelShadow = theme === 'dark' ? darkCardShadow(recipe) : recipe.panelShadow;
    const floatingShadow = theme === 'dark' ? darkCardShadow(recipe) : recipe.floatingShadow;
    vars['--radius-page-panel'] = recipe.radiusPagePanel;
    vars['--radius-section'] = recipe.radiusSection;
    vars['--radius-card'] = recipe.radiusCard;
    vars['--radius-compact-card'] = recipe.radiusCompactCard;
    vars['--radius-button'] = recipe.radiusButton;
    vars['--radius-control'] = recipe.radiusControl;
    vars['--radius-chip'] = recipe.radiusChip;
    vars['--radius-tab'] = recipe.radiusTab;
    vars['--radius-input'] = recipe.radiusInput;
    vars['--radius-modal'] = recipe.radiusModal;
    vars['--radius-media'] = recipe.radiusMedia;
    vars['--radius-icon-tile'] = recipe.radiusIconTile;
    vars['--border-width-surface'] = intensity === 'immersive'
      ? (recipe.id === 'warm-postcard' || recipe.id === 'nature-expedition' ? '2px' : recipe.borderWidthSurface)
      : recipe.borderWidthSurface;
    vars['--border-width-control'] = recipe.borderWidthControl;
    vars['--border-style'] = recipe.borderStyle;
    vars['--shadow-panel'] = panelShadow;
    vars['--shadow-card'] = cardShadow;
    vars['--shadow-floating'] = floatingShadow;
    vars['--tab-shape'] = recipe.tabShape;
    vars['--badge-shape'] = recipe.badgeShape;
    vars['--icon-tile-shape'] = recipe.iconTileShape;
    vars['--radius-full'] = recipe.radiusChip;

    // Legacy aliases remain available for the preview and existing primitives.
    vars['--card-radius'] = recipe.cardRadius;
    vars['--card-shadow'] = cardShadow;
    vars['--button-radius'] = recipe.radiusButton;
    vars['--content-density'] = String(
      intensity === 'immersive' ? recipe.densityScale * 1.04 : recipe.densityScale,
    );
    vars['--card-border-width'] = intensity === 'immersive'
      ? (recipe.id === 'warm-postcard' || recipe.id === 'nature-expedition' ? '2px' : '1.5px')
      : '1px';
    vars['--cover-frame-padding'] = intensity === 'immersive'
      ? (recipe.coverLayout === 'postcard' ? '0.75rem' : '0.35rem')
      : '0px';
  }

  if (applyMotion) {
    vars['--motion-duration'] = `${recipe.motionDurationMs}ms`;
  }

  return vars;
}

export interface ResolveVisualIdentityOptions {
  theme?: 'light' | 'dark';
}

/**
 * Resolve an approved visual identity from destination + trip personality.
 * City → country → trip personality → generic fallback, with optional lock.
 */
export function resolveVisualIdentity(
  profile: TripProfile,
  options: ResolveVisualIdentityOptions = {},
): ResolvedVisualIdentity {
  const theme = options.theme ?? 'light';
  const visual = sanitizeTripVisualDesign(profile.visualDesign, profile.applyVisualIdentity);
  const intensity = visual.intensity;
  const countryName = primaryCountry(profile);
  const country = countryOrFallback(countryName || profile.destinations[0]?.countryCode);
  const firstPoint = profile.destinations.find((destination) => typeof destination.lat === 'number');
  const season = resolveSeason(profile.startDate, firstPoint?.lat);
  const cities = profile.destinations.map((destination) => destination.city).filter(Boolean);

  let recipeId: DesignRecipeId = 'quiet-editorial';
  let recipeSource: ResolvedVisualIdentity['recipeSource'] = 'fallback';
  let reason = 'Generic travel handbook styling.';

  if (visual.recipeOverride && isDesignRecipeId(visual.recipeOverride)) {
    recipeId = visual.recipeOverride;
    recipeSource = 'override';
    reason = `Manual recipe: ${DESIGN_RECIPES[recipeId].label}.`;
  } else {
    const cityRecipe = recipeFromCity(cities);
    const countryRecipe = recipeFromCountry(country);
    const personalityRecipe = scoreRecipe(profile);

    if (cityRecipe) {
      recipeId = cityRecipe;
      recipeSource = 'city';
      reason = `${cities[0]} suggested ${DESIGN_RECIPES[recipeId].label}.`;
    } else if (countryRecipe) {
      recipeId = countryRecipe;
      recipeSource = 'country';
      reason = `${country.name} suggested ${DESIGN_RECIPES[recipeId].label}.`;
    } else if (personalityRecipe) {
      recipeId = personalityRecipe;
      recipeSource = 'trip-personality';
      reason = `Trip style suggested ${DESIGN_RECIPES[recipeId].label}.`;
    }

    const nudged = seasonNudgesRecipe(recipeId, season);
    if (nudged !== recipeId) {
      recipeId = nudged;
      reason += season ? ` Season (${season}) softened the recipe.` : '';
    }

    if (personalityRecipe && recipeSource === 'country') {
      if (
        (personalityRecipe === 'nature-expedition' && profile.styles.some((style) => EXPEDITION_STYLES.has(style)))
        || (personalityRecipe === 'modern-metropolitan' && profile.moods.includes('fast-paced'))
      ) {
        recipeId = personalityRecipe;
        recipeSource = 'trip-personality';
        reason = `Trip personality overrode the country base toward ${DESIGN_RECIPES[recipeId].label}.`;
      }
    }
  }

  const recipe = DESIGN_RECIPES[recipeId];

  return {
    intensity,
    recipe,
    recipeSource,
    country,
    palette: country.palette,
    season,
    reason,
    cssVars: buildCssVars(intensity, recipe, country.palette, theme),
    coverLayout: intensity === 'off' || intensity === 'subtle' ? 'journal' : recipe.coverLayout,
    imageTreatment: intensity === 'off' || intensity === 'subtle' ? 'muted-paper' : recipe.imageTreatment,
    motifSet: intensity === 'off' ? 'none' : recipe.motifSet,
    density: intensity === 'off' || intensity === 'subtle' ? 'balanced' : recipe.density,
  };
}

/** CSS variable names this system may write — cleared when intensity is off. */
export const VISUAL_IDENTITY_CSS_VARS = [
  '--accent',
  '--accent-soft',
  '--accent-ink',
  '--accent-button',
  '--accent-fill',
  '--heading-tracking',
  '--heading-transform',
  '--heading-size-scale',
  '--card-radius',
  '--card-shadow',
  '--button-radius',
  '--radius-page-panel',
  '--radius-section',
  '--radius-card',
  '--radius-compact-card',
  '--radius-button',
  '--radius-control',
  '--radius-chip',
  '--radius-tab',
  '--radius-input',
  '--radius-modal',
  '--radius-media',
  '--radius-icon-tile',
  '--radius-full',
  '--border-width-surface',
  '--border-width-control',
  '--border-style',
  '--shadow-panel',
  '--shadow-card',
  '--shadow-floating',
  '--tab-shape',
  '--badge-shape',
  '--icon-tile-shape',
  '--content-density',
  '--card-border-width',
  '--cover-frame-padding',
  '--motif-opacity',
  '--motif-opacity-surface',
  '--image-overlay',
  '--cover-layout',
  '--motion-duration',
] as const;

export function clearVisualIdentityCss(root: HTMLElement = document.documentElement) {
  for (const name of VISUAL_IDENTITY_CSS_VARS) {
    root.style.removeProperty(name);
  }
  root.removeAttribute('data-visual-intensity');
  root.removeAttribute('data-design-recipe');
  root.removeAttribute('data-cover-layout');
  root.removeAttribute('data-motif-set');
  root.removeAttribute('data-image-treatment');
}

export function applyVisualIdentityCss(
  resolved: ResolvedVisualIdentity,
  root: HTMLElement = document.documentElement,
) {
  clearVisualIdentityCss(root);
  if (resolved.intensity === 'off') {
    root.setAttribute('data-visual-intensity', 'off');
    return;
  }

  for (const [name, value] of Object.entries(resolved.cssVars)) {
    root.style.setProperty(name, value);
  }
  root.setAttribute('data-visual-intensity', resolved.intensity);
  root.setAttribute('data-design-recipe', resolved.recipe.id);
  root.setAttribute('data-cover-layout', resolved.coverLayout);
  root.setAttribute('data-motif-set', resolved.motifSet);
  root.setAttribute('data-image-treatment', resolved.imageTreatment);
}

export function withVisualDesign(
  profile: TripProfile,
  patch: Partial<TripVisualDesign>,
): TripProfile {
  const current = sanitizeTripVisualDesign(profile.visualDesign, profile.applyVisualIdentity);
  const next: TripVisualDesign = {
    intensity: patch.intensity ?? current.intensity,
    recipeOverride: patch.recipeOverride === undefined ? current.recipeOverride : patch.recipeOverride,
    paletteOverride: patch.paletteOverride === undefined ? current.paletteOverride : patch.paletteOverride,
  };
  return {
    ...profile,
    visualDesign: next,
    applyVisualIdentity: applyVisualIdentityFromIntensity(next.intensity),
  };
}

export function countryRecipeHint(countryQuery: string): DesignRecipeId {
  const country = findCountry(countryQuery);
  if (!country) return 'quiet-editorial';
  return recipeFromCountry(country) ?? 'quiet-editorial';
}

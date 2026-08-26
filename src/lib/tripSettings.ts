import type { CSSProperties } from 'react';

export interface TripCopyLabels {
  itineraryTab: string;
  mapsTab: string;
  draftTab: string;
  budgetTab: string;
  checklistTab: string;
  documentsTab: string;
  photosTab: string;
  searchPlaceholder: string;
  overviewEyebrow: string;
  overviewIntroFilled: string;
  overviewIntroEmpty: string;
  backToOverview: string;
  customizePlan: string;
  doneCustomizing: string;
  resetPlan: string;
  photosButton: string;
  dayLabel: string;
  daysLabel: string;
  currentLocationLabel: string;
  spotsSuffix: string;
  openMapLabel: string;
  activityPhotosLabel: string;
  deleteActivityLabel: string;
  deleteActivityConfirm: string;
}

export interface TripThemeSettings {
  bg: string;
  bgElevated: string;
  ink: string;
  inkMuted: string;
  accent: string;
  accentSoft: string;
}

export type ThemeMode = 'light' | 'dark';

export interface ThemePalettePreset {
  id: string;
  name: string;
  description: string;
  light: TripThemeSettings;
  dark: TripThemeSettings;
}

export const DEFAULT_LIGHT_THEME: TripThemeSettings = {
  bg: '#FAF7F2',
  bgElevated: '#FFFFFF',
  ink: '#0F0E0D',
  inkMuted: '#5C5853',
  /* The journey green is the app's own accent. A trip that has not chosen a
     palette inherits it, so nothing renders in the legacy pink by default. */
  accent: '#174b38',
  accentSoft: '#e4eadc',
};

export const DEFAULT_DARK_THEME: TripThemeSettings = {
  bg: '#14110F',
  bgElevated: '#1F1A17',
  ink: '#F5EFE4',
  inkMuted: '#A39B8C',
  accent: '#2f7559',
  accentSoft: '#263c31',
};

/** Theme families with paired light + dark variants. One tap applies both. */
export const THEME_PALETTE_PRESETS: ThemePalettePreset[] = [
  {
    id: 'ember-rose',
    name: 'Ember Rose',
    description: 'Warm paper by day, charcoal rose by night.',
    light: { ...DEFAULT_LIGHT_THEME },
    dark: { ...DEFAULT_DARK_THEME },
  },
  {
    id: 'quantum-rose',
    name: 'Quantum Rose',
    description: 'A vivid pink interface with lilac depth and editorial contrast.',
    light: {
      bg: '#FFF0F8',
      bgElevated: '#FFF7FC',
      ink: '#91185C',
      inkMuted: '#A82A70',
      accent: '#E6067A',
      accentSoft: '#FFD6FF',
    },
    dark: {
      bg: '#1A0922',
      bgElevated: '#2A1435',
      ink: '#FFB3FF',
      inkMuted: '#D67AD6',
      accent: '#FF6BEF',
      accentSoft: '#46204F',
    },
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    description: 'Playful pink energy balanced by citrus cream and pool-blue calm.',
    light: {
      bg: '#F6E6EE',
      bgElevated: '#FDEDC9',
      ink: '#5B5B5B',
      inkMuted: '#7A7A7A',
      accent: '#D04F99',
      accentSoft: '#8ACFD1',
    },
    dark: {
      bg: '#12242E',
      bgElevated: '#1C2E38',
      ink: '#F3E3EA',
      inkMuted: '#E4A2B1',
      accent: '#FBE2A7',
      accentSoft: '#E4A2B1',
    },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    description: 'Quiet violet surfaces with soft rose warmth and steady contrast.',
    light: {
      bg: '#F8F7FA',
      bgElevated: '#FFFFFF',
      ink: '#3D3C4F',
      inkMuted: '#6B6880',
      accent: '#8A79AB',
      accentSoft: '#DFD9EC',
    },
    dark: {
      bg: '#1A1823',
      bgElevated: '#232030',
      ink: '#E0DDEF',
      inkMuted: '#A09AAD',
      accent: '#A995C9',
      accentSoft: '#5A5370',
    },
  },
  {
    id: 'primary-pop',
    name: 'Primary Pop',
    description: 'High-contrast primary colors for a direct, graphic interface.',
    light: {
      bg: '#FFFFFF',
      bgElevated: '#FFFFFF',
      ink: '#000000',
      inkMuted: '#333333',
      accent: '#FF3333',
      accentSoft: '#FFFF00',
    },
    dark: {
      bg: '#000000',
      bgElevated: '#333333',
      ink: '#FFFFFF',
      inkMuted: '#CCCCCC',
      accent: '#FF6666',
      accentSoft: '#FFFF33',
    },
  },
  {
    id: 'garden-indigo',
    name: 'Garden Indigo',
    description: 'Leafy greens with indigo structure, teal lift, and a warm amber signal.',
    light: {
      bg: '#F7F9F3',
      bgElevated: '#FFFFFF',
      ink: '#000000',
      inkMuted: '#333333',
      accent: '#4F46E5',
      accentSoft: '#14B8A6',
    },
    dark: {
      bg: '#000000',
      bgElevated: '#1A212B',
      ink: '#FFFFFF',
      inkMuted: '#CCCCCC',
      accent: '#818CF8',
      accentSoft: '#2DD4BF',
    },
  },
  {
    id: 'terracotta-coast',
    name: 'Terracotta Coast',
    description: 'Weathered stone, terracotta warmth, and a restrained coastal blue.',
    light: {
      bg: '#E8EBED',
      bgElevated: '#FFFFFF',
      ink: '#333333',
      inkMuted: '#6B7280',
      accent: '#E05D38',
      accentSoft: '#D6E4F0',
    },
    dark: {
      bg: '#1C2433',
      bgElevated: '#2A3040',
      ink: '#E5E5E5',
      inkMuted: '#A3A3A3',
      accent: '#E05D38',
      accentSoft: '#2A3656',
    },
  },
];

export const themesMatch = (a: TripThemeSettings, b: TripThemeSettings) =>
  (Object.keys(a) as Array<keyof TripThemeSettings>).every(
    (key) => a[key].toUpperCase() === b[key].toUpperCase(),
  );

export const getPresetVariant = (preset: ThemePalettePreset, mode: ThemeMode) =>
  mode === 'light' ? preset.light : preset.dark;

export const findMatchingThemePreset = (
  settings: Pick<TripAppSettings, 'theme' | 'lightTheme'>,
  mode?: ThemeMode,
) => {
  if (mode) {
    const current = mode === 'light' ? settings.lightTheme : settings.theme;
    return (
      THEME_PALETTE_PRESETS.find((preset) => themesMatch(getPresetVariant(preset, mode), current)) ?? null
    );
  }

  return (
    THEME_PALETTE_PRESETS.find(
      (preset) =>
        themesMatch(preset.light, settings.lightTheme) && themesMatch(preset.dark, settings.theme),
    ) ?? null
  );
};

export const getThemeForMode = (settings: Pick<TripAppSettings, 'theme' | 'lightTheme'>, mode: ThemeMode) =>
  mode === 'light' ? settings.lightTheme : settings.theme;

export const buildTripThemeStyle = (palette: TripThemeSettings, mode: ThemeMode): CSSProperties => {
  const border = `color-mix(in srgb, ${palette.ink} 22%, ${palette.bgElevated})`;
  const sharedTokens = {
    '--background': palette.bg,
    '--foreground': palette.ink,
    '--card': palette.bgElevated,
    '--card-foreground': palette.ink,
    '--popover': palette.bgElevated,
    '--popover-foreground': palette.ink,
    '--primary': palette.accent,
    '--primary-foreground': '#0F0E0D',
    '--secondary': palette.accentSoft,
    '--secondary-foreground': palette.ink,
    '--muted': palette.accentSoft,
    '--muted-foreground': palette.inkMuted,
    '--accent-foreground': '#0F0E0D',
    '--input': border,
    '--ring': palette.accent,
  };

  if (mode === 'light') {
    return {
      ...sharedTokens,
      '--bg': palette.bg,
      '--bg-elevated': palette.bgElevated,
      '--ink': palette.ink,
      '--ink-muted': palette.inkMuted,
      '--accent': palette.accent,
      '--accent-soft': palette.accentSoft,
      '--accent-ink': '#0F0E0D',
      '--border': border,
      '--shadow-lift': '0 1px 0 rgba(15,14,13,0.04), 0 12px 32px -16px rgba(15,14,13,0.18)',
    } as CSSProperties;
  }

  return {
    ...sharedTokens,
    '--bg': palette.bg,
    '--bg-elevated': palette.bgElevated,
    '--ink': palette.ink,
    '--ink-muted': palette.inkMuted,
    '--accent': palette.accent,
    '--accent-soft': palette.accentSoft,
    '--accent-ink': '#0F0E0D',
    '--border': border,
    '--shadow-lift': '0 1px 0 rgba(0,0,0,0.3), 0 18px 40px -18px rgba(0,0,0,0.6)',
  } as CSSProperties;
};

export interface TripAppSettings {
  heroEyebrow: string;
  heroHeadline: string;
  heroDescription: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  coverLabel: string;
  coverHeadline: string;
  coverStatusEmpty: string;
  coverStatusFilled: string;
  coverModeEmpty: string;
  coverModeFilled: string;
  marqueeItems: string[];
  coverImage: string | null;
  immersiveEffects: boolean;
  labels: TripCopyLabels;
  /** Dark-mode palette (legacy `theme` field). */
  theme: TripThemeSettings;
  /** Light-mode palette. */
  lightTheme: TripThemeSettings;
  /** Optional user-saved palette shown alongside the built-in presets. */
  customThemePreset: ThemePalettePreset | null;
}

export const DEFAULT_TRIP_SETTINGS: TripAppSettings = {
  heroEyebrow: 'A personalized travel starter',
  heroHeadline: 'Plan your next trip your way.',
  heroDescription: 'Add cities, days, notes, budgets, maps, and documents as you build your travel plan.',
  heroPrimaryCta: 'Open handbook',
  heroSecondaryCta: 'Open maps',
  coverLabel: 'Custom cover',
  coverHeadline: 'Add your\nown story',
  coverStatusEmpty: 'No cities yet',
  coverStatusFilled: '{cities}',
  coverModeEmpty: 'starter',
  coverModeFilled: 'handbook',
  marqueeItems: ['Travel Handbook', 'Plans', 'Notes', 'Maps', 'Photos'],
  coverImage: null,
  immersiveEffects: false,
  labels: {
    itineraryTab: 'Itinerary',
    mapsTab: 'Maps',
    draftTab: 'Draft',
    budgetTab: 'Budget',
    checklistTab: 'Checklist',
    documentsTab: 'Documents',
    photosTab: 'Photo Wall',
    searchPlaceholder: 'Search itinerary or locations...',
    overviewEyebrow: 'The itinerary · day by day',
    overviewIntroFilled: 'A day-by-day field guide for {cities}.',
    overviewIntroEmpty: 'A blank day-by-day field guide ready for your trip details.',
    backToOverview: 'Back to Overview',
    customizePlan: 'Customize Plan',
    doneCustomizing: 'Done Customizing',
    resetPlan: 'Reset',
    photosButton: 'Photos',
    dayLabel: 'Day',
    daysLabel: 'days',
    currentLocationLabel: 'Current Location',
    spotsSuffix: 'spots',
    openMapLabel: 'Map',
    activityPhotosLabel: 'Photos',
    deleteActivityLabel: 'Delete',
    deleteActivityConfirm: 'Delete this activity?',
  },
  theme: { ...DEFAULT_DARK_THEME },
  lightTheme: { ...DEFAULT_LIGHT_THEME },
  customThemePreset: null,
};

export const mergeTripSettings = (settings?: Partial<TripAppSettings> | null): TripAppSettings => ({
  ...DEFAULT_TRIP_SETTINGS,
  ...settings,
  marqueeItems:
    settings?.marqueeItems && settings.marqueeItems.length > 0
      ? settings.marqueeItems
      : DEFAULT_TRIP_SETTINGS.marqueeItems,
  labels: {
    ...DEFAULT_TRIP_SETTINGS.labels,
    ...(settings?.labels || {}),
  },
  theme: {
    ...DEFAULT_TRIP_SETTINGS.theme,
    ...(settings?.theme || {}),
  },
  lightTheme: {
    ...DEFAULT_TRIP_SETTINGS.lightTheme,
    ...(settings?.lightTheme || {}),
  },
  customThemePreset: settings?.customThemePreset
    ? {
        ...settings.customThemePreset,
        light: { ...settings.customThemePreset.light },
        dark: { ...settings.customThemePreset.dark },
      }
    : null,
});

export const applyTemplate = (template: string, replacements: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? '');

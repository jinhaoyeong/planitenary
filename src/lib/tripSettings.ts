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
  accent: '#EE4D87',
  accentSoft: '#FFE4EE',
};

export const DEFAULT_DARK_THEME: TripThemeSettings = {
  bg: '#14110F',
  bgElevated: '#1F1A17',
  ink: '#F5EFE4',
  inkMuted: '#A39B8C',
  accent: '#FF6B9A',
  accentSoft: '#3A1F2A',
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
    id: 'sage-atlas',
    name: 'Sage Atlas',
    description: 'Quiet botanical paper with a grounded green signal.',
    light: {
      bg: '#F4F5EF',
      bgElevated: '#FFFFFF',
      ink: '#1B241F',
      inkMuted: '#5D6A61',
      accent: '#527A63',
      accentSoft: '#E2ECE2',
    },
    dark: {
      bg: '#121814',
      bgElevated: '#1D251F',
      ink: '#F3F5EB',
      inkMuted: '#9BAA9B',
      accent: '#8DB38C',
      accentSoft: '#26382B',
    },
  },
  {
    id: 'indigo-postcard',
    name: 'Indigo Postcard',
    description: 'Blue-hour paper with a dependable postcard blue.',
    light: {
      bg: '#F1F4F8',
      bgElevated: '#FFFFFF',
      ink: '#172333',
      inkMuted: '#5F7184',
      accent: '#3E6FA8',
      accentSoft: '#DCE7F4',
    },
    dark: {
      bg: '#101821',
      bgElevated: '#192531',
      ink: '#EFF5FA',
      inkMuted: '#9BAFBE',
      accent: '#80A9D4',
      accentSoft: '#24364A',
    },
  },
  {
    id: 'terracotta-ledger',
    name: 'Terracotta Ledger',
    description: 'Sun-baked paper with a warm ceramic accent.',
    light: {
      bg: '#FAF1EA',
      bgElevated: '#FFFDF9',
      ink: '#241A15',
      inkMuted: '#78645A',
      accent: '#C66A4A',
      accentSoft: '#F2DCD1',
    },
    dark: {
      bg: '#1B1210',
      bgElevated: '#291B17',
      ink: '#F8EEE7',
      inkMuted: '#B99A8D',
      accent: '#E08C6A',
      accentSoft: '#452820',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    description: 'Sunlit sandstone that turns lamp-warm at night.',
    light: {
      bg: '#F7F0E8',
      bgElevated: '#FFFBF6',
      ink: '#1A140E',
      inkMuted: '#6B655D',
      accent: '#C8842A',
      accentSoft: '#F3E2C8',
    },
    dark: {
      bg: '#16120C',
      bgElevated: '#221B13',
      ink: '#F8F0E3',
      inkMuted: '#A89880',
      accent: '#E0A045',
      accentSoft: '#3A2C18',
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
  if (mode === 'light') {
    return {
      '--bg': palette.bg,
      '--bg-elevated': palette.bgElevated,
      '--ink': palette.ink,
      '--ink-muted': palette.inkMuted,
      '--accent': palette.accent,
      '--accent-soft': palette.accentSoft,
      '--accent-ink': '#0F0E0D',
      '--border': '#E8E1D5',
      '--shadow-lift': '0 1px 0 rgba(15,14,13,0.04), 0 12px 32px -16px rgba(15,14,13,0.18)',
    } as CSSProperties;
  }

  return {
    '--bg': palette.bg,
    '--bg-elevated': palette.bgElevated,
    '--ink': palette.ink,
    '--ink-muted': palette.inkMuted,
    '--accent': palette.accent,
    '--accent-soft': palette.accentSoft,
    '--accent-ink': '#0F0E0D',
    '--border': '#2C2521',
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
});

export const applyTemplate = (template: string, replacements: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? '');

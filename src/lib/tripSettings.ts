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
    id: 'midnight-slate',
    name: 'Midnight Slate',
    description: 'Cool mist in light mode, slate ink after dark.',
    light: {
      bg: '#F4F5F8',
      bgElevated: '#FFFFFF',
      ink: '#171A22',
      inkMuted: '#667085',
      accent: '#E7685D',
      accentSoft: '#F7D6DD',
    },
    dark: {
      bg: '#171A22',
      bgElevated: '#232630',
      ink: '#F7F2EB',
      inkMuted: '#8E8678',
      accent: '#E7685D',
      accentSoft: '#41242C',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Linen green calm that deepens at night.',
    light: {
      bg: '#F3F5F4',
      bgElevated: '#FFFFFF',
      ink: '#15201C',
      inkMuted: '#5F6B66',
      accent: '#2F7D6E',
      accentSoft: '#DDEFEA',
    },
    dark: {
      bg: '#121714',
      bgElevated: '#1B221D',
      ink: '#EEF3EC',
      inkMuted: '#8FA093',
      accent: '#2F7D6E',
      accentSoft: '#1E332C',
    },
  },
  {
    id: 'coastal',
    name: 'Coastal',
    description: 'Sky-sheet pages with deep navy evenings.',
    light: {
      bg: '#F2F6F9',
      bgElevated: '#FFFFFF',
      ink: '#132033',
      inkMuted: '#5C6B7A',
      accent: '#3D8FB5',
      accentSoft: '#D7EAF3',
    },
    dark: {
      bg: '#10161C',
      bgElevated: '#182129',
      ink: '#EEF4F7',
      inkMuted: '#8A9AA6',
      accent: '#3D8FB5',
      accentSoft: '#1A303A',
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

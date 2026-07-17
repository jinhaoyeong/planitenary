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

export interface ThemePalettePreset {
  id: string;
  name: string;
  description: string;
  theme: TripThemeSettings;
}

/** Curated dark-mode palettes users can apply in one tap. */
export const THEME_PALETTE_PRESETS: ThemePalettePreset[] = [
  {
    id: 'ember-rose',
    name: 'Ember Rose',
    description: 'Warm charcoal with a soft rose accent.',
    theme: {
      bg: '#14110F',
      bgElevated: '#1F1A17',
      ink: '#F5EFE4',
      inkMuted: '#A39B8C',
      accent: '#FF6B9A',
      accentSoft: '#3A1F2A',
    },
  },
  {
    id: 'midnight-slate',
    name: 'Midnight Slate',
    description: 'Cool ink surfaces with a coral spark.',
    theme: {
      bg: '#171A22',
      bgElevated: '#232630',
      ink: '#F7F2EB',
      inkMuted: '#8E8678',
      accent: '#E7685D',
      accentSoft: '#41242C',
    },
  },
  {
    id: 'forest-night',
    name: 'Forest Night',
    description: 'Deep green calm for quieter evenings.',
    theme: {
      bg: '#121714',
      bgElevated: '#1B221D',
      ink: '#EEF3EC',
      inkMuted: '#8FA093',
      accent: '#2F7D6E',
      accentSoft: '#1E332C',
    },
  },
  {
    id: 'coastal-ink',
    name: 'Coastal Ink',
    description: 'Sea-glass accents on deep navy paper.',
    theme: {
      bg: '#10161C',
      bgElevated: '#182129',
      ink: '#EEF4F7',
      inkMuted: '#8A9AA6',
      accent: '#3D8FB5',
      accentSoft: '#1A303A',
    },
  },
  {
    id: 'amber-lamp',
    name: 'Amber Lamp',
    description: 'Lamp-lit warmth with a honey accent.',
    theme: {
      bg: '#16120C',
      bgElevated: '#221B13',
      ink: '#F8F0E3',
      inkMuted: '#A89880',
      accent: '#E0A045',
      accentSoft: '#3A2C18',
    },
  },
  {
    id: 'parchment',
    name: 'Parchment',
    description: 'Light editorial paper for a brighter handbook.',
    theme: {
      bg: '#F7F0E8',
      bgElevated: '#FFFFFF',
      ink: '#0F0E0D',
      inkMuted: '#5C5853',
      accent: '#EE4D87',
      accentSoft: '#FFE4EE',
    },
  },
];

export const themesMatch = (a: TripThemeSettings, b: TripThemeSettings) =>
  (Object.keys(a) as Array<keyof TripThemeSettings>).every(
    (key) => a[key].toUpperCase() === b[key].toUpperCase(),
  );

export const findMatchingThemePreset = (theme: TripThemeSettings) =>
  THEME_PALETTE_PRESETS.find((preset) => themesMatch(preset.theme, theme)) ?? null;

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
  theme: TripThemeSettings;
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
  theme: { ...THEME_PALETTE_PRESETS[0].theme },
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
});

export const applyTemplate = (template: string, replacements: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? '');

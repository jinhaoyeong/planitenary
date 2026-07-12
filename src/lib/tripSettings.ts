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
  theme: {
    bg: '#14110F',
    bgElevated: '#1F1A17',
    ink: '#F5EFE4',
    inkMuted: '#A39B8C',
    accent: '#FF6B9A',
    accentSoft: '#3A1F2A',
  },
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

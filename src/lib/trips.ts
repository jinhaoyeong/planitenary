import type { DayPlan, Itinerary } from '../data';
import {
  GENERATED_FIELDS,
  applyIdentityProposal,
  buildIdentityProposal,
  effectiveFieldSource,
  markAllGenerated,
  type ApplyProposalResult,
  type FieldSourceMap,
  type GeneratedField,
  type IdentityProposal,
} from './identityFields';
import { buildTripIdentity, type TripIdentity } from './tripIdentity';
import {
  badgeDurationDays,
  destinationCities,
  resolveDuration,
  sanitizeTripProfile,
  type TripProfile,
} from './tripProfile';

export type TripStatus = 'active' | 'archived';

export interface TripSummary {
  id: string;
  title: string;
  description: string;
  status: TripStatus;
  updatedAt: string;
  dayCount: number;
  cityCount: number;
}

export const createTripId = () => `trip-${crypto.randomUUID()}`;

export const createBlankItinerary = (id = createTripId()): Itinerary => ({
  id,
  name: 'New Trip',
  cities: [],
  description: 'Start with a blank travel handbook and shape every day your way.',
  days: [],
});

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const addDays = (iso: string, offset: number) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return date;
};

/** Spread the planned days across destinations so each city gets a fair block. */
const cityForDay = (cities: string[], dayIndex: number, totalDays: number) => {
  if (cities.length === 0) return '';
  if (cities.length === 1 || totalDays <= 1) return cities[0];
  const perCity = totalDays / cities.length;
  return cities[Math.min(cities.length - 1, Math.floor(dayIndex / perCity))];
};

/** Guards against a mistyped year turning into thousands of day cards. */
export const MAX_GENERATED_DAYS = 90;

export function buildDaysFromProfile(profile: TripProfile): DayPlan[] {
  const { days: requested } = resolveDuration(profile);
  const days = Math.min(requested, MAX_GENERATED_DAYS);
  if (days <= 0) return [];

  const cities = destinationCities(profile);
  return Array.from({ length: days }, (_, index) => {
    const city = cityForDay(cities, index, days);
    const date = profile.startDate ? SHORT_DATE.format(addDays(profile.startDate, index)) : `Day ${index + 1}`;
    const isFirst = index === 0;
    const isLast = index === days - 1 && days > 1;
    const title = isFirst
      ? city ? `Arrive in ${city}` : 'Arrival day'
      : isLast
        ? city ? `Last morning in ${city}` : 'Departure day'
        : city ? `Day ${index + 1} in ${city}` : `Day ${index + 1}`;

    return { day: index + 1, date, city, title, activities: [] } satisfies DayPlan;
  });
}

/**
 * Writes a whole generated identity onto a brand new itinerary and records
 * every field as generated. Only safe for trips that have no copy yet — an
 * existing handbook must go through {@link regenerateItinerary} so hand-written
 * text is preserved.
 */
export function applyIdentityToNewItinerary(
  itinerary: Itinerary,
  profile: TripProfile,
  identity: TripIdentity,
  generatedAt = new Date().toISOString(),
): Itinerary {
  const proposal = buildIdentityProposal(itinerary, profile, identity, generatedAt);
  const withProfile: Itinerary = {
    ...itinerary,
    tripProfile: profile,
    cities: destinationCities(profile),
    primaryButtonTab: 'itinerary',
    secondaryButtonTab: 'maps',
  };
  const result = applyIdentityProposal(withProfile, profile, proposal, GENERATED_FIELDS);
  return { ...result.itinerary, fieldSources: markAllGenerated(result.itinerary, proposal) };
}

/**
 * Keeps duration-dependent hero fields honest against the active profile.
 * Removing dates clears the badge immediately; restoring valid dates refreshes
 * a generated badge. Hand-written copy on every other field is left alone.
 */
export function syncDurationDependentFields(
  itinerary: Itinerary,
  profile: TripProfile,
  generatedAt = new Date().toISOString(),
): Itinerary {
  const days = badgeDurationDays(profile);
  const identity = buildTripIdentity(profile, { plannedDays: itinerary.days.length });
  const sources: FieldSourceMap = { ...(itinerary.fieldSources ?? {}) };

  let next: Itinerary = { ...itinerary, tripProfile: profile };

  if (days <= 0) {
    // A badge that still shows an old count contradicts the profile.
    next = { ...next, heroDayBadge: '', heroDayBadgeUnit: '' };
    sources.dayBadge = { source: 'generated', generatedValue: '', generatedAt };
    sources.dayBadgeUnit = { source: 'generated', generatedValue: '', generatedAt };

    // Refresh the primary action when the app still owns it, so "Start day 1"
    // becomes "Add your dates" without touching a hand-written label.
    if (effectiveFieldSource(itinerary, 'heroPrimaryButton') === 'generated') {
      next = { ...next, primaryButtonLabel: identity.primaryButtonLabel };
      sources.heroPrimaryButton = {
        source: 'generated',
        generatedValue: identity.primaryButtonLabel,
        generatedAt,
      };
    }
  } else {
    const badgeSource = effectiveFieldSource(itinerary, 'dayBadge');
    const unitSource = effectiveFieldSource(itinerary, 'dayBadgeUnit');
    const currentBadge = (itinerary.heroDayBadge ?? '').trim();

    // Refresh generated/unknown/empty badges; keep a deliberate manual label
    // while the trip still has a real duration.
    if (badgeSource !== 'manual' || currentBadge.length === 0) {
      next = { ...next, heroDayBadge: identity.dayBadgeValue };
      sources.dayBadge = {
        source: 'generated',
        generatedValue: identity.dayBadgeValue,
        generatedAt,
      };
    }
    if (unitSource !== 'manual' || !(itinerary.heroDayBadgeUnit ?? '').trim()) {
      next = { ...next, heroDayBadgeUnit: identity.dayBadgeUnit };
      sources.dayBadgeUnit = {
        source: 'generated',
        generatedValue: identity.dayBadgeUnit,
        generatedAt,
      };
    }

    if (effectiveFieldSource(itinerary, 'heroPrimaryButton') === 'generated') {
      next = { ...next, primaryButtonLabel: identity.primaryButtonLabel };
      sources.heroPrimaryButton = {
        source: 'generated',
        generatedValue: identity.primaryButtonLabel,
        generatedAt,
      };
    }
  }

  return { ...next, fieldSources: sources };
}

/** What the hero badge should show right now, never contradicting the profile. */
export function resolveDisplayedDayBadge(itinerary: Itinerary): { value: string; unit: string; visible: boolean } {
  const profile = sanitizeTripProfile(itinerary.tripProfile);
  if (profile) {
    const days = badgeDurationDays(profile);
    if (days <= 0) return { value: '', unit: '', visible: false };

    const identity = buildTripIdentity(profile, { plannedDays: itinerary.days.length });
    const manualBadge = effectiveFieldSource(itinerary, 'dayBadge') === 'manual'
      && (itinerary.heroDayBadge ?? '').trim().length > 0;
    const value = manualBadge ? (itinerary.heroDayBadge ?? '').trim() : identity.dayBadgeValue;
    const unit = manualBadge
      ? ((itinerary.heroDayBadgeUnit ?? '').trim() || identity.dayBadgeUnit)
      : identity.dayBadgeUnit;
    return { value, unit, visible: value.length > 0 };
  }

  const value = (itinerary.heroDayBadge || (itinerary.days.length > 0 ? String(itinerary.days.length) : '')).trim();
  return {
    value,
    unit: (itinerary.heroDayBadgeUnit || 'days').trim(),
    visible: value.length > 0,
  };
}

/**
 * Regenerates copy for an existing handbook. Fields the traveller edited, and
 * fields saved before provenance tracking existed, are left alone unless they
 * appear in `selection`.
 */
export function regenerateItinerary(
  itinerary: Itinerary,
  profile: TripProfile,
  proposal: IdentityProposal,
  selection?: Iterable<GeneratedField>,
): ApplyProposalResult {
  // Duration fields are synced first so an undated profile cannot leave a
  // stale "8" badge behind — applyIdentityProposal skips empty proposals.
  const durationSynced = syncDurationDependentFields(itinerary, profile, proposal.generatedAt);
  const withProfile: Itinerary = {
    ...durationSynced,
    tripProfile: profile,
    cities: destinationCities(profile),
  };
  return applyIdentityProposal(withProfile, profile, proposal, selection);
}

export function createItineraryFromProfile(profile: TripProfile, id = createTripId()): Itinerary {
  const days = buildDaysFromProfile(profile);
  const identity = buildTripIdentity(profile, { plannedDays: days.length });
  return applyIdentityToNewItinerary({ ...createBlankItinerary(id), days }, profile, identity);
}

export const toTripSummary = (itinerary: Itinerary, updatedAt = new Date().toISOString()): TripSummary => ({
  id: itinerary.id,
  title: itinerary.name || 'Untitled trip',
  description: itinerary.description || 'A new travel handbook.',
  status: 'active',
  updatedAt,
  dayCount: itinerary.days.length,
  cityCount: itinerary.cities.length,
});

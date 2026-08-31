import type { DayPlan, Itinerary } from '../data';
import { resolveTripCover, type TripCoverRef } from './verifiedImage';
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
import {
  generatedDayCardCount,
  validateTripDuration,
  withValidatedDuration,
} from './tripDuration';

export {
  MAX_GENERATED_DAYS,
  MAX_TRIP_DURATION_DAYS,
  TRIP_DURATION_TOO_LONG_MESSAGE,
  longTripPartialGenerationMessage,
  validateTripDuration,
} from './tripDuration';

export type TripStatus = 'active' | 'archived';

export interface TripSummary {
  id: string;
  title: string;
  description: string;
  status: TripStatus;
  updatedAt: string;
  dayCount: number;
  cityCount: number;
  countryCode?: string;
  countryName?: string;
  cover: TripCoverRef;
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

/**
 * Which city a freshly created day belongs to.
 *
 * One city means every day is in it, and saying so is simply true. Several
 * cities mean the app does not know yet: the division depends on what the
 * traveller shortlists in each, which has not happened at creation time. It
 * used to guess with an even split — eight days across Osaka, Nara, Kyoto and
 * Kobe came back as "Day 6 in Nara" and "Day 8 in Kyoto", numbers nothing
 * downstream honoured and the traveller never chose. A blank is honest, and
 * `buildDestinationItinerary` fills it from the plan it actually produced.
 */
const cityForDay = (cities: string[]) => (cities.length === 1 ? cities[0] : '');

/** Guards against a mistyped year turning into thousands of day cards. */
// MAX_GENERATED_DAYS is re-exported from tripDuration above.

export function buildDaysFromProfile(profile: TripProfile): DayPlan[] {
  // Reject invalid ranges rather than inventing cards; still cap valid long
  // stays so a semester abroad does not create hundreds of empty pages.
  const validation = validateTripDuration(profile);
  const requested = validation.ok ? validation.days : 0;
  const days = generatedDayCardCount(requested);
  if (days <= 0) return [];

  const cities = destinationCities(profile);
  return Array.from({ length: days }, (_, index) => {
    const city = cityForDay(cities);
    const date = profile.startDate ? SHORT_DATE.format(addDays(profile.startDate, index)) : `Day ${index + 1}`;
    const isFirst = index === 0;
    const isLast = index === days - 1 && days > 1;
    const title = isFirst
      ? city ? `Arrive in ${city}` : 'Arrival day'
      : isLast
        ? city ? `Last morning in ${city}` : 'Departure day'
        : city ? `Day ${index + 1} in ${city}` : `Day ${index + 1}`;

    // A generated card has one city and no recorded stops, so the base is that
    // city and the activity list is genuinely empty rather than unknown.
    return {
      day: index + 1,
      date,
      stayCity: city,
      activityCities: [],
      city,
      title,
      activities: [],
    } satisfies DayPlan;
  });
}

export interface DaySyncResult {
  days: DayPlan[];
  /** Day cards appended because the trip got longer. */
  added: number;
  /** Empty trailing cards removed because the trip got shorter. */
  removed: number;
  /**
   * Days past the end of the shortened trip that still hold activities. Kept,
   * never deleted, and reported so the traveller can decide.
   */
  strandedDays: number[];
}

/**
 * Keep the day cards in step with the trip's length and dates.
 *
 * Day cards were only ever built at creation, so a traveller who added a day
 * afterwards got a hero badge reading 9 above eight day cards — the ninth day
 * simply did not exist anywhere in the app, and the planner sized everything to
 * eight.
 *
 * Growing appends neutral cards. Shrinking removes trailing cards **only while
 * they are empty**: a day with something planned on it is work, and deleting it
 * to satisfy a date change would be the app throwing away what the traveller
 * did. Those days are reported instead.
 *
 * Dates are refreshed on every card, because moving the trip forward a week
 * moves every day with it. Titles and activities are never touched.
 */
export function syncDaysWithDuration(itinerary: Itinerary, profile: TripProfile): DaySyncResult {
  const validation = validateTripDuration(profile);
  const target = generatedDayCardCount(validation.ok ? validation.days : 0);
  const current = itinerary.days;

  // No usable duration: leave the handbook exactly as it is. Clearing the dates
  // is not an instruction to delete the plan.
  if (target <= 0) return { days: current, added: 0, removed: 0, strandedDays: [] };

  const cities = destinationCities(profile);
  const dateFor = (index: number) => (profile.startDate
    ? SHORT_DATE.format(addDays(profile.startDate, index))
    : `Day ${index + 1}`);

  let days = current.map((day, index) => ({ ...day, day: index + 1, date: dateFor(index) }));
  let added = 0;
  let removed = 0;

  if (days.length < target) {
    const generated = buildDaysFromProfile(profile);
    added = target - days.length;
    days = [...days, ...generated.slice(days.length)];
  } else if (days.length > target) {
    while (days.length > target && days[days.length - 1].activities.length === 0) {
      days = days.slice(0, -1);
      removed += 1;
    }
  }

  const strandedDays = days.slice(target).map((day) => day.day);

  // A single-city trip names its city on every card, including newly added
  // ones; a multi-city trip leaves that to the planner, as at creation.
  //
  // One value resolved once and written to both fields. Filling in only the
  // alias would leave the pair disagreeing until something else sanitized it,
  // and a writer that depends on being cleaned up afterwards is a writer that
  // breaks as soon as its output is read directly.
  const city = cityForDay(cities);
  const previousCities = new Set([
    ...itinerary.cities,
    ...itinerary.days.flatMap((day) => [day.stayCity, day.city]),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean));
  const destinationChanged = Boolean(city && previousCities.size > 0 && !previousCities.has(city.toLowerCase()));
  const generatedForDestination = destinationChanged ? buildDaysFromProfile(profile) : [];
  const named = (day: DayPlan, index: number): DayPlan => {
    const stayCity = destinationChanged ? city : (day.stayCity || day.city || city);
    return {
      ...day,
      stayCity,
      city: stayCity,
      // Empty cards contain no user-authored itinerary work. Refresh their
      // generated place name as part of the explicit destination change so a
      // Tokyo trip cannot keep saying "Arrive in Osaka" after save.
      title: destinationChanged && day.activities.length === 0
        ? (generatedForDestination[index]?.title || day.title)
        : day.title,
    };
  };
  return {
    days: city ? days.map(named) : days,
    added,
    removed,
    strandedDays,
  };
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
  /**
   * The cards follow the dates. This is the single place every profile write
   * passes through, which is why it belongs here rather than in each panel —
   * before this, changing the dates moved the badge and left the day cards
   * behind, so a nine-day trip had eight days in it.
   */
  const synced = syncDaysWithDuration(itinerary, profile);
  const identity = buildTripIdentity(profile, { plannedDays: synced.days.length });
  const sources: FieldSourceMap = { ...(itinerary.fieldSources ?? {}) };

  // The structured profile owns the destination list. Keeping the denormalised
  // `cities` field in step here means the cover, marquee, and every legacy
  // surface see a city added in Settings immediately, before copy is refreshed.
  let next: Itinerary = {
    ...itinerary,
    tripProfile: profile,
    cities: destinationCities(profile),
    days: synced.days,
  };

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
  // Sanitize first so imported/legacy payloads cannot carry a 999-day span.
  const cleaned = sanitizeTripProfile(profile) ?? profile;
  const committed = withValidatedDuration(cleaned);
  const safeProfile = committed.ok ? committed.profile : cleaned;
  const days = buildDaysFromProfile(safeProfile);
  // plannedDays for identity copy is the declared duration (badge/budget), not
  // the capped card count — long trips still say "180 days" honestly.
  const declared = resolveDuration(safeProfile).days;
  const identity = buildTripIdentity(safeProfile, { plannedDays: declared > 0 ? declared : days.length });
  return applyIdentityToNewItinerary({ ...createBlankItinerary(id), days }, safeProfile, identity);
}

export const toTripSummary = (itinerary: Itinerary, updatedAt = new Date().toISOString()): TripSummary => {
  const cover = resolveTripCover(itinerary);
  return {
    id: itinerary.id,
    title: itinerary.name || 'Untitled trip',
    description: itinerary.description || 'A new travel handbook.',
    status: 'active',
    updatedAt,
    dayCount: itinerary.days.length,
    cityCount: itinerary.cities.length,
    countryCode: cover.countryCode,
    countryName: cover.countryName,
    cover,
  };
};

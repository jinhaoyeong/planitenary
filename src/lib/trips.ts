import type { DayPlan, Itinerary } from '../data';
import {
  GENERATED_FIELDS,
  applyIdentityProposal,
  buildIdentityProposal,
  markAllGenerated,
  type ApplyProposalResult,
  type GeneratedField,
  type IdentityProposal,
} from './identityFields';
import { buildTripIdentity, type TripIdentity } from './tripIdentity';
import {
  destinationCities,
  resolveDuration,
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
  const withProfile: Itinerary = {
    ...itinerary,
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

import type { DayPlan, Itinerary } from '../data';
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

export function buildDaysFromProfile(profile: TripProfile): DayPlan[] {
  const { days } = resolveDuration(profile);
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
        : city ? `${city} day ${index + 1}` : `Day ${index + 1}`;

    return { day: index + 1, date, city, title, activities: [] } satisfies DayPlan;
  });
}

/** Copy the generated identity onto the itinerary fields the UI already reads. */
export function applyIdentityToItinerary(
  itinerary: Itinerary,
  profile: TripProfile,
  identity: TripIdentity,
): Itinerary {
  return {
    ...itinerary,
    tripProfile: profile,
    name: identity.heroTitle,
    description: identity.heroDescription,
    cities: destinationCities(profile),
    brandTitle: identity.brandTitle,
    marqueeItems: identity.marqueeItems,
    heroEyebrow: identity.heroEyebrow,
    primaryButtonLabel: identity.primaryButtonLabel,
    primaryButtonTab: 'itinerary',
    secondaryButtonLabel: identity.secondaryButtonLabel,
    secondaryButtonTab: 'maps',
    coverHeadline: identity.coverHeadline,
    coverLabel: identity.coverLabel,
    coverYear: identity.coverYear,
    heroDayBadge: identity.dayBadgeValue,
    heroDayBadgeUnit: identity.dayBadgeUnit,
    overviewEyebrow: identity.overviewEyebrow,
    overviewDescription: identity.overviewDescription,
    searchPlaceholder: identity.searchPlaceholder,
  };
}

export function createItineraryFromProfile(profile: TripProfile, id = createTripId()): Itinerary {
  const days = buildDaysFromProfile(profile);
  const identity = buildTripIdentity(profile, { plannedDays: days.length });
  return applyIdentityToItinerary({ ...createBlankItinerary(id), days }, profile, identity);
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

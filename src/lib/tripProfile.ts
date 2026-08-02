/**
 * Trip Identity System — the structured profile captured when a journey is
 * created. Every screen reads generated copy, colours, currency, and map data
 * from this one object instead of inventing its own defaults.
 */

import { countryOrFallback, findCountry, lookupCityCenter } from './destinations';

export type TripType =
  | 'relaxation' | 'adventure' | 'food' | 'photography' | 'luxury'
  | 'family' | 'solo' | 'couple' | 'friends' | 'business';

export type TravelStyle =
  | 'cafes' | 'mountains' | 'temples' | 'museums' | 'shopping' | 'night-markets'
  | 'anime' | 'nature' | 'beaches' | 'hiking' | 'wildlife' | 'scenic-train'
  | 'street-food' | 'history' | 'nightlife' | 'architecture';

export type TripMood =
  | 'calm' | 'luxury' | 'romantic' | 'fast-paced' | 'slow-living'
  | 'minimal' | 'hidden-gems' | 'festive';

export type BudgetTier = 'budget' | 'mid-range' | 'luxury';
export type TransportMode = 'car' | 'train' | 'plane' | 'walking' | 'public-transport';
export type StayType = 'hotel' | 'hostel' | 'airbnb' | 'resort';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface TripDestination {
  city: string;
  country: string;
  region?: string;
  lat?: number;
  lng?: number;
}

export interface TripProfile {
  version: 1;
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  /** Nights are derived, days = nights + 1 when both dates exist. */
  dayCount: number;
  tripTypes: TripType[];
  styles: TravelStyle[];
  moods: TripMood[];
  budgetTier: BudgetTier;
  transport: TransportMode[];
  stays: StayType[];
  hiddenGems: boolean;
  homeCurrency: string;
  tripCurrency: string;
  /** When true the app brands the handbook after the destination. */
  brandAfterDestination: boolean;
  /** Applies the destination's colour identity to the handbook. */
  applyVisualIdentity: boolean;
  createdAt: string;
}

export interface OptionMeta<T extends string> {
  id: T;
  label: string;
  hint: string;
}

export const TRIP_TYPE_OPTIONS: OptionMeta<TripType>[] = [
  { id: 'relaxation', label: 'Relaxation', hint: 'Slow days, no rushing' },
  { id: 'adventure', label: 'Adventure', hint: 'Trails, action, the outdoors' },
  { id: 'food', label: 'Food', hint: 'Eat your way through' },
  { id: 'photography', label: 'Photography', hint: 'Chasing light and views' },
  { id: 'luxury', label: 'Luxury', hint: 'Comfort and fine details' },
  { id: 'family', label: 'Family', hint: 'Easy pace for everyone' },
  { id: 'solo', label: 'Solo', hint: 'Your own rhythm' },
  { id: 'couple', label: 'Couple', hint: 'Time together' },
  { id: 'friends', label: 'Friends', hint: 'Group energy' },
  { id: 'business', label: 'Business', hint: 'Work plus a little exploring' },
];

export const TRAVEL_STYLE_OPTIONS: OptionMeta<TravelStyle>[] = [
  { id: 'cafes', label: 'Cafés', hint: 'Coffee and quiet corners' },
  { id: 'street-food', label: 'Street food', hint: 'Stalls and small kitchens' },
  { id: 'night-markets', label: 'Night markets', hint: 'Evening browsing' },
  { id: 'temples', label: 'Temples', hint: 'Shrines and sacred sites' },
  { id: 'museums', label: 'Museums', hint: 'Galleries and exhibits' },
  { id: 'history', label: 'History', hint: 'Old towns and ruins' },
  { id: 'architecture', label: 'Architecture', hint: 'Buildings worth the detour' },
  { id: 'shopping', label: 'Shopping', hint: 'Boutiques and districts' },
  { id: 'mountains', label: 'Mountains', hint: 'High ground and views' },
  { id: 'hiking', label: 'Hiking', hint: 'Trails on foot' },
  { id: 'nature', label: 'Nature', hint: 'Parks, forests, open air' },
  { id: 'beaches', label: 'Beaches', hint: 'Coast and water' },
  { id: 'wildlife', label: 'Wildlife', hint: 'Animals in the wild' },
  { id: 'scenic-train', label: 'Scenic train', hint: 'Journeys with a view' },
  { id: 'anime', label: 'Anime & pop', hint: 'Fandom stops' },
  { id: 'nightlife', label: 'Nightlife', hint: 'Bars and late hours' },
];

export const MOOD_OPTIONS: OptionMeta<TripMood>[] = [
  { id: 'calm', label: 'Calm', hint: 'Unhurried and quiet' },
  { id: 'slow-living', label: 'Slow living', hint: 'Long mornings' },
  { id: 'romantic', label: 'Romantic', hint: 'Soft and intimate' },
  { id: 'luxury', label: 'Luxury', hint: 'Polished and indulgent' },
  { id: 'fast-paced', label: 'Fast paced', hint: 'See as much as possible' },
  { id: 'minimal', label: 'Minimal', hint: 'Simple, light, essential' },
  { id: 'hidden-gems', label: 'Hidden gems', hint: 'Off the usual list' },
  { id: 'festive', label: 'Festive', hint: 'Seasons and celebrations' },
];

export const BUDGET_OPTIONS: OptionMeta<BudgetTier>[] = [
  { id: 'budget', label: 'Budget', hint: 'Careful spending' },
  { id: 'mid-range', label: 'Mid-range', hint: 'Comfortable balance' },
  { id: 'luxury', label: 'Luxury', hint: 'Splurge where it counts' },
];

export const TRANSPORT_OPTIONS: OptionMeta<TransportMode>[] = [
  { id: 'plane', label: 'Plane', hint: 'Flying between stops' },
  { id: 'train', label: 'Train', hint: 'Rail journeys' },
  { id: 'car', label: 'Car', hint: 'Driving your own route' },
  { id: 'public-transport', label: 'Public transport', hint: 'Metro and buses' },
  { id: 'walking', label: 'Walking', hint: 'On foot wherever possible' },
];

export const STAY_OPTIONS: OptionMeta<StayType>[] = [
  { id: 'hotel', label: 'Hotel', hint: 'Classic and easy' },
  { id: 'hostel', label: 'Hostel', hint: 'Social and cheap' },
  { id: 'airbnb', label: 'Airbnb', hint: 'Live like a local' },
  { id: 'resort', label: 'Resort', hint: 'Everything on site' },
];

export const createEmptyProfile = (homeCurrency = 'MYR'): TripProfile => ({
  version: 1,
  destinations: [],
  dayCount: 0,
  tripTypes: [],
  styles: [],
  moods: [],
  budgetTier: 'mid-range',
  transport: [],
  stays: [],
  hiddenGems: false,
  homeCurrency,
  tripCurrency: homeCurrency,
  brandAfterDestination: true,
  applyVisualIdentity: true,
  createdAt: new Date().toISOString(),
});

const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function nightsBetween(startDate?: string, endDate?: string): number | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diff >= 0 ? diff : null;
}

export function resolveDuration(profile: Pick<TripProfile, 'startDate' | 'endDate' | 'dayCount'>) {
  const nights = nightsBetween(profile.startDate, profile.endDate);
  if (nights !== null) return { days: nights + 1, nights };
  const days = Math.max(0, Math.round(profile.dayCount || 0));
  return { days, nights: Math.max(0, days - 1) };
}

/** Meteorological season, flipped for the southern hemisphere. */
export function resolveSeason(startDate: string | undefined, latitude?: number): Season | null {
  const start = parseDate(startDate);
  if (!start) return null;
  const month = start.getMonth();
  const northern: Season[] = [
    'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
  ];
  const season = northern[month];
  if (typeof latitude === 'number' && latitude < 0) {
    const flip: Record<Season, Season> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
    return flip[season];
  }
  return season;
}

export function primaryCountry(profile: TripProfile): string {
  const named = profile.destinations.find((destination) => destination.country?.trim());
  return named?.country?.trim() || '';
}

export function destinationCities(profile: TripProfile): string[] {
  return profile.destinations
    .map((destination) => destination.city.trim())
    .filter((city) => city.length > 0);
}

/** Coordinates for every destination, filling gaps from the offline table. */
export function destinationPoints(profile: TripProfile): Array<{ city: string; point: [number, number] }> {
  return profile.destinations
    .map((destination) => {
      if (typeof destination.lat === 'number' && typeof destination.lng === 'number') {
        return { city: destination.city, point: [destination.lat, destination.lng] as [number, number] };
      }
      const offline = lookupCityCenter(destination.city);
      return offline ? { city: destination.city, point: offline } : null;
    })
    .filter((entry): entry is { city: string; point: [number, number] } => entry !== null);
}

export function suggestedCurrency(profile: TripProfile): string {
  const country = findCountry(primaryCountry(profile));
  return country?.currency || profile.tripCurrency || profile.homeCurrency;
}

export function profileCountryProfile(profile: TripProfile) {
  return countryOrFallback(primaryCountry(profile));
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const pickAll = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  asStringArray(value).filter((item): item is T => (allowed as readonly string[]).includes(item));

export function sanitizeTripProfile(value: unknown): TripProfile | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<TripProfile> & Record<string, unknown>;

  const destinations: TripDestination[] = Array.isArray(source.destinations)
    ? source.destinations.flatMap((entry): TripDestination[] => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Partial<TripDestination>;
        const city = typeof item.city === 'string' ? item.city.trim() : '';
        if (!city) return [];
        return [{
          city,
          country: typeof item.country === 'string' ? item.country.trim() : '',
          region: typeof item.region === 'string' && item.region.trim() ? item.region.trim() : undefined,
          lat: typeof item.lat === 'number' && Number.isFinite(item.lat) ? item.lat : undefined,
          lng: typeof item.lng === 'number' && Number.isFinite(item.lng) ? item.lng : undefined,
        }];
      })
    : [];

  if (destinations.length === 0 && !source.startDate && !source.dayCount) return null;

  const base = createEmptyProfile();
  return {
    ...base,
    destinations,
    startDate: typeof source.startDate === 'string' ? source.startDate : undefined,
    endDate: typeof source.endDate === 'string' ? source.endDate : undefined,
    dayCount: typeof source.dayCount === 'number' && Number.isFinite(source.dayCount) ? Math.max(0, Math.round(source.dayCount)) : 0,
    tripTypes: pickAll(source.tripTypes, TRIP_TYPE_OPTIONS.map((option) => option.id)),
    styles: pickAll(source.styles, TRAVEL_STYLE_OPTIONS.map((option) => option.id)),
    moods: pickAll(source.moods, MOOD_OPTIONS.map((option) => option.id)),
    budgetTier: BUDGET_OPTIONS.some((option) => option.id === source.budgetTier)
      ? (source.budgetTier as BudgetTier)
      : 'mid-range',
    transport: pickAll(source.transport, TRANSPORT_OPTIONS.map((option) => option.id)),
    stays: pickAll(source.stays, STAY_OPTIONS.map((option) => option.id)),
    hiddenGems: source.hiddenGems === true,
    homeCurrency: typeof source.homeCurrency === 'string' && source.homeCurrency.trim() ? source.homeCurrency.trim().toUpperCase() : base.homeCurrency,
    tripCurrency: typeof source.tripCurrency === 'string' && source.tripCurrency.trim() ? source.tripCurrency.trim().toUpperCase() : base.tripCurrency,
    brandAfterDestination: source.brandAfterDestination !== false,
    applyVisualIdentity: source.applyVisualIdentity !== false,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : base.createdAt,
  };
}

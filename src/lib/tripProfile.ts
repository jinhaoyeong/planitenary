/**
 * Trip Identity System — the structured profile captured when a journey is
 * created. Every screen reads generated copy, colours, currency, and map data
 * from this one object instead of inventing its own defaults.
 */

import {
  countryOrFallback,
  countryTimezone,
  createDestinationId,
  findCountry,
  lookupCityCenter,
  type PlaceSuggestion,
} from './destinations';
import { sanitizeDurationFields } from './tripDuration';

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

/** How strongly the handbook adapts to destination design recipes. */
export type VisualIdentityIntensity = 'off' | 'subtle' | 'balanced' | 'immersive';

export type DesignRecipeId =
  | 'quiet-editorial'
  | 'modern-metropolitan'
  | 'warm-postcard'
  | 'nature-expedition';

/** Per-trip adaptive design controls. Stored on the profile. */
export interface TripVisualDesign {
  intensity: VisualIdentityIntensity;
  /** When set, locks the recipe instead of auto-resolving. */
  recipeOverride?: DesignRecipeId | null;
  /** Reserved for a later Custom palette picker. */
  paletteOverride?: string | null;
}

/**
 * A saved stop. Identity is a stable id rather than the city name, because
 * city names repeat across the world: Georgetown exists in Malaysia and in
 * Guyana, Victoria in Australia and in Canada.
 */
export interface TripDestination {
  id: string;
  city: string;
  country: string;
  countryCode?: string;
  region?: string;
  lat?: number;
  lng?: number;
  /** Only set where a country has a single zone; geocoding does not supply it. */
  timezone?: string;
  currencyCode?: string;
  provider?: 'nominatim' | 'offline' | 'manual';
  providerPlaceId?: string;
}

/**
 * One stay, in the traveller's own travel order.
 *
 * `days` rather than nights, because the itinerary is built in days and a stay
 * of one day is a real thing — a day trip that ends somewhere else. The array's
 * order *is* the route: Osaka then Nara then Kyoto means exactly that.
 */
export interface TripCityStay {
  city: string;
  days: number;
}

export interface TripProfile {
  version: 1;
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  /**
   * Local landing time on the first day, `HH:MM`. A trip does not begin at
   * nine in the morning; it begins when the plane is on the ground.
   */
  arrivalTime?: string;
  /**
   * Local take-off time on the final day, `HH:MM`. The last day ends when the
   * traveller has to leave for the airport, not at the usual hour.
   */
  departureTime?: string;
  /** Nights are derived, days = nights + 1 when both dates exist. */
  dayCount: number;
  /**
   * How the traveller is dividing the trip between their cities, in travel
   * order. Their decision, not the planner's: where you sleep on night four is
   * a booking, and an app that quietly reassigns it is wrong in a way no
   * scheduling cleverness makes up for.
   *
   * Absent on a single-city trip, and on multi-city trips saved before this
   * existed — `planCityLegs` still divides those by shortlist so an old trip
   * keeps working, but the wizard asks for a stay plan before discovery.
   */
  cityStays?: TripCityStay[];
  /**
   * The trip length `cityStays` was set against.
   *
   * Without it, a plan that no longer adds up is ambiguous: three days placed
   * on an eight-day trip could be a finished plan for a trip that has since
   * grown, or a plan the traveller abandoned halfway. The first must be kept
   * and stretched; the second is better replaced by inference. This is what
   * tells them apart.
   */
  cityStayDayCount?: number;
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
  /**
   * Legacy colour toggle. Kept in sync with visualDesign.intensity !== 'off'
   * so older clients and stored trips keep working.
   */
  applyVisualIdentity: boolean;
  /** Adaptive destination design controls (intensity, optional recipe lock). */
  visualDesign?: TripVisualDesign;
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

const VISUAL_INTENSITIES: VisualIdentityIntensity[] = ['off', 'subtle', 'balanced', 'immersive'];
const DESIGN_RECIPE_IDS: DesignRecipeId[] = [
  'quiet-editorial',
  'modern-metropolitan',
  'warm-postcard',
  'nature-expedition',
];

export function isVisualIdentityIntensity(value: unknown): value is VisualIdentityIntensity {
  return typeof value === 'string' && (VISUAL_INTENSITIES as string[]).includes(value);
}

export function isDesignRecipeId(value: unknown): value is DesignRecipeId {
  return typeof value === 'string' && (DESIGN_RECIPE_IDS as string[]).includes(value);
}

/** Legacy colour toggle → intensity. Migrated trips stay Subtle; new trips use Balanced. */
export function intensityFromLegacy(
  applyVisualIdentity: boolean | undefined,
  isNewTrip = false,
): VisualIdentityIntensity {
  if (applyVisualIdentity === false) return 'off';
  return isNewTrip ? 'balanced' : 'subtle';
}

export function applyVisualIdentityFromIntensity(intensity: VisualIdentityIntensity): boolean {
  return intensity !== 'off';
}

export function sanitizeTripVisualDesign(
  value: unknown,
  legacyApplyVisualIdentity?: boolean,
): TripVisualDesign {
  if (value && typeof value === 'object') {
    const source = value as Partial<TripVisualDesign>;
    const intensity = isVisualIdentityIntensity(source.intensity)
      ? source.intensity
      : intensityFromLegacy(legacyApplyVisualIdentity, false);
    return {
      intensity,
      recipeOverride: isDesignRecipeId(source.recipeOverride) ? source.recipeOverride : null,
      paletteOverride: typeof source.paletteOverride === 'string' && source.paletteOverride.trim()
        ? source.paletteOverride.trim()
        : null,
    };
  }
  return {
    intensity: intensityFromLegacy(legacyApplyVisualIdentity, false),
    recipeOverride: null,
    paletteOverride: null,
  };
}

export const defaultVisualDesignForNewTrip = (): TripVisualDesign => ({
  intensity: 'balanced',
  recipeOverride: null,
  paletteOverride: null,
});

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
  visualDesign: defaultVisualDesignForNewTrip(),
  createdAt: new Date().toISOString(),
});

/**
 * A wall-clock time as `HH:MM`, or `undefined`.
 *
 * Anything unparseable is dropped rather than coerced, because a half-read
 * flight time is worse than none: `shapeTripEdge` would silently shorten or
 * lengthen the wrong day. Seconds are accepted because some browsers append
 * them to `<input type="time">`, and discarded because nothing uses them.
 */
export function sanitizeClockTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  if (hours > 23) return undefined;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

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

/**
 * Duration the hero badge may honestly show. Unlike {@link resolveDuration},
 * this never falls back to a leftover dayCount when both dates are set but
 * invalid — an impossible range must clear the badge, not keep an old number.
 */
export function badgeDurationDays(profile: Pick<TripProfile, 'startDate' | 'endDate' | 'dayCount'>): number {
  const hasStart = Boolean(profile.startDate);
  const hasEnd = Boolean(profile.endDate);
  if (hasStart && hasEnd) {
    const nights = nightsBetween(profile.startDate, profile.endDate);
    return nights !== null ? nights + 1 : 0;
  }
  // A single date is incomplete; only an intentional dayCount counts as undated duration.
  if (hasStart || hasEnd) return 0;
  return Math.max(0, Math.round(profile.dayCount || 0));
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

/** Builds a saved stop from a search result, keeping the provider's identity. */
export function destinationFromPlace(
  place: PlaceSuggestion,
  fallbackCountry?: string,
): TripDestination {
  const country = place.country || fallbackCountry || '';
  const countryProfile = findCountry(place.countryCode || country);
  return {
    id: place.id,
    city: place.city,
    country: country || countryProfile?.name || '',
    countryCode: place.countryCode || countryProfile?.code,
    region: place.region,
    lat: place.lat,
    lng: place.lng,
    timezone: place.timezone ?? countryTimezone(place.countryCode || countryProfile?.code),
    currencyCode: place.currencyCode ?? countryProfile?.currency,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
  };
}

/** A stop typed by hand or recovered from an older record. */
export function manualDestination(city: string, country = ''): TripDestination {
  const countryProfile = findCountry(country);
  const center = lookupCityCenter(city);
  const countryCode = countryProfile?.code;
  return {
    id: createDestinationId({ city, countryCode }),
    city,
    country: country || countryProfile?.name || '',
    countryCode,
    lat: center?.[0],
    lng: center?.[1],
    timezone: countryTimezone(countryCode),
    currencyCode: countryProfile?.currency,
    provider: 'manual',
  };
}

export interface CountryTally {
  country: string;
  countryCode?: string;
  stops: number;
}

/**
 * Countries in the trip, most-visited first. Ties keep the order they were
 * added, so a two-country trip resolves predictably instead of depending on
 * whichever stop happened to be saved first.
 */
export function countryBreakdown(profile: TripProfile): CountryTally[] {
  const tallies: CountryTally[] = [];
  for (const destination of profile.destinations) {
    const country = destination.country?.trim();
    if (!country) continue;
    const existing = tallies.find(
      (tally) => tally.country.toLowerCase() === country.toLowerCase(),
    );
    if (existing) {
      existing.stops += 1;
      existing.countryCode = existing.countryCode || destination.countryCode;
    } else {
      tallies.push({ country, countryCode: destination.countryCode, stops: 1 });
    }
  }
  return tallies.sort((left, right) => right.stops - left.stops);
}

/** The country the handbook is themed and priced around. */
export function primaryCountry(profile: TripProfile): string {
  return countryBreakdown(profile)[0]?.country || '';
}

export const isMultiCountry = (profile: TripProfile): boolean =>
  countryBreakdown(profile).length > 1;

/** Every currency the trip will actually spend in, primary first. */
export function destinationCurrencies(profile: TripProfile): string[] {
  const codes = countryBreakdown(profile)
    .map((tally) => findCountry(tally.countryCode || tally.country)?.currency)
    .filter((code): code is string => Boolean(code));
  return Array.from(new Set(codes));
}

/** "Kyoto, Kyoto Prefecture · Japan" — enough to tell two Georgetowns apart. */
export function describeDestination(destination: TripDestination): string {
  const place = [destination.city, destination.region].filter(Boolean).join(', ');
  return destination.country ? `${place} · ${destination.country}` : place;
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

/**
 * A stored stay plan, filtered to cities the trip still has.
 *
 * Deliberately dumb: it validates shape and membership and nothing else. The
 * plan may be incomplete, over-spent, or all zeroes — those are states the
 * traveller is in the middle of, not corruption to repair behind their back.
 */
function sanitizeCityStays(value: unknown, cities: string[]): TripCityStay[] | undefined {
  if (!Array.isArray(value) || cities.length === 0) return undefined;
  const byKey = new Map(cities.map((city) => [city.toLowerCase(), city]));
  const seen = new Set<string>();
  const stays: TripCityStay[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Partial<TripCityStay>;
    const key = typeof item.city === 'string' ? item.city.trim().toLowerCase() : '';
    const city = byKey.get(key);
    if (!city || seen.has(key)) continue;
    seen.add(key);
    const days = typeof item.days === 'number' && Number.isFinite(item.days)
      ? Math.max(0, Math.floor(item.days))
      : 0;
    stays.push({ city, days });
  }

  return stays.length > 0 ? stays : undefined;
}

export function sanitizeTripProfile(value: unknown): TripProfile | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<TripProfile> & Record<string, unknown>;

  const destinations: TripDestination[] = Array.isArray(source.destinations)
    ? source.destinations.flatMap((entry): TripDestination[] => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Partial<TripDestination>;
        const city = typeof item.city === 'string' ? item.city.trim() : '';
        if (!city) return [];

        const country = typeof item.country === 'string' ? item.country.trim() : '';
        // Records saved before structured destinations existed carry only a
        // city and country, so the rest is recovered from the country catalog.
        const countryProfile = findCountry(item.countryCode || country);
        const countryCode = item.countryCode?.toUpperCase() || countryProfile?.code;
        const offlineCenter = lookupCityCenter(city);
        const lat = typeof item.lat === 'number' && Number.isFinite(item.lat) ? item.lat : offlineCenter?.[0];
        const lng = typeof item.lng === 'number' && Number.isFinite(item.lng) ? item.lng : offlineCenter?.[1];

        return [{
          id: typeof item.id === 'string' && item.id.trim()
            ? item.id.trim()
            : createDestinationId({ city, countryCode, providerPlaceId: item.providerPlaceId }),
          city,
          country: country || countryProfile?.name || '',
          countryCode,
          region: typeof item.region === 'string' && item.region.trim() ? item.region.trim() : undefined,
          lat,
          lng,
          timezone: typeof item.timezone === 'string' && item.timezone.trim()
            ? item.timezone.trim()
            : countryTimezone(countryCode),
          currencyCode: typeof item.currencyCode === 'string' && item.currencyCode.trim()
            ? item.currencyCode.trim().toUpperCase()
            : countryProfile?.currency,
          provider: item.provider === 'nominatim' || item.provider === 'offline' ? item.provider : 'manual',
          providerPlaceId: typeof item.providerPlaceId === 'string' ? item.providerPlaceId : undefined,
        }];
      })
    : [];

  if (destinations.length === 0 && !source.startDate && !source.dayCount) return null;

  const base = createEmptyProfile();
  const duration = sanitizeDurationFields({
    startDate: typeof source.startDate === 'string' ? source.startDate : undefined,
    endDate: typeof source.endDate === 'string' ? source.endDate : undefined,
    dayCount: typeof source.dayCount === 'number' && Number.isFinite(source.dayCount) ? source.dayCount : 0,
  });

  const visualDesign = sanitizeTripVisualDesign(
    source.visualDesign,
    source.applyVisualIdentity !== false,
  );

  return {
    ...base,
    destinations,
    startDate: duration.startDate,
    endDate: duration.endDate,
    arrivalTime: sanitizeClockTime(source.arrivalTime),
    departureTime: sanitizeClockTime(source.departureTime),
    dayCount: duration.dayCount,
    /**
     * Kept only for cities still on the trip, in the order it was saved in —
     * that order is the route. Nothing is rebalanced here: a plan that no
     * longer adds up is the traveller's to resolve, and the wizard shows them
     * what is left. Undefined when there is nothing to divide.
     */
    cityStays: sanitizeCityStays(source.cityStays, destinations.map((entry) => entry.city)),
    cityStayDayCount: typeof source.cityStayDayCount === 'number' && Number.isFinite(source.cityStayDayCount)
      ? Math.max(0, Math.floor(source.cityStayDayCount))
      : undefined,
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
    applyVisualIdentity: applyVisualIdentityFromIntensity(visualDesign.intensity),
    visualDesign,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : base.createdAt,
  };
}

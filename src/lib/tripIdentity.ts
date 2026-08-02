/**
 * Turns a TripProfile into the generated identity every screen reads from:
 * copy, badges, labels, and the colour palette for the handbook.
 */

import type { DestinationPalette } from './destinations';
import {
  destinationCities,
  primaryCountry,
  profileCountryProfile,
  resolveDuration,
  resolveSeason,
  type BudgetTier,
  type TravelStyle,
  type TripMood,
  type TripProfile,
  type TripType,
} from './tripProfile';

export interface TripIdentity {
  brandTitle: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  primaryButtonLabel: string;
  secondaryButtonLabel: string;
  dayBadgeValue: string;
  dayBadgeUnit: string;
  coverHeadline: string;
  coverLabel: string;
  coverYear: string;
  marqueeItems: string[];
  overviewEyebrow: string;
  overviewDescription: string;
  searchPlaceholder: string;
  tagline: string;
  palette: DestinationPalette;
  summaryChips: string[];
}

export interface IdentityContext {
  /** Days already written into the handbook. */
  plannedDays?: number;
  /** Overrides "today" in tests. */
  now?: Date;
}

const hashSeed = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pick = <T>(options: T[], seed: number, salt = 0): T => options[(seed + salt) % options.length];

export function formatList(items: string[], conjunction = 'and'): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} ${conjunction} ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} ${conjunction} ${clean[clean.length - 1]}`;
}

const TYPE_NOUNS: Record<TripType, string> = {
  relaxation: 'escape',
  adventure: 'adventure',
  food: 'food journey',
  photography: 'photo journey',
  luxury: 'luxury escape',
  family: 'family trip',
  solo: 'solo journey',
  couple: 'getaway',
  friends: 'road trip',
  business: 'working trip',
};

const MOOD_ADJECTIVES: Record<TripMood, string> = {
  calm: 'calm',
  luxury: 'polished',
  romantic: 'romantic',
  'fast-paced': 'fast-moving',
  'slow-living': 'slow',
  minimal: 'simple',
  'hidden-gems': 'off-the-map',
  festive: 'festive',
};

const STYLE_PHRASES: Record<TravelStyle, string> = {
  cafes: 'quiet cafés',
  'street-food': 'street food stalls',
  'night-markets': 'night markets',
  temples: 'old temples',
  museums: 'museums',
  history: 'historic corners',
  architecture: 'striking architecture',
  shopping: 'shopping streets',
  mountains: 'mountain views',
  hiking: 'walking trails',
  nature: 'green spaces',
  beaches: 'slow beach afternoons',
  wildlife: 'wildlife spotting',
  'scenic-train': 'scenic train rides',
  anime: 'pop culture stops',
  nightlife: 'late evenings out',
};

const SEARCH_HINTS: Partial<Record<TravelStyle, string>> = {
  cafes: 'cafés',
  'street-food': 'street food',
  'night-markets': 'markets',
  temples: 'temples',
  museums: 'museums',
  history: 'old town spots',
  architecture: 'landmarks',
  shopping: 'shops',
  mountains: 'viewpoints',
  hiking: 'trails',
  nature: 'parks',
  beaches: 'beaches',
  wildlife: 'wildlife stops',
  'scenic-train': 'stations',
  anime: 'anime spots',
  nightlife: 'bars',
};

const BUDGET_PHRASES: Record<BudgetTier, string> = {
  budget: 'without overspending',
  'mid-range': 'at a comfortable pace',
  luxury: 'with room to indulge',
};

const titleCase = (value: string) =>
  value.replace(/\b[a-z]/g, (character) => character.toUpperCase());

const capitalize = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

function durationLabel(days: number): { value: string; unit: string } {
  if (days <= 0) return { value: '0', unit: 'days' };
  if (days === 1) return { value: '1', unit: 'day' };
  if (days === 2 || days === 3) return { value: String(days), unit: 'days' };
  if (days % 7 === 0 && days >= 14) return { value: String(days / 7), unit: days / 7 === 1 ? 'week' : 'weeks' };
  return { value: String(days), unit: 'days' };
}

export function buildTripIdentity(profile: TripProfile, context: IdentityContext = {}): TripIdentity {
  const cities = destinationCities(profile);
  const country = primaryCountry(profile);
  const countryProfile = profileCountryProfile(profile);
  const { days } = resolveDuration(profile);
  const firstPoint = profile.destinations.find((destination) => typeof destination.lat === 'number');
  const season = resolveSeason(profile.startDate, firstPoint?.lat);
  const seed = hashSeed(`${cities.join('|')}|${country}|${profile.createdAt}`);

  const place = cities[0] || country || 'your next trip';
  const placeList = formatList(cities.length > 0 ? cities : [country].filter(Boolean));
  const anchor = cities.length > 0 ? placeList : country || 'somewhere new';

  const type = profile.tripTypes[0];
  const mood = profile.moods[0];
  const typeNoun = type ? TYPE_NOUNS[type] : 'journey';
  const moodAdjective = mood ? MOOD_ADJECTIVES[mood] : '';
  const seasonWord = season ?? '';
  const year = profile.startDate ? new Date(`${profile.startDate}T00:00:00`).getFullYear() : new Date().getFullYear();

  const stylePhrases = profile.styles.slice(0, 3).map((style) => STYLE_PHRASES[style]);
  const motifs = countryProfile.motifs;
  const highlights = stylePhrases.length > 0 ? stylePhrases : motifs.slice(0, 3);

  const brandBase = country || cities[0] || '';
  const brandTitle = profile.brandAfterDestination && brandBase
    ? pick(
        [
          `${titleCase(brandBase)} Handbook`,
          `${titleCase(cities[0] || brandBase)} Journal`,
          seasonWord ? `${capitalize(seasonWord)} ${titleCase(brandBase)}` : `${titleCase(brandBase)} Notes`,
          `The ${titleCase(cities[0] || brandBase)} Story`,
        ],
        seed,
      )
    : 'Travel Handbook';

  const heroTitleOptions = [
    [titleCase(place), seasonWord ? capitalize(seasonWord) : '', String(year)].filter(Boolean).join(' '),
    type ? `${titleCase(place)} ${titleCase(TYPE_NOUNS[type])}` : `${titleCase(place)} ${year}`,
    cities.length > 1 ? `${titleCase(cities[0])} to ${titleCase(cities[cities.length - 1])}` : `${titleCase(place)} ${year}`,
    seasonWord ? `${capitalize(seasonWord)} in ${titleCase(place)}` : `${titleCase(place)} Journey`,
  ].filter((option) => option.trim().length > 0);
  const heroTitle = cities.length > 0 || country ? pick(heroTitleOptions, seed, 1) : 'New Trip';

  const eyebrowLead = [moodAdjective, seasonWord].filter(Boolean).join(' ');
  const heroEyebrow = anchor
    ? capitalize(`a ${eyebrowLead ? `${eyebrowLead} ` : ''}${typeNoun} through ${anchor}.`)
    : 'A personalized travel starter';

  const durationClause = days > 0 ? ` over ${days} ${days === 1 ? 'day' : 'days'}` : '';
  const heroDescription = anchor
    ? `Discover ${formatList(highlights)} across ${anchor}${durationClause}, ${BUDGET_PHRASES[profile.budgetTier]}.`
    : 'Start with a blank travel handbook and shape every day your way.';

  const plannedDays = context.plannedDays ?? 0;
  const now = context.now ?? new Date();
  const start = profile.startDate ? new Date(`${profile.startDate}T00:00:00`) : null;
  const end = profile.endDate ? new Date(`${profile.endDate}T23:59:59`) : null;
  const tripInProgress = Boolean(start && end && now >= start && now <= end);
  const currentDay = tripInProgress && start
    ? Math.min(days || 1, Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1)
    : 0;

  const primaryButtonLabel = tripInProgress && currentDay > 0
    ? `Continue day ${currentDay}`
    : plannedDays > 0
      ? 'Start day 1'
      : cities.length > 0
        ? 'Continue planning'
        : 'Open the itinerary';

  const secondaryButtonLabel = cities.length > 1 ? 'Explore the route' : 'See the map';

  const badge = durationLabel(days);

  const coverHeadline = pick(
    [
      'Every great journey deserves a first page.',
      'Waiting for your first memory.',
      `${titleCase(place)} begins here.`,
      'Add a cover when your story takes shape.',
    ],
    seed,
    2,
  );

  const overviewEyebrow = cities.length > 0
    ? pick(
        [
          `Your ${titleCase(place)} story`,
          'Explore one day at a time',
          'Every day has a new view',
          mood === 'slow-living' || mood === 'calm' ? 'A slow travel guide' : 'The itinerary · day by day',
        ],
        seed,
        3,
      )
    : 'The itinerary · day by day';

  const overviewDescription = anchor
    ? `${days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'Days'} shaped around ${formatList(highlights)} in ${anchor}.`
    : 'A day-by-day field guide for good food, quiet sights, and room to wander.';

  const searchTargets = profile.styles
    .map((style) => SEARCH_HINTS[style])
    .filter((hint): hint is string => Boolean(hint))
    .slice(0, 2);
  const searchPlaceholder = searchTargets.length > 0
    ? `Search ${formatList([...searchTargets, 'anything else'], 'or')}…`
    : 'Search itinerary, phrases, locations...';

  const marqueeItems = Array.from(new Set([
    brandTitle,
    ...cities.slice(0, 2).map(titleCase),
    type ? titleCase(TYPE_NOUNS[type]) : 'Plans',
    'Maps',
    'Photos',
  ]));

  const tagline = anchor
    ? capitalize(`a ${moodAdjective || 'memorable'} ${typeNoun} through ${anchor}.`)
    : 'A travel handbook waiting for its first page.';

  const summaryChips = [
    days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : null,
    cities.length > 0 ? `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}` : null,
    seasonWord ? capitalize(seasonWord) : null,
    type ? titleCase(TYPE_NOUNS[type]) : null,
    `${capitalize(profile.budgetTier.replace('-', ' '))} budget`,
  ].filter((chip): chip is string => Boolean(chip));

  return {
    brandTitle,
    heroEyebrow,
    heroTitle,
    heroDescription,
    primaryButtonLabel,
    secondaryButtonLabel,
    dayBadgeValue: badge.value,
    dayBadgeUnit: badge.unit,
    coverHeadline,
    coverLabel: cities.length > 0 ? cities.map(titleCase).join(' · ') : 'Custom cover',
    coverYear: String(year),
    marqueeItems,
    overviewEyebrow,
    overviewDescription,
    searchPlaceholder,
    tagline,
    palette: countryProfile.palette,
    summaryChips,
  };
}

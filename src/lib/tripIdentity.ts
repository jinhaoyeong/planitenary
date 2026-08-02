/**
 * Turns a TripProfile into the generated identity every screen reads from:
 * copy, badges, labels, and the colour palette for the handbook.
 *
 * Each field draws on its own vocabulary and its own set of templates, and
 * candidates that read too much like copy already chosen for another field are
 * skipped. Two paragraphs generated for the same trip should sound like they
 * were written together, not duplicated.
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
  /** Empty when the trip has no duration yet; the badge is hidden instead. */
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

/** Character budgets, so no generated line can overflow its slot. */
const LIMITS = {
  brandTitle: 28,
  heroTitle: 42,
  heroEyebrow: 72,
  heroDescription: 165,
  coverHeadline: 62,
  overviewEyebrow: 40,
  overviewDescription: 135,
  searchPlaceholder: 50,
  tagline: 90,
} as const;

const hashSeed = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

export function formatList(items: string[], conjunction = 'and'): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} ${conjunction} ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} ${conjunction} ${clean[clean.length - 1]}`;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'across', 'through', 'into', 'over', 'from', 'your', 'you',
  'about', 'that', 'this', 'each', 'every', 'some', 'all', 'day', 'days', 'trip', 'plan',
  'plans', 'planned', 'room', 'shaped', 'built', 'around', 'where', 'what', 'when',
]);

const meaningfulTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );

/**
 * How much two generated lines overlap, 0 to 1, measured against the shorter
 * of the two so a long sentence cannot hide a repeated short one.
 */
export function copySimilarity(left: string, right: string): number {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

const SIMILARITY_LIMIT = 0.5;

interface ChoiceOptions {
  seed: number;
  salt?: number;
  limit: number;
  /** Copy already chosen for other fields; near-duplicates are skipped. */
  avoid?: string[];
  fallback: string;
}

/**
 * Deterministically picks a template that fits its character budget and does
 * not echo copy already used elsewhere. Falls back to a short safe line when
 * no candidate qualifies.
 */
function choose(candidates: string[], { seed, salt = 0, limit, avoid = [], fallback }: ChoiceOptions): string {
  const usable = candidates
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
    .filter((candidate) => candidate.length > 0);
  if (usable.length === 0) return fallback;

  const start = (seed + salt) % usable.length;
  const ordered = [...usable.slice(start), ...usable.slice(0, start)];

  const withinLimit = ordered.filter((candidate) => candidate.length <= limit);
  const pool = withinLimit.length > 0 ? withinLimit : ordered;

  const distinct = pool.find(
    (candidate) => !avoid.some((other) => copySimilarity(candidate, other) > SIMILARITY_LIMIT),
  );

  return distinct ?? pool[0] ?? fallback;
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

/** Hero vocabulary: places and things, phrased as nouns. */
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

/** Overview vocabulary: the same interests phrased as things you do. */
const STYLE_MOMENTS: Record<TravelStyle, string> = {
  cafes: 'slow coffee mornings',
  'street-food': 'eating standing up',
  'night-markets': 'wandering after dark',
  temples: 'temple walks',
  museums: 'gallery hours',
  history: 'stories worth the detour',
  architecture: 'buildings to stand under',
  shopping: 'browsing without a list',
  mountains: 'climbing for the view',
  hiking: 'long walks',
  nature: 'time outdoors',
  beaches: 'afternoons by the water',
  wildlife: 'patient animal watching',
  'scenic-train': 'window seats',
  anime: 'fan pilgrimages',
  nightlife: 'nights that run late',
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

const BUDGET_CHIPS: Record<BudgetTier, string> = {
  budget: 'Budget-friendly',
  'mid-range': 'Mid-range',
  luxury: 'Luxury',
};

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

const numberWord = (value: number) =>
  value >= 0 && value < NUMBER_WORDS.length ? NUMBER_WORDS[value] : String(value);

const titleCase = (value: string) =>
  value.replace(/\b[a-z]/g, (character) => character.toUpperCase());

const capitalize = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/** An undated trip returns empty strings so the badge can be hidden entirely. */
function durationLabel(days: number): { value: string; unit: string } {
  if (days <= 0) return { value: '', unit: '' };
  if (days === 1) return { value: '1', unit: 'day' };
  if (days % 7 === 0 && days >= 14) return { value: String(days / 7), unit: days / 7 === 1 ? 'week' : 'weeks' };
  return { value: String(days), unit: 'days' };
}

export function buildTripIdentity(profile: TripProfile, context: IdentityContext = {}): TripIdentity {
  const cities = destinationCities(profile);
  const country = primaryCountry(profile);
  const countryProfile = profileCountryProfile(profile);
  const { days } = resolveDuration(profile);
  const hasDuration = days > 0;
  const firstPoint = profile.destinations.find((destination) => typeof destination.lat === 'number');
  const season = resolveSeason(profile.startDate, firstPoint?.lat);
  const seed = hashSeed(`${cities.join('|')}|${country}|${profile.createdAt}`);

  const place = cities[0] || country || 'your next trip';
  const placeList = formatList(cities.length > 0 ? cities : [country].filter(Boolean));
  const anchor = cities.length > 0 ? placeList : country;
  const hasPlace = anchor.length > 0;

  const type = profile.tripTypes[0];
  const mood = profile.moods[0];
  const typeNoun = type ? TYPE_NOUNS[type] : 'journey';
  const moodAdjective = mood ? MOOD_ADJECTIVES[mood] : '';
  const seasonWord = season ?? '';
  const year = profile.startDate ? new Date(`${profile.startDate}T00:00:00`).getFullYear() : new Date().getFullYear();

  const motifs = countryProfile.motifs;
  const heroHighlights = formatList(
    profile.styles.length > 0
      ? profile.styles.slice(0, 3).map((style) => STYLE_PHRASES[style])
      : motifs.slice(0, 2),
  );
  // Deliberately a different word pool from the hero so the two paragraphs
  // never restate each other.
  const overviewMoments = formatList(
    profile.styles.length > 0
      ? profile.styles.slice(0, 2).map((style) => STYLE_MOMENTS[style])
      : ['unhurried exploring', 'good food'],
  );

  const dayCount = hasDuration ? `${days} ${days === 1 ? 'day' : 'days'}` : '';
  const dayWords = hasDuration ? `${numberWord(days)} ${days === 1 ? 'day' : 'days'}` : '';

  const brandTitle = profile.brandAfterDestination && (country || cities[0])
    ? choose(
        [
          `${titleCase(country || cities[0])} Handbook`,
          `${titleCase(cities[0] || country)} Journal`,
          seasonWord ? `${capitalize(seasonWord)} in ${titleCase(cities[0] || country)}` : `${titleCase(country || cities[0])} Notes`,
          `The ${titleCase(cities[0] || country)} Story`,
        ],
        { seed, limit: LIMITS.brandTitle, fallback: 'Travel Handbook' },
      )
    : 'Travel Handbook';

  const heroTitle = hasPlace
    ? choose(
        [
          [titleCase(place), seasonWord ? capitalize(seasonWord) : '', String(year)].filter(Boolean).join(' '),
          type ? `${titleCase(place)} ${titleCase(TYPE_NOUNS[type])}` : '',
          cities.length > 1 ? `${titleCase(cities[0])} to ${titleCase(cities[cities.length - 1])}` : '',
          seasonWord ? `${capitalize(seasonWord)} in ${titleCase(place)}` : '',
          `${titleCase(place)} ${year}`,
        ],
        { seed, salt: 1, limit: LIMITS.heroTitle, fallback: `${titleCase(place)} ${year}` },
      )
    : 'New Trip';

  const heroEyebrow = hasPlace
    ? choose(
        [
          capitalize(`a ${[moodAdjective, seasonWord].filter(Boolean).join(' ')} ${typeNoun} through ${anchor}.`.replace(/\s+/g, ' ')),
          capitalize(`${moodAdjective || seasonWord || 'an unhurried'} days in ${anchor}.`),
          `${titleCase(anchor)}, ${moodAdjective ? `${moodAdjective} and unhurried` : 'on your own terms'}.`,
        ],
        { seed, salt: 2, limit: LIMITS.heroEyebrow, avoid: [heroTitle], fallback: `A ${typeNoun} through ${anchor}.` },
      )
    : 'A personalized travel starter';

  const heroDescription = hasPlace
    ? choose(
        [
          `Discover ${heroHighlights} across ${anchor}${hasDuration ? ` over ${dayCount}` : ''}, ${BUDGET_PHRASES[profile.budgetTier]}.`,
          hasDuration
            ? `${capitalize(dayWords)} of ${heroHighlights} in ${anchor}, ${BUDGET_PHRASES[profile.budgetTier]}.`
            : `${capitalize(heroHighlights)} in ${anchor}, ${BUDGET_PHRASES[profile.budgetTier]}.`,
          `A ${moodAdjective ? `${moodAdjective} ` : ''}${typeNoun} built around ${heroHighlights}${hasDuration ? `, ${dayCount} in all` : ''}.`,
          `${titleCase(anchor)} on your terms: ${heroHighlights}, ${BUDGET_PHRASES[profile.budgetTier]}.`,
        ],
        {
          seed,
          salt: 3,
          limit: LIMITS.heroDescription,
          avoid: [heroEyebrow],
          fallback: `A ${typeNoun} through ${anchor}.`,
        },
      )
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
      : hasPlace && !hasDuration
        ? 'Add your dates'
        : hasPlace
          ? 'Continue planning'
          : 'Open the itinerary';

  const secondaryButtonLabel = cities.length > 1 ? 'Explore the route' : 'See the map';

  const badge = durationLabel(days);

  const coverHeadline = choose(
    [
      'Every great journey deserves a first page.',
      'Waiting for your first memory.',
      hasPlace ? `${titleCase(place)} begins here.` : '',
      'Add a cover when your story takes shape.',
    ],
    {
      seed,
      salt: 4,
      limit: LIMITS.coverHeadline,
      avoid: [heroDescription, heroEyebrow],
      fallback: 'Every great journey deserves a first page.',
    },
  );

  const overviewEyebrow = hasPlace
    ? choose(
        [
          `Your ${titleCase(place)} story`,
          'Explore one day at a time',
          'Every day has a new view',
          mood === 'slow-living' || mood === 'calm' ? 'A slow travel guide' : 'The itinerary, day by day',
        ],
        {
          seed,
          salt: 5,
          limit: LIMITS.overviewEyebrow,
          avoid: [heroTitle, heroEyebrow],
          fallback: 'The itinerary, day by day',
        },
      )
    : 'The itinerary, day by day';

  const overviewDescription = hasPlace
    ? choose(
        [
          hasDuration
            ? `${capitalize(dayWords)} planned around ${overviewMoments}.`
            : `Planned around ${overviewMoments}.`,
          `Each day leans into ${overviewMoments}.`,
          `Made for ${overviewMoments}, with space to change your mind.`,
          `${titleCase(anchor)}, one day at a time: ${overviewMoments}.`,
        ],
        {
          seed,
          salt: 6,
          limit: LIMITS.overviewDescription,
          avoid: [heroDescription, heroEyebrow, coverHeadline],
          fallback: `Made for ${overviewMoments}.`,
        },
      )
    : 'A day-by-day field guide for good food, quiet sights, and room to wander.';

  const searchTargets = profile.styles
    .map((style) => SEARCH_HINTS[style])
    .filter((hint): hint is string => Boolean(hint))
    .slice(0, 2);
  const searchPlaceholder = choose(
    searchTargets.length > 0
      ? [
          `Search ${formatList([...searchTargets, 'anything else'], 'or')}…`,
          `Search ${formatList(searchTargets, 'or')}…`,
          `Find ${searchTargets[0]} and more…`,
        ]
      : [],
    {
      seed,
      salt: 7,
      limit: LIMITS.searchPlaceholder,
      fallback: 'Search itinerary, phrases, locations…',
    },
  );

  const marqueeItems = Array.from(new Set([
    brandTitle,
    ...cities.slice(0, 2).map(titleCase),
    type ? titleCase(TYPE_NOUNS[type]) : 'Plans',
    'Maps',
    'Photos',
  ]));

  const tagline = hasPlace
    ? choose(
        [
          capitalize(`a ${moodAdjective || 'memorable'} ${typeNoun} through ${anchor}.`),
          `${titleCase(anchor)}, taken ${moodAdjective ? `${moodAdjective}ly` : 'slowly'}.`,
        ],
        { seed, salt: 8, limit: LIMITS.tagline, fallback: `A ${typeNoun} through ${anchor}.` },
      )
    : 'A travel handbook waiting for its first page.';

  const summaryChips = [
    hasDuration ? dayCount : 'Dates not set',
    cities.length > 0 ? `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}` : null,
    seasonWord ? capitalize(seasonWord) : null,
    type ? titleCase(TYPE_NOUNS[type]) : null,
    BUDGET_CHIPS[profile.budgetTier],
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

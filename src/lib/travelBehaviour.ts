/**
 * Travel behaviour profile — the numbers that make a mood mean something.
 *
 * The v1 profile captured moods ("Calm", "Slow living", "Fast paced") but the
 * planner never consumed them, so every plan came out the same shape. This
 * module turns those qualitative choices into the concrete limits the scheduler
 * enforces: how many main stops a day can hold, when the day starts, how long a
 * meal really takes, how far someone is willing to walk before they are tired.
 *
 * Picking "Relaxed" must visibly change the itinerary. That is the contract.
 */

import type { TripMood, TripProfile, TripType } from './tripProfile';

export type TravelPace =
  | 'very-relaxed'
  | 'relaxed'
  | 'balanced'
  | 'active'
  | 'intensive';

export type CrowdTolerance = 'avoid' | 'moderate' | 'does-not-matter';
export type Spontaneity = 'fully-planned' | 'some-free-time' | 'mostly-flexible';
export type RecommendationMix = 'classic' | 'balanced' | 'trendy' | 'hidden-local';

export interface WalkingLimits {
  preferredDailyMinutes?: number;
  maximumDailyMinutes?: number;
  maximumContinuousMinutes?: number;
}

export interface MealPreferences {
  breakfastRequired: boolean;
  lunchWindow?: { start: string; end: string };
  dinnerWindow?: { start: string; end: string };
  dietaryNeeds: string[];
  preferredDiningMinutes?: number;
  /** Above this, a famous queue stops being worth it for this traveller. */
  maximumQueueMinutes?: number;
}

export interface ComfortPreferences {
  /** Never schedule two things closer together than this. */
  minimumTransitionBufferMinutes: number;
  avoidTooManyTransfers: boolean;
  requireRestAfterLongTravel: boolean;
  /** Keep an indoor option in reach when the forecast turns. */
  requireIndoorBackup: boolean;
}

export interface TravellerComposition {
  adults: number;
  children: number;
  seniors: number;
  mobilityNeeds: string[];
}

export interface TravelBehaviourProfile {
  pace: TravelPace;
  preferredStartTime?: string;
  preferredReturnTime?: string;
  maxMainActivitiesPerDay?: number;
  walking: WalkingLimits;
  meals: MealPreferences;
  comfort: ComfortPreferences;
  crowdTolerance: CrowdTolerance;
  spontaneity: Spontaneity;
  recommendationMix: RecommendationMix;
  travellers: TravellerComposition;
}

/**
 * The pace table. These are the defaults a traveller gets before they touch
 * anything, and they are what make relaxed and intensive produce materially
 * different days.
 */
export interface PaceDefaults {
  maxMainActivities: number;
  /** Extra low-commitment stops allowed nearby (a viewpoint, a coffee). */
  optionalActivities: number;
  startTime: string;
  latestReturnTime: string;
  transitionBufferMinutes: number;
  diningMinutes: number;
  /** Free, unscheduled minutes the day must preserve. */
  minimumFreeTimeMinutes: number;
  preferredWalkingMinutes: number;
  maximumWalkingMinutes: number;
  maximumContinuousWalkMinutes: number;
  maximumQueueMinutes: number;
}

export const PACE_DEFAULTS: Record<TravelPace, PaceDefaults> = {
  'very-relaxed': {
    maxMainActivities: 2,
    optionalActivities: 1,
    startTime: '10:30',
    latestReturnTime: '19:30',
    transitionBufferMinutes: 45,
    diningMinutes: 100,
    minimumFreeTimeMinutes: 150,
    preferredWalkingMinutes: 30,
    maximumWalkingMinutes: 55,
    maximumContinuousWalkMinutes: 15,
    maximumQueueMinutes: 15,
  },
  relaxed: {
    maxMainActivities: 2,
    optionalActivities: 1,
    startTime: '10:00',
    latestReturnTime: '20:30',
    transitionBufferMinutes: 35,
    diningMinutes: 85,
    minimumFreeTimeMinutes: 90,
    preferredWalkingMinutes: 45,
    maximumWalkingMinutes: 75,
    maximumContinuousWalkMinutes: 20,
    maximumQueueMinutes: 25,
  },
  balanced: {
    maxMainActivities: 3,
    optionalActivities: 1,
    startTime: '09:15',
    latestReturnTime: '21:30',
    transitionBufferMinutes: 25,
    diningMinutes: 70,
    minimumFreeTimeMinutes: 60,
    preferredWalkingMinutes: 65,
    maximumWalkingMinutes: 100,
    maximumContinuousWalkMinutes: 30,
    maximumQueueMinutes: 40,
  },
  active: {
    maxMainActivities: 4,
    optionalActivities: 2,
    startTime: '08:30',
    latestReturnTime: '22:00',
    transitionBufferMinutes: 18,
    diningMinutes: 55,
    minimumFreeTimeMinutes: 30,
    preferredWalkingMinutes: 90,
    maximumWalkingMinutes: 140,
    maximumContinuousWalkMinutes: 40,
    maximumQueueMinutes: 60,
  },
  intensive: {
    maxMainActivities: 5,
    optionalActivities: 2,
    startTime: '08:00',
    latestReturnTime: '22:30',
    transitionBufferMinutes: 12,
    diningMinutes: 45,
    minimumFreeTimeMinutes: 0,
    preferredWalkingMinutes: 110,
    maximumWalkingMinutes: 170,
    maximumContinuousWalkMinutes: 50,
    maximumQueueMinutes: 90,
  },
};

const PACE_ORDER: TravelPace[] = ['very-relaxed', 'relaxed', 'balanced', 'active', 'intensive'];

export const paceRank = (pace: TravelPace): number => PACE_ORDER.indexOf(pace);

/**
 * Mood → pace. The user already told us how they want the trip to feel; this
 * reads that intent rather than making them answer a second, near-identical
 * question. Explicit settings always win over anything inferred here.
 */
const MOOD_PACE: Partial<Record<TripMood, TravelPace>> = {
  'slow-living': 'very-relaxed',
  calm: 'relaxed',
  minimal: 'relaxed',
  romantic: 'relaxed',
  luxury: 'relaxed',
  'fast-paced': 'active',
  festive: 'balanced',
  'hidden-gems': 'balanced',
};

const TRIP_TYPE_PACE: Partial<Record<TripType, TravelPace>> = {
  relaxation: 'relaxed',
  family: 'relaxed',
  business: 'relaxed',
  adventure: 'active',
};

/**
 * Infer pace from what the traveller already chose. When moods conflict
 * ("Calm" plus "Fast paced"), the calmer reading wins — over-packing a day is
 * the failure a traveller actually feels, and an under-packed day leaves room
 * to add more.
 */
export function inferPace(profile: Pick<TripProfile, 'moods' | 'tripTypes'>): TravelPace {
  const signals: TravelPace[] = [
    ...profile.moods.map((mood) => MOOD_PACE[mood]),
    ...profile.tripTypes.map((type) => TRIP_TYPE_PACE[type]),
  ].filter((pace): pace is TravelPace => Boolean(pace));

  if (signals.length === 0) return 'balanced';
  return signals.reduce((slowest, pace) => (paceRank(pace) < paceRank(slowest) ? pace : slowest));
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const asTime = (value: unknown): string | undefined =>
  typeof value === 'string' && TIME_PATTERN.test(value.trim()) ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Explicit traveller settings. Every level is optional: setting one walking
 * limit must not force the caller to restate the rest of the profile.
 */
export interface TravelBehaviourOverrides {
  pace?: TravelPace;
  preferredStartTime?: string;
  preferredReturnTime?: string;
  maxMainActivitiesPerDay?: number;
  walking?: Partial<WalkingLimits>;
  meals?: Partial<MealPreferences>;
  comfort?: Partial<ComfortPreferences>;
  crowdTolerance?: CrowdTolerance;
  spontaneity?: Spontaneity;
  recommendationMix?: RecommendationMix;
  travellers?: Partial<TravellerComposition>;
}

/**
 * Build a behaviour profile from a v1 trip profile, honouring anything the
 * traveller set explicitly and deriving the rest from their moods.
 *
 * Migration mapping, as required:
 *   Relaxation / Calm → relaxed · Slow living → very-relaxed
 *   Fast paced → active · no mood → balanced
 */
export function deriveTravelBehaviour(
  profile: Pick<TripProfile, 'moods' | 'tripTypes'>,
  explicit?: TravelBehaviourOverrides,
): TravelBehaviourProfile {
  const pace = explicit?.pace ?? inferPace(profile);
  const defaults = PACE_DEFAULTS[pace];

  return {
    pace,
    preferredStartTime: explicit?.preferredStartTime ?? defaults.startTime,
    preferredReturnTime: explicit?.preferredReturnTime ?? defaults.latestReturnTime,
    maxMainActivitiesPerDay: explicit?.maxMainActivitiesPerDay ?? defaults.maxMainActivities,
    walking: {
      preferredDailyMinutes: explicit?.walking?.preferredDailyMinutes ?? defaults.preferredWalkingMinutes,
      maximumDailyMinutes: explicit?.walking?.maximumDailyMinutes ?? defaults.maximumWalkingMinutes,
      maximumContinuousMinutes:
        explicit?.walking?.maximumContinuousMinutes ?? defaults.maximumContinuousWalkMinutes,
    },
    meals: {
      breakfastRequired: explicit?.meals?.breakfastRequired ?? false,
      lunchWindow: explicit?.meals?.lunchWindow ?? { start: '12:00', end: '14:00' },
      dinnerWindow: explicit?.meals?.dinnerWindow ?? { start: '18:30', end: '20:30' },
      dietaryNeeds: explicit?.meals?.dietaryNeeds ?? [],
      preferredDiningMinutes: explicit?.meals?.preferredDiningMinutes ?? defaults.diningMinutes,
      maximumQueueMinutes: explicit?.meals?.maximumQueueMinutes ?? defaults.maximumQueueMinutes,
    },
    comfort: {
      minimumTransitionBufferMinutes:
        explicit?.comfort?.minimumTransitionBufferMinutes ?? defaults.transitionBufferMinutes,
      avoidTooManyTransfers: explicit?.comfort?.avoidTooManyTransfers ?? paceRank(pace) <= paceRank('relaxed'),
      requireRestAfterLongTravel:
        explicit?.comfort?.requireRestAfterLongTravel ?? paceRank(pace) <= paceRank('relaxed'),
      requireIndoorBackup: explicit?.comfort?.requireIndoorBackup ?? false,
    },
    crowdTolerance: explicit?.crowdTolerance
      ?? (paceRank(pace) <= paceRank('relaxed') ? 'avoid' : 'moderate'),
    spontaneity: explicit?.spontaneity
      ?? (paceRank(pace) <= paceRank('relaxed') ? 'mostly-flexible' : 'some-free-time'),
    recommendationMix: explicit?.recommendationMix ?? 'balanced',
    travellers: {
      adults: explicit?.travellers?.adults ?? 1,
      children: explicit?.travellers?.children ?? 0,
      seniors: explicit?.travellers?.seniors ?? 0,
      mobilityNeeds: explicit?.travellers?.mobilityNeeds ?? [],
    },
  };
}

/**
 * Recover a stored behaviour profile without ever silently discarding a
 * traveller's explicit choice. Unknown or corrupt fields fall back to the pace
 * defaults; valid ones are preserved exactly.
 */
export function sanitizeTravelBehaviour(
  value: unknown,
  profile: Pick<TripProfile, 'moods' | 'tripTypes'>,
): TravelBehaviourProfile {
  if (!value || typeof value !== 'object') return deriveTravelBehaviour(profile);
  const source = value as Record<string, unknown>;
  const pace = PACE_ORDER.includes(source.pace as TravelPace) ? (source.pace as TravelPace) : undefined;
  const defaults = PACE_DEFAULTS[pace ?? inferPace(profile)];

  const walking = (source.walking || {}) as Record<string, unknown>;
  const meals = (source.meals || {}) as Record<string, unknown>;
  const comfort = (source.comfort || {}) as Record<string, unknown>;
  const travellers = (source.travellers || {}) as Record<string, unknown>;

  const window = (input: unknown, fallback: { start: string; end: string }) => {
    const raw = (input || {}) as Record<string, unknown>;
    const start = asTime(raw.start);
    const end = asTime(raw.end);
    return start && end ? { start, end } : fallback;
  };

  return deriveTravelBehaviour(profile, {
    pace,
    preferredStartTime: asTime(source.preferredStartTime),
    preferredReturnTime: asTime(source.preferredReturnTime),
    maxMainActivitiesPerDay: typeof source.maxMainActivitiesPerDay === 'number'
      ? clampInt(source.maxMainActivitiesPerDay, 1, 8, defaults.maxMainActivities)
      : undefined,
    walking: {
      preferredDailyMinutes: typeof walking.preferredDailyMinutes === 'number'
        ? clampInt(walking.preferredDailyMinutes, 0, 480, defaults.preferredWalkingMinutes)
        : undefined,
      maximumDailyMinutes: typeof walking.maximumDailyMinutes === 'number'
        ? clampInt(walking.maximumDailyMinutes, 0, 600, defaults.maximumWalkingMinutes)
        : undefined,
      maximumContinuousMinutes: typeof walking.maximumContinuousMinutes === 'number'
        ? clampInt(walking.maximumContinuousMinutes, 0, 180, defaults.maximumContinuousWalkMinutes)
        : undefined,
    },
    meals: {
      breakfastRequired: meals.breakfastRequired === true,
      lunchWindow: window(meals.lunchWindow, { start: '12:00', end: '14:00' }),
      dinnerWindow: window(meals.dinnerWindow, { start: '18:30', end: '20:30' }),
      dietaryNeeds: asStringArray(meals.dietaryNeeds),
      preferredDiningMinutes: typeof meals.preferredDiningMinutes === 'number'
        ? clampInt(meals.preferredDiningMinutes, 15, 240, defaults.diningMinutes)
        : undefined,
      maximumQueueMinutes: typeof meals.maximumQueueMinutes === 'number'
        ? clampInt(meals.maximumQueueMinutes, 0, 240, defaults.maximumQueueMinutes)
        : undefined,
    },
    comfort: {
      minimumTransitionBufferMinutes: typeof comfort.minimumTransitionBufferMinutes === 'number'
        ? clampInt(comfort.minimumTransitionBufferMinutes, 0, 120, defaults.transitionBufferMinutes)
        : defaults.transitionBufferMinutes,
      avoidTooManyTransfers: typeof comfort.avoidTooManyTransfers === 'boolean'
        ? comfort.avoidTooManyTransfers
        : undefined,
      requireRestAfterLongTravel: typeof comfort.requireRestAfterLongTravel === 'boolean'
        ? comfort.requireRestAfterLongTravel
        : undefined,
      requireIndoorBackup: comfort.requireIndoorBackup === true,
    },
    crowdTolerance: ['avoid', 'moderate', 'does-not-matter'].includes(source.crowdTolerance as string)
      ? (source.crowdTolerance as CrowdTolerance)
      : undefined,
    spontaneity: ['fully-planned', 'some-free-time', 'mostly-flexible'].includes(source.spontaneity as string)
      ? (source.spontaneity as Spontaneity)
      : undefined,
    recommendationMix: ['classic', 'balanced', 'trendy', 'hidden-local'].includes(source.recommendationMix as string)
      ? (source.recommendationMix as RecommendationMix)
      : undefined,
    travellers: {
      adults: clampInt(travellers.adults, 1, 20, 1),
      children: clampInt(travellers.children, 0, 20, 0),
      seniors: clampInt(travellers.seniors, 0, 20, 0),
      mobilityNeeds: asStringArray(travellers.mobilityNeeds),
    },
  });
}

/**
 * Mobility needs and very young or elderly travellers override the pace table:
 * an "active" pace with a toddler is still not four museums before lunch.
 */
export function applyTravellerConstraints(behaviour: TravelBehaviourProfile): TravelBehaviourProfile {
  const { travellers } = behaviour;
  const needsGentlerDay = travellers.mobilityNeeds.length > 0
    || travellers.children > 0
    || travellers.seniors > 0;
  if (!needsGentlerDay) return behaviour;

  const walkingCeiling = travellers.mobilityNeeds.length > 0 ? 45 : 90;
  return {
    ...behaviour,
    maxMainActivitiesPerDay: Math.min(behaviour.maxMainActivitiesPerDay ?? 3, 3),
    walking: {
      ...behaviour.walking,
      maximumDailyMinutes: Math.min(behaviour.walking.maximumDailyMinutes ?? walkingCeiling, walkingCeiling),
      maximumContinuousMinutes: Math.min(behaviour.walking.maximumContinuousMinutes ?? 20, 20),
    },
    comfort: {
      ...behaviour.comfort,
      minimumTransitionBufferMinutes: Math.max(behaviour.comfort.minimumTransitionBufferMinutes, 25),
      requireRestAfterLongTravel: true,
    },
  };
}

/** Plain-language summary for the plan header. */
export function describePace(behaviour: TravelBehaviourProfile): string {
  const labels: Record<TravelPace, string> = {
    'very-relaxed': 'Very relaxed',
    relaxed: 'Relaxed',
    balanced: 'Balanced',
    active: 'Active',
    intensive: 'Intensive',
  };
  const stops = behaviour.maxMainActivitiesPerDay ?? PACE_DEFAULTS[behaviour.pace].maxMainActivities;
  return `${labels[behaviour.pace]} · up to ${stops} main ${stops === 1 ? 'stop' : 'stops'} a day, starting ${behaviour.preferredStartTime}`;
}

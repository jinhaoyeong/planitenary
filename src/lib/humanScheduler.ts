/**
 * Human scheduling engine.
 *
 * The previous planner dropped places into fixed 09:30 slots using a hardcoded
 * list of Osaka day themes, and counted only visit duration. A real day is not
 * that shape. It is:
 *
 *   leave → travel → orient → queue → visit → exit → walk → eat → rest → …
 *   → travel back → evening
 *
 * This module simulates that, for any city, and refuses to produce a day a
 * person could not physically complete. Every minute a traveller will actually
 * spend is accounted for, and every constraint that blocks a placement is
 * reported rather than silently dropped.
 */

import type { SchedulerRejectionReason } from '../data';
import type { PlaceCandidate } from './destinationIntelligence';
import { openingWindow, toMinutes, toTime } from './openingHours';
import { distanceMeters } from './placeIdentity';
import { PACE_DEFAULTS, type TravelBehaviourProfile } from './travelBehaviour';
import { cityReachability, isPlacementAllowed } from '../../supabase/functions/_shared/cityReachability';

export type TravelMode = 'walking' | 'public-transport' | 'driving';

export interface RouteLeg {
  durationMinutes: number;
  distanceMeters: number;
  mode: TravelMode;
  transfers?: number;
  /** `provider` is a real routing answer; `offline-straight-line` is an estimate. */
  source: 'provider' | 'offline-straight-line';
}

/** Looks up a leg between two places. Returns undefined when unknown. */
export type RouteResolver = (from: PlaceCandidate, to: PlaceCandidate) => RouteLeg | undefined;

export interface DayLoad {
  mainActivities: number;
  optionalActivities: number;
  visitMinutes: number;
  transportMinutes: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  queueMinutes: number;
  mealMinutes: number;
  /**
   * Meals given a real venue. The difference between this and the number of
   * meal slots is how often the plan could only offer a flexible window.
   */
  mealPlaces: number;
  freeTimeMinutes: number;
  departureTime: string;
  expectedReturnTime: string;
  /**
   * 0–1 strain **relative to this traveller's own limits**, not absolute
   * exertion. A gentle day can still read high for someone who set gentle
   * limits — which is the point: it drives the "this day is demanding" warning
   * for the person actually walking it.
   *
   * Because it is normalised per-traveller it is not comparable between two
   * different pace profiles. To compare plans, use the absolute fields
   * (`walkingMinutes`, `transportMinutes`, `mainActivities`).
   */
  fatigueScore: number;
  /** 0–1. How likely the day falls apart if one thing runs late. */
  rushRisk: number;
  confidence: 'high' | 'medium' | 'low';
}

export type SlotKind = 'place' | 'meal' | 'rest' | 'transfer';

export interface ScheduledSlot {
  kind: SlotKind;
  startMinutes: number;
  endMinutes: number;
  candidate?: PlaceCandidate;
  label: string;
  /** Travel taken to reach this slot. */
  arrivalLeg?: RouteLeg;
  queueMinutes?: number;
  reason: string;
}

/**
 * Declared in `../data` alongside `DiscoveryUnscheduledReason`, which extends
 * it. Keeping one list means a new reason cannot be added here and silently
 * omitted from the persisted union — which is exactly what happened twice.
 */
export type RejectionReason = SchedulerRejectionReason;

export interface SchedulingRejection {
  candidate: PlaceCandidate;
  reason: RejectionReason;
  detail: string;
}

export interface SimulatedDay {
  dayNumber: number;
  city: string;
  title: string;
  slots: ScheduledSlot[];
  load: DayLoad;
  rejections: SchedulingRejection[];
  warnings: string[];
}

/**
 * Clock helpers and weekday hour resolution now live in `openingHours.ts`,
 * alongside the traveller-facing summary built from the same rules. Re-exported
 * here because several callers have always imported them from the scheduler.
 */
export { toMinutes, toTime };

/** Average urban walking speed, ~4.5 km/h, with a little slack for crossings. */
const WALKING_METRES_PER_MINUTE = 72;
/** Straight-line distance underestimates real streets by roughly a third. */
const STREET_DETOUR_FACTOR = 1.35;
/** Beyond this a traveller takes transit rather than walking. */
const MAX_REASONABLE_WALK_METRES = 1600;

/**
 * Fallback leg when no routing provider answered. Clearly labelled so the UI
 * never presents an estimate as a real route, and so plan confidence drops.
 */
export function estimateLeg(from: PlaceCandidate, to: PlaceCandidate): RouteLeg | undefined {
  if (!from.coordinates || !to.coordinates) return undefined;
  const straight = distanceMeters(from.coordinates, to.coordinates);
  const street = straight * STREET_DETOUR_FACTOR;

  if (street <= MAX_REASONABLE_WALK_METRES) {
    return {
      durationMinutes: Math.max(4, Math.round(street / WALKING_METRES_PER_MINUTE)),
      distanceMeters: Math.round(street),
      mode: 'walking',
      source: 'offline-straight-line',
    };
  }
  // Transit: an average door-to-door speed of ~18 km/h plus a wait allowance.
  return {
    durationMinutes: Math.max(10, Math.round((street / 1000 / 18) * 60 + 9)),
    distanceMeters: Math.round(street),
    mode: 'public-transport',
    // Walking to and from the stops, which still counts against the walking budget.
    transfers: street > 8000 ? 1 : 0,
    source: 'offline-straight-line',
  };
}

/** Walking minutes inside a leg — all of a walk, a fixed access cost for transit. */
const walkingMinutesOf = (leg: RouteLeg): number =>
  leg.mode === 'walking' ? leg.durationMinutes : Math.min(12, 6 + (leg.transfers || 0) * 3);

const walkingMetresOf = (leg: RouteLeg): number =>
  leg.mode === 'walking' ? leg.distanceMeters : walkingMinutesOf(leg) * WALKING_METRES_PER_MINUTE;

/**
 * How long the traveller waits to get in. Uses reported queue evidence where
 * we have it, otherwise a small allowance based on how much a place requires
 * booking — a required reservation means you walk in, an unbookable famous
 * place means you wait.
 */
export function queueMinutesFor(
  candidate: PlaceCandidate,
  reportedQueueMinutes?: number,
): number {
  if (typeof reportedQueueMinutes === 'number' && reportedQueueMinutes >= 0) {
    return Math.round(reportedQueueMinutes);
  }
  if (candidate.reservationStatus === 'required') return 5;
  if (candidate.reservationStatus === 'recommended') return 15;
  return candidate.categories.includes('essential') ? 20 : 8;
}

/** Orientation on arrival and gathering yourself on the way out. */
const ARRIVAL_BUFFER_MINUTES = 5;
const EXIT_BUFFER_MINUTES = 5;

/** Sitting down for a moment after a walk longer than the traveller's limit. */
const WALK_BREAK_MINUTES = 15;

/**
 * What counts as a low-commitment stop, for the optional allowance: short
 * enough to drop into a full day, and close enough to be genuinely on the way.
 */
const OPTIONAL_VISIT_MINUTES = 45;
const OPTIONAL_WALK_MINUTES = 12;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Categories that make a place somewhere you could eat. */
const FOOD_CATEGORIES = ['food', 'cafes', 'street-food'];

/** True when a meal could be had here. A market qualifies; so does a museum café. */
export const isFoodPlace = (candidate: PlaceCandidate): boolean =>
  candidate.categories.some((category) => FOOD_CATEGORIES.includes(category));

/**
 * True when eating is *all* this place is for.
 *
 * The distinction matters: a night market or a food hall is somewhere to eat
 * **and** a genuine sight, and treating anything food-adjacent as a restaurant
 * would quietly delete it from the day's attractions. Only a place with no
 * non-food character is excluded from sightseeing.
 */
export const isFoodOnly = (candidate: PlaceCandidate): boolean =>
  candidate.categories.length > 0
  && candidate.categories.every((category) => FOOD_CATEGORIES.includes(category));

/** How far a traveller will reasonably walk for a meal that is not the point of the day. */
const MEAL_DETOUR_WALK_MINUTES = 12;

/**
 * The latest a meal is still dinner rather than the middle of the night.
 *
 * Only reached on an arrival day, where the settling time can push the day's
 * start past the configured dinner window. Beyond this the plan says nothing
 * instead of inventing a 2am meal.
 */
const LATEST_DINNER_START = 22 * 60 + 30;

/** Budget tier → the price levels that tier is comfortable with. */
const BUDGET_PRICE_LEVELS: Record<string, number[]> = {
  budget: [0, 1, 2],
  'mid-range': [0, 1, 2, 3],
  luxury: [1, 2, 3, 4],
};

export interface MealPreferenceInputs {
  budgetTier?: string;
  dietaryNeeds?: string[];
  /** Cuisine and style tags the traveller asked for, e.g. `street-food`. */
  preferredTags?: string[];
}

/**
 * Choose somewhere to actually eat.
 *
 * A meal slot used to be an empty ninety minutes labelled "Lunch — venue not
 * selected". That is a placeholder, not a plan, and for a traveller whose whole
 * interest is food it was the emptiest part of the itinerary.
 *
 * Scored rather than filtered, so a day always gets the best available answer
 * instead of nothing when no candidate is perfect. Hard requirements — open at
 * the time, tolerable queue, reachable — are still absolute; everything else
 * ranks.
 */
export function selectMealPlace(
  options: PlaceCandidate[],
  context: {
    atMinutes: number;
    weekday?: number;
    from?: PlaceCandidate;
    resolveRoute: RouteResolver;
    queueTolerance: number;
    queueEvidence: Record<string, number>;
    preferences: MealPreferenceInputs;
    used: Set<string>;
  },
): { candidate: PlaceCandidate; leg?: RouteLeg; queueMinutes: number } | undefined {
  const { preferences } = context;
  const wantedTags = new Set((preferences.preferredTags || []).map((tag) => tag.toLowerCase()));
  const allowedPrices = BUDGET_PRICE_LEVELS[preferences.budgetTier || 'mid-range'];
  const dietary = (preferences.dietaryNeeds || []).map((need) => need.toLowerCase());

  let best: { candidate: PlaceCandidate; leg?: RouteLeg; queueMinutes: number; score: number } | undefined;

  for (const candidate of options) {
    if (context.used.has(candidate.id) || !isFoodPlace(candidate)) continue;

    // --- Hard requirements ------------------------------------------------
    const hours = openingWindow(candidate.openingHours, context.weekday);
    if (hours.closedToday) continue;
    if (hours.known && (context.atMinutes < hours.opensAt || context.atMinutes >= hours.closesAt)) continue;

    const queueMinutes = queueMinutesFor(candidate, context.queueEvidence[candidate.id]);
    if (queueMinutes > context.queueTolerance) continue;

    const leg = context.from ? context.resolveRoute(context.from, candidate) : undefined;
    if (context.from && !leg) continue;
    const detour = leg ? walkingMinutesOf(leg) : 0;
    if (detour > MEAL_DETOUR_WALK_MINUTES) continue;

    /**
     * A dietary need is a requirement, not a preference — but only where the
     * data exists to honour it. Treating "unknown" as "unsuitable" would leave
     * a vegetarian traveller with no lunch at all in cities where nobody has
     * tagged the restaurants.
     */
    if (dietary.length > 0 && candidate.dietaryOptions && candidate.dietaryOptions.length > 0) {
      const catered = dietary.every((need) => candidate.dietaryOptions!.some((option) => option.includes(need)));
      if (!catered) continue;
    }

    // --- Preferences ------------------------------------------------------
    let score = 0;
    const tags = new Set([...candidate.categories, ...candidate.experienceTags].map((tag) => tag.toLowerCase()));
    for (const tag of wantedTags) if (tags.has(tag)) score += 2;
    if (candidate.priceLevel !== undefined && allowedPrices.includes(candidate.priceLevel)) score += 1;
    if (candidate.priceLevel !== undefined && !allowedPrices.includes(candidate.priceLevel)) score -= 2;
    if (dietary.length > 0 && candidate.dietaryOptions?.length) score += 2;
    // Closer is better once everything else is equal: a meal should not become
    // the walk of the day.
    score += Math.max(0, (MEAL_DETOUR_WALK_MINUTES - detour) / MEAL_DETOUR_WALK_MINUTES);
    if (hours.known) score += 0.5;
    score += (candidate.notability ?? 0);

    if (!best || score > best.score) best = { candidate, leg, queueMinutes, score };
  }

  return best ? { candidate: best.candidate, leg: best.leg, queueMinutes: best.queueMinutes } : undefined;
}

/** A place's own preferred window, e.g. a night market that only works after dark. */
function preferredWindow(candidate: PlaceCandidate): { start: number; end: number } | undefined {
  const window = candidate.bestTimeWindows?.[0];
  if (!window) return undefined;
  return { start: toMinutes(window.start), end: toMinutes(window.end) };
}

export interface DayPlanRequest {
  dayNumber: number;
  city: string;
  candidates: PlaceCandidate[];
  behaviour: TravelBehaviourProfile;
  /** Where the day starts and ends, if the traveller set an accommodation. */
  origin?: PlaceCandidate;
  routeResolver?: RouteResolver;
  /** Reported queue minutes by candidate id, from evidence. */
  queueEvidence?: Record<string, number>;
  /** Slots that must not move — bookings, locked activities. */
  fixedSlots?: ScheduledSlot[];
  /** Arrival days start late; the caller can override the first departure. */
  startTimeOverride?: string;
  /**
   * Latest the traveller can still be out. A departure day ends when they have
   * to leave for the airport, not when they would normally head back.
   */
  returnTimeOverride?: string;
  /**
   * Fewer main stops than the pace would normally allow — for an arrival day,
   * a departure day, or the first days of a long-haul trip.
   */
  maxMainOverride?: number;
  /** Prefer indoor candidates when live weather indicates a wet day. */
  preferIndoor?: boolean;
  /**
   * Places to eat, offered for meal slots only. Kept separate from
   * `candidates` because a traveller does not shortlist lunch the way they
   * shortlist a museum — and food must not consume the day's main allowance.
   */
  mealCandidates?: PlaceCandidate[];
  /** Budget, diet and taste, for choosing between them. */
  mealPreferences?: MealPreferenceInputs;
  /**
   * The calendar date this day falls on, `YYYY-MM-DD`. Supplies the weekday
   * that opening hours are resolved against; without it, weekly closures cannot
   * be honoured and the planner falls back to the first published window.
   */
  date?: string;
}

/** Weekday for a `YYYY-MM-DD` date, or undefined when it is absent or invalid. */
export function weekdayOf(date?: string): number | undefined {
  if (!date) return undefined;
  // Parsed as UTC so the weekday does not shift with the runner's timezone.
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed).getUTCDay() : undefined;
}

/**
 * Simulate one day and return exactly what a person would experience.
 *
 * Candidates are consumed in the order given (the caller ranks and clusters
 * them first). Anything that will not fit is returned in `rejections` with the
 * constraint that blocked it — nothing is ever dropped silently.
 */
export function simulateDay(request: DayPlanRequest): SimulatedDay {
  const { behaviour, routeResolver, queueEvidence = {} } = request;
  const candidates = request.preferIndoor
    ? [...request.candidates].sort((a, b) => Number(b.indoorOutdoor === 'indoor') - Number(a.indoorOutdoor === 'indoor'))
    : request.candidates;
  const paceDefaults = PACE_DEFAULTS[behaviour.pace];
  const resolveRoute: RouteResolver = routeResolver
    ? (from, to) => routeResolver(from, to) ?? estimateLeg(from, to)
    : estimateLeg;

  const startMinutes = toMinutes(request.startTimeOverride || behaviour.preferredStartTime || paceDefaults.startTime);
  const returnLimit = toMinutes(
    request.returnTimeOverride || behaviour.preferredReturnTime || paceDefaults.latestReturnTime,
  );
  const paceMaxMain = behaviour.maxMainActivitiesPerDay ?? paceDefaults.maxMainActivities;
  // An override may only ever ask for *less*: a gentler day is a caller's to
  // request, but overriding the traveller's own ceiling upward is not.
  const maxMain = request.maxMainOverride !== undefined
    ? Math.max(0, Math.min(paceMaxMain, request.maxMainOverride))
    : paceMaxMain;
  const buffer = behaviour.comfort.minimumTransitionBufferMinutes;
  const walkingCeiling = behaviour.walking.maximumDailyMinutes ?? paceDefaults.maximumWalkingMinutes;
  const diningMinutes = behaviour.meals.preferredDiningMinutes ?? paceDefaults.diningMinutes;
  const queueTolerance = behaviour.meals.maximumQueueMinutes ?? paceDefaults.maximumQueueMinutes;
  const continuousWalkCeiling = behaviour.walking.maximumContinuousMinutes ?? paceDefaults.maximumContinuousWalkMinutes;
  /**
   * Unscheduled minutes the day must keep. This is the single field that most
   * expresses "do not pack my day" — a very-relaxed traveller is promised 150
   * of them — and it is enforced as a constraint, not merely reported.
   */
  const freeTimeFloor = paceDefaults.minimumFreeTimeMinutes;
  const optionalAllowance = paceDefaults.optionalActivities;
  const weekday = weekdayOf(request.date);
  const dayCity = request.origin?.city || candidates[0]?.city;
  /**
   * City geography for this day, derived from the candidates themselves.
   * No geocoding call and nothing stored: a city is where its places are.
   */
  const reach = cityReachability(candidates);

  /**
   * Restaurants are scheduled as meals, not as sights.
   *
   * Without this split a shortlist containing food would spend the day's main
   * allowance on lunch venues and then still reserve an empty window to eat in.
   * `mealCandidates` lets the caller offer food the traveller never explicitly
   * shortlisted, which is usually how eating works.
   */
  const foodOptions = [...(request.mealCandidates || []), ...candidates.filter(isFoodPlace)];
  const sightCandidates = candidates.filter((candidate) => !isFoodOnly(candidate));

  const slots: ScheduledSlot[] = [...(request.fixedSlots || [])].sort((a, b) => a.startMinutes - b.startMinutes);
  const rejections: SchedulingRejection[] = [];
  const warnings: string[] = [];

  let clock = startMinutes;
  let mainCount = slots.filter((slot) => slot.kind === 'place').length;
  let optionalCount = 0;
  let visitMinutes = 0;
  let transportMinutes = 0;
  let walkingMinutes = 0;
  let walkingMetres = 0;
  let queueTotal = 0;
  let mealMinutes = 0;
  let unknownHours = 0;
  let estimatedLegs = 0;
  let totalLegs = 0;
  let lunchPlaced = false;
  let dinnerPlaced = false;
  /** Meals given a real venue, as opposed to a flexible window. */
  let mealPlaces = 0;

  let previous: PlaceCandidate | undefined = request.origin;
  const seen = new Set<string>();

  const lunch = behaviour.meals.lunchWindow;
  /**
   * Dinner, moved to when the traveller can actually eat it.
   *
   * The configured window is a preference for an ordinary day. A day that
   * cannot begin until after it has closed is an arrival day — the plane
   * landed, the bags are dropped, and it is now later than anyone planned.
   * Holding the traveller to a window that expired while they were in a taxi
   * would mean landing at 19:30 and being offered no dinner at all, which is
   * not what "no main activities" was ever meant to say.
   *
   * Past {@link LATEST_DINNER_START} it stays unset: at some point the honest
   * answer is that the day is over, and the empty-day warning explains it.
   */
  const dinner = (() => {
    const configured = behaviour.meals.dinnerWindow;
    if (!configured) return configured;
    const configuredEnd = toMinutes(configured.end);
    if (startMinutes <= configuredEnd) return configured;
    if (startMinutes > LATEST_DINNER_START) return undefined;
    // Wide enough to reach a restaurant, not so wide it drifts into the night.
    return { start: toTime(startMinutes), end: toTime(LATEST_DINNER_START) };
  })();
  /**
   * `breakfastRequired` has been on the profile since the behaviour model was
   * written and was never scheduled. A traveller who says they need breakfast
   * gets one, in the hour before the day's first stop.
   */
  const breakfast = behaviour.meals.breakfastRequired
    ? { start: toTime(Math.max(0, startMinutes - 60)), end: toTime(startMinutes) }
    : undefined;
  let breakfastPlaced = false;

  /**
   * Insert a meal when the clock has entered its window — or when the activity
   * about to be scheduled would run straight past the window's end. Without the
   * second condition a single long museum visit silently eats lunch, which is
   * exactly what a person would not do.
   */
  const maybeInsertMeal = (neighbourhood: string, projectedBusyUntil: number) => {
    const tryMeal = (
      window: { start: string; end: string } | undefined,
      alreadyPlaced: boolean,
      label: string,
    ): boolean => {
      if (!window || alreadyPlaced) return alreadyPlaced;
      const windowStart = toMinutes(window.start);
      const windowEnd = toMinutes(window.end);
      const windowOpen = clock >= windowStart;
      const wouldMissWindow = projectedBusyUntil > windowEnd;
      if (!windowOpen && !wouldMissWindow) return false;

      const start = Math.max(clock, windowStart);
      if (start > windowEnd) return false;

      // Somewhere real to eat, if the shortlist holds one that is open now and
      // close by. The abstract window survives as the fallback so a day never
      // simply loses its lunch.
      const choice = selectMealPlace(foodOptions, {
        atMinutes: start,
        weekday,
        from: previous,
        resolveRoute,
        queueTolerance,
        queueEvidence,
        preferences: request.mealPreferences || {},
        used: seen,
      });

      if (choice) {
        const legMinutes = choice.leg?.durationMinutes ?? 0;
        const seatedAt = start + legMinutes + choice.queueMinutes;
        // Travelling to and queueing for a meal is real time; if it no longer
        // fits the window, the flexible block is the honest answer.
        if (seatedAt + diningMinutes <= windowEnd + diningMinutes) {
          slots.push({
            kind: 'meal',
            startMinutes: seatedAt,
            endMinutes: seatedAt + diningMinutes,
            candidate: choice.candidate,
            label: `${label} — ${choice.candidate.name}`,
            arrivalLeg: choice.leg,
            queueMinutes: choice.queueMinutes,
            reason: `${choice.candidate.neighbourhood || choice.candidate.city} · ${choice.candidate.categories.slice(0, 2).join(' and ')}`,
          });
          seen.add(choice.candidate.id);
          mealPlaces += 1;
          clock = seatedAt + diningMinutes;
          mealMinutes += diningMinutes;
          transportMinutes += legMinutes;
          queueTotal += choice.queueMinutes;
          if (choice.leg) {
            walkingMinutes += walkingMinutesOf(choice.leg);
            walkingMetres += walkingMetresOf(choice.leg);
          }
          previous = choice.candidate;
          return true;
        }
      }

      slots.push({
        kind: 'meal',
        startMinutes: start,
        endMinutes: start + diningMinutes,
        label,
        reason: `Kept flexible around ${neighbourhood}. A schedule constraint, not a recommended attraction.`,
      });
      clock = start + diningMinutes;
      mealMinutes += diningMinutes;
      return true;
    };

    breakfastPlaced = tryMeal(breakfast, breakfastPlaced, 'Breakfast');
    lunchPlaced = tryMeal(lunch, lunchPlaced, 'Lunch');
    dinnerPlaced = tryMeal(dinner, dinnerPlaced, 'Dinner');
  };

  for (const candidate of sightCandidates) {
    if (seen.has(candidate.id)) {
      rejections.push({ candidate, reason: 'duplicate', detail: 'Already scheduled on this day.' });
      continue;
    }
    /**
     * Whether the traveller *can* get there, not whether they feel energetic.
     *
     * These used to be the same switch: `allowCrossCityDays` was false at a
     * relaxed pace, so somebody staying in Osaka for five calm days could not
     * be offered Kyoto at all — not because it is far, but because they had
     * said they wanted an unhurried trip. That conflates geography with
     * appetite. Reachability decides whether the visit is possible; the pace
     * limits below decide how much of the day it may take.
     */
    if (dayCity && !isPlacementAllowed(reach.verdictFor(dayCity, candidate))) {
      rejections.push({
        candidate,
        reason: 'incompatible-location',
        detail: `${candidate.city} is too far from ${dayCity} to visit and return the same day.`,
      });
      continue;
    }

    /**
     * Beyond the main allowance a day can still absorb a few low-commitment
     * stops — a viewpoint, a coffee, a short walk through a market. That is
     * what `optionalActivities` was always meant to express.
     */
    const isLowCommitment = candidate.estimatedVisitMinutes <= OPTIONAL_VISIT_MINUTES;
    const asOptional = mainCount >= maxMain;
    if (asOptional && (!isLowCommitment || optionalCount >= optionalAllowance)) {
      rejections.push({
        candidate,
        reason: 'daily-capacity-reached',
        detail: `A ${behaviour.pace} day holds ${maxMain} main ${maxMain === 1 ? 'stop' : 'stops'}.`,
      });
      continue;
    }

    // --- Travel to the place -------------------------------------------
    const leg = previous ? resolveRoute(previous, candidate) : undefined;
    if (previous && !leg) {
      rejections.push({
        candidate,
        reason: 'insufficient-route-data',
        detail: 'No coordinates, so travel time cannot be estimated honestly.',
      });
      continue;
    }
    if (leg) {
      totalLegs += 1;
      if (leg.source === 'offline-straight-line') estimatedLegs += 1;
    }

    const legMinutes = leg?.durationMinutes ?? 0;
    const legWalkMinutes = leg ? walkingMinutesOf(leg) : 0;
    const legWalkMetres = leg ? walkingMetresOf(leg) : 0;

    // The walk home is not optional, so its cost is reserved up front rather
    // than spent after the budget check has already passed.
    const returnWalkReserve = request.origin
      ? walkingMinutesOf(resolveRoute(candidate, request.origin) ?? { durationMinutes: 0, distanceMeters: 0, mode: 'walking', source: 'offline-straight-line' })
      : 0;

    // Walking budget is a hard limit, not a preference.
    if (walkingMinutes + legWalkMinutes + returnWalkReserve > walkingCeiling) {
      rejections.push({
        candidate,
        reason: 'walking-limit-exceeded',
        detail: `Would push walking past your ${walkingCeiling} minute limit, including the journey back.`,
      });
      continue;
    }

    // An optional extra is only worth it if it is genuinely on the way.
    if (asOptional && legWalkMinutes > OPTIONAL_WALK_MINUTES) {
      rejections.push({
        candidate,
        reason: 'daily-capacity-reached',
        detail: `A ${behaviour.pace} day holds ${maxMain} main ${maxMain === 1 ? 'stop' : 'stops'}, and this is too far to add as a short extra.`,
      });
      continue;
    }

    /**
     * A single long walk needs a breather, whatever the daily total says. The
     * pace table has always specified this ceiling; nothing read it until now.
     */
    const walkBreakMinutes = legWalkMinutes > continuousWalkCeiling ? WALK_BREAK_MINUTES : 0;

    // --- Meals happen on the way, not after the day is over --------------
    // Projected end of this visit, used to decide whether a meal window would
    // otherwise be skipped entirely.
    const projectedEnd = clock + legMinutes + (leg ? buffer : 0) + walkBreakMinutes
      + queueMinutesFor(candidate, queueEvidence[candidate.id])
      + ARRIVAL_BUFFER_MINUTES + candidate.estimatedVisitMinutes;
    maybeInsertMeal(candidate.neighbourhood || candidate.city, projectedEnd);

    const arrival = clock + legMinutes + (leg ? buffer : 0);

    // --- Opening hours and the place's own best window -------------------
    const hours = openingWindow(candidate.openingHours, weekday);
    // Published hours that name no window today mean closed — a different
    // answer from "unknown", and the one that used to build plans around a
    // locked door.
    if (hours.closedToday) {
      rejections.push({
        candidate,
        reason: 'closed-on-this-day',
        detail: `Closed on ${WEEKDAY_NAMES[weekday ?? 0]}s.`,
      });
      continue;
    }
    if (!hours.known) unknownHours += 1;
    const preferred = preferredWindow(candidate);
    const entry = Math.max(arrival + walkBreakMinutes, clock, hours.opensAt, preferred?.start ?? 0);

    const queue = queueMinutesFor(candidate, queueEvidence[candidate.id]);
    if (queue > queueTolerance) {
      rejections.push({
        candidate,
        reason: 'queue-exceeds-tolerance',
        detail: `Reported waits of about ${queue} minutes exceed your ${queueTolerance} minute tolerance.`,
      });
      continue;
    }

    const visitStart = entry + queue + ARRIVAL_BUFFER_MINUTES;
    const visitEnd = visitStart + candidate.estimatedVisitMinutes;

    if (hours.known && visitEnd > hours.closesAt) {
      rejections.push({
        candidate,
        reason: 'opening-hours-conflict',
        detail: `Closes at ${toTime(hours.closesAt)}; the visit would not finish in time.`,
      });
      continue;
    }
    if (preferred && visitStart > preferred.end) {
      rejections.push({
        candidate,
        reason: 'opening-hours-conflict',
        detail: `Best experienced between ${toTime(preferred.start)} and ${toTime(preferred.end)}.`,
      });
      continue;
    }

    // --- Can the traveller still get home? -------------------------------
    const homeLeg = request.origin ? resolveRoute(candidate, request.origin) : undefined;
    const returnMinutes = homeLeg?.durationMinutes ?? 0;
    if (visitEnd + EXIT_BUFFER_MINUTES + returnMinutes > returnLimit) {
      rejections.push({
        candidate,
        reason: 'return-time-exceeded',
        detail: `Would get you back after ${toTime(returnLimit)}.`,
      });
      continue;
    }

    /**
     * The free-time floor, measured exactly as the final `DayLoad` measures it
     * so the reported number and the constraint cannot disagree.
     *
     * An empty day is not a relaxing day, so the floor never blocks the first
     * stop — it stops a day filling up, it does not stop it starting.
     */
    if (freeTimeFloor > 0 && mainCount > 0) {
      const projectedBusy = visitMinutes + candidate.estimatedVisitMinutes
        + transportMinutes + legMinutes + returnMinutes
        + queueTotal + queue
        + mealMinutes + walkBreakMinutes;
      const projectedAvailable = Math.max(1, Math.max(returnLimit, visitEnd + EXIT_BUFFER_MINUTES + returnMinutes) - startMinutes);
      if (projectedAvailable - projectedBusy < freeTimeFloor) {
        rejections.push({
          candidate,
          reason: 'free-time-floor',
          detail: `A ${behaviour.pace} day keeps at least ${freeTimeFloor} minutes unscheduled; adding this would not leave them.`,
        });
        continue;
      }
    }

    if (walkBreakMinutes > 0) {
      slots.push({
        kind: 'rest',
        startMinutes: arrival,
        endMinutes: arrival + walkBreakMinutes,
        label: 'Breather',
        reason: `Added after a ${legWalkMinutes} minute walk, longer than your ${continuousWalkCeiling} minute limit in one go.`,
      });
    }

    slots.push({
      kind: 'place',
      startMinutes: visitStart,
      endMinutes: visitEnd,
      candidate,
      label: candidate.name,
      arrivalLeg: leg,
      queueMinutes: queue,
      reason: `${candidate.neighbourhood || candidate.city} · ${candidate.categories.slice(0, 2).join(' and ')}`,
    });

    seen.add(candidate.id);
    // An optional extra sits alongside the main allowance rather than
    // consuming it, which is what lets a short stop join an already-full day.
    if (asOptional) optionalCount += 1;
    else mainCount += 1;
    visitMinutes += candidate.estimatedVisitMinutes;
    transportMinutes += legMinutes;
    walkingMinutes += legWalkMinutes;
    walkingMetres += legWalkMetres;
    queueTotal += queue;
    clock = visitEnd + EXIT_BUFFER_MINUTES;
    previous = candidate;

    // A rest beat after a long haul, when the traveller asked for one.
    if (behaviour.comfort.requireRestAfterLongTravel && legMinutes >= 45) {
      slots.push({
        kind: 'rest',
        startMinutes: clock,
        endMinutes: clock + 20,
        label: 'Breather',
        reason: 'Added after a long transfer because you asked for a gentler pace.',
      });
      clock += 20;
    }
  }

  /**
   * A day that scheduled no sights never entered the loop above, so it never
   * reached `maybeInsertMeal` either — meals were only ever inserted as a side
   * effect of placing an attraction. An evening arrival is exactly that day:
   * `maxMainOverride: 0` by design, but the traveller has still landed and
   * still needs feeding.
   *
   * Guarded on an empty day so ordinary days keep the behaviour they have.
   * `selectMealPlace` still applies opening hours, the walking detour limit
   * and the queue tolerance, so this can only find somewhere genuinely open
   * and genuinely close by.
   */
  if (mainCount === 0 && optionalCount === 0) {
    maybeInsertMeal(dayCity || '', clock);
  }

  // A dinner window still owed at the end of the day.
  if (dinner && !dinnerPlaced && clock < toMinutes(dinner.end)) {
    const start = Math.max(clock, toMinutes(dinner.start));
    if (start + diningMinutes <= returnLimit) {
      slots.push({
        kind: 'meal',
        startMinutes: start,
        endMinutes: start + diningMinutes,
        label: 'Dinner',
        reason: 'Kept flexible. A schedule constraint, not a recommended attraction.',
      });
      clock = start + diningMinutes;
      mealMinutes += diningMinutes;
    }
  }

  const homeLeg = previous && request.origin && previous !== request.origin
    ? resolveRoute(previous, request.origin)
    : undefined;
  const returnMinutes = homeLeg?.durationMinutes ?? 0;
  if (homeLeg) {
    transportMinutes += returnMinutes;
    walkingMinutes += walkingMinutesOf(homeLeg);
    walkingMetres += walkingMetresOf(homeLeg);
  }
  const expectedReturn = clock + returnMinutes;

  if (maxMain === 0 && startMinutes > LATEST_DINNER_START && slots.length === 0) {
    warnings.push(`No meal fits after ${toTime(startMinutes)}; this day is intentionally empty.`);
  }

  const busyMinutes = visitMinutes + transportMinutes + queueTotal + mealMinutes;
  // Free time is measured against the day the traveller *has* — start through
  // their return target — not against however long the booked activities
  // happened to run. Otherwise finishing early paradoxically reads as less free
  // time than a day packed until closing.
  const availableMinutes = Math.max(1, Math.max(returnLimit, expectedReturn) - startMinutes);
  const freeTimeMinutes = Math.max(0, availableMinutes - busyMinutes);

  // Fatigue blends the three things that actually tire a traveller: time on
  // your feet, time in transit, and how full the day is.
  const walkingLoad = walkingMinutes / Math.max(1, walkingCeiling);
  const transitLoad = transportMinutes / 180;
  // Optional stops are short and nearby, so they tire a traveller less than a
  // main one — but not nothing, which is why they are not free here.
  const densityLoad = (mainCount + optionalCount * 0.5) / Math.max(1, maxMain);
  const fatigueScore = Math.max(0, Math.min(1, walkingLoad * 0.45 + transitLoad * 0.25 + densityLoad * 0.3));

  // Rush risk: how little slack there is if one thing overruns.
  const slackRatio = freeTimeMinutes / availableMinutes;
  const rushRisk = Math.max(0, Math.min(1, (1 - slackRatio) * 0.7 + (queueTotal / 120) * 0.3));

  if (expectedReturn > returnLimit) {
    warnings.push(`This day ends at ${toTime(expectedReturn)}, later than your ${toTime(returnLimit)} target.`);
  }
  if (unknownHours > 0) {
    warnings.push(`${unknownHours} ${unknownHours === 1 ? 'place has' : 'places have'} unverified opening hours.`);
  }
  if (estimatedLegs > 0) {
    warnings.push(`${estimatedLegs} of ${totalLegs} travel times are straight-line estimates, not live routing.`);
  }
  if (fatigueScore > 0.8) {
    warnings.push('This is a demanding day. Consider moving one stop.');
  }

  // Confidence is honest about its inputs: estimated routes or unknown hours
  // cap it, regardless of how neat the schedule looks.
  const confidence: DayLoad['confidence'] = estimatedLegs === 0 && unknownHours === 0
    ? 'high'
    : estimatedLegs === totalLegs && totalLegs > 0
      ? 'low'
      : 'medium';

  slots.sort((a, b) => a.startMinutes - b.startMinutes);

  const anchor = slots.find((slot) => slot.kind === 'place')?.candidate;
  const title = anchor
    ? `${anchor.neighbourhood || anchor.city}${slots.filter((slot) => slot.kind === 'place').length > 1 ? ' and nearby' : ''}`
    : `Flexible day ${request.dayNumber}`;

  return {
    dayNumber: request.dayNumber,
    city: anchor?.city || request.city,
    title,
    slots,
    load: {
      mainActivities: mainCount,
      optionalActivities: optionalCount,
      visitMinutes,
      transportMinutes,
      walkingMinutes,
      walkingDistanceMeters: Math.round(walkingMetres),
      queueMinutes: queueTotal,
      mealMinutes,
      mealPlaces,
      freeTimeMinutes,
      departureTime: toTime(startMinutes),
      expectedReturnTime: toTime(expectedReturn),
      fatigueScore: Number(fatigueScore.toFixed(3)),
      rushRisk: Number(rushRisk.toFixed(3)),
      confidence,
    },
    rejections,
    warnings,
  };
}

/**
 * Group candidates into geographic clusters so a day stays in one part of the
 * city. Replaces the hardcoded neighbourhood themes: clusters are discovered
 * from the actual coordinates, so this works identically in Melbourne, Beijing
 * or anywhere else.
 *
 * Uses named neighbourhoods when the provider supplies them, and falls back to
 * distance-based grouping when it does not.
 */
export function clusterCandidates(
  candidates: PlaceCandidate[],
  maxClusterRadiusMeters = 2500,
): PlaceCandidate[][] {
  const remaining = [...candidates];
  const clusters: PlaceCandidate[][] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const cluster = [seed];

    if (seed.coordinates) {
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const other = remaining[index];
        if (other.city !== seed.city) continue;
        const sameNeighbourhood = Boolean(
          seed.neighbourhood && other.neighbourhood && seed.neighbourhood === other.neighbourhood,
        );
        const metres = other.coordinates
          ? distanceMeters(seed.coordinates, other.coordinates)
          : undefined;
        const near = metres !== undefined && metres <= maxClusterRadiusMeters;
        // A shared neighbourhood label widens the radius but never overrides
        // real distance — providers do mislabel, and a beachside suburb tagged
        // "CBD" must not end up in a walkable city-centre day.
        const sameArea = sameNeighbourhood
          && (metres === undefined || metres <= maxClusterRadiusMeters * 2);
        if (near || sameArea) {
          cluster.push(other);
          remaining.splice(index, 1);
        }
      }
    } else {
      // No coordinates: fall back to the neighbourhood label alone.
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const other = remaining[index];
        if (other.city === seed.city && other.neighbourhood === seed.neighbourhood) {
          cluster.push(other);
          remaining.splice(index, 1);
        }
      }
    }
    clusters.push(cluster);
  }

  // Biggest clusters first — they make the most coherent days.
  return clusters.sort((a, b) => b.length - a.length);
}

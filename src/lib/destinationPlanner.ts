import type { Activity, DayPlan, DiscoveryUnscheduledReason, Itinerary } from '../data';
import type { TripProfile } from './tripProfile';
import {
  candidateToActivity,
  type CandidateDecision,
  type CandidateScoreBreakdown,
  type PlaceCandidate,
  type RankedCandidate,
} from './destinationIntelligence';
import {
  PACE_DEFAULTS,
  applyTravellerConstraints,
  deriveTravelBehaviour,
  type TravelBehaviourProfile,
} from './travelBehaviour';
import {
  clusterCandidates,
  isFoodOnly,
  isFoodPlace,
  simulateDay,
  toMinutes,
  toTime,
  type DayLoad,
  type RouteResolver,
  type ScheduledSlot,
  type SimulatedDay,
} from './humanScheduler';
import { scorePlaces, type ScoringInputs } from './placeIntelligence';

const STYLE_TAGS: Record<string, string[]> = {
  cafes: ['cafes', 'food'],
  'street-food': ['street-food', 'food', 'market', 'food-district'],
  'night-markets': ['market', 'evening', 'nightlife'],
  temples: ['temples', 'temple', 'shrine', 'history'],
  museums: ['museums', 'museum', 'art'],
  history: ['history', 'temple', 'shrine'],
  architecture: ['architecture', 'view'],
  shopping: ['shopping', 'market'],
  mountains: ['nature', 'hiking', 'view'],
  hiking: ['hiking', 'walk', 'nature'],
  nature: ['nature', 'park', 'garden'],
  beaches: ['waterfront', 'nature'],
  wildlife: ['wildlife', 'aquarium'],
  'scenic-train': ['view', 'waterfront'],
  anime: ['anime', 'theme-park'],
  nightlife: ['nightlife', 'evening', 'view'],
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const dataCompleteness = (candidate: PlaceCandidate) => {
  const checks = [
    candidate.providerPlaceId,
    candidate.coordinates,
    candidate.neighbourhood,
    candidate.openingHours,
    candidate.sourceReferences.length > 0,
    candidate.lastVerifiedAt,
  ];
  return checks.filter(Boolean).length / checks.length;
};

const budgetFit = (candidate: PlaceCandidate, profile: TripProfile) => {
  const price = candidate.priceLevel ?? 2;
  if (profile.budgetTier === 'budget') return clamp01(1 - Math.max(0, price - 1) * 0.25);
  if (profile.budgetTier === 'luxury') return price >= 2 ? 1 : 0.75;
  return price <= 3 ? 1 : 0.7;
};

/**
 * Rank a shortlist using the multi-dimensional scorer, keeping the
 * {@link RankedCandidate} shape the UI already consumes.
 *
 * Evidence and trend data are optional: with them the ranking reflects what
 * visitors report lately; without them it degrades to interests, significance
 * and practicality rather than failing.
 */
export function rankWithIntelligence(
  candidates: PlaceCandidate[],
  profile: TripProfile,
  options: { behaviour?: TravelBehaviourProfile; evidence?: ScoringInputs['evidence']; trends?: ScoringInputs['trends'] } = {},
): RankedCandidate[] {
  const behaviour = options.behaviour ?? deriveTravelBehaviour(profile);
  const scored = scorePlaces(candidates, {
    profile,
    behaviour,
    evidence: options.evidence,
    trends: options.trends,
  });

  return scored.map(({ candidate, score, dimensions, reasons, cautions }) => ({
    candidate,
    score,
    breakdown: {
      interestFit: dimensions.travellerFit,
      localSignificance: dimensions.destinationSignificance,
      neighbourhoodFit: dimensions.localRelevance,
      dataCompleteness: dimensions.evidenceConfidence,
      budgetFit: budgetFit(candidate, profile),
      openingHoursFit: candidate.openingHours ? 1 : 0.45,
      routeCompatibility: dimensions.practicality,
      diversityContribution: dimensions.currentQuality,
    },
    reasons,
    cautions,
  }));
}

export function rankDestinationCandidates(candidates: PlaceCandidate[], profile: TripProfile): RankedCandidate[] {
  const requestedTags = new Set(profile.styles.flatMap((style) => STYLE_TAGS[style] || [style]));
  const neighbourhoodCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.neighbourhood) neighbourhoodCounts.set(candidate.neighbourhood, (neighbourhoodCounts.get(candidate.neighbourhood) || 0) + 1);
  }

  return candidates.map((candidate) => {
    const tags = new Set([...candidate.categories, ...candidate.experienceTags]);
    const matches = [...requestedTags].filter((tag) => tags.has(tag));
    const interestFit = requestedTags.size === 0 ? 0.65 : clamp01(0.35 + matches.length * 0.22);
    const localSignificance = candidate.categories.includes('essential') ? 1 : candidate.categories.includes('local-character') ? 0.9 : 0.7;
    const neighbourhoodFit = clamp01(0.55 + ((neighbourhoodCounts.get(candidate.neighbourhood || '') || 0) - 1) * 0.1);
    const completeness = dataCompleteness(candidate);
    const costFit = budgetFit(candidate, profile);
    const openingHoursFit = candidate.openingHours ? 1 : 0.45;
    const routeCompatibility = candidate.neighbourhood ? 0.85 : 0.5;
    const diversityContribution = candidate.categories.length >= 2 ? 0.85 : 0.65;
    const breakdown: CandidateScoreBreakdown = {
      interestFit,
      localSignificance,
      neighbourhoodFit,
      dataCompleteness: completeness,
      budgetFit: costFit,
      openingHoursFit,
      routeCompatibility,
      diversityContribution,
    };
    const score = Math.round(100 * (
      interestFit * 0.24
      + localSignificance * 0.18
      + neighbourhoodFit * 0.13
      + completeness * 0.15
      + costFit * 0.08
      + openingHoursFit * 0.08
      + routeCompatibility * 0.09
      + diversityContribution * 0.05
    ));
    const reasons = [
      matches.length > 0 ? `Matches ${matches.slice(0, 2).join(' and ')}` : 'Adds destination variety',
      candidate.neighbourhood ? `Fits a ${candidate.neighbourhood} cluster` : 'Can anchor a flexible day',
      candidate.openingHours ? 'Hours captured in fixture' : 'Hours still need live verification',
    ];
    return { candidate, score, breakdown, reasons };
  }).sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

/**
 * Drop decisions about places that are no longer on offer.
 *
 * Decisions are restored by city and survive a re-discovery, but the candidate
 * list does not: a provider can return a different set for the same city, and a
 * cached run can expire into a shorter one. Keeping every prior decision then
 * leaves the deck describing places that are not in it — the reported "45 of 20
 * reviewed" — and, when none of the retained ids appear in the new list, a
 * build that accepts nothing at all while the traveller is looking at a
 * shortlist of 33.
 *
 * Keyed on the candidate id rather than the name, because two places in one
 * city genuinely share names.
 */
export function pruneDecisionsToCandidates(
  decisions: Record<string, CandidateDecision>,
  candidates: readonly Pick<PlaceCandidate, 'id'>[],
): { decisions: Record<string, CandidateDecision>; dropped: number } {
  const offered = new Set(candidates.map((candidate) => candidate.id));
  const kept: Record<string, CandidateDecision> = {};
  let dropped = 0;

  for (const [candidateId, decision] of Object.entries(decisions)) {
    if (offered.has(candidateId)) kept[candidateId] = decision;
    else dropped += 1;
  }

  return { decisions: kept, dropped };
}

/**
 * Places to shortlist beyond what the days can actually hold.
 *
 * Some accepted places never reach a day: they close on the wrong weekday, sit
 * too far from that day's cluster, or would push the walk past the traveller's
 * ceiling. Shortlisting exactly the capacity would leave days short whenever
 * that happens, so the deck carries a margin.
 *
 * **Provisional.** It has not been measured. `unscheduledReasons` already
 * records every rejection with its cause, so the real rate can be counted from
 * live plans and this replaced with a number that came from somewhere.
 * `FATIGUE_SPREAD_TOLERANCE` was guessed at `0.25` and fired on nothing at all;
 * treating this as measured would be the same mistake.
 */
const SHORTLIST_HEADROOM = 1.4;

/**
 * The fraction of the shortlist offered as "must do" rather than "interested".
 * The distinction is the traveller's to make; this only decides how many the
 * recommendation is confident enough to pre-commit.
 */
const MUST_DO_SHARE = 0.2;

/** Never offer so few that the traveller has no real choice, even for one day. */
const MINIMUM_SHORTLIST = 6;

export interface ShortlistTarget {
  /** Main sightseeing stops the trip can physically hold. */
  capacity: number;
  /** Places to pre-select, capacity plus headroom, bounded by what exists. */
  shortlist: number;
  /** How many of those are offered as must-do. */
  mustDo: number;
}

/**
 * How many places a trip can actually absorb.
 *
 * The traveller's complaint was concrete: a shortlist of the same size whether
 * the trip is three days or twenty-one. Capacity is not a matter of taste — it
 * is the number of days multiplied by the stops a day of that pace can hold,
 * and `PACE_DEFAULTS` already differs per pace. So Calm asks for fewer places
 * than Fast paced without a second rule existing anywhere: choosing a relaxed
 * mood shortens the deck, which is what choosing it should mean.
 *
 * Meals are excluded deliberately. A restaurant is not competing for a stop —
 * `buildDestinationItinerary` draws food from the whole ranked list, so food
 * places must not consume sightseeing capacity here either.
 */
export function shortlistTarget(
  dayCount: number,
  behaviour: TravelBehaviourProfile,
  availableCount: number,
): ShortlistTarget {
  const days = Math.max(1, Math.round(dayCount) || 1);
  const perDay = behaviour.maxMainActivitiesPerDay ?? PACE_DEFAULTS[behaviour.pace].maxMainActivities;
  const capacity = days * Math.max(1, perDay);

  const wanted = Math.max(MINIMUM_SHORTLIST, Math.ceil(capacity * SHORTLIST_HEADROOM));
  const shortlist = Math.max(0, Math.min(availableCount, wanted));
  const mustDo = Math.min(shortlist, Math.max(2, Math.round(capacity * MUST_DO_SHARE)));

  return { capacity, shortlist, mustDo };
}

/**
 * The "Recommended shortlist" pre-selection, sized to the trip rather than to a
 * constant. Food-only places are passed over: they are drawn separately when
 * meals are scheduled, and pre-selecting them would spend sightseeing capacity
 * on lunch.
 */
export function defaultDiscoveryDecisions(
  ranked: RankedCandidate[],
  options: { dayCount?: number; behaviour?: TravelBehaviourProfile } = {},
): Record<string, CandidateDecision> {
  const decisions: Record<string, CandidateDecision> = {};
  const sightseeing = ranked.filter(({ candidate }) => !isFoodOnly(candidate));

  const behaviour = options.behaviour;
  // Without trip context there is nothing to size against, so the previous
  // fixed shape is kept rather than inventing a capacity.
  const target = behaviour
    ? shortlistTarget(options.dayCount ?? 1, behaviour, sightseeing.length)
    : { shortlist: Math.min(sightseeing.length, 29), mustDo: 2, capacity: 0 };

  sightseeing.slice(0, target.shortlist).forEach(({ candidate }, index) => {
    decisions[candidate.id] = index < target.mustDo ? 'must-do' : 'interested';
  });
  return decisions;
}

const createMealWindow = (day: number, label: string, time: string, durationMinutes: number, neighbourhood: string): Activity => ({
  id: `discovery-meal-${day}-${label.toLowerCase()}`,
  kind: 'meal-window',
  time,
  durationMinutes,
  name: `${label} — venue not selected`,
  description: `Keep this time flexible around ${neighbourhood}.`,
  type: 'food',
  location: neighbourhood,
  source: 'generated',
  lockedFields: [],
  generatedMetadata: { source: 'generated', generatedAt: new Date().toISOString(), reason: 'Schedule constraint, not a discovered attraction.', confidence: 'high' },
});

const createRestBeat = (day: number, time: string, reason: string): Activity => ({
  id: `discovery-rest-${day}`,
  kind: 'meal-window',
  time,
  durationMinutes: 20,
  name: 'Breather',
  description: reason,
  type: 'other',
  source: 'generated',
  lockedFields: [],
  generatedMetadata: { source: 'generated', generatedAt: new Date().toISOString(), reason, confidence: 'high' },
});

export interface DestinationBuildResult {
  days: DayPlan[];
  scheduledCandidates: PlaceCandidate[];
  unscheduledCandidates: PlaceCandidate[];
  unscheduledReasons: Array<{ candidate: PlaceCandidate; reason: DiscoveryUnscheduledReason; detail: string }>;
  /** Per-day human load: travel, walking, queueing, fatigue. */
  dayLoads: DayLoad[];
  warnings: string[];
  routeMode: 'offline-straight-line' | 'provider';
  /** The pace actually used, so the UI can explain the shape of the plan. */
  behaviour: TravelBehaviourProfile;
}

/**
 * Rejections that hold for the whole trip rather than one day. A duplicate is
 * always a duplicate and a queue always exceeds a fixed tolerance, but capacity,
 * walking, opening hours and return time all depend on what else that
 * particular day contains.
 */
const TRIP_WIDE_REJECTIONS = new Set<DiscoveryUnscheduledReason>([
  'duplicate',
  'insufficient-route-data',
  'queue-exceeds-tolerance',
]);

/**
 * How uneven the trip may be before it is worth moving something.
 *
 * Chosen from measured plans rather than taste. A real five-place two-day trip
 * came out at 0.47 against 0.22 — one day twice as demanding as the other, and
 * obviously worth evening out — which scores 0.247. A well-balanced three-day
 * Melbourne trip scores 0.140 and should be left alone. The line sits between
 * them, close enough to the lower figure to catch the mild cases too.
 *
 * A wrong threshold is not dangerous here: a move must still *narrow* the
 * spread to be kept, so setting this too low costs a few wasted simulations
 * rather than a worse plan.
 */
const FATIGUE_SPREAD_TOLERANCE = 0.18;

/** Moves are cheap to simulate, but an unbounded loop is not worth the risk. */
const MAX_REBALANCE_MOVES = 4;

/**
 * Spread between the hardest and easiest day that actually has stops.
 *
 * `fatigueScore` is normalised to the traveller's own limits, which makes it
 * meaningless to compare *between* travellers — but every day here shares one
 * behaviour profile, so comparing days within a trip is exactly what it is for.
 * Empty days are excluded: a day with nothing on it is not restful, it is
 * unplanned, and counting it would make every trip look lopsided.
 */
function fatigueSpread(simulations: SimulatedDay[]): number {
  const scores = simulations.filter((day) => day.load.mainActivities > 0).map((day) => day.load.fatigueScore);
  return scores.length < 2 ? 0 : Math.max(...scores) - Math.min(...scores);
}

/**
 * Even out the trip by moving stops from the hardest day to the easiest.
 *
 * A person planning by hand does this instinctively: they look at a day with
 * four museums and a day with one, and move something. The scheduler produces
 * each day well but has no view across the trip, so a greedy first pass can
 * leave day two exhausting and day three nearly empty.
 *
 * Every move must earn its place. A move is kept only when the spread genuinely
 * narrows **and** no place is lost — moving a stop onto a day that cannot
 * absorb it would silently drop it, which is far worse than an uneven trip.
 */
function rebalanceDays(
  initialAssignments: PlaceCandidate[][],
  initialSimulations: SimulatedDay[],
  simulateAll: (assignments: PlaceCandidate[][]) => SimulatedDay[],
  placesOf: (day: SimulatedDay) => PlaceCandidate[],
): { assignments: PlaceCandidate[][]; simulations: SimulatedDay[]; moves: number } {
  let assignments = initialAssignments;
  let simulations = initialSimulations;
  let moves = 0;

  const scheduledCount = (days: SimulatedDay[]) =>
    days.reduce((total, day) => total + placesOf(day).length, 0);
  const startingCount = scheduledCount(simulations);

  for (let attempt = 0; attempt < MAX_REBALANCE_MOVES; attempt += 1) {
    const spread = fatigueSpread(simulations);
    if (spread <= FATIGUE_SPREAD_TOLERANCE) break;

    const active = simulations
      .map((day, index) => ({ index, day }))
      .filter(({ day }) => day.load.mainActivities > 0);
    if (active.length < 2) break;

    const heaviest = active.reduce((worst, entry) =>
      entry.day.load.fatigueScore > worst.day.load.fatigueScore ? entry : worst);
    /**
     * Only days that already have stops are targets.
     *
     * Moving into an empty day is a different decision — filling a rest day —
     * and it interacts badly with the measure: an empty day is excluded from
     * the spread, so putting one stop on it creates a very light active day and
     * *widens* the range. Rebalancing evens out the days the traveller is
     * already spending; it does not quietly consume their free one.
     */
    const lightest = active.reduce((best, entry) =>
      (entry.day.load.fatigueScore < best.day.load.fatigueScore ? entry : best));

    if (heaviest.index === lightest.index) break;
    // Never empty a day to fill another.
    if (assignments[heaviest.index].length < 2) break;

    // The last stop of the heavy day is the one a person would drop first: it
    // is the furthest into an already long day.
    const next = assignments.map((day) => [...day]);
    const moved = next[heaviest.index].pop();
    if (!moved) break;
    next[lightest.index] = [...next[lightest.index], moved];

    const nextSimulations = simulateAll(next);
    const landed = placesOf(nextSimulations[lightest.index]).some((place) => place.id === moved.id);
    const keptEverything = scheduledCount(nextSimulations) === startingCount;
    const improved = fatigueSpread(nextSimulations) < spread;

    if (!landed || !keptEverything || !improved) break;

    assignments = next;
    simulations = nextSimulations;
    moves += 1;
  }

  return { assignments, simulations, moves };
}

/** How much of a cluster can be enjoyed with a roof over your head. */
const indoorShare = (cluster: PlaceCandidate[]): number => {
  if (cluster.length === 0) return 0;
  return cluster.filter((candidate) => candidate.indoorOutdoor === 'indoor').length / cluster.length;
};

/**
 * Decide which part of the city each day goes to, with the forecast in mind.
 *
 * Ordering places *within* a day already prefers indoor ones when rain is
 * likely, but that can only shuffle whatever the day was given. If the wet day
 * was handed the botanic gardens and the beach, there is nothing indoors to
 * bring forward. This chooses which cluster the day gets in the first place.
 *
 * Clusters otherwise keep their existing largest-first order, which is what
 * makes coherent days. A wet day only takes a different cluster when that
 * cluster is genuinely more sheltered than what it would have had — swapping
 * for a marginal difference would trade a good day shape for nothing.
 */
export function assignClustersToDays(
  clusters: PlaceCandidate[][],
  dayCount: number,
  wetDayNumbers: number[] = [],
): PlaceCandidate[][] {
  const wet = new Set(wetDayNumbers);
  if (wet.size === 0 || clusters.length === 0) return clusters.slice(0, dayCount);

  const remaining = [...clusters];
  const assigned: PlaceCandidate[][] = [];

  for (let day = 1; day <= dayCount; day += 1) {
    if (remaining.length === 0) { assigned.push([]); continue; }

    if (!wet.has(day)) {
      assigned.push(remaining.shift()!);
      continue;
    }

    const wouldHave = remaining[0];
    let bestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (indoorShare(remaining[index]) > indoorShare(remaining[bestIndex])) bestIndex = index;
    }
    // A quarter of the day's stops is the difference between "there is
    // somewhere to shelter" and "this is technically more indoor".
    const worthSwapping = indoorShare(remaining[bestIndex]) >= indoorShare(wouldHave) + 0.25;
    assigned.push(remaining.splice(worthSwapping ? bestIndex : 0, 1)[0]);
  }

  return assigned;
}

/** Getting out of an airport and to somewhere you can start the day. */
const ARRIVAL_SETTLING_MINUTES = 120;
/** Leaving for the airport: check-in, security, and not running for it. */
const DEPARTURE_LEAD_MINUTES = 210;
/** Beyond this shift, the body is genuinely on another clock. */
const JET_LAG_THRESHOLD_HOURS = 5;
/** How many days a long-haul arrival keeps affecting the plan. */
const JET_LAG_DAYS = 2;

export interface TripEdges {
  /** Local arrival time on day one, `HH:MM`. */
  arrivalTime?: string;
  /** Local departure time on the final day, `HH:MM`. */
  departureTime?: string;
  /**
   * Hours between home and the destination, signed. Supplied by the caller
   * because only the client knows where the traveller is starting from.
   */
  timezoneShiftHours?: number;
}

/**
 * How a day at the edge of a trip differs from one in the middle.
 *
 * A trip does not begin at nine in the morning on day one. It begins whenever
 * the plane lands, after which there is a bag to drop and a city to find. And
 * it does not end at the usual hour either — the last day ends when the
 * traveller has to leave for the airport, which is earlier than it feels.
 *
 * Returns only what differs from the normal pace, so a middle day passes
 * through untouched.
 */
export function shapeTripEdge(
  dayIndex: number,
  dayCount: number,
  edges: TripEdges,
): { startTimeOverride?: string; returnTimeOverride?: string; maxMainOverride?: number; note?: string } {
  const isFirst = dayIndex === 0;
  const isLast = dayIndex === dayCount - 1 && dayCount > 1;
  const shape: { startTimeOverride?: string; returnTimeOverride?: string; maxMainOverride?: number; note?: string } = {};

  if (isFirst && edges.arrivalTime) {
    const usableFrom = toMinutes(edges.arrivalTime) + ARRIVAL_SETTLING_MINUTES;
    shape.startTimeOverride = toTime(usableFrom);
    // Landing in the evening leaves a day that is really just dinner.
    shape.maxMainOverride = usableFrom >= toMinutes('17:00') ? 0 : 1;
    shape.note = `Day one starts after your ${edges.arrivalTime} arrival, with time to drop bags.`;
  }

  if (isLast && edges.departureTime) {
    const mustLeaveBy = toMinutes(edges.departureTime) - DEPARTURE_LEAD_MINUTES;
    shape.returnTimeOverride = toTime(Math.max(0, mustLeaveBy));
    shape.maxMainOverride = Math.min(shape.maxMainOverride ?? 1, 1);
    shape.note = `The last day ends in time to leave for a ${edges.departureTime} departure.`;
  }

  /**
   * Jet lag, applied only where it is real. A three-hour shift is a late night;
   * eight hours is waking at four in the morning for a week. The rule is
   * deliberately blunt — one fewer stop, a later start — because anything more
   * precise would be inventing physiology we cannot observe.
   */
  const shift = Math.abs(edges.timezoneShiftHours ?? 0);
  if (shift >= JET_LAG_THRESHOLD_HOURS && dayIndex < JET_LAG_DAYS && !isLast) {
    const laterStart = toMinutes(shape.startTimeOverride || '09:30') + 60;
    shape.startTimeOverride = toTime(laterStart);
    shape.maxMainOverride = Math.max(0, (shape.maxMainOverride ?? 99) === 99 ? 2 : shape.maxMainOverride!);
    shape.note = shape.note
      ? `${shape.note} Eased off for the ${shift}-hour time difference.`
      : `Eased off for the ${shift}-hour time difference.`;
  }

  return shape;
}

export interface BuildOptions {
  /** Live routing when a provider is connected; estimates otherwise. */
  routeResolver?: RouteResolver;
  /** Reported queue minutes by candidate id, drawn from evidence. */
  queueEvidence?: Record<string, number>;
  /** Explicit traveller settings, which always beat anything inferred. */
  behaviour?: TravelBehaviourProfile;
  /** Day numbers for which live weather recommends an indoor-first order. */
  weatherRiskDays?: number[];
  /** Flight times and time-zone shift, so the first and last days fit reality. */
  tripEdges?: TripEdges;
  /** Current event facts surfaced by the provider; never treated as booked time. */
  currentEventNotes?: string[];
  /** Timed event facts used only to detect conflicts with the proposed plan. */
  currentEvents?: Array<{
    id: string;
    name: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    url?: string;
  }>;
}

/** Categories that describe logistics rather than the character of a day. */
const UNINFORMATIVE_CATEGORIES = new Set(['essential', 'experience', 'day-trip']);

const humanise = (category: string) =>
  category.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

/**
 * The calendar date of day N, or undefined for an undated trip.
 *
 * Undated is a real case — a traveller can plan before fixing dates — and it
 * degrades honestly: without a weekday the scheduler falls back to a place's
 * first published window rather than inventing one.
 */
export function dateForDay(startDate: string | undefined, dayIndex: number): string | undefined {
  if (!startDate) return undefined;
  // UTC throughout, so the weekday cannot shift with the viewer's timezone.
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return undefined;
  return new Date(start + dayIndex * 86_400_000).toISOString().slice(0, 10);
}

const clockMinutes = (value?: string) => {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

/** The category that best characterises what a day is actually about. */
function dominantTheme(places: PlaceCandidate[]): string | undefined {
  const counts = new Map<string, number>();
  for (const place of places) {
    for (const category of place.categories) {
      if (UNINFORMATIVE_CATEGORIES.has(category)) continue;
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? humanise(best[0]) : undefined;
}

/**
 * Name a day after where it actually goes. Titles must be distinct across the
 * trip — two days both called "Minami and nearby" read like a bug — so this
 * falls through progressively more specific forms until one is unused.
 */
function composeDayTitle(places: PlaceCandidate[], used: Set<string>, dayNumber: number): string {
  if (places.length === 0) return `Flexible day ${dayNumber}`;
  const areas = [...new Set(places.map((place) => place.neighbourhood || place.city))];
  const theme = dominantTheme(places);

  const options = [
    areas.length === 1 ? areas[0] : areas.slice(0, 2).join(' and '),
    theme ? `${theme} in ${areas[0]}` : undefined,
    theme && areas.length > 1 ? `${theme} around ${areas[1]}` : undefined,
    `Around ${places[0].name}`,
    `${areas[0]} · day ${dayNumber}`,
  ].filter((option): option is string => Boolean(option));

  return options.find((option) => !used.has(option)) ?? `${areas[0]} · day ${dayNumber}`;
}

/** Turn one simulated slot into the Activity shape the rest of the app renders. */
function slotToActivity(
  slot: ScheduledSlot,
  dayNumber: number,
  transportMode: string,
): Activity | null {
  const time = toTime(slot.startMinutes);

  if (slot.kind === 'meal') {
    return createMealWindow(
      dayNumber,
      slot.label,
      time,
      slot.endMinutes - slot.startMinutes,
      slot.reason.replace(/^Kept flexible around /, '').split('.')[0],
    );
  }
  if (slot.kind === 'rest') return createRestBeat(dayNumber, time, slot.reason);
  if (!slot.candidate) return null;

  const activity = candidateToActivity(slot.candidate);
  activity.time = time;
  activity.durationMinutes = slot.endMinutes - slot.startMinutes;
  activity.transportMinutes = slot.arrivalLeg?.durationMinutes;
  activity.transportMode = slot.arrivalLeg
    ? (slot.arrivalLeg.mode === 'walking' ? 'walking' : transportMode)
    : undefined;
  activity.travelEstimateSource = slot.arrivalLeg
    ? (slot.arrivalLeg.source === 'provider' ? 'provider-route' : 'offline-straight-line')
    : 'unknown';
  activity.generatedMetadata = {
    source: 'imported',
    generatedAt: new Date().toISOString(),
    reason: slot.queueMinutes
      ? `${slot.reason} · about ${slot.queueMinutes} min wait`
      : slot.reason,
    // Confidence tracks the evidence, not the neatness of the schedule.
    confidence: slot.candidate.openingHours && slot.arrivalLeg?.source === 'provider'
      ? 'high'
      : slot.candidate.openingHours ? 'medium' : 'low',
  };
  return activity;
}

/**
 * Build a full itinerary by simulating each day as a person would live it.
 *
 * Days are formed from geographic clusters discovered in the candidates
 * themselves — there is no per-city theme table, so this behaves identically in
 * Melbourne, Beijing, Osaka or anywhere a provider can answer.
 */
export function buildDestinationItinerary(
  itinerary: Itinerary,
  profile: TripProfile,
  ranked: RankedCandidate[],
  decisions: Record<string, CandidateDecision>,
  options: BuildOptions = {},
): DestinationBuildResult {
  const accepted = ranked
    .filter(({ candidate }) => decisions[candidate.id] === 'must-do' || decisions[candidate.id] === 'interested')
    .map(({ candidate }) => candidate);

  const behaviour = applyTravellerConstraints(
    options.behaviour ?? deriveTravelBehaviour(profile),
  );
  const dayCount = Math.max(1, itinerary.days.length || profile.dayCount || 1);
  const primaryCity = profile.destinations[0]?.city || itinerary.cities[0] || accepted[0]?.city || '';
  const transportMode = profile.transport.includes('public-transport')
    ? 'public transport'
    : 'walking / public transport';

  /**
   * Food is offered to every day rather than clustered into one.
   *
   * A restaurant is not a destination competing for the day's stops — it is
   * where the traveller happens to be at one o'clock. Drawing from the whole
   * ranked list, not just the accepted shortlist, means a day can suggest
   * somewhere to eat even when the traveller never swiped on a restaurant.
   */
  const foodCandidates = ranked
    .map(({ candidate }) => candidate)
    .filter((candidate) => isFoodPlace(candidate) && decisions[candidate.id] !== 'skip');

  // Must-do places lead their cluster so capacity limits never drop them first.
  const mustDo = new Set(
    accepted.filter((candidate) => decisions[candidate.id] === 'must-do').map((candidate) => candidate.id),
  );
  const clusters = assignClustersToDays(
    clusterCandidates(accepted.filter((candidate) => !isFoodOnly(candidate))).map((cluster) =>
      [...cluster].sort((a, b) => Number(mustDo.has(b.id)) - Number(mustDo.has(a.id)))),
    dayCount,
    // Send the sheltered part of the city to the day the forecast says is wet.
    options.weatherRiskDays,
  );

  const days: DayPlan[] = [];
  const dayLoads: DayLoad[] = [];
  const scheduled = new Set<string>();
  /** Venues already used for a meal, so the trip does not eat in one place daily. */
  const usedMealVenues = new Set<string>();
  const rejections = new Map<string, { candidate: PlaceCandidate; reason: DiscoveryUnscheduledReason; detail: string }>();
  const warnings = new Set<string>();
  (options.currentEventNotes || []).filter(Boolean).forEach((note) => {
    warnings.add(`Current event to review before locking the plan: ${note}`);
  });
  const eventWindows = options.currentEvents || [];
  const usedTitles = new Set<string>();
  let usedProviderRoutes = false;

  /** Simulate one day from an explicit candidate list. */
  const runDay = (index: number, dayCandidates: PlaceCandidate[], excludedMealVenues: Set<string>) => {
    // The first and last days are shaped by the flights, not by the pace. The
    // note is for the traveller and is collected separately.
    const edge = shapeTripEdge(index, dayCount, options.tripEdges || {});
    return simulateDay({
    dayNumber: index + 1,
    city: primaryCity,
    candidates: dayCandidates,
    behaviour,
    routeResolver: options.routeResolver,
    queueEvidence: options.queueEvidence,
    preferIndoor: options.weatherRiskDays?.includes(index + 1),
    // Supplies the weekday that opening hours are checked against, so a
    // Monday is not planned from places that close on Mondays.
    date: dateForDay(profile.startDate, index),
    // Somewhere to actually eat. Offered from the whole shortlist rather than
    // this day's cluster, because a traveller does not shortlist lunch.
    mealCandidates: foodCandidates.filter((candidate) => !excludedMealVenues.has(candidate.id)),
    mealPreferences: {
      budgetTier: profile.budgetTier,
      dietaryNeeds: behaviour.meals.dietaryNeeds,
      preferredTags: profile.styles,
    },
      startTimeOverride: edge.startTimeOverride,
      returnTimeOverride: edge.returnTimeOverride,
      maxMainOverride: edge.maxMainOverride,
    });
  };

  const placesOf = (day: SimulatedDay): PlaceCandidate[] => day.slots
    .filter((slot) => slot.kind === 'place')
    .map((slot) => slot.candidate)
    .filter((candidate): candidate is PlaceCandidate => Boolean(candidate));

  /**
   * Re-simulate the whole trip from a fixed per-day assignment.
   *
   * Meal venues are recomputed from scratch each time so a re-run is
   * deterministic — otherwise the exclusions left over from an abandoned
   * arrangement would leak into the next one.
   */
  const simulateAll = (assignments: PlaceCandidate[][]): SimulatedDay[] => {
    const meals = new Set<string>();
    return assignments.map((dayCandidates, index) => {
      const day = runDay(index, dayCandidates, meals);
      for (const slot of day.slots) {
        if (slot.kind === 'meal' && slot.candidate) meals.add(slot.candidate.id);
      }
      return day;
    });
  };

  // Tell the traveller why the edges of their trip look different, rather than
  // letting a near-empty arrival day read as a planning failure.
  for (let index = 0; index < dayCount; index += 1) {
    const { note } = shapeTripEdge(index, dayCount, options.tripEdges || {});
    if (note) warnings.add(note);
  }

  // --- Pass one: fill the days in order ------------------------------------
  // Anything a cluster could not absorb rolls forward to later days.
  let carryOver: PlaceCandidate[] = [];
  let simulations: SimulatedDay[] = [];
  let assignments: PlaceCandidate[][] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const cluster = clusters[index] || [];
    const dayCandidates = [...carryOver, ...cluster].filter((candidate) => !scheduled.has(candidate.id));
    carryOver = [];

    const simulated = runDay(index, dayCandidates, usedMealVenues);

    for (const slot of simulated.slots) {
      /**
       * Meal venues are tracked apart from shortlisted places.
       *
       * `scheduled` answers "did the traveller's choice make it in", and every
       * accepted place must appear there or in `rejections`. A restaurant the
       * planner suggested was never their choice, so counting it would break
       * that accounting — while still needing to be remembered, so the same
       * place is not offered for lunch on every day of the trip.
       */
      if (slot.candidate) {
        if (slot.kind === 'meal') usedMealVenues.add(slot.candidate.id);
        else scheduled.add(slot.candidate.id);
      }
    }

    // Most rejections are about *this* day, not the place: a museum that shuts
    // before you could reach it today fits easily on a lighter day. Only
    // trip-wide reasons are final; everything else rolls forward.
    for (const rejection of simulated.rejections) {
      if (TRIP_WIDE_REJECTIONS.has(rejection.reason)) {
        rejections.set(rejection.candidate.id, rejection);
      } else {
        carryOver.push(rejection.candidate);
      }
    }

    simulations.push(simulated);
    assignments.push(placesOf(simulated));
  }

  // --- Pass two: even out the days ----------------------------------------
  const rebalanced = rebalanceDays(assignments, simulations, simulateAll, placesOf);
  assignments = rebalanced.assignments;
  simulations = rebalanced.simulations;
  if (rebalanced.moves > 0) {
    warnings.add(rebalanced.moves === 1
      ? 'One stop was moved to a lighter day so no single day is much harder than the rest.'
      : `${rebalanced.moves} stops were moved to lighter days so no single day is much harder than the rest.`);
  }

  // --- Pass three: turn the final simulation into the plan ------------------
  for (let index = 0; index < simulations.length; index += 1) {
    const simulated = simulations[index];
    const existing = itinerary.days[index];
    const protectedActivities = (existing?.activities || []).filter((activity) =>
      activity.locked || activity.lockedFields?.includes('all') || activity.lockedFields?.includes('schedule'));

    const discoveredActivities = simulated.slots
      .map((slot) => slotToActivity(slot, index + 1, transportMode))
      .filter((activity): activity is Activity => activity !== null);

    for (const slot of simulated.slots) {
      if (slot.arrivalLeg?.source === 'provider') usedProviderRoutes = true;
    }
    simulated.warnings.forEach((warning) => warnings.add(warning));

    // Event data is advisory unless the traveller explicitly chooses the
    // event. We nevertheless use its factual local time to flag a collision
    // with the proposed itinerary, never silently moving or booking anything.
    eventWindows
      .filter((event) => !event.date || !existing?.date || event.date === existing.date)
      .forEach((event) => {
        const eventStart = clockMinutes(event.startTime);
        const eventEnd = clockMinutes(event.endTime) ?? (eventStart === null ? null : eventStart + 120);
        if (eventStart === null || eventEnd === null) return;
        const overlaps = discoveredActivities.some((activity) => {
          const activityStart = clockMinutes(activity.time);
          if (activityStart === null) return false;
          const activityEnd = activityStart + Math.max(15, activity.durationMinutes || 90);
          return activityStart < eventEnd && activityEnd > eventStart;
        });
        if (overlaps) warnings.add(`Live event ${event.name} overlaps this day's proposed activities; review before locking.`);
      });

    const dayPlaces = simulated.slots
      .map((slot) => slot.candidate)
      .filter((candidate): candidate is PlaceCandidate => Boolean(candidate));
    const title = dayPlaces.length > 0
      ? composeDayTitle(dayPlaces, usedTitles, index + 1)
      : existing?.title || `Flexible day ${index + 1}`;
    usedTitles.add(title);

    days.push({
      day: existing?.day || index + 1,
      date: existing?.date || '',
      city: simulated.city || existing?.city || primaryCity,
      title,
      activities: [...protectedActivities, ...discoveredActivities].sort((a, b) => a.time.localeCompare(b.time)),
      photos: existing?.photos,
    });
    dayLoads.push(simulated.load);
  }

  // Anything still carried after the last day genuinely has no home.
  for (const candidate of carryOver) {
    if (scheduled.has(candidate.id) || rejections.has(candidate.id)) continue;
    rejections.set(candidate.id, {
      candidate,
      reason: 'no-viable-day',
      detail: 'The trip has no remaining day with room for this place.',
    });
  }
  // And anything never offered to a day at all, because there were more
  // clusters than days.
  for (const candidate of accepted) {
    if (scheduled.has(candidate.id) || rejections.has(candidate.id)) continue;
    rejections.set(candidate.id, {
      candidate,
      reason: 'no-viable-day',
      detail: `This trip has ${dayCount} ${dayCount === 1 ? 'day' : 'days'}; add a day to fit more areas.`,
    });
  }

  const unscheduledReasons = [...rejections.values()];
  warnings.add('Opening hours with low or medium source confidence should be rechecked before travel.');

  return {
    days,
    scheduledCandidates: accepted.filter((candidate) => scheduled.has(candidate.id)),
    unscheduledCandidates: unscheduledReasons.map((item) => item.candidate),
    unscheduledReasons,
    dayLoads,
    warnings: [...warnings],
    routeMode: usedProviderRoutes ? 'provider' : 'offline-straight-line',
    behaviour,
  };
}

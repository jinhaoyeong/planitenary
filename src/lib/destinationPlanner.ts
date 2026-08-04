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
  applyTravellerConstraints,
  deriveTravelBehaviour,
  type TravelBehaviourProfile,
} from './travelBehaviour';
import {
  clusterCandidates,
  simulateDay,
  toTime,
  type DayLoad,
  type RouteResolver,
  type ScheduledSlot,
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

export function defaultDiscoveryDecisions(ranked: RankedCandidate[]): Record<string, CandidateDecision> {
  const decisions: Record<string, CandidateDecision> = {};
  ranked.slice(0, 2).forEach(({ candidate }) => { decisions[candidate.id] = 'must-do'; });
  ranked.slice(2, 29).forEach(({ candidate }) => { decisions[candidate.id] = 'interested'; });
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

export interface BuildOptions {
  /** Live routing when a provider is connected; estimates otherwise. */
  routeResolver?: RouteResolver;
  /** Reported queue minutes by candidate id, drawn from evidence. */
  queueEvidence?: Record<string, number>;
  /** Explicit traveller settings, which always beat anything inferred. */
  behaviour?: TravelBehaviourProfile;
  /** Day numbers for which live weather recommends an indoor-first order. */
  weatherRiskDays?: number[];
  /** Current event facts surfaced by the provider; never treated as booked time. */
  currentEventNotes?: string[];
}

/** Categories that describe logistics rather than the character of a day. */
const UNINFORMATIVE_CATEGORIES = new Set(['essential', 'experience', 'day-trip']);

const humanise = (category: string) =>
  category.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

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

  // Must-do places lead their cluster so capacity limits never drop them first.
  const mustDo = new Set(
    accepted.filter((candidate) => decisions[candidate.id] === 'must-do').map((candidate) => candidate.id),
  );
  const clusters = clusterCandidates(accepted).map((cluster) =>
    [...cluster].sort((a, b) => Number(mustDo.has(b.id)) - Number(mustDo.has(a.id))));

  const days: DayPlan[] = [];
  const dayLoads: DayLoad[] = [];
  const scheduled = new Set<string>();
  const rejections = new Map<string, { candidate: PlaceCandidate; reason: DiscoveryUnscheduledReason; detail: string }>();
  const warnings = new Set<string>();
  (options.currentEventNotes || []).filter(Boolean).forEach((note) => {
    warnings.add(`Current event to review before locking the plan: ${note}`);
  });
  const usedTitles = new Set<string>();
  let usedProviderRoutes = false;

  // Anything a cluster could not absorb rolls forward to later days.
  let carryOver: PlaceCandidate[] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const existing = itinerary.days[index];
    const protectedActivities = (existing?.activities || []).filter((activity) =>
      activity.locked || activity.lockedFields?.includes('all') || activity.lockedFields?.includes('schedule'));

    const cluster = clusters[index] || [];
    const dayCandidates = [...carryOver, ...cluster].filter((candidate) => !scheduled.has(candidate.id));
    carryOver = [];

    const simulated = simulateDay({
      dayNumber: index + 1,
      city: primaryCity,
      candidates: dayCandidates,
      behaviour,
      routeResolver: options.routeResolver,
      queueEvidence: options.queueEvidence,
      preferIndoor: options.weatherRiskDays?.includes(index + 1),
      // Arrival day starts in the afternoon; the traveller is in transit.
      startTimeOverride: index === 0 && itinerary.days.length === 0 ? '15:00' : undefined,
    });

    const discoveredActivities = simulated.slots
      .map((slot) => slotToActivity(slot, index + 1, transportMode))
      .filter((activity): activity is Activity => activity !== null);

    for (const slot of simulated.slots) {
      if (slot.candidate) scheduled.add(slot.candidate.id);
      if (slot.arrivalLeg?.source === 'provider') usedProviderRoutes = true;
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
    simulated.warnings.forEach((warning) => warnings.add(warning));

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

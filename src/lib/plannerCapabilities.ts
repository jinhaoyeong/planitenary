/**
 * What Planitenary can do to a plan, defined once.
 *
 * Before this, the same capabilities existed twice: as a row of chips inside
 * the itinerary page's "Organise places" panel, and as nothing at all in Ask —
 * where a traveller could describe the same intent in prose and reach a
 * different code path. Two surfaces, two vocabularies, one set of underlying
 * planners. This module is the single vocabulary.
 *
 * It is deliberately *not* a planner. Every capability names an engine that
 * already exists in `tripIntelligence` or on the server, and the mapping is the
 * only new thing here. Nothing in this file changes an itinerary, and the
 * `route` field is what guarantees that: a capability either opens a
 * deterministic proposal for review, or it opens Ask with the question
 * pre-typed. Neither writes.
 *
 * Two layers, and they answer different questions:
 *
 * - `deriveSmartActions` (server-shared) answers "what is wrong with *this*
 *   trip right now" — contextual, ranked, at most a handful.
 * - This registry answers "what can you do at all" — the stable catalogue,
 *   filtered only by whether the trip has the material for it.
 *
 * Smart Plan shows the first above the second. Ask turns the second into
 * example questions. Neither owns the meaning.
 */

import type { Activity, Itinerary } from '../data';

/**
 * Stable ids. These match the internal action vocabulary the deterministic
 * planners already used, so a capability can be traced from a chip to the
 * engine without a translation table.
 */
export type PlannerCapabilityId =
  | 'place-saved'
  | 'rebalance-travel'
  | 'more-relaxed'
  | 'less-walking'
  | 'rainy-day'
  | 'late-start'
  | 'route-delay'
  | 'lower-cost'
  | 'fix-conflicts'
  | 'more-local'
  | 'complete-trip'
  | 'undo-last';

/**
 * Where a click goes, and the reason the distinction is load-bearing.
 *
 * `local-proposal` capabilities are answered by a deterministic function on the
 * traveller's own device: no model, no request, no metered call. Routing them
 * through Ask would spend money to reproduce arithmetic that is already exact.
 *
 * `ask` capabilities are genuinely open-ended — "somewhere cheaper near
 * Shinjuku" has no deterministic answer — and belong in a conversation.
 *
 * `history` is neither: it reverses a change that has already been applied.
 */
export type PlannerCapabilityRoute = 'local-proposal' | 'server-proposal' | 'ask' | 'history';

/** What the trip currently offers, derived once and passed to every predicate. */
export interface PlannerTripSignals {
  hasScheduledPlaces: boolean;
  hasUnassignedPlaces: boolean;
  conflictCount: number;
  dayCount: number;
  hasReversibleChange: boolean;
}

export interface PlannerCapability {
  id: PlannerCapabilityId;
  /**
   * Traveller-facing, and deliberately plain. "Make it less rushed" rather
   * than "rebalance schedule density": the person reading this is deciding
   * what they want, not naming an algorithm.
   */
  label: string;
  /** One short line. Shown where there is room; never required to understand the label. */
  description: string;
  route: PlannerCapabilityRoute;
  /**
   * How the same intent sounds as a question, used to pre-type Ask.
   *
   * Present even for deterministic capabilities, because a traveller may want
   * the conversational version of the same thing ("reduce walking on day 3"
   * rather than "reduce walking"), and that phrasing has to come from the same
   * place as the chip or the two surfaces drift apart.
   */
  askExample: string;
  /** Whether the trip has the material for this to mean anything. */
  available: (signals: PlannerTripSignals) => boolean;
}

/**
 * A place the planner is allowed to move.
 *
 * Lifted out of `PlannerPreview` unchanged so the capability list and the
 * planner agree on what counts as a place. Two definitions of "activity" is
 * how a chip offers to fix conflicts a planner cannot see.
 */
export const isPlannerPlaceActivity = (activity: Activity): boolean =>
  activity.kind !== 'meal-window'
  && activity.kind !== 'rest-window'
  && activity.kind !== 'free-time'
  && activity.kind !== 'transport'
  && !(activity.source === 'generated' && !activity.providerPlaceId && (activity.type === 'food' || activity.type === 'cafe'));

const timeToMinutes = (value: string): number | null => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * Overlaps and opening-hours breaches across the whole trip.
 *
 * Also lifted from `PlannerPreview` rather than rewritten: the number shown on
 * the "Fix schedule conflicts" chip has to be the number the repair planner
 * will actually find, and a second implementation would eventually disagree.
 */
export const conflictCountFor = (itinerary: Itinerary): number => itinerary.days.reduce((total, day) => {
  const activities = day.activities
    .filter(isPlannerPlaceActivity)
    .sort((left, right) => (timeToMinutes(left.time) ?? 0) - (timeToMinutes(right.time) ?? 0));
  let conflicts = 0;
  activities.forEach((activity, index) => {
    const start = timeToMinutes(activity.time);
    const end = start === null ? null : start + Math.max(15, activity.durationMinutes || 90);
    const openingStart = timeToMinutes(activity.openingHours?.opensAt || '');
    const openingEnd = timeToMinutes(activity.openingHours?.closesAt || '');
    if (start !== null && end !== null && ((openingStart !== null && start < openingStart) || (openingEnd !== null && end > openingEnd))) conflicts += 1;
    const previous = activities[index - 1];
    const previousStart = previous ? timeToMinutes(previous.time) : null;
    const previousEnd = previousStart === null ? null : previousStart + Math.max(15, previous.durationMinutes || 90);
    if (previousEnd !== null && start !== null && start < previousEnd) conflicts += 1;
  });
  return total + conflicts;
}, 0);

export function plannerTripSignals(itinerary: Itinerary): PlannerTripSignals {
  return {
    hasScheduledPlaces: itinerary.days.some((day) => day.activities.some(isPlannerPlaceActivity)),
    hasUnassignedPlaces: (itinerary.unassignedActivities?.length || 0) > 0,
    conflictCount: conflictCountFor(itinerary),
    dayCount: itinerary.days.length,
    hasReversibleChange: (itinerary.plannerHistory?.length || 0) > 0,
  };
}

/** A capability needs somewhere to put places before it can rearrange them. */
const needsPlan = (signals: PlannerTripSignals) => signals.hasScheduledPlaces;

/**
 * The catalogue.
 *
 * Order is the order they are offered. Deterministic repairs come before
 * open-ended research, because the cheap exact answer should be the one a
 * traveller sees first.
 */
export const PLANNER_CAPABILITIES: readonly PlannerCapability[] = [
  {
    id: 'place-saved',
    label: 'Place my saved activities',
    description: 'Spread confirmed places across your days.',
    route: 'local-proposal',
    askExample: 'Put my saved activities into days.',
    available: (signals) => signals.hasUnassignedPlaces,
  },
  {
    id: 'rebalance-travel',
    label: 'Rebalance travel',
    description: 'Reorder stops so you criss-cross the city less.',
    route: 'local-proposal',
    askExample: 'Can you rebalance the travel across my days?',
    available: needsPlan,
  },
  {
    id: 'more-relaxed',
    label: 'Make the trip less rushed',
    description: 'Fewer stops a day, with room to breathe.',
    route: 'local-proposal',
    askExample: 'Make tomorrow less rushed.',
    available: needsPlan,
  },
  {
    id: 'less-walking',
    label: 'Reduce walking',
    description: 'Cut the distance covered on foot.',
    route: 'local-proposal',
    askExample: 'Reduce walking on day 3.',
    available: needsPlan,
  },
  {
    id: 'rainy-day',
    label: 'Make a rainy-day version',
    description: 'Prefer indoor stops if the weather turns.',
    route: 'local-proposal',
    askExample: 'Rearrange my plan if it rains.',
    available: needsPlan,
  },
  {
    id: 'late-start',
    label: 'Handle a late start',
    description: 'Reflow the day when you begin an hour behind.',
    route: 'local-proposal',
    askExample: 'I am starting an hour late — can you reflow the day?',
    available: needsPlan,
  },
  {
    id: 'route-delay',
    label: 'Adjust for a route delay',
    description: 'Absorb half an hour lost in transit.',
    route: 'local-proposal',
    askExample: 'A train delay cost me 30 minutes. What should change?',
    available: needsPlan,
  },
  {
    id: 'lower-cost',
    label: 'Lower the cost',
    description: 'Swap toward cheaper stops where it fits.',
    route: 'local-proposal',
    askExample: 'How do I bring the cost of this trip down?',
    available: needsPlan,
  },
  {
    id: 'fix-conflicts',
    label: 'Fix schedule conflicts',
    description: 'Repair overlaps and closed-door arrivals.',
    route: 'local-proposal',
    askExample: 'Fix the schedule conflicts in my plan.',
    // Offered only when there is something to repair. A chip that opens an
    // empty proposal teaches a traveller that the chip does nothing.
    available: (signals) => needsPlan(signals) && signals.conflictCount > 0,
  },
  {
    /**
     * Was a permanently disabled "More local · Soon" chip, which promised
     * something and delivered a tooltip. It has no deterministic planner, but
     * it is a perfectly good *question*, so it routes to Ask and works today.
     */
    id: 'more-local',
    label: 'Find more local places',
    description: 'Look for places beyond the obvious ones.',
    route: 'ask',
    askExample: 'Find more local places near my saved stops.',
    available: () => true,
  },
  {
    id: 'complete-trip',
    label: 'Complete my trip',
    description: 'Fill thin days from saved places and verified suggestions.',
    route: 'server-proposal',
    askExample: 'What is still missing from my trip?',
    available: (signals) => signals.dayCount > 0,
  },
  {
    id: 'undo-last',
    label: 'Undo last plan change',
    description: 'Put the plan back as it was.',
    route: 'history',
    askExample: 'Undo the last change to my plan.',
    available: (signals) => signals.hasReversibleChange,
  },
];

export const plannerCapability = (id: PlannerCapabilityId): PlannerCapability | undefined =>
  PLANNER_CAPABILITIES.find((capability) => capability.id === id);

export const availableCapabilities = (signals: PlannerTripSignals): PlannerCapability[] =>
  PLANNER_CAPABILITIES.filter((capability) => capability.available(signals));

/**
 * Example questions for Ask's empty state.
 *
 * Drawn from the same registry the chips come from, so the two surfaces cannot
 * describe different products. `undo-last` is excluded: reversing an applied
 * change is a button, and offering it as a sentence to type invites the model
 * to be asked for something only history can do.
 */
export const capabilityAskExamples = (signals: PlannerTripSignals, limit = 6): string[] =>
  availableCapabilities(signals)
    .filter((capability) => capability.id !== 'undo-last')
    .slice(0, limit)
    .map((capability) => capability.askExample);

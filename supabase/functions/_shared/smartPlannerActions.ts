/**
 * Deterministic Smart Plan actions.
 *
 * GPT does not invent which problems exist. This module inspects the owned
 * itinerary (and optional wallet hints) and returns at most five actions.
 * None of them writes — proposal intents enter Plan my trip; read intents
 * navigate or open Ask.
 */

import { ARRIVAL_SETTLING_MINUTES, clockToMinutes, isPlannerPlace } from './itineraryProposal.ts';
import type { IntelligenceSurface } from './intelligenceContext.ts';

export type SmartActionScope = 'trip' | 'day' | 'activity' | 'place' | 'budget' | 'map' | 'documents';
export type SmartActionMode = 'read' | 'research' | 'proposal';

import { parseStructuredPlaceRef, type StructuredPlaceRef } from './placeReference.ts';

export type SmartActionIntent =
  | 'plan-trip'
  | 'plan-after-arrival'
  | 'improve-day'
  | 'fix-conflict'
  | 'fit-must-do'
  | 'organise-saved'
  | 'review-budget'
  | 'ask';

export interface SmartAction {
  id: SmartActionIntent;
  title: string;
  reason: string;
  scope: SmartActionScope;
  mode: SmartActionMode;
  /**
   * The place this action is about, when its decision was captured with one.
   *
   * Present only on `fit-must-do`, and only when the traveller's Must-do was
   * recorded from a discovery candidate the server could prove. Every older
   * decision has none, which is why the action reads perfectly well without
   * it — the reference adds a picture, never the meaning.
   */
  placeRef?: StructuredPlaceRef;
  /**
   * Which stored decision this action is about.
   *
   * Not identity, and deliberately not a place: it names the decision the
   * server should re-read from the traveller's own trip. The action already
   * carries `placeRef` for deterministic local reasoning, but a reference that
   * arrived in a browser is only a claim — the server resolves what the
   * decision actually points at, from storage it owns.
   */
  decisionKey?: string;
}

export interface SmartActionInput {
  itinerary: Record<string, unknown> | null;
  surface: IntelligenceSurface;
  dayNumber?: number;
  hasBudget?: boolean;
  budgetRemainingKnown?: number;
  budgetCeilingKnown?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const MAX_ACTIONS = 5;

const activityRows = (itinerary: Record<string, unknown> | null): Array<{
  day?: number;
  activity: Record<string, unknown>;
}> => {
  const rows: Array<{ day?: number; activity: Record<string, unknown> }> = [];
  for (const raw of asArray(itinerary?.days)) {
    const day = asRecord(raw);
    const number = typeof day?.day === 'number' ? day.day : undefined;
    for (const entry of asArray(day?.activities)) {
      const activity = asRecord(entry);
      if (activity) rows.push({ day: number, activity });
    }
  }
  for (const entry of asArray(itinerary?.unassignedActivities)) {
    const activity = asRecord(entry);
    if (activity) rows.push({ activity });
  }
  return rows;
};

const timedWindows = (activities: Record<string, unknown>[]) =>
  activities.flatMap((activity) => {
    const start = clockToMinutes(typeof activity.time === 'string' ? activity.time : undefined);
    const duration = typeof activity.durationMinutes === 'number' ? activity.durationMinutes : undefined;
    if (start === undefined || duration === undefined || duration <= 0) return [];
    return [{ name: String(activity.name || 'Activity'), start, end: start + duration }];
  }).sort((left, right) => left.start - right.start);

export function deriveSmartActions(input: SmartActionInput): SmartAction[] {
  const itinerary = input.itinerary;
  const rows = activityRows(itinerary);
  const days = asArray(itinerary?.days).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const discovery = asRecord(itinerary?.discoveryState);
  const decisions = asRecord(discovery?.decisions) ?? {};
  const focusDay = input.dayNumber ?? (typeof days[0]?.day === 'number' ? days[0].day : 1);

  const flights = rows.filter(({ activity }) => activity.type === 'flight');
  const arrival = flights.find(({ activity, day }) => {
    const start = clockToMinutes(typeof activity.time === 'string' ? activity.time : undefined);
    return day === focusDay && start !== undefined && typeof activity.durationMinutes === 'number';
  });

  const dayRecord = days.find((day) => day.day === focusDay);
  const dayActivities = asArray(dayRecord?.activities).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const plannerOnDay = dayActivities.filter((activity) => isPlannerPlace(activity, focusDay));
  const windows = timedWindows(dayActivities);
  const hasOverlap = windows.slice(1).some((current, index) => current.start < windows[index].end);

  const mustDoIds = Object.entries(decisions)
    .filter(([, value]) => value === 'must-do')
    .map(([id]) => id);
  const scheduledIds = new Set(
    rows
      .map(({ activity }) => typeof activity.id === 'string' ? activity.id : '')
      .filter(Boolean),
  );
  /**
   * The specific Must-do that is missing, not merely that one is.
   *
   * The action text is unchanged, but knowing *which* decision it refers to is
   * what lets its stored reference be attached — and a reference may only ever
   * be found by decision key.
   */
  const omittedMustDoId = mustDoIds.find((id) => !scheduledIds.has(id));

  const interestedCount = Object.values(decisions).filter((value) => value === 'interested').length;
  const eligiblePlaces = rows.filter(({ activity, day }) => isPlannerPlace(activity, day)).length;

  const actions: SmartAction[] = [];
  const push = (action: SmartAction) => {
    if (actions.length >= MAX_ACTIONS - 1) return;
    if (actions.some((existing) => existing.id === action.id)) return;
    actions.push(action);
  };

  if (hasOverlap) {
    push({
      id: 'fix-conflict',
      title: 'Fix timing conflict',
      reason: `Saved activities on day ${focusDay} overlap. I can propose a conflict-free day.`,
      scope: 'day',
      mode: 'proposal',
    });
  }

  if (arrival) {
    const start = clockToMinutes(typeof arrival.activity.time === 'string' ? arrival.activity.time : undefined) ?? 0;
    const duration = typeof arrival.activity.durationMinutes === 'number' ? arrival.activity.durationMinutes : 0;
    const landing = start + duration;
    const hour = Math.floor(landing / 60);
    const minute = landing % 60;
    const period = hour >= 12 ? 'PM' : 'AM';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    const clock = minute === 0 ? `${twelve}:00 ${period}` : `${twelve}:${String(minute).padStart(2, '0')} ${period}`;
    const sightseeing = Math.floor((landing + ARRIVAL_SETTLING_MINUTES) / 60);
    const sightMin = (landing + ARRIVAL_SETTLING_MINUTES) % 60;
    const sightPeriod = sightseeing >= 12 ? 'PM' : 'AM';
    const sightTwelve = sightseeing % 12 === 0 ? 12 : sightseeing % 12;
    const sightClock = sightMin === 0
      ? `${sightTwelve}:00 ${sightPeriod}`
      : `${sightTwelve}:${String(sightMin).padStart(2, '0')} ${sightPeriod}`;
    if (plannerOnDay.length <= 1) {
      push({
        id: 'plan-after-arrival',
        title: 'Plan after arrival',
        reason: `Your flight arrives at ${clock}. I can organise the afternoon from ${sightClock} onward.`,
        scope: 'day',
        mode: 'proposal',
      });
    }
  }

  if (omittedMustDoId) {
    push({
      id: 'fit-must-do',
      title: 'Fit a Must do',
      reason: 'A place you marked Must do is not on the saved plan yet.',
      scope: 'place',
      mode: 'proposal',
      // Absent for every decision made before references existed. No lookup,
      // no reconstruction: this is the ref that was captured, or nothing.
      placeRef: parseStructuredPlaceRef(asRecord(discovery?.placeRefs)?.[omittedMustDoId]),
      decisionKey: omittedMustDoId,
    });
  }

  if (plannerOnDay.length === 0 && !arrival) {
    push({
      id: 'improve-day',
      title: `Plan day ${focusDay}`,
      reason: `Day ${focusDay} has no sightseeing yet.`,
      scope: 'day',
      mode: 'proposal',
    });
  } else if (plannerOnDay.length >= 1 && input.surface === 'itinerary') {
    push({
      id: 'improve-day',
      title: focusDay ? `Improve day ${focusDay}` : 'Improve this day',
      reason: 'I can rebalance this day around your saved places and fixed times.',
      scope: 'day',
      mode: 'proposal',
    });
  }

  if (interestedCount >= 4) {
    push({
      id: 'organise-saved',
      title: 'Organise saved places',
      reason: `You have ${interestedCount} Interested places. Review which ones belong in the plan.`,
      scope: 'place',
      mode: 'read',
    });
  }

  if (
    input.hasBudget === true
    && typeof input.budgetCeilingKnown === 'number'
    && input.budgetCeilingKnown > 0
    && typeof input.budgetRemainingKnown === 'number'
    && input.budgetRemainingKnown <= input.budgetCeilingKnown * 0.2
  ) {
    push({
      id: 'review-budget',
      title: 'Review budget',
      reason: 'Recorded spending is near your planned ceiling.',
      scope: 'budget',
      mode: 'read',
    });
  } else if (input.surface === 'budget' && input.hasBudget === true) {
    push({
      id: 'review-budget',
      title: 'Review budget',
      reason: 'See how recorded spending compares with your category ceilings.',
      scope: 'budget',
      mode: 'read',
    });
  }

  if (eligiblePlaces > 0 && !actions.some((action) => action.mode === 'proposal')) {
    push({
      id: 'plan-trip',
      title: 'Plan my trip',
      reason: 'Build a route-aware proposal from your saved places. Nothing changes until you apply it.',
      scope: 'trip',
      mode: 'proposal',
    });
  } else if (eligiblePlaces > 0 && !actions.some((action) => action.id === 'plan-trip' || action.id === 'plan-after-arrival')) {
    push({
      id: 'plan-trip',
      title: 'Plan my trip',
      reason: 'Build a complete, validated proposal from the current trip.',
      scope: 'trip',
      mode: 'proposal',
    });
  }

  actions.push({
    id: 'ask',
    title: 'Ask anything',
    reason: 'Open Ask Planitenary about this trip.',
    scope: 'trip',
    mode: 'read',
  });

  return actions.slice(0, MAX_ACTIONS);
}

export function askSuggestionsFor(surface: IntelligenceSurface): string[] {
  if (surface === 'map') {
    return ['What is nearby?', 'Which saved place is closest?', 'How long to walk between these stops?'];
  }
  if (surface === 'budget') {
    return ['Where am I spending most?', 'How much have I recorded so far?', 'Which activity prices are still unknown?'];
  }
  if (surface === 'documents') {
    return ['What documents do I have?', 'Where is my flight on the itinerary?', 'Can you read the booking PDF?'];
  }
  if (surface === 'saved') {
    return ['Which places did I skip?', 'Which of these should I prioritize?', 'What have I marked Visited?'];
  }
  return [
    'What can I fit after this?',
    'Why isn’t this place on today’s plan?',
    'Do I have enough time before my flight?',
  ];
}

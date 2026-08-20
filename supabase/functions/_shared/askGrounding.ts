/**
 * Deterministic Ask grounding: the server decides which owned-trip facts are
 * required, reads them, and only then may a model speak.
 *
 * The production failure this exists to close is a one-round Ask with zero
 * tool calls that invented Skip/Flight/day facts. A prompt asking Nano to
 * inspect the trip is a request. This module is the floor.
 *
 * No Deno APIs, no network, no quota. The agent handler may attach DB extras
 * (budget/documents/history/proposal) before calling {@link collectAskGrounding};
 * those extras are still not model calls.
 */

import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
  canonicalDecisionKeysOf,
  clockToMinutes,
  minutesToClock,
} from './itineraryProposal.ts';
import { summarizeBudgetFacts } from './budgetFacts.ts';
import { summarizeDocumentFacts } from './documentFacts.ts';
import { emptyEvidence, type AgentEvidence } from './agentContract.ts';
import type {
  ConversationTurn,
  IntelligenceFocus,
  IntelligenceSurface,
  IntelligenceUiEnvelope,
} from './intelligenceContext.ts';

export const ASK_GROUNDING_SCOPES = [
  'trip',
  'itinerary',
  'day',
  'decisions',
  'flights',
  'schedule',
  'proposal',
  'history',
  'budget',
  'documents',
  'map',
] as const;

export type AskGroundingScope = typeof ASK_GROUNDING_SCOPES[number];

export type AskFactProvenance =
  | 'stored-trip'
  | 'decision-state'
  | 'deterministic-policy'
  | 'provider-route'
  | 'history'
  | 'budget'
  | 'document';

export interface AskGroundingPlan {
  required: AskGroundingScope[];
  /**
   * Whether this question may only be answered once a place search has run.
   *
   * A sibling of `required` rather than one more scope, because the scopes are
   * reads of *this traveller's own trip* and discovery is the opposite: it goes
   * looking for something the trip does not contain. Folding it in would make
   * every scope consumer ask "is this one actually a read?".
   *
   * Enforcement lives in `agentRuntime`, which refuses to accept an answer turn
   * until the search has actually happened. A sentence in the system prompt is
   * guidance, and production showed guidance is not enough: asked to "find one
   * place worth visiting", the model answered from trip prose without searching
   * and invented an id to cite.
   */
  requiresPlaceDiscovery: boolean;
  /**
   * Area text to search around, when the question named one.
   *
   * Search input, never identity — see {@link DISCOVERY_AREA_RE}. Absent when
   * the question named no area, in which case the caller searches the trip's
   * own city.
   */
  placeDiscoveryArea?: string;
}

export interface AskGroundingRead {
  scope: AskGroundingScope;
  reader: string;
  provenance: AskFactProvenance;
}

export interface AskEvidencePacket {
  trip: {
    name?: string;
    dayCount: number;
    currentRevision?: string;
  };
  days: Array<{ day: number; date?: string; city?: string; title?: string }>;
  savedPlaceNames: string[];
  relevantActivities: Array<{
    name: string;
    scheduledDay?: number;
    time?: string;
    type?: string;
    decision?: string;
    onSavedPlan: boolean;
  }>;
  decisions: Array<{
    placeName: string;
    decision: 'skip' | 'visited' | 'must-do' | 'interested';
    onSavedPlan: boolean;
    scheduledDay?: number;
  }>;
  fixedEvents: Array<{
    kind: 'flight';
    name: string;
    day?: number;
    start: string;
    end: string;
    durationMinutes: number;
    sightseeingAfter?: string;
    settlingMinutes: number;
  }>;
  scheduleFacts: Array<{
    day?: number;
    earliestSightseeing?: string;
    settlingMinutes: number;
    departureLeadMinutes: number;
    note: string;
  }>;
  currentDay?: {
    day: number;
    city?: string;
    activityNames: string[];
  };
  focus?: {
    surface: IntelligenceSurface;
    dayNumber?: number;
    selectedPlaceName?: string;
    mapViewHint?: { lat: number; lng: number };
  };
  budget?: {
    present: boolean;
    note: string;
    spent?: number;
    plannedCeiling?: number;
    remainingKnownBudget?: number;
    currency?: string;
  };
  documents?: {
    count: number;
    titles: string[];
    extraction: 'unavailable';
    note: string;
  };
  history?: {
    count: number;
    note: string;
  };
  proposal?: {
    present: boolean;
    note: string;
  };
  rules: string[];
}

export type AskGroundingResult =
  | {
    ok: true;
    plan: AskGroundingPlan;
    reads: AskGroundingRead[];
    packet: AskEvidencePacket;
    evidence: AgentEvidence;
    dayCount: number;
    missing: [];
    detail?: undefined;
  }
  | {
    ok: false;
    plan: AskGroundingPlan;
    reads: AskGroundingRead[];
    packet?: AskEvidencePacket;
    evidence: AgentEvidence;
    dayCount: number;
    missing: AskGroundingScope[];
    detail: string;
  };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const uniqueScopes = (scopes: AskGroundingScope[]): AskGroundingScope[] =>
  ASK_GROUNDING_SCOPES.filter((scope) => scopes.includes(scope));

const normaliseQuestion = (question: string): string =>
  question.toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, ' ').trim();

const DECISION_RE =
  /\b(skip|skipped|skipping|visited|must[- ]do|interested|omitted|excluded|left out|not included)\b|why isn'?t|why is it not|not in my plan/;

const FLIGHT_RE =
  /\b(flight|flights|arrival|arrive|arriving|depart|departure|landing|landed|after my flight|before my flight|sightseeing start|when can i start|do i have time)\b/;

const SCHEDULE_RE =
  /\b(can i fit|fit after|after this|before this|free time|move later|overlap|conflict|schedule|after my flight|before my flight|when can i start|sightseeing start|do i have time)\b/;

const HISTORY_RE = /\b(what changed|last plan|change history|undo|applied the plan|previous plan)\b/;

const BUDGET_RE = /\b(budget|spent|spending|remaining|how much|wallet|expenses?)\b/;

const DOCUMENT_RE = /\b(document|documents|booking|ticket|pdf|passport|visa|confirmation)\b/;

const MAP_RE = /\b(near here|nearby|closest|how far|on the map|this pin)\b/;

/**
 * A question whose central request is a place the traveller does not have yet.
 *
 * Deliberately narrower than "mentions a place". "Why is Kushida Shrine not in
 * my plan?" names a shrine and is *about* the plan that exists; "find one place
 * worth visiting near Shinjuku" asks for something that does not. Only the
 * second may be answered out of a search, and only the second is worth paying
 * for one.
 *
 * Two shapes, because English has two. A discovery verb needs a target before
 * it means discovery at all — "find my booking" does not — while "where should
 * I go" already carries both halves in the phrasing and offers no noun to match.
 */
const DISCOVERY_ASK_RE = /\bwhere (should|can|could) (i|we) (go|eat|visit|stay|drink)\b/;

const DISCOVERY_VERB_RE = /\b(find|recommend|suggest|show me|any good|looking for)\b/;

/**
 * The area a discovery question points at, as **search input only**.
 *
 * This never becomes an identity. It is handed to the place provider as the
 * text to look around, and every id, name and coordinate on the resulting card
 * still comes from what the provider returned. "Shinjuku" here is a query, not
 * a place the server claims to know.
 *
 * Lazy, and stopped by the first clause boundary, because the phrase that
 * follows an area is usually another sentence: "near Shinjuku **and explain
 * why it fits this trip**" must search Shinjuku, not the rest of the question.
 */
const DISCOVERY_AREA_RE =
  /\b(?:near|around|close to|next to|in|at)\s+([a-z0-9'’\- ]{2,40}?)(?=\s+(?:and|for|that|which|so|because|but)\b|\s*[,.?!;]|$)/;

/**
 * Phrases that follow "near" without naming anywhere a provider could find.
 * Sending one as a search area returns nothing at best, so the trip's own city
 * is used instead.
 */
const AREA_STOPWORDS = new Set([
  'here', 'there', 'me', 'us', 'my hotel', 'the hotel', 'my place', 'this place',
  'this trip', 'the trip', 'my trip', 'my plan', 'the plan', 'my itinerary', 'today',
]);

const DISCOVERY_TARGET_RE =
  /\b(place|places|spot|spots|somewhere|anywhere|restaurant|restaurants|cafe|cafes|café|bar|bars|attraction|attractions|museum|museums|shrine|shrines|temple|temples|park|parks|market|markets|shop|shops|things? to do|to eat|to visit)\b/;

/**
 * Decide which owned-trip scopes the server must read before a model round.
 *
 * GPT does not participate. Surface hints add context; they never supply facts.
 */
export function deriveAskGroundingPlan(input: {
  question: string;
  surface?: IntelligenceSurface;
  uiContext?: IntelligenceUiEnvelope;
}): AskGroundingPlan {
  const question = normaliseQuestion(input.question);
  const surface = input.surface ?? input.uiContext?.surface;
  const required: AskGroundingScope[] = ['trip', 'itinerary', 'day'];

  if (DECISION_RE.test(question)) required.push('decisions');
  if (FLIGHT_RE.test(question)) required.push('flights', 'schedule');
  if (SCHEDULE_RE.test(question)) required.push('flights', 'schedule');
  if (HISTORY_RE.test(question)) required.push('history');
  if (BUDGET_RE.test(question) || surface === 'budget') required.push('budget');
  if (DOCUMENT_RE.test(question) || surface === 'documents') required.push('documents');
  if (MAP_RE.test(question) || surface === 'map') required.push('map');

  const requiresPlaceDiscovery = DISCOVERY_ASK_RE.test(question)
    || (DISCOVERY_VERB_RE.test(question) && DISCOVERY_TARGET_RE.test(question));

  const areaMatch = requiresPlaceDiscovery ? DISCOVERY_AREA_RE.exec(question) : null;
  const area = areaMatch?.[1]?.trim();
  const placeDiscoveryArea = area && !AREA_STOPWORDS.has(area) ? area : undefined;

  return { required: uniqueScopes(required), requiresPlaceDiscovery, placeDiscoveryArea };
}

export interface PersistedFlight {
  id?: string;
  name: string;
  day?: number;
  time: string;
  durationMinutes: number;
  endTime: string;
  sightseeingAfter: string;
  location?: string;
  note: string;
}

const dayRows = (itinerary: Record<string, unknown> | null): Array<Record<string, unknown>> =>
  asArray(itinerary?.days).map(asRecord).filter(Boolean) as Record<string, unknown>[];

const activityRows = (itinerary: Record<string, unknown> | null): Array<{
  day?: number;
  activity: Record<string, unknown>;
}> => {
  const rows: Array<{ day?: number; activity: Record<string, unknown> }> = [];
  for (const day of dayRows(itinerary)) {
    const number = typeof day.day === 'number' ? day.day : undefined;
    for (const entry of asArray(day.activities)) {
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

/** Timed persisted flights. Untimed rows are omitted rather than invented. */
export function listPersistedFlights(itinerary: Record<string, unknown> | null): PersistedFlight[] {
  const rows: PersistedFlight[] = [];
  for (const { day, activity } of activityRows(itinerary)) {
    if (activity.type !== 'flight') continue;
    const start = clockToMinutes(typeof activity.time === 'string' ? activity.time : undefined);
    const duration = typeof activity.durationMinutes === 'number' ? activity.durationMinutes : undefined;
    if (start === undefined || duration === undefined || duration <= 0) continue;
    const end = Math.min(1439, start + duration);
    const sightseeing = Math.min(1439, end + ARRIVAL_SETTLING_MINUTES);
    const name = text(activity.name, 160) ?? 'Flight';
    rows.push({
      id: text(activity.id, 120),
      name,
      day,
      time: minutesToClock(start),
      durationMinutes: duration,
      endTime: minutesToClock(end),
      sightseeingAfter: minutesToClock(sightseeing),
      location: text(activity.location, 160),
      note: `Fixed window. Sightseeing on this day starts after a ${ARRIVAL_SETTLING_MINUTES}-minute arrival buffer when this is the arrival flight.`,
    });
  }
  return rows.slice(0, 8);
}

export interface BoundPlaceDecision {
  activityId?: string;
  name: string;
  decision: 'skip' | 'visited' | 'must-do' | 'interested';
  scheduledDay?: number;
  keysUsed: string[];
}

const PLANNING_DECISIONS = ['skip', 'visited', 'must-do', 'interested'] as const;
type PlanningDecision = typeof PLANNING_DECISIONS[number];

const isPlanningDecision = (value: unknown): value is PlanningDecision =>
  typeof value === 'string' && (PLANNING_DECISIONS as readonly string[]).includes(value);

/**
 * Resolve Skip / Visited / Must do / Interested through canonical activity
 * identity. Listing ids that are not a canonical key of a saved activity are
 * not used as the bound reason for that place.
 */
export function bindSavedPlaceDecisions(itinerary: Record<string, unknown> | null): BoundPlaceDecision[] {
  const discovery = asRecord(itinerary?.discoveryState);
  const decisions = asRecord(discovery?.decisions) ?? {};
  const bound: BoundPlaceDecision[] = [];
  const seen = new Set<string>();
  for (const { day, activity } of activityRows(itinerary)) {
    const name = text(activity.name, 160);
    if (!name || activity.type === 'flight') continue;
    const keys = canonicalDecisionKeysOf(activity);
    const matched = keys.find((key) => isPlanningDecision(decisions[key]));
    if (!matched) continue;
    const identity = text(activity.id, 120) ?? keys[0] ?? name;
    if (seen.has(identity)) continue;
    seen.add(identity);
    bound.push({
      activityId: text(activity.id, 120),
      name,
      decision: decisions[matched] as PlanningDecision,
      scheduledDay: day,
      keysUsed: [matched],
    });
  }
  return bound.slice(0, 20);
}

const questionMentions = (question: string, name: string): boolean => {
  const haystack = normaliseQuestion(question);
  const needle = name.toLowerCase().replace(/['’]/g, "'").trim();
  return needle.length >= 4 && haystack.includes(needle);
};

const PRONOUN_RE = /\b(it|this|that|this place|that place|this stop|that stop)\b/;
const WHY_OMITTED_RE = /\b(why isn'?t|why is it not|not in my plan|omitted|excluded|not included)\b/;

/** Names only — never decisions, times, or other mutable facts from memory. */
const resolveNamedSavedPlaces = (input: {
  question: string;
  savedPlaceNames: string[];
  uiFocus?: IntelligenceFocus;
  conversation?: ConversationTurn[];
}): string[] => {
  const mentioned = input.savedPlaceNames.filter((name) => questionMentions(input.question, name));
  if (mentioned.length > 0) return mentioned;
  if (!PRONOUN_RE.test(normaliseQuestion(input.question))) return [];
  const focusName = input.uiFocus?.selectedActivity?.name ?? input.uiFocus?.selectedPlace?.name;
  if (focusName && input.savedPlaceNames.some((name) => name.toLowerCase() === focusName.toLowerCase())) {
    return [focusName];
  }
  const turns = input.conversation ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const text = `${turns[index].question} ${turns[index].answer}`;
    const found = input.savedPlaceNames.filter((name) => questionMentions(text, name));
    if (found.length > 0) return found;
  }
  return [];
};

export interface AskGroundingExtras {
  budgetStored?: unknown;
  budgetReadFailed?: boolean;
  documents?: unknown[];
  documentsReadFailed?: boolean;
  historyCount?: number;
  historyReadFailed?: boolean;
  proposalPresent?: boolean;
  proposalReadFailed?: boolean;
}

const pushRead = (
  reads: AskGroundingRead[],
  scope: AskGroundingScope,
  reader: string,
  provenance: AskFactProvenance,
) => {
  if (reads.some((entry) => entry.scope === scope && entry.reader === reader)) return;
  reads.push({ scope, reader, provenance });
};

/**
 * Read the required scopes from the owned itinerary (and optional extras).
 *
 * Combined questions merge scopes and each reader runs at most once.
 */
export function collectAskGrounding(input: {
  itinerary: Record<string, unknown> | null;
  tripId: string;
  question: string;
  plan: AskGroundingPlan;
  uiFocus?: IntelligenceFocus;
  conversation?: ConversationTurn[];
  extras?: AskGroundingExtras;
}): AskGroundingResult {
  const reads: AskGroundingRead[] = [];
  const missing: AskGroundingScope[] = [];
  const itinerary = input.itinerary;
  const days = dayRows(itinerary);
  const dayCount = days.length;
  const evidence = emptyEvidence();

  const fail = (scope: AskGroundingScope, detail: string): AskGroundingResult => ({
    ok: false,
    plan: input.plan,
    reads,
    evidence,
    dayCount,
    missing: uniqueScopes([...missing, scope]),
    detail,
  });

  if (!itinerary || dayCount <= 0) {
    return fail('itinerary', 'I can’t verify this trip’s current itinerary right now.');
  }

  pushRead(reads, 'trip', 'readOwnedTrip', 'stored-trip');
  pushRead(reads, 'itinerary', 'get_current_itinerary', 'stored-trip');
  pushRead(reads, 'day', 'get_current_day', 'stored-trip');

  const required = new Set(input.plan.required);
  const flights = listPersistedFlights(itinerary);
  const boundDecisions = bindSavedPlaceDecisions(itinerary);
  const rows = activityRows(itinerary);

  if (required.has('flights') || required.has('schedule')) {
    pushRead(reads, 'flights', 'get_flights', 'stored-trip');
    pushRead(reads, 'flights', 'get_fixed_events', 'stored-trip');
    if (flights.length === 0) {
      return fail('flights', 'I can’t verify your flight timing from the current trip right now.');
    }
  }

  if (required.has('schedule')) {
    pushRead(reads, 'schedule', 'check_schedule_fit', 'deterministic-policy');
  }

  if (required.has('decisions')) {
    pushRead(reads, 'decisions', 'get_candidate_decisions', 'decision-state');
    if (!asRecord(itinerary.discoveryState) && boundDecisions.length === 0) {
      return fail('decisions', 'I can’t verify why a place was omitted from the current trip right now.');
    }
  }

  if (required.has('budget')) {
    pushRead(reads, 'budget', 'get_budget_summary', 'budget');
    if (input.extras?.budgetReadFailed) {
      return fail('budget', 'I can’t verify a trip budget from the stored records right now.');
    }
    const budgetFacts = summarizeBudgetFacts(input.extras?.budgetStored ?? null, itinerary);
    if (!budgetFacts.present) {
      if (input.extras?.budgetStored != null) {
        return fail('budget', 'I can’t verify a trip budget from the stored records right now.');
      }
      return fail('budget', 'You haven’t set a trip budget yet.');
    }
  }

  if (required.has('documents')) {
    pushRead(reads, 'documents', 'get_trip_documents', 'document');
    if (input.extras?.documentsReadFailed) {
      return fail('documents', 'I can’t verify trip documents from the stored records right now.');
    }
  }

  if (required.has('history')) {
    pushRead(reads, 'history', 'get_change_history', 'history');
    if (input.extras?.historyReadFailed) {
      return fail('history', 'I can’t verify plan-change history from the stored records right now.');
    }
  }

  if (required.has('proposal')) {
    pushRead(reads, 'proposal', 'get_current_proposal', 'stored-trip');
    if (input.extras?.proposalReadFailed) {
      return fail('proposal', 'I can’t verify the current proposal from the stored records right now.');
    }
  }

  if (required.has('map')) {
    pushRead(reads, 'map', 'get_current_ui_context', 'stored-trip');
  }

  const savedPlaceNames = [...new Set(
    rows
      .map(({ activity }) => text(activity.name, 160))
      .filter((name): name is string => Boolean(name)),
  )].slice(0, 20);
  const namedPlaces = resolveNamedSavedPlaces({
    question: input.question,
    savedPlaceNames,
    uiFocus: input.uiFocus,
    conversation: input.conversation,
  });
  const namedSet = new Set(namedPlaces.map((name) => name.toLowerCase()));

  const relevantActivities = rows.flatMap(({ day, activity }) => {
    const name = text(activity.name, 160);
    if (!name) return [];
    const mentioned = namedSet.has(name.toLowerCase()) || questionMentions(input.question, name);
    const bound = boundDecisions.find((entry) => entry.activityId === activity.id);
    const includeFlight = activity.type === 'flight' && required.has('flights');
    if (!mentioned && !includeFlight) return [];
    return [{
      name,
      scheduledDay: day,
      time: text(activity.time, 5),
      type: text(activity.type, 40),
      decision: bound?.decision,
      onSavedPlan: day !== undefined,
    }];
  }).slice(0, 12);

  // A decision question about a named saved place must bind through canonical
  // identity, not a listing-only key. If the question names a place we cannot
  // attach to a saved activity, fail closed rather than guess.
  if (required.has('decisions') && WHY_OMITTED_RE.test(normaliseQuestion(input.question))) {
    if (namedPlaces.length === 0) {
      return fail('decisions', 'I can’t verify why a place was omitted from the current trip right now.');
    }
    const boundNamed = namedPlaces.filter((name) =>
      boundDecisions.some((entry) => entry.name.toLowerCase() === name.toLowerCase()));
    if (boundNamed.length === 0) {
      return fail('decisions', 'I can’t verify why a place was omitted from the current trip right now.');
    }
  }

  const packet: AskEvidencePacket = {
    trip: {
      name: text(itinerary.name, 160),
      dayCount,
      currentRevision: text(itinerary.revision, 80) ?? (typeof itinerary.revision === 'number' ? String(itinerary.revision) : undefined),
    },
    days: days.slice(0, 14).map((day) => ({
      day: typeof day.day === 'number' ? day.day : 0,
      date: text(day.date, 40),
      city: text(day.city, 80),
      title: text(day.title, 120),
    })).filter((day) => day.day > 0),
    savedPlaceNames,
    relevantActivities: relevantActivities.length > 0
      ? relevantActivities
      : boundDecisions.slice(0, 8).map((entry) => ({
        name: entry.name,
        scheduledDay: entry.scheduledDay,
        decision: entry.decision,
        onSavedPlan: entry.scheduledDay !== undefined,
      })),
    decisions: boundDecisions.map((entry) => ({
      placeName: entry.name,
      decision: entry.decision,
      onSavedPlan: entry.scheduledDay !== undefined,
      scheduledDay: entry.scheduledDay,
    })),
    fixedEvents: flights.map((flight) => ({
      kind: 'flight' as const,
      name: flight.name,
      day: flight.day,
      start: flight.time,
      end: flight.endTime,
      durationMinutes: flight.durationMinutes,
      sightseeingAfter: flight.sightseeingAfter,
      settlingMinutes: ARRIVAL_SETTLING_MINUTES,
    })),
    scheduleFacts: flights.map((flight) => ({
      day: flight.day,
      earliestSightseeing: flight.sightseeingAfter,
      settlingMinutes: ARRIVAL_SETTLING_MINUTES,
      departureLeadMinutes: DEPARTURE_LEAD_MINUTES,
      note: `Earliest arrival-day sightseeing is ${flight.sightseeingAfter} (${flight.endTime} landing plus a ${ARRIVAL_SETTLING_MINUTES}-minute settling buffer).`,
    })),
    currentDay: (() => {
      const focusDay = input.uiFocus?.dayNumber
        ?? (typeof days[0]?.day === 'number' ? days[0].day : undefined);
      const day = days.find((entry) => entry.day === focusDay);
      if (!day || typeof day.day !== 'number') return undefined;
      return {
        day: day.day,
        city: text(day.city, 80),
        activityNames: asArray(day.activities).flatMap((entry) => {
          const name = text(asRecord(entry)?.name, 160);
          return name ? [name] : [];
        }).slice(0, 8),
      };
    })(),
    rules: [
      'Authoritative evidence was derived by the server from the owned trip. It overrides conversation history.',
      'Do not invent a day number outside trip.dayCount.',
      'Do not invent a travel time, airport-transfer duration, or budget amount.',
      'Skip / Visited / Must do / Interested come from bound saved-activity decisions, never from listing-name matching.',
      'You may call extra tools only for facts not already in this evidence.',
      'You cannot save, apply, book, or mutate the itinerary. Describe a proposal instead.',
    ],
  };

  if (input.uiFocus) {
    packet.focus = {
      surface: input.uiFocus.surface,
      dayNumber: input.uiFocus.dayNumber,
      selectedPlaceName: input.uiFocus.selectedPlace?.name ?? input.uiFocus.selectedActivity?.name,
      mapViewHint: input.uiFocus.mapView,
    };
  }

  if (required.has('budget')) {
    const facts = summarizeBudgetFacts(input.extras?.budgetStored ?? null, itinerary);
    packet.budget = {
      present: facts.present,
      note: facts.note,
      spent: facts.spent,
      plannedCeiling: facts.plannedCeiling,
      remainingKnownBudget: facts.remainingKnownBudget,
      currency: facts.currency,
    };
    for (const amount of [facts.spent, facts.plannedCeiling, facts.remainingKnownBudget]) {
      if (typeof amount === 'number' && Number.isFinite(amount)) evidence.budgetAmounts.add(Math.round(amount));
    }
  }

  if (required.has('documents')) {
    const facts = summarizeDocumentFacts(input.extras?.documents ?? [], input.uiFocus?.selectedDocumentId);
    packet.documents = {
      count: facts.documents.length,
      titles: facts.documents.map((doc) => doc.title).slice(0, 12),
      extraction: 'unavailable',
      note: facts.note,
    };
  }

  if (required.has('history')) {
    const count = input.extras?.historyCount ?? 0;
    packet.history = {
      count,
      note: count === 0
        ? 'No applied plan-change history is stored for this trip.'
        : `${count} applied plan change(s) are stored.`,
    };
  }

  if (required.has('proposal')) {
    packet.proposal = {
      present: input.extras?.proposalPresent === true,
      note: input.extras?.proposalPresent === true
        ? 'A current Plan my trip preview exists. It is not the saved itinerary unless applied.'
        : 'There is no current Plan my trip preview for the saved itinerary.',
    };
  }

  for (const name of savedPlaceNames) evidence.knownPlaceNames.add(name.toLowerCase());
  for (const flight of flights) evidence.knownPlaceNames.add(flight.name.toLowerCase());
  for (const row of boundDecisions) evidence.knownPlaceNames.add(row.name.toLowerCase());

  return {
    ok: true,
    plan: input.plan,
    reads,
    packet,
    evidence,
    dayCount,
    missing: [],
  };
}

/** Compact packet the model may see. Internal decision keys stay out. */
export function presentAskEvidence(packet: AskEvidencePacket): Record<string, unknown> {
  return {
    trip: packet.trip,
    days: packet.days,
    savedPlaceNames: packet.savedPlaceNames,
    currentDay: packet.currentDay,
    relevantActivities: packet.relevantActivities.map((activity) => ({
      name: activity.name,
      scheduledDay: activity.scheduledDay,
      time: activity.time,
      type: activity.type,
      decision: activity.decision,
      onSavedPlan: activity.onSavedPlan,
    })),
    decisions: packet.decisions,
    fixedEvents: packet.fixedEvents,
    scheduleFacts: packet.scheduleFacts,
    focus: packet.focus,
    budget: packet.budget,
    documents: packet.documents,
    history: packet.history,
    proposal: packet.proposal,
    rules: packet.rules,
  };
}

export const ASK_GROUNDING_REFUSAL = 'grounding-unavailable';

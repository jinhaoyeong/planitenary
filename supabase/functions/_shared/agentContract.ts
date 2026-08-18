/**
 * The Planitenary agent's contract: what it may ask for, how much it may
 * spend asking, and what it must prove before anything it says is shown.
 *
 * This module has NO imports and no Deno APIs on purpose, so the same code is
 * exercised by the Node/vitest suite — the precedent set by `cacheKeys.ts`,
 * `placeCost.ts` and `reasoning.ts`. The rules that bound spending are the
 * rules most worth testing directly, and a spending guard nothing can load is
 * a spending guard nobody knows has stopped working.
 *
 * ## The division of labour, and why it is mechanical rather than a prompt
 *
 * The model orchestrates; it does not know anything. It decides *which*
 * question to ask and *which* of several real answers is best for this
 * traveller — it never supplies the answer itself. A system prompt asking a
 * model not to invent a travel time is a request. What is enforced here is:
 *
 *   - a tool call must name a tool in {@link AGENT_TOOLS} and type-check
 *     against that tool's own argument validator
 *   - a cited URL must be one a tool actually returned this run
 *   - a stated travel time must be a number a routing tool actually returned
 *   - a stated place must be one a place tool actually returned
 *
 * A sentence that cannot clear those is dropped, and the rest are kept. This
 * is `validateBriefSentences` one layer up: the excerpt rule made a *sentence*
 * accountable to a source, and {@link validateAgentAnswer} makes an *answer*
 * accountable to the tool results that produced it.
 *
 * ## Nothing here can write
 *
 * There is no `save_itinerary`, no `update_activity`, no `delete_place`, and
 * {@link AGENT_TOOLS} is the only list the runtime dispatches from — so the
 * absence is structural rather than a policy the loop is trusted to follow.
 * {@link MUTATING_TOOL_PATTERNS} exists so a future edit that adds one has to
 * fail a test before it can reach production.
 */

/** Every operation the agent tier will answer. Anything else is refused. */
export const AGENT_OPERATIONS = ['ask', 'research-trip', 'research-place', 'build-itinerary'] as const;

export type AgentOperation = typeof AGENT_OPERATIONS[number];

export const isAgentOperation = (value: unknown): value is AgentOperation =>
  typeof value === 'string' && (AGENT_OPERATIONS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// What one operation may consume
// ---------------------------------------------------------------------------

/**
 * The ceilings for one operation.
 *
 * Per operation rather than global, for the reason `OPENAI_MAX_OUTPUT_TOKENS`
 * is per operation: a conversational answer that had to consult routes and
 * weather legitimately needs more rounds than a single place lookup, and one
 * number would be wrong for both. Every field is a *hard stop* — reaching one
 * ends the loop and returns what has been gathered, rather than continuing
 * with a warning nobody reads.
 */
export interface AgentLimits {
  /** Serialised request material the client may send. */
  maxInputChars: number;
  /**
   * Model calls, not tool calls. This is the number that costs money, so it is
   * the number that is capped. The last permitted call runs with tools
   * withdrawn, so the budget always buys an answer rather than ending on a
   * tool request nobody can act on — see {@link isFinalRound}.
   */
  maxModelRounds: number;
  /** Tool executions across the whole run, all tools counted together. */
  maxToolCalls: number;
  /** Web searches. Separate because it is the slowest and least bounded tool. */
  maxWebSearches: number;
  /**
   * Routing lookups. A matrix counts as one however many pairs it covers,
   * which is what makes consolidating pairs into one call worth doing.
   */
  maxRouteCalls: number;
  /** Place-detail lookups. Batched, so one call may cover several places. */
  maxPlaceLookups: number;
}

/**
 * The ceilings, per operation.
 *
 * These are deliberately small. The production global cap is five provider
 * calls a day, so an `ask` that could spend six of them on its own would take
 * the whole deployment's allowance for one question. Raising any of these is a
 * deliberate edit, reviewed on its own — the same rule
 * `OPENAI_MODELS_BY_OPERATION` follows.
 */
export const AGENT_LIMITS: Record<AgentOperation, AgentLimits> = {
  /**
   * A traveller's question. The only operation that genuinely needs several
   * rounds: "what can we do if it rains tomorrow" is weather, then places,
   * then routes, and none of the three can be asked before the previous
   * answer is known.
   */
  ask: {
    maxInputChars: 24_000,
    maxModelRounds: 6,
    maxToolCalls: 12,
    maxWebSearches: 2,
    maxRouteCalls: 2,
    maxPlaceLookups: 3,
  },
  /** Research across a whole trip. Broader, so more search, fewer routes. */
  'research-trip': {
    maxInputChars: 24_000,
    maxModelRounds: 4,
    maxToolCalls: 8,
    maxWebSearches: 2,
    maxRouteCalls: 1,
    maxPlaceLookups: 3,
  },
  /** One place, in depth. Narrow by construction. */
  'research-place': {
    maxInputChars: 12_000,
    maxModelRounds: 3,
    maxToolCalls: 5,
    maxWebSearches: 1,
    maxRouteCalls: 1,
    maxPlaceLookups: 2,
  },
  /**
   * A complete proposal has more material than a question, but remains tightly
   * bounded: at most one composition plus two repairs are expected. Eight is
   * the hard outer ceiling if malformed replies consume rounds before that.
   */
  'build-itinerary': {
    maxInputChars: 48_000,
    maxModelRounds: 8,
    maxToolCalls: 10,
    maxWebSearches: 0,
    maxRouteCalls: 3,
    maxPlaceLookups: 2,
  },
};

/**
 * The reply ceiling per operation, in output tokens.
 *
 * The counterpart of `OPENAI_MAX_OUTPUT_TOKENS` for the agent tier, and kept
 * here beside the other agent limits rather than there so one file answers
 * "what can this operation cost". Output is eight times the price of input, so
 * this is the side worth bounding — and an unbounded reply is also the one
 * that breaks JSON parsing by running until some other limit stops it
 * mid-structure.
 */
export const AGENT_MAX_OUTPUT_TOKENS: Record<AgentOperation, number> = {
  ask: 1_600,
  'research-trip': 1_600,
  'research-place': 1_000,
  'build-itinerary': 3_000,
};

/**
 * The only model the agent tier may use.
 *
 * A separate allowlist from `OPENAI_MODELS_BY_OPERATION` rather than three
 * more entries in it, and the separation is load-bearing:
 * `travel-reasoning`'s generic path will run *any* operation in
 * `REASONING_OPERATIONS` against raw client input with no trip-ownership
 * check. Registering the agent operations there would open a second door to
 * the model that skips both ownership and the bounded loop — the "second
 * hidden path" that must not exist. Two tiers, two allowlists, one shared
 * quota counter.
 */
export const AGENT_OPENAI_MODEL = 'gpt-5-nano';

/** The JSON protocol spoken over the existing metered model adapter. */
export const AGENT_SYSTEM_PROMPT = `You are Planitenary's read-only travel orchestrator for one owned trip.
Return one JSON object and nothing else.

When more facts are needed and tools are available, return:
{"tool_calls":[{"tool":"tool_name","args":{}}]}

When you can answer, or finalRound is true, return:
{"answer":"concise answer","citations":["exact tool URL"],"proposal":{"summary":"optional read-only proposal","day":1,"travelMinutes":27,"placeNames":["exact tool place name"],"replan":{"objective":"make Day 3 easier","affectedDays":[3,4],"moves":[{"placeName":"exact tool place name","fromDay":3,"toDay":4}]}}}

A thin focus object names the tab/day/place the traveller is looking at. Use it as the default referent for "this", "here", "today", then load facts with tools. Call only the tools the question needs.

Previous conversation turns are memory only. If they conflict with a tool result or the current itinerary, the current itinerary wins.

Never invent a place, coordinate, route, travel time, opening hour, price, budget remaining, event, forecast, closure, photograph, licence, document fact, or URL. Travel times must be copied from routing findings. Money amounts must be copied from budget/expense findings. Document contents are metadata only unless a tool returned extracted facts.

Cite only exact URLs in findings. Do not mention internal hashes, revisions, ledgers, RPC names, or candidate ids. You cannot save, apply, book, or mutate anything. If a tool failed or a fact is unavailable, say so plainly. On finalRound, do not request tools.`;

/**
 * The planning model chooses composition only. Clock arithmetic, routes,
 * opening hours, buffers and conflict decisions are intentionally absent from
 * its output contract and are added by `itineraryProposal.ts` afterwards.
 */
export const ITINERARY_PLANNER_SYSTEM_PROMPT = `You are Planitenary's read-only itinerary composition planner.
Return one JSON object and nothing else:
{"days":[{"day":1,"placeIds":["exact supplied id"],"rationale":"short reason"}]}

Use only place IDs and day numbers in the supplied planning material. Respect each day's usable windows and fixedEvents: those are already-timed flights and transport, not suggestions. Never assign a place during a fixed event or outside that day's windows. Respect fixed-day and Must-do priorities, but a Must-do cannot overlap a flight. Group nearby places and avoid unnecessary cross-city movement. Do not output times, durations, coordinates, routes, opening hours, weather, prices, bookings, invented places, or invented flight or airport-transfer times. Deterministic Planitenary code calculates and validates all of those after your reply. If structured conflicts are supplied, repair only the ordering/day assignment needed to address them. You cannot save or apply anything.`;

export const AGENT_OPENAI_MODELS_BY_OPERATION: Record<AgentOperation, readonly string[]> = {
  ask: [AGENT_OPENAI_MODEL],
  'research-trip': [AGENT_OPENAI_MODEL],
  'research-place': [AGENT_OPENAI_MODEL],
  'build-itinerary': [AGENT_OPENAI_MODEL],
};

/**
 * Whether a configured model may run an agent operation.
 *
 * **Never corrects to the default**, for the reason `openaiModelRefusal`
 * states: a deployment that set an expensive model and was quietly downgraded
 * looks identical to one that chose nano deliberately, and the same mistake in
 * the other direction is the genuinely expensive error available here. A
 * misconfiguration turns the tier off and says why.
 *
 * Returns `undefined` for "allowed", or the sentence to report.
 */
export function agentModelRefusal(operation: AgentOperation, configuredModel: string): string | undefined {
  const allowed = AGENT_OPENAI_MODELS_BY_OPERATION[operation];
  if (allowed.includes(configuredModel)) return undefined;
  return `OPENAI_MODEL "${configuredModel}" is not approved for the agent operation ${operation}. Allowed: ${allowed.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export type AgentToolName =
  // Trip, all ownership-checked before any of them run.
  | 'get_trip'
  | 'get_trip_profile'
  | 'get_current_itinerary'
  | 'get_current_day'
  | 'get_saved_places'
  | 'get_unassigned_places'
  | 'get_candidate_decisions'
  | 'get_fixed_events'
  | 'get_flights'
  | 'get_current_proposal'
  | 'get_change_history'
  | 'get_budget_summary'
  | 'get_expenses'
  | 'get_trip_documents'
  | 'get_document_facts'
  | 'get_current_ui_context'
  // Research.
  | 'search_places'
  | 'search_web'
  | 'get_place_details'
  | 'get_opening_hours'
  | 'get_events'
  | 'get_weather'
  // Photographs, through the real Wikimedia path. Never generated.
  | 'get_place_images'
  // Routing.
  | 'get_route'
  | 'get_route_matrix'
  // Planning support, wrapping the deterministic planner.
  | 'validate_schedule'
  | 'calculate_day_timing'
  | 'find_schedule_conflicts'
  | 'check_schedule_fit';

/** Which budget line a tool draws from. `general` draws only on `maxToolCalls`. */
export type AgentToolCost = 'general' | 'web-search' | 'route' | 'place-lookup';

export interface AgentToolSpec {
  name: AgentToolName;
  /** Shown to the model. Says what the tool *knows*, not how to use it. */
  description: string;
  cost: AgentToolCost;
  /**
   * Validate and normalise the model's arguments.
   *
   * Returns `undefined` for anything malformed, which the runtime reports back
   * to the model as a failed tool call rather than throwing. A model that
   * mis-shapes one call should be able to correct it on the next round; losing
   * the whole answer to one bad argument would be a worse outcome than the
   * round it costs.
   *
   * Every validator bounds string lengths. These become provider query
   * parameters, and an unbounded string from a model is a request this server
   * would build on somebody else's behalf.
   */
  parseArgs: (raw: unknown) => Record<string, unknown> | undefined;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const isoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : undefined;

const boundedList = (value: unknown, max: number, itemMax: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => text(entry, itemMax))
    .filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items.slice(0, max) : undefined;
};

const optionalDay = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 60 ? value : undefined;

/** No arguments at all. Used by the trip readers, which are scoped by the server. */
const noArgs = () => ({});

/**
 * Every tool the agent may call, and nothing else.
 *
 * The runtime dispatches from this record alone, so a name absent here cannot
 * be reached however the model spells it. That is what makes "the agent cannot
 * write" a structural property rather than a promise: there is no write tool
 * to dispatch to.
 */
export const AGENT_TOOLS: Record<AgentToolName, AgentToolSpec> = {
  get_trip: {
    name: 'get_trip',
    description: 'The traveller\'s trip: destinations, dates, and which day is which.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_trip_profile: {
    name: 'get_trip_profile',
    description: 'Travel styles, pace, moods, budget tier and dietary needs the traveller chose.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_current_itinerary: {
    name: 'get_current_itinerary',
    description: 'The saved day-by-day plan, with each activity\'s time, duration and place.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_saved_places: {
    name: 'get_saved_places',
    description: 'Places the traveller kept, whether or not they are scheduled yet.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_candidate_decisions: {
    name: 'get_candidate_decisions',
    description: 'What the traveller marked Must do, Interested, Skip or Visited. Keys are canonical saved-activity or listing ids, never names.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_current_day: {
    name: 'get_current_day',
    description: 'One saved day in detail. Defaults to the day the traveller is looking at.',
    cost: 'general',
    parseArgs: (raw) => {
      const day = optionalDay((raw as { day?: unknown })?.day);
      return day ? { day } : {};
    },
  },
  get_unassigned_places: {
    name: 'get_unassigned_places',
    description: 'Saved places that are not on a day yet.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_fixed_events: {
    name: 'get_fixed_events',
    description: 'Timed flights and transport already on the itinerary, with their windows.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_flights: {
    name: 'get_flights',
    description: 'Persisted flight activities: time, duration, and arrival/departure role when known.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_current_proposal: {
    name: 'get_current_proposal',
    description: 'Whether a current Plan my trip preview exists for the saved itinerary. Not the saved plan unless applied.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_change_history: {
    name: 'get_change_history',
    description: 'What the last applied Plan my trip changes did, as a traveller-facing diff. No snapshots.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_budget_summary: {
    name: 'get_budget_summary',
    description: 'Recorded trip wallet: spent, planned ceiling, remaining. Missing prices stay unknown.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_expenses: {
    name: 'get_expenses',
    description: 'Recorded expense rows from the trip wallet. Does not invent spending.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_trip_documents: {
    name: 'get_trip_documents',
    description: 'Metadata for files attached to this trip: titles and types, not extracted booking facts.',
    cost: 'general',
    parseArgs: noArgs,
  },
  get_document_facts: {
    name: 'get_document_facts',
    description: 'Facts extracted from a trip document. Reports when extraction is not available.',
    cost: 'general',
    parseArgs: (raw) => {
      const documentId = text((raw as { documentId?: unknown })?.documentId, 80);
      return documentId ? { documentId } : {};
    },
  },
  get_current_ui_context: {
    name: 'get_current_ui_context',
    description: 'The tab, day, and selected saved place the traveller is looking at, rehydrated from the trip.',
    cost: 'general',
    parseArgs: noArgs,
  },

  search_places: {
    name: 'search_places',
    description: 'Real places in a city from OpenStreetMap and Wikivoyage, by category or interest.',
    cost: 'place-lookup',
    parseArgs: (raw) => {
      const args = raw as { city?: unknown; query?: unknown; categories?: unknown; limit?: unknown };
      const city = text(args?.city, 120);
      if (!city) return undefined;
      const limit = typeof args?.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(20, Math.round(args.limit)))
        : 10;
      return {
        city,
        query: text(args?.query, 200),
        categories: boundedList(args?.categories, 6, 40),
        limit,
      };
    },
  },
  search_web: {
    name: 'search_web',
    description:
      'Current information from the open web: recent recommendations, temporary exhibitions, '
      + 'seasonal events, closures and travel advice. Returns titles, snippets and source URLs. '
      + 'Snippets are what a page said, not established fact.',
    cost: 'web-search',
    parseArgs: (raw) => {
      const args = raw as { query?: unknown };
      const query = text(args?.query, 200);
      return query ? { query } : undefined;
    },
  },
  get_place_details: {
    name: 'get_place_details',
    description: 'Facts already held about specific places: category, admission, coordinates, website.',
    cost: 'place-lookup',
    parseArgs: (raw) => {
      const args = raw as { placeIds?: unknown };
      const placeIds = boundedList(args?.placeIds, 10, 120);
      return placeIds ? { placeIds } : undefined;
    },
  },
  get_opening_hours: {
    name: 'get_opening_hours',
    description: 'When specific places are open, weekday-aware, from the sources that published them.',
    cost: 'place-lookup',
    parseArgs: (raw) => {
      const args = raw as { placeIds?: unknown; date?: unknown };
      const placeIds = boundedList(args?.placeIds, 10, 120);
      if (!placeIds) return undefined;
      return { placeIds, date: isoDate(args?.date) };
    },
  },
  get_events: {
    name: 'get_events',
    description: 'Ticketed events happening in a city between two dates.',
    cost: 'general',
    parseArgs: (raw) => {
      const args = raw as { city?: unknown; startDate?: unknown; endDate?: unknown };
      const city = text(args?.city, 120);
      if (!city) return undefined;
      return { city, startDate: isoDate(args?.startDate), endDate: isoDate(args?.endDate) };
    },
  },
  get_weather: {
    name: 'get_weather',
    description: 'Forecast for the trip\'s coordinates, by day: rain probability and temperature.',
    cost: 'general',
    parseArgs: (raw) => {
      const args = raw as { startDate?: unknown; endDate?: unknown };
      return { startDate: isoDate(args?.startDate), endDate: isoDate(args?.endDate) };
    },
  },

  get_place_images: {
    name: 'get_place_images',
    description:
      'Real photographs of specific places, from Wikimedia Commons, with author and licence. '
      + 'Photographs are never generated.',
    cost: 'place-lookup',
    parseArgs: (raw) => {
      const args = raw as { placeIds?: unknown };
      const placeIds = boundedList(args?.placeIds, 8, 120);
      return placeIds ? { placeIds } : undefined;
    },
  },

  get_route: {
    name: 'get_route',
    description:
      'Real travel time between two places from a routing provider. '
      + 'This is the only source of a travel time; never estimate one.',
    cost: 'route',
    parseArgs: (raw) => {
      const args = raw as { fromPlaceId?: unknown; toPlaceId?: unknown; mode?: unknown };
      const fromPlaceId = text(args?.fromPlaceId, 120);
      const toPlaceId = text(args?.toPlaceId, 120);
      if (!fromPlaceId || !toPlaceId) return undefined;
      const mode = text(args?.mode, 20);
      return {
        fromPlaceId,
        toPlaceId,
        mode: mode && ['walking', 'driving', 'cycling', 'transit'].includes(mode) ? mode : 'walking',
      };
    },
  },
  get_route_matrix: {
    name: 'get_route_matrix',
    description:
      'Real travel times between many places at once. Prefer this over several get_route calls: '
      + 'it costs one lookup however many pairs it covers.',
    cost: 'route',
    parseArgs: (raw) => {
      const args = raw as { placeIds?: unknown; mode?: unknown };
      const placeIds = boundedList(args?.placeIds, 10, 120);
      if (!placeIds || placeIds.length < 2) return undefined;
      const mode = text(args?.mode, 20);
      return {
        placeIds,
        mode: mode && ['walking', 'driving', 'cycling', 'transit'].includes(mode) ? mode : 'walking',
      };
    },
  },

  validate_schedule: {
    name: 'validate_schedule',
    description: 'Inspect one saved day for missing times and overlapping activity windows. Read-only.',
    cost: 'general',
    parseArgs: (raw) => {
      const args = raw as { day?: unknown };
      const day = typeof args?.day === 'number' && Number.isInteger(args.day) && args.day > 0 && args.day <= 60
        ? args.day
        : undefined;
      return day ? { day } : undefined;
    },
  },
  calculate_day_timing: {
    name: 'calculate_day_timing',
    description: 'Summarise the saved start, end and activity duration for one day. It does not estimate travel.',
    cost: 'general',
    parseArgs: (raw) => {
      const args = raw as { day?: unknown };
      const day = typeof args?.day === 'number' && Number.isInteger(args.day) && args.day > 0 && args.day <= 60
        ? args.day
        : undefined;
      return day ? { day } : undefined;
    },
  },
  find_schedule_conflicts: {
    name: 'find_schedule_conflicts',
    description: 'Places the deterministic planner left unscheduled, including its saved reasons.',
    cost: 'general',
    parseArgs: noArgs,
  },
  check_schedule_fit: {
    name: 'check_schedule_fit',
    description:
      'Whether a saved place can fit after another activity on a day, using saved times, durations, and flights. '
      + 'Does not include travel time — call get_route for that.',
    cost: 'general',
    parseArgs: (raw) => {
      const args = raw as { day?: unknown; afterActivityId?: unknown; placeId?: unknown; visitMinutes?: unknown };
      const visitMinutes = typeof args?.visitMinutes === 'number' && Number.isFinite(args.visitMinutes)
        ? Math.max(15, Math.min(12 * 60, Math.round(args.visitMinutes)))
        : undefined;
      return {
        day: optionalDay(args?.day),
        afterActivityId: text(args?.afterActivityId, 120),
        placeId: text(args?.placeId, 120),
        visitMinutes,
      };
    },
  },
};

export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS) as AgentToolName[];

export const isAgentToolName = (value: unknown): value is AgentToolName =>
  typeof value === 'string' && value in AGENT_TOOLS;

/**
 * Verbs that would make a tool a writer.
 *
 * Nothing in {@link AGENT_TOOLS} matches these, and a test asserts it stays
 * that way. Phase 1 is read-only by construction, and the way that guarantee
 * usually dies is somebody adding one convenient write tool — so the guarantee
 * is written down where adding it breaks the build rather than left as an
 * intention in a commit message.
 */
export const MUTATING_TOOL_PATTERNS = [
  /^save_/, /^set_/, /^update_/, /^delete_/, /^remove_/, /^create_/, /^add_/,
  /^move_/, /^apply_/, /^persist_/, /^write_/, /^book_/, /^reserve_/, /^confirm_/,
];

/** True when a tool name would let the agent change something. */
export const isMutatingToolName = (name: string): boolean =>
  MUTATING_TOOL_PATTERNS.some((pattern) => pattern.test(name));

// ---------------------------------------------------------------------------
// The budget, as a thing that counts rather than a comment that hopes
// ---------------------------------------------------------------------------

export type BudgetRefusal =
  | 'tool-calls-exhausted'
  | 'web-searches-exhausted'
  | 'route-calls-exhausted'
  | 'place-lookups-exhausted';

export interface BudgetState {
  modelRounds: number;
  toolCalls: number;
  webSearches: number;
  routeCalls: number;
  placeLookups: number;
}

export const emptyBudget = (): BudgetState => ({
  modelRounds: 0,
  toolCalls: 0,
  webSearches: 0,
  routeCalls: 0,
  placeLookups: 0,
});

/**
 * Whether one more call of this tool is affordable, and the charge if so.
 *
 * Pure and separate from the loop so the caps can be tested without a model
 * or a network in sight. A refusal is returned to the *model* as a failed
 * tool result rather than ending the run, so it can answer with what it has —
 * "return the best partial answer instead of continuing".
 */
export function chargeTool(
  budget: BudgetState,
  tool: AgentToolName,
  limits: AgentLimits,
): { ok: true; budget: BudgetState } | { ok: false; refusal: BudgetRefusal } {
  if (budget.toolCalls >= limits.maxToolCalls) return { ok: false, refusal: 'tool-calls-exhausted' };

  const cost = AGENT_TOOLS[tool].cost;
  if (cost === 'web-search' && budget.webSearches >= limits.maxWebSearches) {
    return { ok: false, refusal: 'web-searches-exhausted' };
  }
  if (cost === 'route' && budget.routeCalls >= limits.maxRouteCalls) {
    return { ok: false, refusal: 'route-calls-exhausted' };
  }
  if (cost === 'place-lookup' && budget.placeLookups >= limits.maxPlaceLookups) {
    return { ok: false, refusal: 'place-lookups-exhausted' };
  }

  return {
    ok: true,
    budget: {
      ...budget,
      toolCalls: budget.toolCalls + 1,
      webSearches: budget.webSearches + (cost === 'web-search' ? 1 : 0),
      routeCalls: budget.routeCalls + (cost === 'route' ? 1 : 0),
      placeLookups: budget.placeLookups + (cost === 'place-lookup' ? 1 : 0),
    },
  };
}

/**
 * Whether this is the last model call the budget allows.
 *
 * The final round runs with the tool catalogue withdrawn, so the last thing
 * the budget buys is an *answer* rather than a tool request nobody can act on.
 * Without this a run that used its rounds exploring would end holding a
 * request for one more lookup, and the traveller would get nothing at all.
 */
export const isFinalRound = (budget: BudgetState, limits: AgentLimits): boolean =>
  budget.modelRounds + 1 >= limits.maxModelRounds;

// ---------------------------------------------------------------------------
// What the model is allowed to have said
// ---------------------------------------------------------------------------

/** A tool the model asked for, after validation. */
export interface AgentToolCall {
  tool: AgentToolName;
  args: Record<string, unknown>;
}

/**
 * One model turn: either tool calls, or an answer. Never both — a turn that
 * claims both is treated as tool calls, because acting on a half-informed
 * answer is the worse of the two mistakes.
 */
export type AgentTurn =
  | { kind: 'tools'; calls: AgentToolCall[]; rejected: number }
  | { kind: 'answer'; answer: RawAgentAnswer }
  | { kind: 'unusable' };

/** The answer shape, before it has been checked against the tool results. */
export interface RawAgentAnswer {
  answer: string;
  citations: string[];
  /** A change the agent suggests. Phase 1 never applies one. */
  proposal?: {
    summary: string;
    day?: number;
    /** Travel times must match a routing result — see {@link validateAgentAnswer}. */
    travelMinutes?: number;
    placeNames?: string[];
    /** Structured preview only. There is still no writer behind it. */
    replan?: {
      objective: string;
      affectedDays: number[];
      moves: Array<{ placeName: string; fromDay?: number; toDay: number }>;
    };
  };
}

/** How many tool calls one turn may request. */
export const MAX_CALLS_PER_TURN = 3;

const MAX_ANSWER_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 500;

/**
 * Read one model turn, refusing anything malformed.
 *
 * Never throws. A model that returns nonsense produces `unusable`, which the
 * runtime reports as a failed round rather than a crash — the same posture
 * `parseModelJson` takes, for the same reason: an unparseable answer is a
 * missing answer, and every caller already handles that.
 */
export function parseAgentTurn(value: unknown): AgentTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'unusable' };
  const raw = value as { tool_calls?: unknown; answer?: unknown; citations?: unknown; proposal?: unknown };

  if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
    const calls: AgentToolCall[] = [];
    let rejected = 0;
    for (const entry of raw.tool_calls.slice(0, MAX_CALLS_PER_TURN)) {
      const call = entry as { tool?: unknown; args?: unknown };
      if (!isAgentToolName(call?.tool)) { rejected += 1; continue; }
      const args = AGENT_TOOLS[call.tool].parseArgs(call?.args ?? {});
      if (!args) { rejected += 1; continue; }
      calls.push({ tool: call.tool, args });
    }
    if (calls.length > 0) return { kind: 'tools', calls, rejected };
    // Every call was rejected. That is still a turn the model took, and
    // reporting it as such lets the runtime tell the model what it got wrong
    // instead of silently looping on the same mistake.
    return { kind: 'tools', calls: [], rejected: Math.max(1, rejected) };
  }

  const answer = text(raw.answer, MAX_ANSWER_CHARS);
  if (!answer) return { kind: 'unusable' };

  const citations = Array.isArray(raw.citations)
    ? raw.citations.map((entry) => text(entry, 500)).filter((entry): entry is string => Boolean(entry))
    : [];

  const proposalRaw = raw.proposal as {
    summary?: unknown; day?: unknown; travelMinutes?: unknown; placeNames?: unknown; replan?: unknown;
  } | undefined;
  const summary = proposalRaw ? text(proposalRaw.summary, MAX_SUMMARY_CHARS) : undefined;
  const replanRaw = proposalRaw?.replan && typeof proposalRaw.replan === 'object'
    ? proposalRaw.replan as Record<string, unknown>
    : undefined;
  const objective = text(replanRaw?.objective, 300);
  const affectedDays = Array.isArray(replanRaw?.affectedDays)
    ? replanRaw.affectedDays.filter((day): day is number =>
      typeof day === 'number' && Number.isInteger(day) && day > 0 && day <= 60).slice(0, 10)
    : [];
  const moves = Array.isArray(replanRaw?.moves)
    ? replanRaw.moves.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const move = entry as Record<string, unknown>;
      const placeName = text(move.placeName, 160);
      const toDay = typeof move.toDay === 'number' && Number.isInteger(move.toDay) && move.toDay > 0 && move.toDay <= 60
        ? move.toDay
        : undefined;
      if (!placeName || !toDay) return [];
      const fromDay = typeof move.fromDay === 'number' && Number.isInteger(move.fromDay) && move.fromDay > 0 && move.fromDay <= 60
        ? move.fromDay
        : undefined;
      return [{ placeName, fromDay, toDay }];
    }).slice(0, 12)
    : [];

  return {
    kind: 'answer',
    answer: {
      answer,
      citations,
      proposal: summary
        ? {
          summary,
          day: typeof proposalRaw?.day === 'number' && Number.isInteger(proposalRaw.day)
            ? proposalRaw.day
            : undefined,
          travelMinutes: typeof proposalRaw?.travelMinutes === 'number'
            && Number.isFinite(proposalRaw.travelMinutes)
            ? Math.round(proposalRaw.travelMinutes)
            : undefined,
          placeNames: boundedList(proposalRaw?.placeNames, 8, 160),
          replan: objective && affectedDays.length > 0
            ? { objective, affectedDays, moves }
            : undefined,
        }
        : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Accountability: what the tools actually returned
// ---------------------------------------------------------------------------

/**
 * The facts this run established, gathered as the tools answer.
 *
 * The answer is checked against this and nothing else. It is the agent-tier
 * equivalent of the source text `validateBriefSentences` checks excerpts
 * against — the mechanism that makes "never invent" enforceable rather than
 * requested.
 */
export interface AgentEvidence {
  /** URLs a tool returned. A citation naming anything else is dropped. */
  citableUrls: Set<string>;
  /** Every travel time, in minutes, that a routing tool returned. */
  routeMinutes: Set<number>;
  /** Place names a tool returned, lowercased. */
  knownPlaceNames: Set<string>;
  /** Wallet/itinerary money amounts a budget tool returned, rounded. */
  budgetAmounts: Set<number>;
}

export const emptyEvidence = (): AgentEvidence => ({
  citableUrls: new Set<string>(),
  routeMinutes: new Set<number>(),
  knownPlaceNames: new Set<string>(),
  budgetAmounts: new Set<number>(),
});

export type AnswerRejection =
  | 'uncited-url'
  | 'invented-travel-time'
  | 'invented-travel-time-in-answer'
  | 'invented-place'
  | 'invented-budget-amount';

export interface ValidatedAgentAnswer {
  answer: string;
  citations: string[];
  proposal?: RawAgentAnswer['proposal'];
  rejected: Array<{ value: string; reason: AnswerRejection }>;
}

/**
 * Hold the answer to what the tools actually established.
 *
 * Three rules, each closing a way the model could state something no tool
 * said:
 *
 * 1. **A citation must be a URL a tool returned.** A plausible-looking link
 *    the model composed is worse than no link: it looks checkable and is not.
 * 2. **A travel time must be a number a routing tool returned.** This is the
 *    architecture rule made mechanical — the model may choose between transit
 *    at 27 minutes and walking at 51, and may not offer 18.
 * 3. **A named place must be one a tool returned.** Stops a proposal built
 *    around somewhere that does not exist, or is not in this city.
 *
 * A failing structured part is dropped and the rest is kept, because one bad
 * citation is no reason to lose a good answer — and no reason to show the bad
 * citation. Unsupported travel-time prose is different: the complete answer
 * is replaced with a safe refusal because selectively rewriting natural
 * language would risk changing its meaning. Every rejection is still returned
 * so a validator that has quietly stopped firing remains visible.
 */
export function validateAgentAnswer(
  answer: RawAgentAnswer,
  evidence: AgentEvidence,
): ValidatedAgentAnswer {
  const rejected: ValidatedAgentAnswer['rejected'] = [];

  const citations = answer.citations.filter((url) => {
    if (evidence.citableUrls.has(url)) return true;
    rejected.push({ value: url, reason: 'uncited-url' });
    return false;
  });

  let proposal = answer.proposal;
  if (proposal?.travelMinutes !== undefined && !evidence.routeMinutes.has(proposal.travelMinutes)) {
    rejected.push({ value: `${proposal.travelMinutes} minutes`, reason: 'invented-travel-time' });
    proposal = { ...proposal, travelMinutes: undefined };
  }
  if (proposal?.placeNames) {
    const kept = proposal.placeNames.filter((name) => {
      if (evidence.knownPlaceNames.has(name.toLowerCase())) return true;
      rejected.push({ value: name, reason: 'invented-place' });
      return false;
    });
    proposal = { ...proposal, placeNames: kept.length > 0 ? kept : undefined };
  }
  if (proposal?.replan) {
    const moves = proposal.replan.moves.filter((move) => {
      if (evidence.knownPlaceNames.has(move.placeName.toLowerCase())) return true;
      rejected.push({ value: move.placeName, reason: 'invented-place' });
      return false;
    });
    proposal = { ...proposal, replan: { ...proposal.replan, moves } };
  }

  // Structured validation alone is not enough: the model could omit
  // `proposal.travelMinutes` and still write "it takes 18 minutes" in the
  // visible answer. Recognise the common route-time forms and fail closed.
  const statedRouteMinutes = new Set<number>();
  const routePatterns = [
    /\b(?:takes?|about|around|roughly|approximately)\s+(\d{1,3})\s*(?:minutes?|mins?)\b/gi,
    /\b(\d{1,3})[-\s]*(?:minute|min)\s+(?:walk|drive|ride|trip|journey|transfer|route)\b/gi,
    /\b(?:walk|drive|ride|transit|train|bus|taxi|route|journey|transfer)\s+(?:takes?\s+)?(\d{1,3})\s*(?:minutes?|mins?)\b/gi,
  ];
  for (const pattern of routePatterns) {
    for (const match of answer.answer.matchAll(pattern)) statedRouteMinutes.add(Number(match[1]));
  }
  const unsupportedInAnswer = [...statedRouteMinutes]
    .filter((minutes) => !evidence.routeMinutes.has(minutes));
  for (const minutes of unsupportedInAnswer) {
    rejected.push({ value: `${minutes} minutes`, reason: 'invented-travel-time-in-answer' });
  }
  const visibleTravel = unsupportedInAnswer.length > 0
    ? 'I could not verify the travel time in that answer from the routing results, so I have not shown the estimate.'
    : answer.answer;

  const statedMoney = new Set<number>();
  const moneyPattern = /\b(?:RM|MYR|USD|EUR|JPY|CNY)\s*\$?\s*(\d{1,7}(?:,\d{3})*)\b|\$\s*(\d{1,7}(?:,\d{3})*)\b/gi;
  for (const match of visibleTravel.matchAll(moneyPattern)) {
    const raw = match[1] || match[2];
    if (!raw) continue;
    statedMoney.add(Number(raw.replaceAll(',', '')));
  }
  const unsupportedMoney = [...statedMoney].filter((amount) => !evidence.budgetAmounts.has(amount));
  for (const amount of unsupportedMoney) {
    rejected.push({ value: String(amount), reason: 'invented-budget-amount' });
  }
  const visibleAnswer = unsupportedMoney.length > 0
    ? 'I could not verify that money amount from the trip budget records, so I have not shown an estimate.'
    : visibleTravel;

  return { answer: visibleAnswer, citations, proposal, rejected };
}

/**
 * Fold a tool's result into the evidence set.
 *
 * Deliberately permissive about *shape* and strict about *provenance*: it
 * walks whatever the adapter returned looking for the three things an answer
 * can be held to, and ignores everything else. A tool that grows a field
 * therefore does not need this updated, while a model that invents one of the
 * three still fails.
 */
export function collectEvidence(
  evidence: AgentEvidence,
  tool: AgentToolName,
  result: unknown,
): AgentEvidence {
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;

    for (const key of ['url', 'sourceUrl', 'sourcePage', 'website', 'link']) {
      const value = record[key];
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) evidence.citableUrls.add(value);
    }
    for (const key of ['name', 'title', 'placeName']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) evidence.knownPlaceNames.add(value.trim().toLowerCase());
    }
    /**
     * Only a routing tool may establish a travel time. A duration that turned
     * up in, say, a search snippet must not become quotable as a route — that
     * is exactly the substitution this rule exists to prevent.
     */
    if (tool === 'get_route' || tool === 'get_route_matrix') {
      for (const key of ['durationMinutes', 'travelMinutes', 'minutes']) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) evidence.routeMinutes.add(Math.round(value));
      }
    }
    if (tool === 'get_budget_summary' || tool === 'get_expenses') {
      for (const key of ['spent', 'plannedCeiling', 'remainingKnownBudget', 'amount', 'amountMYR', 'min', 'max']) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) evidence.budgetAmounts.add(Math.round(value));
      }
    }

    for (const value of Object.values(record)) visit(value, depth + 1);
  };

  visit(result, 0);
  return evidence;
}

/**
 * The Planitenary agent — read-only, metered, and bounded.
 *
 * A separate function from `travel-reasoning` on purpose. That one is the
 * cheap card-personalisation tier: one request, one answer, no tools. This one
 * runs a bounded tool loop, and the two must not share an entry point —
 * `travel-reasoning`'s generic path will run any operation in
 * `REASONING_OPERATIONS` against raw client input with **no trip-ownership
 * check**, which is exactly the door an agent must not be able to walk
 * through. Two functions, two operation allowlists, one shared quota counter.
 *
 * ## The order, which is the whole security model
 *
 *   authenticate -> prove trip ownership -> validate operation and size
 *   -> for build-itinerary: derive current material and try an exact cache hit
 *   -> only on a cache miss (or for other operations):
 *        resolve an approved model -> budget gate + atomic quota reservation
 *        -> provider -> usage accounting -> ledger finalisation -> validate answer
 *
 * The kill switch (`OPENAI_MODEL=disabled`) therefore blocks new paid calls.
 * It must not hide an already-paid exact cached proposal.
 *
 * Every model round goes through `meteredModelCall`, the same door the rest of
 * the app uses. There is no other way to reach a provider from here: the loop
 * in `agentRuntime.ts` has no network access of its own and takes its model
 * caller as an injected dependency.
 *
 * ## It cannot change anything
 *
 * Phase 1 answers questions and *proposes*. There is no write tool, no write
 * path in the adapters, and no branch here that persists anything. A proposal
 * comes back as text for a person to act on. That is a structural property of
 * the dispatch table rather than a rule this handler is trusted to follow.
 *
 * ## Trip facts are grounded before the model speaks
 *
 * Ask does not hope the model will inspect the trip. After ownership, the
 * server derives required factual scopes, reads them in-process, and only then
 * may a model round run. Optional tools remain for facts that were not
 * pre-grounded. `validateAgentAnswer` is defence in depth, not the floor.
 */
import {
  AGENT_LIMITS,
  AGENT_SYSTEM_PROMPT,
  ITINERARY_PLANNER_SYSTEM_PROMPT,
  aiBudgetEpoch,
  aiReasoningLimits,
  aiSafetyBudgetUsd,
  isAgentOperation,
  json,
  openaiModel,
  preflight,
  resolveAgentReasoning,
  AGENT_OPERATIONS,
  type AgentOperation,
} from '../_shared/providers.ts';
import { callModel } from '../_shared/reasoning.ts';
import { budgetWindowStart, maximumReservedCost, type ModelUsage } from '../_shared/aiCost.ts';
import { authenticateRequest, bearerToken } from '../_shared/auth.ts';
import { readOwnedTrip } from '../_shared/tripOwnership.ts';
import {
  finalizeAiSpendAttempt,
  readItineraryProposalCache,
  readSpendToDate,
  serviceClient,
  writeItineraryProposalCache,
} from '../_shared/cache.ts';
import { reserveAiReasoningAttempt } from '../_shared/quota.ts';
import { SpendSession, meteredModelCall, type MeteredDeps } from '../_shared/meteredModel.ts';
import { runAgent, type AgentModelPayload } from '../_shared/agentRuntime.ts';
import { createToolExecutor } from '../_shared/agentToolAdapters.ts';
import {
  parseConversationTurns,
  parseUiContextEnvelope,
  rehydrateIntelligenceFocus,
} from '../_shared/intelligenceContext.ts';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  type PlanningMaterial,
  type ProposalRouteMode,
  type RouteMatrixLeg,
} from '../_shared/itineraryProposal.ts';
import {
  cachedItineraryProposalEnvelope,
  generationDisabledRefusal,
  isGenerationKillSwitch,
  lookupExactItineraryProposalCache,
} from '../_shared/itineraryProposalCache.ts';
import {
  ASK_GROUNDING_REFUSAL,
  collectAskGrounding,
  deriveAskGroundingPlan,
  presentAskEvidence,
  type AskGroundingExtras,
  type AskGroundingResult,
} from '../_shared/askGrounding.ts';
import {
  HISTORY_DIFF_SELECT,
  historyRecordFromAuthorityRow,
  listItineraryChangeHistory,
  type HistoryRecord,
} from '../_shared/itineraryChangeHistory.ts';

interface AgentBody {
  operation?: string;
  tripId?: string;
  question?: string;
  uiContext?: unknown;
  conversation?: unknown;
}

/** A traveller's question. Long enough for a real one, short enough to bound. */
const MAX_QUESTION_CHARS = 600;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Flatten the real sibling-function matrix into traceable route legs. */
const routeLegsFromTool = (value: unknown): RouteMatrixLeg[] => {
  const result = asRecord(value);
  const placeIds = asArray(result?.placeIds).filter((entry): entry is string => typeof entry === 'string');
  const payload = asRecord(result?.matrix);
  const matrix = asArray(payload?.matrix);
  const mode = ['walking', 'public-transport', 'driving', 'cycling'].includes(String(result?.requestedMode ?? result?.mode))
    ? (result?.requestedMode ?? result?.mode) as ProposalRouteMode
    : 'walking';
  const providerMode = typeof result?.providerMode === 'string' ? result.providerMode : undefined;
  const provider = typeof result?.provider === 'string' ? result.provider : undefined;
  const legs: RouteMatrixLeg[] = [];
  for (let originIndex = 0; originIndex < placeIds.length; originIndex += 1) {
    const row = asArray(matrix[originIndex]);
    for (let destinationIndex = 0; destinationIndex < placeIds.length; destinationIndex += 1) {
      if (originIndex === destinationIndex) continue;
      const cell = asRecord(row[destinationIndex]);
      const duration = typeof cell?.durationMinutes === 'number' && Number.isFinite(cell.durationMinutes)
        ? Math.round(cell.durationMinutes)
        : undefined;
      const source = cell?.source === 'cache' ? 'cache' : 'provider';
      legs.push({
        fromPlaceId: placeIds[originIndex],
        toPlaceId: placeIds[destinationIndex],
        status: cell?.status === 'ok' && duration !== undefined ? 'ok' : 'unknown',
        durationMinutes: duration,
        distanceMeters: typeof cell?.distanceMeters === 'number' ? Math.round(cell.distanceMeters) : undefined,
        mode,
        requestedMode: mode,
        providerMode,
        provider,
        source: cell?.status === 'ok' ? source : 'unavailable',
      });
    }
  }
  return legs;
};

const responseStatus = (refusal: string): number => {
  if (refusal === ASK_GROUNDING_REFUSAL) return 200;
  if (refusal === 'quota-exhausted' || refusal === 'budget-reached') return 429;
  if (refusal === 'provider-failed') return 502;
  return 503;
};

const UNMETERED_SPEND = {
  knownUsd: 0,
  reservedUsd: 0,
  unknownEvents: 0,
  ceilingUsd: 0,
  remainingUsd: 0,
};

const groundingEnvelope = (result: AskGroundingResult) => ({
  ok: result.ok,
  scopes: result.plan.required,
  reads: result.reads,
  missing: result.ok ? [] : result.missing,
  facts: result.ok && result.packet
    ? {
      dayCount: result.packet.trip.dayCount,
      decisions: result.packet.decisions.map((entry) => ({
        placeName: entry.placeName,
        decision: entry.decision,
      })),
      flights: result.packet.fixedEvents.map((flight) => ({
        start: flight.start,
        end: flight.end,
        sightseeingAfter: flight.sightseeingAfter,
      })),
    }
    : undefined,
});

/** Load only the extras the grounding plan actually requires. Zero AI cost. */
const loadAskGroundingExtras = async (input: {
  cache: NonNullable<ReturnType<typeof serviceClient>>;
  tripId: string;
  userId: string;
  itinerary: Record<string, unknown> | null;
  plan: ReturnType<typeof deriveAskGroundingPlan>;
}): Promise<AskGroundingExtras> => {
  const extras: AskGroundingExtras = {};
  const required = new Set(input.plan.required);

  if (required.has('budget')) {
    const { data, error } = await input.cache
      .from('budgets')
      .select('data')
      .eq('id', input.tripId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (error) extras.budgetReadFailed = true;
    else extras.budgetStored = asRecord(data)?.data ?? null;
  }

  if (required.has('documents')) {
    const { data, error } = await input.cache
      .from('trip_documents')
      .select('id, title, description, file_name, mime_type, storage_path, created_at')
      .eq('trip_id', input.tripId)
      .eq('user_id', input.userId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) extras.documentsReadFailed = true;
    else extras.documents = Array.isArray(data) ? data : [];
  }

  if (required.has('history')) {
    const listed = await listItineraryChangeHistory(input.tripId, input.userId, {
      async readHistory(tripId, userId, limit) {
        const { data, error } = await input.cache
          .from('itinerary_change_history')
          .select(HISTORY_DIFF_SELECT)
          .eq('trip_id', tripId)
          .eq('user_id', userId)
          .order('applied_at', { ascending: false })
          .limit(limit);
        if (error) return null;
        return (Array.isArray(data) ? data : [])
          .map(historyRecordFromAuthorityRow)
          .filter((entry): entry is HistoryRecord => entry !== null);
      },
    });
    if (!listed.ok) extras.historyReadFailed = true;
    else extras.historyCount = listed.changes.length;
  }

  if (required.has('proposal') && input.itinerary) {
    try {
      const material = await buildPlanningMaterial(input.tripId, input.itinerary);
      const cached = await readItineraryProposalCache(input.cache, input.tripId, material.revision);
      extras.proposalPresent = Boolean(cached);
    } catch {
      extras.proposalReadFailed = true;
    }
  }

  return extras;
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  /**
   * Identity first, and from the token only.
   *
   * The body carries a trip id and nothing else identifying. A client-supplied
   * user id is never read here — the caller is whoever the verified JWT says
   * they are, and ownership is checked against that.
   */
  const authentication = await authenticateRequest(request);
  if (authentication.ok === false) return json({ error: authentication.detail }, authentication.status);

  const body = (await request.json().catch(() => ({}))) as AgentBody;

  if (!isAgentOperation(body.operation)) {
    return json({ error: `Unknown operation. Allowed: ${AGENT_OPERATIONS.join(', ')}.` }, 400);
  }
  const operation: AgentOperation = body.operation;
  const limits = AGENT_LIMITS[operation];

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (operation !== 'build-itinerary' && !question) return json({ error: 'A question is required.' }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: `Question too long: ${question.length} characters, limit ${MAX_QUESTION_CHARS}.` }, 413);
  }

  const tripId = typeof body.tripId === 'string' ? body.tripId.trim() : '';
  if (!tripId) return json({ error: 'A tripId is required.' }, 400);

  const cache = serviceClient();
  if (!cache) return json({ error: 'AI accounting is not configured.' }, 503);

  /**
   * Ownership, before anything else is read and long before anything is spent.
   *
   * `readOwnedTrip` queries by trip id *and* verified user id together, so a
   * service-role lookup cannot become an existence oracle for somebody else's
   * trip. A trip that is not this caller's is refused identically to one that
   * does not exist.
   */
  const trip = await readOwnedTrip(cache, tripId, authentication.caller.userId);
  if (trip.kind === 'error') return json({ error: 'The trip could not be read.' }, 503);
  if (trip.kind === 'missing') return json({ error: 'Trip not found.' }, 404);

  const itinerary = trip.itineraryData && typeof trip.itineraryData === 'object'
    ? trip.itineraryData as Record<string, unknown>
    : null;

  const uiEnvelope = parseUiContextEnvelope(body.uiContext);
  const conversation = parseConversationTurns(body.conversation);
  const uiFocus = rehydrateIntelligenceFocus(itinerary, uiEnvelope, trip.tripId);

  let askGrounding: AskGroundingResult | undefined;
  if (operation !== 'build-itinerary') {
    const plan = deriveAskGroundingPlan({
      question,
      surface: uiFocus.surface,
      uiContext: uiEnvelope,
    });
    const extras = await loadAskGroundingExtras({
      cache,
      tripId: trip.tripId,
      userId: authentication.caller.userId,
      itinerary,
      plan,
    });
    askGrounding = collectAskGrounding({
      itinerary,
      tripId: trip.tripId,
      question,
      plan,
      uiFocus,
      conversation,
      extras,
    });
    if (!askGrounding.ok) {
      return json({
        operation,
        tripId: trip.tripId,
        status: 'refused',
        applied: false,
        answer: undefined,
        citations: [],
        rejected: [],
        transcript: [],
        refusal: ASK_GROUNDING_REFUSAL,
        detail: askGrounding.detail,
        grounding: groundingEnvelope(askGrounding),
        budget: { modelRounds: 0, toolCalls: 0, webSearches: 0, routeCalls: 0, placeLookups: 0 },
        spend: UNMETERED_SPEND,
      });
    }
  }

  /**
   * Exact cache before any model initialisation.
   *
   * Auth and ownership have already run. The material revision is derived from
   * the authorised trip, then the cache is asked for that exact pair. A hit
   * returns the stored proposal with zero reservation, ledger, or provider
   * work. A miss continues into the paid path below.
   */
  let itineraryProposalMaterial: PlanningMaterial | undefined;
  if (operation === 'build-itinerary') {
    const lookup = await lookupExactItineraryProposalCache({
      tripId: trip.tripId,
      itinerary,
      maxInputChars: limits.maxInputChars,
      readCache: (ownedTripId, materialRevision) =>
        readItineraryProposalCache(cache, ownedTripId, materialRevision),
    });
    if (lookup.kind === 'too-large') {
      return json({
        error: `Planning material too large: ${lookup.materialChars} characters, limit ${lookup.limit}.`,
      }, 413);
    }
    if (lookup.kind === 'hit') {
      return json(cachedItineraryProposalEnvelope(lookup.proposal, limits));
    }
    itineraryProposalMaterial = lookup.material;
  }

  const resolution = resolveAgentReasoning(operation);
  if (operation === 'build-itinerary' && (
    resolution.status === 'unconfigured' || isGenerationKillSwitch(openaiModel())
  )) {
    return json(generationDisabledRefusal(trip.tripId), 503);
  }
  if (resolution.status === 'misconfigured') return json({ error: resolution.error }, 500);
  if (resolution.status === 'unconfigured') return json({ error: 'The assistant is not configured.' }, 503);
  const { options } = resolution;

  const reasoningLimits = aiReasoningLimits();
  const budgetUsd = aiSafetyBudgetUsd();
  if (!reasoningLimits || budgetUsd === null) {
    return json({ error: 'AI spending limits are not configured safely.' }, 503);
  }

  /**
   * The conservative per-round reservation.
   *
   * Reserved *before* each provider round and settled after, so a loop that
   * runs several rounds is charged several times rather than once — the budget
   * sees the true exposure of a multi-round operation while it is running, not
   * after it finishes.
   */
  const maxCostUsd = maximumReservedCost({
    provider: options.provider,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
  });
  if (maxCostUsd === null) {
    return json({ error: 'The selected AI model has no conservative accounting policy.' }, 503);
  }

  const session = new SpendSession(
    { readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())) },
    budgetUsd,
  );

  const token = bearerToken(request);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  if (!token || !supabaseUrl) return json({ error: 'The agent tool boundary is not configured.' }, 503);
  const functionsBaseUrl = `${supabaseUrl}/functions/v1`;
  const toolSession = createToolExecutor({
    authHeader: `Bearer ${token}`,
    functionsBaseUrl,
    cache,
    tripId: trip.tripId,
    userId: authentication.caller.userId,
    itinerary,
    uiFocus,
  });
  const executeTool = toolSession.execute;

  /**
   * One metered model round.
   *
   * Fresh usage and request-id state per round: `meteredModelCall`'s contract
   * requires it, and reusing them across rounds would attribute one round's
   * cost to another. The material key names the operation, the trip and the
   * round, so the ledger can show what a single question actually cost.
   */
  const callOneRound = async (
    payload: AgentModelPayload | (Record<string, unknown> & { round: number }),
    systemPrompt = AGENT_SYSTEM_PROMPT,
  ) => {
    let usage: ModelUsage | undefined;
    let providerRequestId: string | undefined;
    let dispatchStatus: 'not-dispatched' | 'possibly-dispatched' = 'not-dispatched';

    const call: MeteredDeps['call'] = async () => {
      usage = undefined;
      providerRequestId = undefined;
      dispatchStatus = 'not-dispatched';
      const result = await callModel(`agent-${operation}`, payload, {
        ...options,
        systemPrompt,
        onProviderDispatch: () => { dispatchStatus = 'possibly-dispatched'; },
        onUsage: (reported) => { usage = reported; },
        onProviderResponse: (response) => {
          providerRequestId = response.providerRequestId;
          if (response.usage) usage = response.usage;
        },
      });
      return {
        result,
        usage,
        providerRequestId,
        dispatchStatus,
        status: (result !== undefined ? 'success' : usage ? 'invalid_output' : 'provider_error') as
          'success' | 'invalid_output' | 'provider_error',
      };
    };

    const materialKey = `agent:${operation}:${trip.tripId}:r${payload.round}`;
    const deps: MeteredDeps = {
      reserveAttempt: (row) => reserveAiReasoningAttempt(cache, {
        userId: authentication.caller.userId,
        tripId: trip.tripId,
        provider: String(row.provider || options.provider),
        model: String(row.model_requested || options.model),
        operation: `agent-${operation}`,
        materialKey,
        reservedUsd: maxCostUsd,
        budgetUsd,
        budgetSince: budgetWindowStart(aiBudgetEpoch()),
        globalLimit: reasoningLimits.global,
        userLimit: reasoningLimits.user,
      }),
      finalizeAttempt: (attemptId, row) => finalizeAiSpendAttempt(cache, attemptId, row),
      readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())),
      call,
    };

    const outcome = await meteredModelCall(
      {
        operation: `agent-${operation}`,
        provider: options.provider,
        requestedModel: options.model,
        accounting: {
          userId: authentication.caller.userId,
          tripId: trip.tripId,
          materialKey,
          reservedUsd: maxCostUsd,
        },
      },
      session,
      deps,
    );

    return outcome.ok === true
      ? { ok: true as const, value: outcome.result }
      : { ok: false as const, refusal: outcome.refusal, detail: outcome.detail };
  };

  if (operation === 'build-itinerary') {
    const material = itineraryProposalMaterial;
    if (!material) return json({ error: 'Planning material could not be built.' }, 500);

    const transcript: Array<{ tool: string; ok: boolean; detail?: string }> = [];
    let modelRounds = 0;
    let refusal: { refusal: string; detail?: string } | undefined;

    try {
      const proposal = await runItineraryProposalEngine(material, {
        chooseComposition: async ({ round, conflicts, previous }) => {
          const outcome = await callOneRound({
            operation,
            round,
            planningMaterial: material,
            conflicts,
            previousComposition: previous,
            finalRound: round >= 1 + material.limits.maxRepairIterations,
          }, ITINERARY_PLANNER_SYSTEM_PROMPT);
          modelRounds += 1;
          if (outcome.ok === false) {
            refusal = { refusal: outcome.refusal, detail: outcome.detail };
            throw new Error('planner-model-refused');
          }
          return outcome.value;
        },
        getRouteMatrix: async ({ placeIds, mode }) => {
          const result = await executeTool({ tool: 'get_route_matrix', args: { placeIds, mode } });
          transcript.push({ tool: 'get_route_matrix', ok: result.ok, detail: result.ok ? undefined : result.detail });
          return result.ok ? routeLegsFromTool(result.result) : [];
        },
      });
      await writeItineraryProposalCache(cache, proposal);

      return json({
        operation,
        tripId: trip.tripId,
        status: proposal.status === 'valid' ? 'answered' : 'partial',
        itineraryProposal: proposal,
        applied: false,
        cached: false,
        transcript,
        budget: {
          modelRounds,
          toolCalls: transcript.length,
          webSearches: 0,
          routeCalls: transcript.filter((entry) => entry.tool === 'get_route_matrix').length,
          placeLookups: 0,
        },
        limits,
        spend: await session.report(),
      });
    } catch (error) {
      if (!refusal) throw error;
      return json({
        operation,
        tripId: trip.tripId,
        status: 'refused',
        applied: false,
        transcript,
        refusal: refusal.refusal,
        detail: refusal.detail,
        spend: await session.report(),
      }, responseStatus(refusal.refusal));
    }
  }

  /**
   * The context the model reasons over: the question, bounded conversation,
   * and server-derived authoritative evidence. The thin UI envelope is a
   * focus hint only. Mutable trip facts are re-read on every request.
   */
  const context = {
    tripId: trip.tripId,
    name: itinerary?.name,
    cities: itinerary?.cities,
    dayCount: askGrounding?.packet?.trip.dayCount ?? asArray(itinerary?.days).length,
    today: new Date().toISOString().slice(0, 10),
    focus: uiFocus,
    conversation,
    authoritativeEvidence: askGrounding?.packet ? presentAskEvidence(askGrounding.packet) : undefined,
    rules: [
      'Authoritative evidence overrides conversation history.',
      'Never state a travel time, opening hour, price or forecast you did not receive from evidence or a tool.',
      'Cite only URLs a tool returned.',
      'You cannot change or save the itinerary. Describe a proposal instead.',
      'Focus is a hint. Current itinerary facts win over conversation memory.',
      'Do not mention hashes, revisions, ledgers, or internal ids.',
    ],
  };

  const contextChars = JSON.stringify(context).length + question.length;
  if (contextChars > limits.maxInputChars) {
    return json({ error: `Request too large: ${contextChars} characters, limit ${limits.maxInputChars}.` }, 413);
  }

  const run = await runAgent(
    { operation, question, context },
    {
      limits,
      callModel: (payload) => callOneRound(payload),
      executeTool,
      seededEvidence: askGrounding?.evidence,
      answerConstraints: askGrounding ? { dayCount: askGrounding.dayCount } : undefined,
    },
  );

  /**
   * Cards for the places the answer pointed at.
   *
   * Resolved *after* validation, from the ids that survived it, and entirely
   * server-side: the model chose which of the places it had been shown to
   * point at and nothing more. Names, coordinates, photographs and the
   * traveller's own decision all come from records this server already holds.
   *
   * Costs no model round and no image provider call — the photograph is read
   * from the validated cache by canonical identity.
   */
  const places = run.answer?.placeIds?.length
    ? await toolSession.resolvePlaceCards(run.answer.placeIds)
    : [];

  const status = run.status === 'refused' && run.refusal ? responseStatus(run.refusal) : 200;

  return json({
    operation,
    tripId: trip.tripId,
    status: run.status,
    answer: run.answer?.answer,
    citations: run.answer?.citations ?? [],
    /**
     * Structured place cards. Absent rather than empty-ish when the answer was
     * not about specific places — a card is an extra, never the answer.
     */
    places,
    /**
     * A suggestion, never an action. Phase 1 has no write path at all, so this
     * is text for a person to act on — which is why the flag is stated rather
     * than implied.
     */
    proposal: run.answer?.proposal,
    applied: false,
    /**
     * What the answer was refused for saying. Reported for the reason the
     * brief rejection counters are: a validator whose rejection rate nobody
     * watches is a validator nobody notices has stopped working.
     */
    rejected: run.answer?.rejected ?? [],
    detail: run.detail,
    refusal: run.refusal,
    /** Which tools ran, so the UI can show what the assistant actually did. */
    transcript: run.transcript,
    budget: run.budget,
    limits,
    evidence: run.evidence,
    grounding: askGrounding ? groundingEnvelope(askGrounding) : undefined,
    spend: await session.report(),
  }, status);
});

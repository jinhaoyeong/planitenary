/**
 * The agent loop: bounded, injected, and unable to write anything.
 *
 * Imports only `agentContract.ts`, which itself imports nothing — so this
 * module loads under vitest and the loop's bounds are exercised directly,
 * without a model or a network. That is the point: the caps here are the
 * difference between a question costing one provider call and a question
 * costing the deployment's whole daily allowance, and a cap nothing can test
 * is a cap nobody knows has stopped working. Same precedent as
 * `intelligenceService.ts`, which takes its cache, claim and provider as
 * dependencies for exactly this reason.
 *
 * ## The loop is not autonomous
 *
 * There is no "keep going until satisfied". Every run is bounded on five axes
 * before it starts — model rounds, total tool calls, web searches, routing
 * lookups, place lookups — and the last model round the budget allows runs
 * with the tool catalogue **withdrawn**, so the final thing the budget buys is
 * an answer rather than a request for one more lookup that nobody will act on.
 *
 * Reaching a limit is not an error. It ends the run and returns what was
 * gathered, which is the honest outcome: a partial answer with its sources is
 * worth more to a traveller than a spinner that never stops.
 */
import {
  AGENT_TOOLS,
  chargeTool,
  collectEvidence,
  emptyBudget,
  emptyEvidence,
  isAgentToolName,
  isFinalRound,
  parseAgentTurn,
  validateAgentAnswer,
  type AgentAnswerConstraints,
  type AgentEvidence,
  type AgentLimits,
  type AgentOperation,
  type AgentToolCall,
  type AgentToolName,
  type AgentToolRejection,
  type BudgetState,
  type ValidatedAgentAnswer,
} from './agentContract.ts';

/** One tool execution, as it happened. Returned so the UI can show progress. */
export interface AgentTranscriptEntry {
  tool: AgentToolName;
  ok: boolean;
  /** Why it did not run: a budget refusal, or the adapter's own reason. */
  detail?: string;
}

export type AgentRunStatus =
  /** The model answered and the answer survived validation. */
  | 'answered'
  /** Limits were reached before an answer. Findings are still returned. */
  | 'partial'
  /** The metered boundary refused. Nothing was spent beyond what it says. */
  | 'refused';

export interface AgentRunResult {
  status: AgentRunStatus;
  answer?: ValidatedAgentAnswer;
  /** Present when `status` is `refused`; the metered refusal code. */
  refusal?: string;
  detail?: string;
  transcript: AgentTranscriptEntry[];
  budget: BudgetState;
  /** Counts rather than the sets themselves, so the payload stays small. */
  evidence: { citableUrls: number; routeMinutes: number; knownPlaceNames: number };
  /**
   * Whether this run had to search for a place, and how that went.
   *
   * `attempted` and `succeeded` are separate because a search that ran and
   * found nothing is evidence — the honest answer to "find me somewhere" can
   * be that there is nowhere — while a search that never ran is the absence of
   * evidence. Collapsing the two would let the second borrow the first's
   * licence to answer.
   */
  placeDiscovery: {
    required: boolean;
    attempted: boolean;
    succeeded: boolean;
    /**
     * Who ran the search. `server-presearch` is the normal path: the server
     * searched before the first model round, so the model never had the
     * chance to skip it. `model-tool` means the model asked for it itself,
     * which still works and is still validated identically.
     */
    source?: 'server-presearch' | 'model-tool';
  };
  /**
   * Per-round trace, for acceptance and debugging. Carries no model prose, no
   * prompt, no argument values and no credentials — only shapes and reasons.
   */
  diagnostics: AgentRoundDiagnostic[];
}

/**
 * One round, as it actually went.
 *
 * Everything here was previously visible only to the model. A round that
 * proposed a malformed tool call and a round that proposed nothing both left
 * the run with `toolCalls: 0` and an empty transcript, which is what made a
 * six-round production failure impossible to diagnose without paying for
 * another one.
 */
export interface AgentRoundDiagnostic {
  round: number;
  turnKind: 'answer' | 'tools' | 'unusable';
  proposedToolCalls: number;
  acceptedToolCalls: number;
  rejectedToolCalls: AgentToolRejection[];
  /** Set when the round produced an answer the server declined to accept. */
  answerGate?: 'place-discovery-required';
}

export type ModelCallOutcome =
  | { ok: true; value: unknown }
  | { ok: false; refusal: string; detail: string };

export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; detail: string };

export interface AgentRunDeps {
  limits: AgentLimits;
  /**
   * One metered model call. The caller wires this to `meteredModelCall`, so
   * every round passes the same budget/quota/ledger door the rest of the app
   * uses — there is deliberately no way to reach a provider from this module
   * except through what is injected here.
   */
  callModel: (payload: AgentModelPayload) => Promise<ModelCallOutcome>;
  /** Execute one validated tool call against the real adapters. */
  executeTool: (call: AgentToolCall) => Promise<ToolOutcome>;
  /**
   * Facts already established before the first model round — Ask grounding.
   * Optional tools may add more; they must not be the only source of trip facts.
   */
  seededEvidence?: AgentEvidence;
  /** Trip-shape constraints such as day count. */
  answerConstraints?: AgentAnswerConstraints;
  /**
   * This question may not be answered until `search_places` has run.
   *
   * Set from the Ask grounding plan. The runtime enforces it by declining the
   * model's answer turn, which is the only enforcement that holds: the model
   * is asked for tool calls in prose JSON, so nothing in the provider request
   * can compel one.
   */
  requiresPlaceDiscovery?: boolean;
  /**
   * Tool results the server gathered before the first model round.
   *
   * The place pre-search arrives here. Passing it as findings rather than as
   * some new channel means the model reads it exactly as it reads a tool
   * result it asked for — same shape, same place in the payload, no second
   * way of describing a tool result.
   */
  seededFindings?: AgentModelPayload['findings'];
  /** Outcome of a server-run place search, when one happened. */
  seededPlaceDiscovery?: { attempted: boolean; succeeded: boolean };
}

/** What one round sends the model. Shape asserted by the tests. */
export interface AgentModelPayload {
  operation: AgentOperation;
  question: string;
  /** Trip material the server assembled. Never client-supplied identity. */
  context: unknown;
  /**
   * The tools still available. **Empty on the final round**, which is how the
   * loop guarantees its last paid call produces an answer.
   */
  tools: Array<{ name: string; description: string }>;
  /** Results so far, in the order they were gathered. */
  findings: Array<{ tool: string; ok: boolean; result?: unknown; detail?: string }>;
  /** True when the model must answer now, because no further tools will run. */
  finalRound: boolean;
  round: number;
  /**
   * True when this question may not be answered until `search_places` has run.
   *
   * Sent per question rather than left to the system prompt alone so the model
   * can comply on the first round. The runtime enforces it either way; this
   * only decides whether compliance costs one paid round or three.
   */
  requiresPlaceDiscovery: boolean;
}

/** The catalogue offered to the model, derived from the one dispatch table. */
export const toolCatalogue = (): Array<{ name: string; description: string }> =>
  Object.values(AGENT_TOOLS).map((spec) => ({ name: spec.name, description: spec.description }));

/**
 * What a traveller is told when a discovery question could not be grounded in
 * a real search. Deliberately the same words whether the model refused to
 * search or ran out of rounds: from the outside those are the same outcome.
 */
const DISCOVERY_UNMET = 'I could not confirm a real place for that request, so I have not recommended one.';

/** One provider result cannot consume the next round's whole input budget. */
const MAX_TOOL_RESULT_CHARS = 4_000;

const compactToolResult = (result: unknown): unknown => {
  try {
    const serialised = JSON.stringify(result);
    if (serialised.length <= MAX_TOOL_RESULT_CHARS) return result;
    return {
      truncated: true,
      preview: serialised.slice(0, MAX_TOOL_RESULT_CHARS),
      detail: `Tool result truncated at ${MAX_TOOL_RESULT_CHARS} characters.`,
    };
  } catch {
    return { truncated: true, detail: 'Tool result could not be serialised safely.' };
  }
};

/**
 * Run one agent question to a bounded conclusion.
 *
 * Returns rather than throws in every path. A traveller asking "what should we
 * do tonight" must never see a stack trace, and every failure mode here —
 * an exhausted budget, a refused metered call, a model that will not produce
 * usable JSON — degrades to either a partial answer or a stated refusal.
 */
export async function runAgent(
  input: { operation: AgentOperation; question: string; context: unknown },
  deps: AgentRunDeps,
): Promise<AgentRunResult> {
  const { limits } = deps;
  let budget = emptyBudget();
  const transcript: AgentTranscriptEntry[] = [];
  const findings: AgentModelPayload['findings'] = [...(deps.seededFindings ?? [])];
  const evidence: AgentEvidence = deps.seededEvidence
    ? {
      citableUrls: new Set(deps.seededEvidence.citableUrls),
      routeMinutes: new Set(deps.seededEvidence.routeMinutes),
      knownPlaceNames: new Set(deps.seededEvidence.knownPlaceNames),
      referenceablePlaceIds: new Set(deps.seededEvidence.referenceablePlaceIds),
      budgetAmounts: new Set(deps.seededEvidence.budgetAmounts),
      budgetKeys: new Set(deps.seededEvidence.budgetKeys),
      priceAmounts: new Set(deps.seededEvidence.priceAmounts),
      priceKeys: new Set(deps.seededEvidence.priceKeys),
      priceFacts: deps.seededEvidence.priceFacts.map((fact) => ({
        ...fact,
        fares: fact.fares.map((fare) => ({ ...fare })),
      })),
    }
    : emptyEvidence();

  /**
   * Only `search_places` counts.
   *
   * `get_saved_places` and `get_place_details` are place-bearing too, but they
   * report on places this trip already holds. A traveller asking for somewhere
   * *new* is not answered by re-reading their own list, so neither may satisfy
   * the requirement.
   */
  /**
   * Seeded results count as evidence, not just as something to read.
   *
   * The runtime collects them itself rather than trusting the caller to have
   * done it. A caller that passed the pre-search as findings but forgot the
   * evidence would show the model a list of real places and then reject every
   * id it picked from that list — a guaranteed zero-card answer, with nothing
   * obviously wrong anywhere. Doing it here makes the two consistent by
   * construction.
   */
  for (const finding of deps.seededFindings ?? []) {
    if (finding.ok && isAgentToolName(finding.tool)) collectEvidence(evidence, finding.tool, finding.result);
  }

  const requiresPlaceDiscovery = deps.requiresPlaceDiscovery === true;
  let placeDiscoveryAttempted = deps.seededPlaceDiscovery?.attempted === true;
  let placeDiscoverySucceeded = deps.seededPlaceDiscovery?.succeeded === true;
  let placeDiscoverySource: 'server-presearch' | 'model-tool' | undefined = deps.seededPlaceDiscovery
    ? 'server-presearch'
    : undefined;
  const diagnostics: AgentRoundDiagnostic[] = [];

  /**
   * How many rounds a discovery question may waste before the run gives up.
   *
   * Two, because one UI Ask is not one metered call: every round is separately
   * reserved, priced and counted against the daily quota. The first version of
   * this gate refused an unsearched answer and let the loop try again up to
   * the round cap, and production duly spent **six** quota units producing
   * nothing. Refusing twice is enough to establish the model will not comply.
   *
   * A round counts as wasted only when it dispatched no tool at all while the
   * search was still outstanding — so the intended recovery, answer → search →
   * answer, is never penalised, because its middle round dispatches.
   */
  const MAX_DISCOVERY_NONCOMPLIANCE = 2;
  let discoveryNoncompliance = 0;

  const summarise = (status: AgentRunStatus, extra: Partial<AgentRunResult> = {}): AgentRunResult => ({
    status,
    transcript,
    budget,
    evidence: {
      citableUrls: evidence.citableUrls.size,
      routeMinutes: evidence.routeMinutes.size,
      knownPlaceNames: evidence.knownPlaceNames.size,
    },
    placeDiscovery: {
      required: requiresPlaceDiscovery,
      attempted: placeDiscoveryAttempted,
      succeeded: placeDiscoverySucceeded,
      source: placeDiscoverySource,
    },
    diagnostics,
    ...extra,
  });

  while (budget.modelRounds < limits.maxModelRounds) {
    const finalRound = isFinalRound(budget, limits);
    const payload: AgentModelPayload = {
      operation: input.operation,
      question: input.question,
      context: input.context,
      // Withdrawn on the last round the budget allows. A model with no tools
      // to ask for has only one useful thing left to do.
      tools: finalRound ? [] : toolCatalogue(),
      findings,
      finalRound,
      round: budget.modelRounds + 1,
      requiresPlaceDiscovery,
    };
    let payloadChars: number;
    try {
      payloadChars = JSON.stringify(payload).length;
    } catch {
      return summarise(findings.length > 0 ? 'partial' : 'refused', {
        detail: 'The assistant context could not be serialised safely.',
      });
    }
    if (payloadChars > limits.maxInputChars) {
      return summarise(findings.length > 0 ? 'partial' : 'refused', {
        detail: `The assistant reached its ${limits.maxInputChars}-character input limit.`,
      });
    }

    const outcome = await deps.callModel(payload);

    budget = { ...budget, modelRounds: budget.modelRounds + 1 };

    if (outcome.ok === false) {
      // The metered door said no — quota, budget, or the provider itself.
      // Whatever was gathered before this is still returned, because it cost
      // something and may still answer the question.
      return summarise(
        findings.length > 0 ? 'partial' : 'refused',
        { refusal: outcome.refusal, detail: outcome.detail },
      );
    }

    const turn = parseAgentTurn(outcome.value);

    const roundDiagnostic: AgentRoundDiagnostic = {
      round: budget.modelRounds,
      turnKind: turn.kind,
      proposedToolCalls: turn.kind === 'tools' ? turn.calls.length + turn.rejections.length : 0,
      acceptedToolCalls: turn.kind === 'tools' ? turn.calls.length : 0,
      rejectedToolCalls: turn.kind === 'tools' ? turn.rejections : [],
    };
    diagnostics.push(roundDiagnostic);

    /**
     * Charge a round that cost money without moving the required search
     * forward, and say whether the run should now stop.
     *
     * Only counts while the search is still outstanding, so the intended
     * recovery — answer, then search, then answer — is never charged: its
     * middle round dispatches a tool.
     */
    const wastedRound = (): boolean => {
      if (!requiresPlaceDiscovery || placeDiscoverySucceeded) return false;
      discoveryNoncompliance += 1;
      return discoveryNoncompliance >= MAX_DISCOVERY_NONCOMPLIANCE;
    };

    if (turn.kind === 'answer') {
      /**
       * The gate this whole flag exists for.
       *
       * Production asked the model to "find one place worth visiting near
       * Shinjuku"; it answered on the first round having called nothing, named
       * a place it knew from the trip's own prose, and invented an id to cite
       * for it. The id was rejected downstream, so no card was built — but
       * nothing had required the search in the first place, which left the
       * card path dependent on the model's mood.
       *
       * Note there is no `finalRound` escape here. Letting the last round
       * through would mean a recommendation with no search behind it is
       * refused five times and then accepted, which is the same defect with a
       * delay. When the rounds run out this falls to the `partial` below.
       */
      if (requiresPlaceDiscovery && !placeDiscoverySucceeded) {
        roundDiagnostic.answerGate = 'place-discovery-required';
        findings.push({
          tool: 'model',
          ok: false,
          detail: placeDiscoveryAttempted
            ? 'The place search did not succeed, so there is no verified place to recommend yet. Call search_places again.'
            : 'This question asks for a place to visit. Call search_places first, then answer using only the places it returns.',
        });
        if (wastedRound()) return summarise('partial', { detail: DISCOVERY_UNMET });
        continue;
      }
      return summarise('answered', {
        answer: validateAgentAnswer(turn.answer, evidence, deps.answerConstraints),
      });
    }

    if (turn.kind === 'unusable') {
      // A round that produced nothing readable. Recorded as a finding so the
      // next round can see it went wrong, rather than repeating it blindly.
      findings.push({ tool: 'model', ok: false, detail: 'The previous reply was not valid JSON in the expected shape.' });
      if (wastedRound()) return summarise('partial', { detail: DISCOVERY_UNMET });
      continue;
    }

    if (turn.rejected > 0 && turn.calls.length === 0) {
      /**
       * Name what was wrong with each call rather than counting them. The
       * model can act on "search_places, invalid-args, you sent query"; it
       * cannot act on "1 tool call was rejected".
       */
      const why = turn.rejections
        .map((rejection) => {
          const tool = rejection.tool ?? 'unknown tool';
          const sent = rejection.argKeys?.length ? `, arguments sent: ${rejection.argKeys.join(', ')}` : '';
          return `${tool} (${rejection.reason}${sent})`;
        })
        .join('; ');
      findings.push({
        tool: 'model',
        ok: false,
        detail: why
          ? `No tool ran. ${why}.`
          : `${turn.rejected} tool call(s) named an unknown tool or had invalid arguments.`,
      });
      if (wastedRound()) return summarise('partial', { detail: DISCOVERY_UNMET });
      continue;
    }

    for (const call of turn.calls) {
      const charge = chargeTool(budget, call.tool, limits);
      if (charge.ok === false) {
        /**
         * Reported to the model rather than ending the run. It can then answer
         * with what it has — "return the best partial answer instead of
         * continuing" — instead of the traveller getting nothing because the
         * third route lookup was one too many.
         */
        transcript.push({ tool: call.tool, ok: false, detail: charge.refusal });
        findings.push({ tool: call.tool, ok: false, detail: `Not available: ${charge.refusal}.` });
        continue;
      }
      budget = charge.budget;

      // Attempted the moment it is dispatched: a search that threw was still a
      // search, and the model should be told so rather than silently retried.
      if (call.tool === 'search_places') {
        placeDiscoveryAttempted = true;
        placeDiscoverySource ??= 'model-tool';
      }

      let result: ToolOutcome;
      try {
        result = await deps.executeTool(call);
      } catch {
        result = { ok: false, detail: 'The tool failed.' };
      }

      if (result.ok === true) {
        if (call.tool === 'search_places') placeDiscoverySucceeded = true;
        collectEvidence(evidence, call.tool, result.result);
        transcript.push({ tool: call.tool, ok: true });
        findings.push({ tool: call.tool, ok: true, result: compactToolResult(result.result) });
      } else {
        transcript.push({ tool: call.tool, ok: false, detail: result.detail });
        findings.push({ tool: call.tool, ok: false, detail: result.detail });
      }
    }
  }

  // Rounds exhausted with no answer. Everything gathered is still returned:
  // the sources alone often answer the question a traveller actually had.
  return summarise('partial', {
    detail: requiresPlaceDiscovery && !placeDiscoverySucceeded
      ? DISCOVERY_UNMET
      : 'The assistant reached its limit for this question before finishing.',
  });
}

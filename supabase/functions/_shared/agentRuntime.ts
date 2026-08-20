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
  isFinalRound,
  parseAgentTurn,
  validateAgentAnswer,
  type AgentAnswerConstraints,
  type AgentEvidence,
  type AgentLimits,
  type AgentOperation,
  type AgentToolCall,
  type AgentToolName,
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
}

/** The catalogue offered to the model, derived from the one dispatch table. */
export const toolCatalogue = (): Array<{ name: string; description: string }> =>
  Object.values(AGENT_TOOLS).map((spec) => ({ name: spec.name, description: spec.description }));

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
  const findings: AgentModelPayload['findings'] = [];
  const evidence: AgentEvidence = deps.seededEvidence
    ? {
      citableUrls: new Set(deps.seededEvidence.citableUrls),
      routeMinutes: new Set(deps.seededEvidence.routeMinutes),
      knownPlaceNames: new Set(deps.seededEvidence.knownPlaceNames),
      referenceablePlaceIds: new Set(deps.seededEvidence.referenceablePlaceIds),
      budgetAmounts: new Set(deps.seededEvidence.budgetAmounts),
    }
    : emptyEvidence();

  const summarise = (status: AgentRunStatus, extra: Partial<AgentRunResult> = {}): AgentRunResult => ({
    status,
    transcript,
    budget,
    evidence: {
      citableUrls: evidence.citableUrls.size,
      routeMinutes: evidence.routeMinutes.size,
      knownPlaceNames: evidence.knownPlaceNames.size,
    },
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

    if (turn.kind === 'answer') {
      return summarise('answered', {
        answer: validateAgentAnswer(turn.answer, evidence, deps.answerConstraints),
      });
    }

    if (turn.kind === 'unusable') {
      // A round that produced nothing readable. Recorded as a finding so the
      // next round can see it went wrong, rather than repeating it blindly.
      findings.push({ tool: 'model', ok: false, detail: 'The previous reply was not valid JSON in the expected shape.' });
      continue;
    }

    if (turn.rejected > 0 && turn.calls.length === 0) {
      findings.push({
        tool: 'model',
        ok: false,
        detail: `${turn.rejected} tool call(s) named an unknown tool or had invalid arguments.`,
      });
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

      let result: ToolOutcome;
      try {
        result = await deps.executeTool(call);
      } catch {
        result = { ok: false, detail: 'The tool failed.' };
      }

      if (result.ok === true) {
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
    detail: 'The assistant reached its limit for this question before finishing.',
  });
}

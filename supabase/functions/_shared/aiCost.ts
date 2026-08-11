/**
 * What a model call actually cost.
 *
 * Everything else guarding the reasoning tier bounds a call *before* it is
 * made — which model, how much input, how many output tokens, how many
 * requests a day. Those are blast-radius controls, and none of them knows what
 * was spent. This module is the other half: it reads the provider's own usage
 * report and turns it into money.
 *
 * Two rules run through all of it, both pointing the same way:
 *
 * **Unknown is never zero.** A missing usage block, an unrecognised model, a
 * failed request — none of those cost nothing, they cost *an amount we cannot
 * determine*. Recording them as `0` would let a budget quietly drain while the
 * ledger insisted nothing had happened, which is the same failure the original
 * billing incident had: spending that nothing was counting.
 *
 * **Estimates round against us.** Where a price is genuinely unknown the
 * higher figure is used, so the guard stops early rather than late. A spend
 * ceiling that under-counts is not a ceiling.
 *
 * No Deno APIs and no runtime imports, so vitest exercises every rule here
 * directly — the `placeCost.ts` and `reasoning.ts` precedent.
 */

/** Tokens a provider reported for one request. All counts, no money. */
export interface ModelUsage {
  inputTokens: number;
  /**
   * Input tokens served from the provider's prompt cache, where it reports
   * them. A subset of `inputTokens`, not an addition to it.
   */
  cachedInputTokens?: number;
  outputTokens: number;
  /** Reasoning tokens, where billed separately from visible output. */
  reasoningTokens?: number;
  totalTokens?: number;
  /**
   * The model the provider says answered, which is not always the one asked
   * for — an alias can resolve to a dated snapshot. Cost must follow what
   * actually ran, not what we requested.
   */
  model?: string;
}

/** Price per one million tokens, in USD. */
export interface ModelPrice {
  input: number;
  output: number;
  /**
   * Cached input, where the provider prices it separately and the figure has
   * been confirmed against official documentation. Deliberately optional: an
   * *unconfirmed* discount is never applied, because guessing it low makes the
   * spend guard permissive in exactly the situation it exists for.
   */
  cachedInput?: number;
}

/**
 * GPT-5 nano, from OpenAI's published rates: $0.05 / $0.005 / $0.40 per 1M.
 *
 * Held as one object so an alias and its dated snapshot cannot drift apart —
 * they are the same model billed the same way, and two literals would
 * eventually disagree.
 */
const GPT_5_NANO: ModelPrice = { input: 0.05, cachedInput: 0.005, output: 0.40 };

/**
 * Approved models and their prices, in one place.
 *
 * Only `gpt-5-nano` is on the allowlist, so only `gpt-5-nano` has a price. A
 * model absent from this table cannot be costed, which is the intended
 * outcome — an unpriced model must not be silently treated as free, and the
 * allowlist should have refused it long before this point anyway.
 *
 * Dated snapshots map to the same price as the alias they resolve from.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'gpt-5-nano': GPT_5_NANO,
  /**
   * The dated snapshot the alias currently resolves to, priced explicitly.
   *
   * Necessary because cost follows the model the provider says *answered*: ask
   * for `gpt-5-nano`, be told `gpt-5-nano-2025-08-07`, and without this entry
   * every single call would cost as unknown and the spend gate would fail
   * closed after the first one — a self-inflicted outage from a guard doing
   * exactly what it was told.
   *
   * Listed by name rather than matched by prefix. `startsWith('gpt-5-nano')`
   * would be shorter and would silently apply today's price to a snapshot
   * released next year at a different one — inheriting a stale price is the
   * failure this whole table exists to prevent. An unrecognised snapshot must
   * stay unpriced until somebody looks at it.
   */
  'gpt-5-nano-2025-08-07': GPT_5_NANO,
};

/** Prices are quoted per million tokens. */
const PER_TOKENS = 1_000_000;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Read the usage block out of an OpenAI response.
 *
 * Returns `undefined` when the provider reported nothing usable, which the
 * caller must treat as "cost unknown" rather than as "cost nothing". Both
 * token counts are required for that reason: a usage block carrying only one
 * of them cannot produce a cost, and half a figure is worse than none.
 */
export function parseOpenAiUsage(payload: unknown): ModelUsage | undefined {
  const root = payload as { usage?: Record<string, unknown>; model?: unknown } | null;
  const usage = root?.usage;
  if (!usage || typeof usage !== 'object') return undefined;

  const inputTokens = finiteNumber(usage.prompt_tokens) ?? finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;

  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const outputDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;

  return {
    inputTokens,
    cachedInputTokens: finiteNumber(promptDetails?.cached_tokens),
    outputTokens,
    reasoningTokens: finiteNumber(outputDetails?.reasoning_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
    model: typeof root?.model === 'string' ? root.model : undefined,
  };
}

export interface CostEstimate {
  /** USD, or `null` when it genuinely cannot be determined. */
  usd: number | null;
  /** Why it could not be determined. Absent when `usd` is a number. */
  unknownReason?: 'no-usage' | 'unpriced-model';
}

/**
 * Cost one request, from what the provider said it used.
 *
 * `requestedModel` is only a fallback: if the response named the model that
 * answered, that name wins. An alias resolving to a snapshot we do not price
 * must read as unknown rather than borrow the alias's price, because the whole
 * point of following the resolved name is that it can differ.
 *
 * **Cached input is charged at the full input rate unless a cached price is
 * confirmed.** A model whose discount has not been verified is billed as
 * though it had none, because applying an unverified discount makes every
 * estimate lower than the truth — in a number that feeds a spend ceiling,
 * where being wrong low is the failure that matters. Over-estimating stops the
 * tier slightly early; under-estimating overspends. GPT-5 nano's rate is
 * confirmed and therefore applied.
 */
export function estimateCost(
  usage: ModelUsage | undefined,
  requestedModel: string | undefined,
): CostEstimate {
  if (!usage) return { usd: null, unknownReason: 'no-usage' };

  const model = usage.model || requestedModel || '';
  const price = MODEL_PRICING[model];
  if (!price) return { usd: null, unknownReason: 'unpriced-model' };

  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  const cachedRate = price.cachedInput ?? price.input;

  /**
   * Reasoning tokens are billed as output and are usually already included in
   * `completion_tokens`; adding them again would double-charge. They are
   * recorded separately for visibility, not summed into the cost here.
   */
  const usd = (uncached * price.input + cached * cachedRate + usage.outputTokens * price.output) / PER_TOKENS;

  return { usd };
}

/**
 * What happened to one request, as distinct from what it cost.
 *
 * These are deliberately separate axes, and conflating them loses the most
 * useful thing the ledger can tell you. A provider can bill for a response
 * whose JSON we could not parse: that is `invalid_output` *with a real
 * non-zero cost* — money spent for nothing, which is exactly the pattern worth
 * being able to see. Defining success as "usage was reported" would file it as
 * a success and hide it.
 */
export type AiRequestStatus =
  /** Answered, parsed, usable. */
  | 'success'
  /** Billed, but the reply could not be parsed or used. */
  | 'invalid_output'
  /** The provider refused — a non-2xx response. */
  | 'provider_error'
  /** The request never completed. */
  | 'network_error'
  | 'timeout'
  /** Answered, but reported no usage, so the cost cannot be determined. */
  | 'usage_missing';

/** One metered request, as the ledger records it. Never carries prompt text. */
export interface AiSpendEvent {
  provider: string;
  /** The alias or name we sent. */
  requestedModel: string;
  /**
   * The exact model the provider says answered, when it says so.
   *
   * Kept apart from `requestedModel` because they genuinely differ — an alias
   * resolves to a dated snapshot — and because cost is calculated from *this*
   * one. Writing the same value to both columns would discard the only record
   * of which model was actually billed.
   */
  resolvedModel: string | null;
  operation: string;
  status: AiRequestStatus;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
  unknownReason?: string;
}

/**
 * Build a ledger row for one request.
 *
 * A failure records null tokens rather than zeros. The distinction is the
 * whole value of the ledger: zeros would average into "our calls are getting
 * cheaper" when what actually happened is that they stopped working.
 */
export function spendEvent(input: {
  provider: string;
  requestedModel: string;
  operation: string;
  usage?: ModelUsage;
  status: AiRequestStatus;
}): AiSpendEvent {
  const { usd, unknownReason } = estimateCost(input.usage, input.requestedModel);
  return {
    provider: input.provider,
    requestedModel: input.requestedModel,
    resolvedModel: input.usage?.model ?? null,
    operation: input.operation,
    status: input.status,
    inputTokens: input.usage?.inputTokens ?? null,
    cachedInputTokens: input.usage?.cachedInputTokens ?? null,
    outputTokens: input.usage?.outputTokens ?? null,
    reasoningTokens: input.usage?.reasoningTokens ?? null,
    totalTokens: input.usage?.totalTokens ?? null,
    estimatedUsd: usd,
    unknownReason,
  };
}

/**
 * The ledger's column shape.
 *
 * Mapped here rather than at the write site so the snake_case boundary is
 * crossed exactly once, and so the "nulls, never zeros" rule is enforced by
 * the same module that decided the cost rather than re-derived beside the
 * database call.
 */
export function spendLedgerRow(
  event: AiSpendEvent,
  extra: { providerRequestId?: string; errorCode?: string } = {},
): Record<string, unknown> {
  return {
    provider: event.provider,
    provider_request_id: extra.providerRequestId ?? null,
    model_requested: event.requestedModel,
    model_resolved: event.resolvedModel,
    operation: event.operation,
    input_tokens: event.inputTokens,
    cached_input_tokens: event.cachedInputTokens,
    output_tokens: event.outputTokens,
    reasoning_tokens: event.reasoningTokens,
    total_tokens: event.totalTokens,
    estimated_cost_usd: event.estimatedUsd,
    cost_status: event.estimatedUsd === null ? 'unknown' : 'known',
    request_status: event.status,
    // Reserved, and deliberately unpopulated until the authentication work.
    trip_id: null,
    user_id: null,
    error_code: extra.errorCode ?? event.unknownReason ?? null,
  };
}

/**
 * The deployment's own spending ceiling, below the prepaid balance.
 *
 * A provider's prepaid cutoff is not instantaneous — usage can overshoot the
 * balance before access actually stops — so the app holds its own line well
 * short of it. The reserve is what makes the difference between "the AI
 * stopped" and "the account is empty and every other paid thing stopped too".
 */
export const DEFAULT_SPEND_CEILING_USD = 4.25;

/**
 * When the current budget started counting.
 *
 * This exists because the obvious implementation is wrong in a way that takes
 * months to notice. Summing a *rolling window* — the last 90 days, say — means
 * old spending silently ages out and the ceiling refills itself: spend $4.20
 * over three months and on day 91 the app believes it has budget again, having
 * never been given any more money. A prepaid balance does not work that way.
 * $5 loaded once is $5 forever until somebody loads more.
 *
 * So the window is anchored to an explicit epoch, and resetting the budget is
 * a deliberate human act performed *after* topping up the balance — never
 * something the passage of time does on its own.
 *
 * `undefined` means "count everything ever recorded", which is the correct and
 * safe default for a deployment that has never declared an epoch.
 */
export function budgetWindowStart(configuredEpoch?: string): string | undefined {
  if (!configuredEpoch?.trim()) return undefined;
  const parsed = new Date(configuredEpoch.trim());
  // An unparseable epoch must not silently become "everything since 1970" or,
  // worse, an Invalid Date that the database compares against unpredictably.
  // Counting all spend is the conservative reading of a broken setting.
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export type SpendGate =
  | { allowed: true }
  | { allowed: false; reason: 'ceiling-reached' | 'spend-unknown'; detail: string };

/**
 * Whether another metered call may be made.
 *
 * `spentUsd` of `null` means the ledger could not be read, and that **refuses
 * the call**. The reasoning is the one already written into `reserveQuota`'s
 * `failClosed`: an unreachable counter means we do not know what today has
 * cost, and "spend money because we cannot tell" is not a defensible default
 * for a provider that bills.
 *
 * Note what this cannot do. The cost of the *next* call is unknown until it
 * returns, so this stops the call after the ceiling is crossed, not before.
 * Bounding the overshoot is the job of the per-request controls — the model
 * allowlist, the input cap and the output ceiling — which is why all three
 * remain necessary even with a spend guard in place.
 */
export function spendGate(
  spentUsd: number | null,
  ceilingUsd = DEFAULT_SPEND_CEILING_USD,
): SpendGate {
  if (spentUsd === null) {
    return {
      allowed: false,
      reason: 'spend-unknown',
      detail: 'AI spending to date could not be read, so no further metered calls are made.',
    };
  }
  if (spentUsd >= ceilingUsd) {
    return {
      allowed: false,
      reason: 'ceiling-reached',
      detail: `AI spending has reached the configured ceiling of $${ceilingUsd.toFixed(2)}.`,
    };
  }
  return { allowed: true };
}

/**
 * Application-side quota caps.
 *
 * A provider quota that is small enough to exhaust is a product problem, not a
 * billing one: YouTube allows 100 `search.list` calls a day, so a busy morning
 * can leave every afternoon plan without video evidence. Counting our own usage
 * and stopping below the provider's limit keeps a margin in reserve.
 *
 * This complements the caches rather than replacing them. The cache stops us
 * asking the same question twice; the cap stops us asking too many different
 * ones in a day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuotaRequest {
  /** Provider key, e.g. `youtube-search`. */
  provider: string;
  /** Calls this reservation covers. Almost always 1. */
  calls: number;
  /** Quota units, where the provider prices calls differently. */
  units: number;
  /** Our cap, deliberately below the provider's own limit. */
  callLimit: number;
  /**
   * The timezone the provider resets its quota in. YouTube resets at midnight
   * Pacific; counting in UTC would misalign the reset by up to eight hours.
   */
  resetTimezone: string;
  /**
   * Refuse the call when the counter cannot be read, instead of allowing it.
   *
   * The default below is to fail *open*, and the reasoning for that is written
   * out there: overrunning a free provider costs an error response, and losing
   * all evidence to a brief database wobble is the worse outcome. That
   * reasoning depends entirely on the call being free.
   *
   * Gemini is not free. If the counter is unreachable we do not know how much
   * of today's allowance is spent, and "spend money because we cannot tell" is
   * not a defensible default — an unreachable counter has to mean "don't
   * call". Set this only for providers that send a bill.
   */
  failClosed?: boolean;
}

export interface AiReasoningReservationRequest {
  userId: string;
  tripId?: string;
  provider: string;
  model: string;
  operation: string;
  materialKey?: string;
  reservedUsd: number;
  budgetUsd: number;
  budgetSince?: string;
  globalLimit: number;
  userLimit: number;
}

export type AiReasoningReservationResult =
  | { ok: true; attemptId: string }
  | { ok: false; refusal: 'quota-exhausted' | 'budget-reached' | 'spend-unknown' | 'accounting-failed'; detail: string };

/**
 * Reserve all applicable reasoning dimensions and the pre-provider ledger row
 * in one database transaction. A false result consumes nothing.
 */
export async function reserveAiReasoningAttempt(
  client: SupabaseClient | null,
  request: AiReasoningReservationRequest,
): Promise<AiReasoningReservationResult> {
  if (!client) {
    return { ok: false, refusal: 'accounting-failed', detail: 'AI accounting is not configured.' };
  }
  try {
    const { data, error } = await client.rpc('reserve_ai_reasoning_attempt', {
      p_user_id: request.userId,
      p_trip_id: request.tripId ?? null,
      p_provider: request.provider,
      p_model: request.model,
      p_operation: request.operation,
      p_material_key: request.materialKey ?? null,
      p_reserved_cost_usd: request.reservedUsd,
      p_budget_usd: request.budgetUsd,
      p_budget_since: request.budgetSince ?? null,
      p_global_limit: request.globalLimit,
      p_user_limit: request.userLimit,
      p_trip_limit: null,
    });
    if (error || !data || typeof data !== 'object') {
      return { ok: false, refusal: 'accounting-failed', detail: 'The AI accounting reservation could not be created.' };
    }
    const result = data as { allowed?: unknown; reason?: unknown; attempt_id?: unknown };
    if (result.allowed === true && (typeof result.attempt_id === 'string' || typeof result.attempt_id === 'number')) {
      return { ok: true, attemptId: String(result.attempt_id) };
    }
    if (result.reason === 'quota-exhausted') {
      return { ok: false, refusal: 'quota-exhausted', detail: 'The daily AI request allowance for this account is spent.' };
    }
    if (result.reason === 'budget-reached') {
      return { ok: false, refusal: 'budget-reached', detail: 'AI spending has reached the configured ceiling.' };
    }
    return { ok: false, refusal: 'spend-unknown', detail: 'AI spending could not be safely established.' };
  } catch {
    return { ok: false, refusal: 'accounting-failed', detail: 'The AI accounting reservation could not be created.' };
  }
}

/**
 * Reserve quota for one call.
 *
 * Returns true when the call may proceed. The reservation is atomic, so two
 * concurrent requests cannot both slip past the last unit.
 *
 * **Fails open by default.** If the counter cannot be reached the call is
 * allowed, because exceeding a YouTube quota costs nothing but an error
 * response — unlike the paid providers, there is no bill on the other side of
 * this. Failing closed would turn a brief database problem into a total loss
 * of evidence, which is the worse outcome of the two.
 *
 * That argument holds only for free providers. Pass `failClosed` for a metered
 * one; see the field's own note for why the default inverts there.
 */
export async function reserveQuota(
  client: SupabaseClient | null,
  request: QuotaRequest,
): Promise<boolean> {
  // No client is not the same as an unreachable one: it means quota accounting
  // is not configured in this deployment at all. A metered provider still
  // refuses, because nothing would be counting the spend.
  if (!client) return !request.failClosed;
  const onUnknown = () => !request.failClosed;
  try {
    const { data, error } = await client.rpc('consume_provider_quota', {
      p_provider: request.provider,
      p_calls: request.calls,
      p_units: request.units,
      p_call_limit: request.callLimit,
      p_reset_timezone: request.resetTimezone,
    });
    if (error) return onUnknown();
    return data !== false;
  } catch {
    return onUnknown();
  }
}

/** Calls already made today, for diagnostics. Null when unknown. */
export async function usageToday(
  client: SupabaseClient | null,
  provider: string,
  resetTimezone: string,
): Promise<{ calls: number; units: number } | null> {
  if (!client) return null;
  try {
    // Recomputed in the provider's timezone so it matches what the cap counts.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: resetTimezone });
    const { data, error } = await client
      .from('provider_usage')
      .select('calls, units')
      .eq('provider', provider)
      .eq('usage_date', today)
      .maybeSingle();
    /**
     * "Nothing used yet" and "the counter is unreachable" are different
     * answers and must not share a value. A missing row genuinely means zero;
     * an error means we do not know, and reporting zero there would state
     * confidently that the day's allowance is untouched when it might be spent.
     */
    if (error) return null;
    if (!data) return { calls: 0, units: 0 };
    return { calls: Number(data.calls) || 0, units: Number(data.units) || 0 };
  } catch {
    return null;
  }
}

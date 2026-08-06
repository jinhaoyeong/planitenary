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
}

/**
 * Reserve quota for one call.
 *
 * Returns true when the call may proceed. The reservation is atomic, so two
 * concurrent requests cannot both slip past the last unit.
 *
 * **Fails open.** If the counter cannot be reached the call is allowed, because
 * exceeding a YouTube quota costs nothing but an error response — unlike the
 * paid providers, there is no bill on the other side of this. Failing closed
 * would turn a brief database problem into a total loss of evidence, which is
 * the worse outcome of the two.
 */
export async function reserveQuota(
  client: SupabaseClient | null,
  request: QuotaRequest,
): Promise<boolean> {
  if (!client) return true;
  try {
    const { data, error } = await client.rpc('consume_provider_quota', {
      p_provider: request.provider,
      p_calls: request.calls,
      p_units: request.units,
      p_call_limit: request.callLimit,
      p_reset_timezone: request.resetTimezone,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
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

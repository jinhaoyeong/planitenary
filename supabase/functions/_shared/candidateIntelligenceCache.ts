/**
 * Reading the candidate-intelligence cache.
 *
 * Split out of `cache.ts` for the reason `authPrimitives.ts` was split out of
 * `auth.ts`: that module reaches for `Deno.env` to build its service client, so
 * nothing importing it can be loaded by vitest or by the app's typecheck. This
 * lookup is where a bug costs money on every deck open, so it belongs where the
 * tests can actually exercise it. The client is a parameter, and there are no
 * Deno APIs and no runtime imports here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Three outcomes, deliberately not two.
 *
 * A hit and a miss are both *answers about the cache*; a failed read is not.
 * Collapsing the third into the second is what let a database fault look like
 * "nothing stored yet" and fall straight through to a billed provider call —
 * the same distinction `IntelligenceOutcome` draws between an empty answer and
 * one that was never obtained, applied to the layer underneath it.
 *
 * Within `entries`, callers must branch on presence rather than truthiness:
 *
 *   absent    → never asked about these exact facts
 *   `null`    → asked, and nothing survived validation
 *   an object → asked, and this is what survived
 *
 * The middle one is the reason this cache is worth having at all: without it, a
 * candidate the model had nothing useful to say about is paid for again every
 * single time the deck is opened.
 */
export type CandidateIntelligenceRead =
  | { ok: true; entries: Map<string, unknown | null> }
  | { ok: false; reason: string };

/**
 * Cached answers for an exact set of cache keys.
 *
 * **Looked up one exact key at a time, and that is not an oversight.** These
 * keys are `JSON.stringify`'d arrays, so every one of them contains double
 * quotes as well as commas. PostgREST's `in.(…)` argument is a quoted-CSV
 * grammar, and postgrest-js quotes a value containing `[,()]` without escaping
 * the quotes already inside it (`PostgrestFilterBuilder`'s
 * `PostgrestReservedCharsRegexp`). The value therefore closes its own quoting
 * early and the list parses into tokens that match nothing — silently, with no
 * error to notice. Production proved it: a row written by one paid request was
 * invisible to an identical replay, so every deck would have paid full price
 * forever.
 *
 * `eq` carries its argument to the end of the filter with no list grammar to
 * misparse, so an exact key stays exact. The batch is bounded by
 * `MAX_INTELLIGENCE_BATCH`, so this is at most fifteen single-row reads issued
 * together — correctness and cost safety ahead of one round trip.
 */
export async function readCandidateIntelligence(
  client: SupabaseClient | null,
  tripId: string,
  cacheKeys: string[],
): Promise<CandidateIntelligenceRead> {
  const entries = new Map<string, unknown | null>();
  if (cacheKeys.length === 0) return { ok: true, entries };
  if (!client) return { ok: false, reason: 'cache-unconfigured' };
  try {
    const rows = await Promise.all([...new Set(cacheKeys)].map(async (cacheKey) => {
      const { data, error } = await client
        .from('ai_candidate_intelligence')
        .select('cache_key, intelligence, expires_at')
        // Trip scoping stays: the cache key already carries the trip, and this
        // filter keeps the row unreachable from another trip regardless.
        .eq('trip_id', tripId)
        .eq('cache_key', cacheKey)
        .maybeSingle();
      return { data, error };
    }));
    const now = Date.now();
    for (const row of rows) {
      // One failed read poisons the whole answer rather than being reported as
      // fourteen hits and one miss, because the miss is the expensive one.
      if (row.error) return { ok: false, reason: 'cache-read-failed' };
      const found = row.data as { cache_key: string; intelligence: unknown; expires_at: string } | null;
      if (!found) continue;
      // Expiry here is garbage collection, not freshness — correctness is
      // governed by the material key — but an expired row is still skipped
      // rather than served, so a sweep and a read cannot disagree.
      if (new Date(found.expires_at).getTime() <= now) continue;
      /**
       * Presence is the hit, never truthiness. A stored SQL NULL means the
       * provider already evaluated this exact material and nothing survived
       * validation — a settled answer worth not paying for twice — so it is
       * mapped to `null` and placed in the map, not skipped.
       */
      entries.set(found.cache_key, found.intelligence ?? null);
    }
    return { ok: true, entries };
  } catch {
    return { ok: false, reason: 'cache-read-failed' };
  }
}

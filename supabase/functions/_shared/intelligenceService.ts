/**
 * The candidate-intelligence request, end to end.
 *
 * Cache first, batch the misses, one metered call per batch, validate each
 * candidate independently, write each result under its own key. The order
 * matters more than any single step: consulting the cache *before* the spend
 * guard is what makes a revisited deck free rather than merely cheap, and
 * batching only the misses is what keeps a fresh deck at one request instead
 * of fifteen.
 *
 * Written as a pure function over injected dependencies rather than inside the
 * Edge Function, because the handler reaches for `Deno` and the Supabase client
 * and so cannot be loaded by vitest. That would have left the orchestration —
 * which is where the expensive mistakes live — covered only by a source-code
 * grep. A structural guard is worth having and is not a substitute for
 * exercising the thing.
 */

import {
  buildIntelligenceBatches,
  intelligenceBatchClaimKey,
  intelligenceCacheKey,
  intelligenceRequestBody,
  validateCandidateIntelligence,
  type IntelligenceCandidate,
  type IntelligenceTripContext,
  type ValidatedIntelligence,
} from './candidateIntelligence.ts';

/**
 * What a card knows about its own intelligence.
 *
 * `deterministic-only` and `unavailable` are deliberately different. The first
 * means we asked and there was nothing worth saying — a settled answer. The
 * second means we never got to ask, which is temporary and must not be
 * remembered as though it were settled.
 */
export type IntelligenceStatus = 'ready' | 'deterministic-only' | 'unavailable';

export interface CandidateIntelligenceResult {
  candidateId: string;
  intelligence: ValidatedIntelligence | null;
  status: IntelligenceStatus;
}

/** Counters for the development diagnostics view. Never carries a prompt. */
export interface IntelligenceDiagnostics {
  candidatesRequested: number;
  cacheHits: number;
  cacheMisses: number;
  batches: number;
  meteredRequests: number;
  candidatesAccepted: number;
  candidatesRejected: number;
  deterministicFallbacks: number;
  blockedReason?: string;
}

/**
 * What the cache was able to say.
 *
 * `ok: false` is not a miss. It means the question could not be asked, so the
 * one thing that must not follow is a provider call made on the assumption
 * that nothing was stored.
 */
export type CacheReadOutcome =
  | { ok: true; entries: Map<string, ValidatedIntelligence | null> }
  | { ok: false; reason: string };

export interface IntelligenceServiceDeps {
  /**
   * Cached answers by cache key. Within a successful read, a key absent from
   * `entries` is a miss and a key present with `null` is a stored empty answer.
   * A failed read is a third outcome and fails closed.
   */
  readCache: (keys: string[]) => Promise<CacheReadOutcome>;
  /** Persist answers. Only ever called with results the model actually produced. */
  writeCache: (entries: Array<{
    cacheKey: string;
    candidate: IntelligenceCandidate;
    tripMaterialRevision: string;
    plannerRevision: string;
    model: string;
    intelligence: ValidatedIntelligence | null;
  }>) => Promise<void>;
  /** The shared metered boundary. The only route to a provider. */
  callMetered: (payload: unknown) => Promise<
    { ok: true; result: unknown } | { ok: false; refusal: string }
  >;
  model: string;
  /** The verified trip scope for both cache keys and live claims. */
  tripId: string;
  plannerContextRevision?: string;
  maxSerialisedChars: number;
  /** Returns false when another request owns the exact live batch. */
  claimBatch?: (claimKey: string) => Promise<boolean>;
  /** Releases a successful or failed live claim. */
  releaseBatch?: (claimKey: string) => Promise<void>;
}

export async function resolveCandidateIntelligence(
  trip: IntelligenceTripContext,
  candidates: IntelligenceCandidate[],
  deps: IntelligenceServiceDeps,
): Promise<{ results: CandidateIntelligenceResult[]; diagnostics: IntelligenceDiagnostics }> {
  const diagnostics: IntelligenceDiagnostics = {
    candidatesRequested: candidates.length,
    cacheHits: 0,
    cacheMisses: 0,
    batches: 0,
    meteredRequests: 0,
    candidatesAccepted: 0,
    candidatesRejected: 0,
    deterministicFallbacks: 0,
  };
  if (candidates.length === 0) return { results: [], diagnostics };

  const keyFor = (candidate: IntelligenceCandidate) => intelligenceCacheKey({
    tripId: deps.tripId,
    candidateId: candidate.candidateId,
    candidateRevision: candidate.candidateRevision,
    plannerRevision: candidate.plannerRevision,
    tripMaterialRevision: trip.tripMaterialRevision,
    model: deps.model,
  });

  /**
   * Read before anything else. A deck the traveller has already seen must cost
   * nothing at all — not a smaller batch, not a cheaper call — and the only way
   * to guarantee that is to answer from the cache before the spend guard is
   * even consulted.
   */
  const keys = candidates.map(keyFor);
  const cached = await deps.readCache(keys);

  const results = new Map<string, CandidateIntelligenceResult>();
  const misses: IntelligenceCandidate[] = [];

  /**
   * Fail closed when the cache could not be read at all.
   *
   * A cache we cannot question is not a cache with nothing in it. Treating the
   * two alike is a cost-safety defect rather than merely a correctness one: a
   * transient database fault would present every already-answered candidate as
   * a miss and buy all of them again, at the exact moment the system is least
   * healthy. Nothing is written either, because nothing was learned.
   */
  if (cached.ok === false) {
    diagnostics.blockedReason = cached.reason || 'cache-unavailable';
    for (const candidate of candidates) {
      diagnostics.deterministicFallbacks += 1;
      results.set(candidate.candidateId, {
        candidateId: candidate.candidateId, intelligence: null, status: 'unavailable',
      });
    }
    return {
      results: candidates.map((candidate) => results.get(candidate.candidateId)!),
      diagnostics,
    };
  }

  for (const candidate of candidates) {
    const hit = cached.entries.get(keyFor(candidate));
    // `undefined` is a miss; `null` is a stored answer meaning "asked, nothing
    // survived". Branching on presence rather than truthiness is the whole
    // reason the empty answer is worth storing.
    if (hit === undefined) { misses.push(candidate); diagnostics.cacheMisses += 1; continue; }
    diagnostics.cacheHits += 1;
    results.set(candidate.candidateId, {
      candidateId: candidate.candidateId,
      intelligence: hit,
      status: hit ? 'ready' : 'deterministic-only',
    });
  }

  const batches = buildIntelligenceBatches(misses, deps.maxSerialisedChars);
  diagnostics.batches = batches.length;

  for (const batch of batches) {
    const batchClaimKey = intelligenceBatchClaimKey({
      tripId: deps.tripId,
      model: deps.model,
      cacheKeys: batch.map(keyFor),
    });
    if (deps.claimBatch && !await deps.claimBatch(batchClaimKey)) {
      /**
       * Another request is already paying for this exact batch. Re-read once so
       * a fast winner can hand its result to this caller; if it is still live,
       * return deterministic fallback rather than starting a second provider
       * attempt. The claim expiry handles a crashed winner later.
       */
      const settled = await deps.readCache(batch.map(keyFor));
      for (const candidate of batch) {
        // A failed re-read yields no settled answer, which lands on the
        // deterministic fallback below. It cannot start a second provider
        // attempt from here either way.
        const hit = settled.ok ? settled.entries.get(keyFor(candidate)) : undefined;
        if (hit !== undefined) {
          diagnostics.cacheHits += 1;
          results.set(candidate.candidateId, {
            candidateId: candidate.candidateId,
            intelligence: hit,
            status: hit ? 'ready' : 'deterministic-only',
          });
        } else {
          diagnostics.deterministicFallbacks += 1;
          results.set(candidate.candidateId, {
            candidateId: candidate.candidateId, intelligence: null, status: 'unavailable',
          });
        }
      }
      diagnostics.blockedReason = 'duplicate-in-flight';
      continue;
    }

    try {
      const answer = await deps.callMetered(intelligenceRequestBody(trip, batch));
      diagnostics.meteredRequests += 1;

      if (answer.ok === false) {
        /**
         * Never asked, so nothing is learned and nothing is written. A budget
         * ceiling reached this afternoon must not permanently mark these cards
         * as having no personalisation available — which is exactly what caching
         * this as an empty answer would do.
         */
        diagnostics.blockedReason = answer.refusal;
        for (const candidate of batch) {
          diagnostics.deterministicFallbacks += 1;
          results.set(candidate.candidateId, {
            candidateId: candidate.candidateId, intelligence: null, status: 'unavailable',
          });
        }
        // Every later batch would be refused for the same reason; asking again
        // spends a quota unit to be told so.
        continue;
      }

      const { byCandidate } = validateCandidateIntelligence(answer.result, { trip, candidates: batch });
      const toWrite: Parameters<IntelligenceServiceDeps['writeCache']>[0] = [];

      for (const candidate of batch) {
        const intelligence = byCandidate.get(candidate.candidateId) ?? null;
        if (intelligence) diagnostics.candidatesAccepted += 1;
        else diagnostics.candidatesRejected += 1;

        results.set(candidate.candidateId, {
          candidateId: candidate.candidateId,
          intelligence,
          // Answered, even when empty. Settled, not temporary.
          status: intelligence ? 'ready' : 'deterministic-only',
        });
        toWrite.push({
          cacheKey: keyFor(candidate),
          candidate,
          tripMaterialRevision: trip.tripMaterialRevision,
          plannerRevision: candidate.plannerRevision,
          model: deps.model,
          intelligence,
        });
      }

      await deps.writeCache(toWrite);
    } finally {
      // A thrown provider/cache error must not strand the durable claim until
      // its expiry. The metered ledger remains the accounting boundary.
      await deps.releaseBatch?.(batchClaimKey);
    }
  }

  return {
    results: candidates.map((candidate) => results.get(candidate.candidateId) || {
      candidateId: candidate.candidateId, intelligence: null, status: 'unavailable' as const,
    }),
    diagnostics,
  };
}

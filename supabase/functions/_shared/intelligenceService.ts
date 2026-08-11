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

export interface IntelligenceServiceDeps {
  /** Cached answers by cache key. `undefined` for a miss, `null` for a stored empty answer. */
  readCache: (keys: string[]) => Promise<Map<string, ValidatedIntelligence | null | undefined>>;
  /** Persist answers. Only ever called with results the model actually produced. */
  writeCache: (entries: Array<{
    cacheKey: string;
    candidate: IntelligenceCandidate;
    profileRevision: string;
    plannerContextRevision?: string;
    model: string;
    intelligence: ValidatedIntelligence | null;
  }>) => Promise<void>;
  /** The shared metered boundary. The only route to a provider. */
  callMetered: (payload: unknown) => Promise<
    { ok: true; result: unknown } | { ok: false; refusal: string }
  >;
  model: string;
  plannerContextRevision?: string;
  maxSerialisedChars: number;
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
    candidateId: candidate.candidateId,
    candidateRevision: candidate.candidateRevision,
    profileRevision: trip.profileRevision,
    plannerContextRevision: deps.plannerContextRevision,
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

  for (const candidate of candidates) {
    const hit = cached.get(keyFor(candidate));
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
    const answer = await deps.callMetered(intelligenceRequestBody(trip, batch));
    diagnostics.meteredRequests += 1;

    if (!answer.ok) {
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
        profileRevision: trip.profileRevision,
        plannerContextRevision: deps.plannerContextRevision,
        model: deps.model,
        intelligence,
      });
    }

    await deps.writeCache(toWrite);
  }

  return {
    results: candidates.map((candidate) => results.get(candidate.candidateId) || {
      candidateId: candidate.candidateId, intelligence: null, status: 'unavailable' as const,
    }),
    diagnostics,
  };
}

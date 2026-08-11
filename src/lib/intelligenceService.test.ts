/**
 * The candidate-intelligence request, end to end.
 *
 * `candidateIntelligence.test.ts` proves what the model may *say*. This suite
 * proves what the request *costs*: that a revisited deck spends nothing, that
 * one changed candidate regenerates only itself, that a refused call is never
 * remembered as an answer, and that the provider is not reached at all when the
 * budget is gone.
 *
 * These are the mistakes that do not announce themselves. A cache key that is
 * subtly too coarse, or a refusal cached as an empty answer, produces a feature
 * that works perfectly and quietly costs money or quietly stops working.
 *
 * Dependencies are injected, so nothing here touches a network or a database —
 * which is the reason the orchestration lives in a pure module rather than
 * inside the Edge Function handler.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveCandidateIntelligence } from '../../supabase/functions/_shared/intelligenceService';
import {
  intelligenceCacheKey,
  type IntelligenceCandidate,
  type IntelligenceTripContext,
} from '../../supabase/functions/_shared/candidateIntelligence';

const trip: IntelligenceTripContext = {
  tripMaterialRevision: 'p1',
  styles: ['local-neighbourhoods'],
  pace: 'relaxed',
};

const candidate = (index: number, revision = 'r1'): IntelligenceCandidate => ({
  candidateId: `place-${index}`,
  candidateRevision: revision,
  plannerRevision: 'plan-r1',
  name: `Place ${index}`,
  category: 'sight',
  clusterId: 'north',
  matchedStyleTags: ['local-neighbourhoods'],
  pairableCandidateIds: [],
});

const fifteen = Array.from({ length: 15 }, (_, index) => candidate(index));

/** A well-formed reply covering every candidate it was asked about. */
const answerFor = (candidates: IntelligenceCandidate[]) => ({
  candidates: Object.fromEntries(candidates.map((entry) => [entry.candidateId, {
    tripMaterialRevision: trip.tripMaterialRevision,
    candidateRevision: entry.candidateRevision,
    reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
    cautionAtoms: [],
  }])),
});

function harness(over: Partial<{
  cached: Map<string, unknown>;
  reply: unknown;
  refusal: string;
}> = {}) {
  const written: Array<{ cacheKey: string; intelligence: unknown }> = [];
  const callMetered = vi.fn().mockImplementation(async (payload: unknown) => {
    if (over.refusal) return { ok: false as const, refusal: over.refusal };
    const sent = (payload as { candidates: Array<{ candidateId: string }> }).candidates;
    return {
      ok: true as const,
      result: over.reply ?? answerFor(sent.map((entry) => candidate(Number(entry.candidateId.split('-')[1])))),
    };
  });

  const deps = {
    model: 'gpt-5-nano',
    plannerRevision: 'plan-r1',
    maxSerialisedChars: 30_000,
    readCache: vi.fn().mockImplementation(async (keys: string[]) => {
      const found = new Map();
      for (const key of keys) if (over.cached?.has(key)) found.set(key, over.cached.get(key));
      return found;
    }),
    writeCache: vi.fn().mockImplementation(async (entries: Array<{ cacheKey: string; intelligence: unknown }>) => {
      written.push(...entries.map((entry) => ({ cacheKey: entry.cacheKey, intelligence: entry.intelligence })));
    }),
    callMetered,
  };
  return { deps, callMetered, written };
}

const keyFor = (entry: IntelligenceCandidate) => intelligenceCacheKey({
  candidateId: entry.candidateId,
  candidateRevision: entry.candidateRevision,
  tripMaterialRevision: trip.tripMaterialRevision,
  plannerRevision: 'plan-r1',
  model: 'gpt-5-nano',
});

describe('what a request actually costs', () => {
  it('serves fifteen fresh candidates from one metered call', async () => {
    const { deps, callMetered } = harness();
    const { diagnostics } = await resolveCandidateIntelligence(trip, fifteen, deps);

    expect(callMetered).toHaveBeenCalledTimes(1);
    expect(diagnostics).toMatchObject({
      candidatesRequested: 15, cacheHits: 0, cacheMisses: 15, batches: 1, meteredRequests: 1,
    });
  });

  /**
   * The single most valuable property here. A traveller reopening a deck they
   * have already reviewed must cost nothing at all — not a smaller batch, not a
   * cheaper call — which is why the cache is consulted before the spend guard
   * is even reached.
   */
  it('spends nothing when every candidate is already cached', async () => {
    const cached = new Map(fifteen.map((entry) => [keyFor(entry), { candidateId: entry.candidateId, reasons: [] }]));
    const { deps, callMetered } = harness({ cached });

    const { diagnostics } = await resolveCandidateIntelligence(trip, fifteen, deps);

    expect(callMetered).not.toHaveBeenCalled();
    expect(diagnostics).toMatchObject({ cacheHits: 15, cacheMisses: 0, batches: 0, meteredRequests: 0 });
  });

  /** One candidate changing must not drag fourteen correct neighbours with it. */
  it('regenerates only the candidate whose revision changed', async () => {
    const cached = new Map(fifteen.slice(1).map((entry) => [keyFor(entry), { candidateId: entry.candidateId, reasons: [] }]));
    const changed = [candidate(0, 'r2'), ...fifteen.slice(1)];
    const { deps, callMetered } = harness({ cached });

    const { diagnostics } = await resolveCandidateIntelligence(trip, changed, deps);

    expect(callMetered).toHaveBeenCalledTimes(1);
    expect(diagnostics).toMatchObject({ cacheHits: 14, cacheMisses: 1, meteredRequests: 1 });
    const sent = callMetered.mock.calls[0][0] as { candidates: Array<{ candidateId: string }> };
    expect(sent.candidates).toHaveLength(1);
    expect(sent.candidates[0].candidateId).toBe('place-0');
  });

  /** A profile change invalidates every candidate, because the key carries it. */
  it('regenerates everything when the trip profile changes materially', async () => {
    const cached = new Map(fifteen.map((entry) => [keyFor(entry), { candidateId: entry.candidateId, reasons: [] }]));
    const { deps, callMetered } = harness({ cached });

    const { diagnostics } = await resolveCandidateIntelligence(
      { ...trip, tripMaterialRevision: 'p2' }, fifteen, deps,
    );

    expect(callMetered).toHaveBeenCalledTimes(1);
    expect(diagnostics.cacheHits).toBe(0);
  });

  it('stores a cached empty answer and never re-asks about it', async () => {
    // `null` is a stored answer: asked, nothing survived.
    const cached = new Map(fifteen.map((entry) => [keyFor(entry), null]));
    const { deps, callMetered } = harness({ cached });

    const { results, diagnostics } = await resolveCandidateIntelligence(trip, fifteen, deps);

    expect(callMetered).not.toHaveBeenCalled();
    expect(diagnostics.cacheHits).toBe(15);
    expect(results[0]).toMatchObject({ intelligence: null, status: 'deterministic-only' });
  });
});

describe('a refused call is never remembered as an answer', () => {
  it.each(['budget-reached', 'spend-unknown', 'quota-exhausted', 'accounting-failed', 'provider-failed'])(
    'writes no cache entry when the call is refused with %s',
    async (refusal) => {
      const { deps, written } = harness({ refusal });
      const { results, diagnostics } = await resolveCandidateIntelligence(trip, fifteen.slice(0, 3), deps);

      // Nothing learned, so nothing stored — otherwise one spent budget would
      // permanently mark these cards as having no personalisation.
      expect(written).toHaveLength(0);
      expect(deps.writeCache).not.toHaveBeenCalled();
      expect(diagnostics.blockedReason).toBe(refusal);
      expect(diagnostics.deterministicFallbacks).toBe(3);
      for (const result of results) {
        expect(result).toMatchObject({ intelligence: null, status: 'unavailable' });
      }
    },
  );

  /**
   * `unavailable` and `deterministic-only` must stay distinct. The first is
   * temporary and will be retried; the second is settled and cached.
   */
  it('distinguishes "could not ask" from "asked and found nothing"', async () => {
    const blocked = harness({ refusal: 'budget-reached' });
    const answered = harness({ reply: { candidates: {} } });

    const first = await resolveCandidateIntelligence(trip, [candidate(0)], blocked.deps);
    const second = await resolveCandidateIntelligence(trip, [candidate(0)], answered.deps);

    expect(first.results[0].status).toBe('unavailable');
    expect(second.results[0].status).toBe('deterministic-only');
    // Only the settled one is written.
    expect(blocked.written).toHaveLength(0);
    expect(answered.written).toHaveLength(1);
    expect(answered.written[0].intelligence).toBeNull();
  });
});

describe('validation still applies at the service boundary', () => {
  it('caches the empty answer for a candidate whose every atom was invented', async () => {
    const { deps, written } = harness({
      reply: {
        candidates: {
          'place-0': {
            tripMaterialRevision: 'p1', candidateRevision: 'r1',
            reasonAtoms: [{ type: 'queue-is-short', references: [] }],
            cautionAtoms: [],
          },
        },
      },
    });

    const { results } = await resolveCandidateIntelligence(trip, [candidate(0)], deps);

    expect(results[0]).toMatchObject({ intelligence: null, status: 'deterministic-only' });
    // Asked, nothing survived — a real finding, worth not paying for twice.
    expect(written[0].intelligence).toBeNull();
  });

  it('does not overwrite the cache from a stale-revision reply', async () => {
    const { deps, written } = harness({
      reply: {
        candidates: {
          'place-0': {
            tripMaterialRevision: 'p1', candidateRevision: 'r-old',
            reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
            cautionAtoms: [],
          },
        },
      },
    });

    const { results } = await resolveCandidateIntelligence(trip, [candidate(0)], deps);

    expect(results[0].intelligence).toBeNull();
    // The stale answer is discarded rather than written over the current key.
    expect(written[0].intelligence).toBeNull();
  });

  it('keeps good candidates when one in the batch is invalid', async () => {
    const { deps } = harness({
      reply: {
        candidates: {
          'place-0': {
            tripMaterialRevision: 'p1', candidateRevision: 'r1',
            reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
            cautionAtoms: [],
          },
          'place-1': {
            tripMaterialRevision: 'p1', candidateRevision: 'r1',
            reasonAtoms: [{ type: 'style-match', references: ['temples'] }],
            cautionAtoms: [],
          },
        },
      },
    });

    const { results, diagnostics } = await resolveCandidateIntelligence(
      trip, [candidate(0), candidate(1)], deps,
    );

    expect(results[0].status).toBe('ready');
    expect(results[1].status).toBe('deterministic-only');
    expect(diagnostics).toMatchObject({ candidatesAccepted: 1, candidatesRejected: 1 });
  });

  it('asks nothing at all when there are no candidates', async () => {
    const { deps, callMetered } = harness();
    const { results } = await resolveCandidateIntelligence(trip, [], deps);
    expect(results).toHaveLength(0);
    expect(callMetered).not.toHaveBeenCalled();
  });
});

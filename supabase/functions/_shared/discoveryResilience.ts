/**
 * Keeping one factual source's outage from becoming a total discovery failure.
 *
 * This module exists because the rule it encodes was previously a comment. The
 * OSM path claimed "independent sources, so one being down must not sink the
 * other" while awaiting an unprotected Overpass call inside a `Promise.all`, so
 * an Overpass timeout rejected the batch, discarded Wikivoyage listings already
 * in hand, and surfaced as a 502. Smart Plan caught that, recorded zero
 * suggestions, and told travellers their saved places were the problem.
 *
 * The logic lives here, importable and injectable, so those semantics are
 * covered by tests rather than by a promise in prose.
 */

/** Which factual sources failed, so an outage is never reported as an absence. */
export interface DiscoverySourceReport {
  overpassFailed: boolean;
  wikivoyageFailed: boolean;
  /**
   * The request budget ran out before a source could be asked.
   *
   * A separate fact from a source failing: nothing is known to be down, we
   * simply stopped. Recorded because "we ran out of time" must not be reported
   * to the traveller as "this city has nothing in it".
   */
  deadlineExceeded: boolean;
}

export const emptySourceReport = (): DiscoverySourceReport => ({
  overpassFailed: false,
  wikivoyageFailed: false,
  deadlineExceeded: false,
});

/**
 * The whole request's budget, by what is waiting on it.
 *
 * Lives here rather than in the function because the browser derives its own
 * deadline from it. Two independently maintained numbers is how the client came
 * to give up while the server was still allowed to work.
 */
export const DISCOVERY_REQUEST_BUDGET_MS = { browse: 110_000, planning: 45_000 } as const;

/**
 * One clock for a whole discovery request.
 *
 * Every source already had its own ceiling, but nothing added them up, so a
 * request could legitimately spend 12s on Wikivoyage and then 22s twice on
 * Overpass — past a minute — while the browser had given up at fifty seconds
 * and shown a timeout for work that was still going. A per-source ceiling
 * bounds a source; only a shared deadline bounds a request.
 */
export interface RequestDeadline {
  remainingMs(): number;
  expired(): boolean;
  /**
   * The budget a source may have, or `null` when it must not be started.
   *
   * Starting a 22s round with 3s left buys nothing: it cannot finish, and the
   * traveller waits the 3s anyway. `minimumMs` is the point below which the
   * attempt is not worth making.
   */
  allow(ceilingMs: number, minimumMs: number): number | null;
}

export const createRequestDeadline = (
  budgetMs: number,
  now: () => number = Date.now,
): RequestDeadline => {
  const endsAt = now() + budgetMs;
  const remainingMs = () => Math.max(0, endsAt - now());
  return {
    remainingMs,
    expired: () => remainingMs() <= 0,
    allow(ceilingMs, minimumMs) {
      const remaining = remainingMs();
      if (remaining < minimumMs) return null;
      return Math.min(ceilingMs, remaining);
    },
  };
};

/**
 * Await a factual source without letting it reject the batch around it.
 *
 * Returns the fallback and records the failure instead of throwing. The caller
 * decides what an empty result means; this only guarantees it gets the chance.
 */
export async function settleFactualSource<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  onFailure?: (error: unknown) => void,
): Promise<T> {
  try {
    return await fetcher();
  } catch (error) {
    onFailure?.(error);
    return fallback;
  }
}

export type FactualDiscoveryOutcome = 'ok' | 'sources-unavailable' | 'no-candidates';

/**
 * Distinguish "this city has nothing" from "we could not ask".
 *
 * Candidates always win: if any source answered with usable places, a second
 * source's outage is degradation, not failure, and the result is real.
 */
export function factualDiscoveryOutcome(input: {
  candidateCount: number;
  report: DiscoverySourceReport;
}): FactualDiscoveryOutcome {
  if (input.candidateCount > 0) return 'ok';
  return input.report.overpassFailed || input.report.wikivoyageFailed || input.report.deadlineExceeded
    ? 'sources-unavailable'
    : 'no-candidates';
}

/**
 * Run at most `width` jobs at once.
 *
 * Planning discovers several cities to answer one press. Sequentially that
 * meant three ~47s failures in a row inside one ~149s request; unbounded it
 * would mean hammering Overpass. Both are wrong, so the width is bounded and
 * the caller carries a shared deadline.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  width: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(width, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * The same clock, reported short by the reserved slice.
 *
 * One deadline still governs the request; this is the view of it the sources
 * are given, so they stop early enough to leave the tail its budget.
 */
export const reserving = (deadline: RequestDeadline, reserveMs: number): RequestDeadline => {
  const remainingMs = () => Math.max(0, deadline.remainingMs() - reserveMs);
  return {
    remainingMs,
    expired: () => remainingMs() <= 0,
    allow: (ceilingMs, minimumMs) => {
      const remaining = remainingMs();
      if (remaining < minimumMs) return null;
      return Math.min(ceilingMs, remaining);
    },
  };
};

/**
 * Bound how long the response waits for work that cannot be aborted.
 *
 * The Supabase client takes no signal, so this bounds the wait rather than the
 * query: a slow write may still finish in the background, but it can no longer
 * hold the response past the deadline the request advertises.
 */
export async function withinBudget<T>(budgetMs: number, fallback: T, work: () => Promise<T>): Promise<T> {
  if (budgetMs <= 0) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), budgetMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

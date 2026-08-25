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
}

export const emptySourceReport = (): DiscoverySourceReport => ({
  overpassFailed: false,
  wikivoyageFailed: false,
});

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
  return input.report.overpassFailed || input.report.wikivoyageFailed
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

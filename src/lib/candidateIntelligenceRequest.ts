/**
 * When to ask for candidate intelligence, and when to ignore the answer.
 *
 * The expensive mistake in this layer is not a wrong result, it is a loop.
 * The shape is familiar and quiet:
 *
 *   render → array rebuilt → effect fires → request → setState → render → …
 *
 * The backend cache would stop that costing money, but it still floods the
 * Edge Function and makes the UI impossible to reason about. So the effect
 * depends on **one scalar fingerprint** of the facts that can change the
 * answer, and everything else — deck index, flip, scroll, hover, decisions —
 * is deliberately absent from it.
 *
 * Written as a plain controller rather than a hook so the rules are testable
 * without a renderer. Nothing here imports React, and the component keeps one
 * instance across renders.
 */

import type { ValidatedIntelligence } from '../../supabase/functions/_shared/candidateIntelligence';

export type IntelligenceStatus = 'ready' | 'deterministic-only' | 'unavailable';

export interface CandidateIntelligenceEntry {
  intelligence: ValidatedIntelligence | null;
  status: IntelligenceStatus;
}

/** The minimum a candidate must expose to take part. */
export interface RequestableCandidate {
  candidateId: string;
  candidateRevision: string;
}

/**
 * A stable fingerprint of everything that can change the answer.
 *
 * Sorted, because the deck reorders as decisions are made and a reorder
 * changes nothing about whether a place suits the traveller. Without the sort,
 * every re-rank would look like new material and buy the same answers again.
 *
 * Deliberately excludes deck index, flip state, scroll position, open details,
 * decision state, hover and viewport. None of them can change what is true
 * about a candidate, so none of them may cause a request.
 */
export function materialRequestKey(input: {
  profileRevision: string;
  plannerContextRevision?: string;
  candidates: RequestableCandidate[];
}): string {
  const candidates = input.candidates
    .map((candidate) => `${candidate.candidateId}:${candidate.candidateRevision}`)
    .sort()
    .join(',');
  return [
    input.profileRevision,
    input.plannerContextRevision || 'no-context',
    candidates,
  ].join('|');
}

export interface IntelligenceRequestState {
  /** By candidate id. Absent means no answer yet. */
  entries: Map<string, CandidateIntelligenceEntry>;
  /** The key `entries` describes, so a stale reply can be recognised. */
  key: string | null;
}

/**
 * Decides whether to ask, and whether an answer is still wanted.
 *
 * Holds two pieces of state and nothing else: the key currently in flight, and
 * the key whose answer is already held. Both are strings, which is what keeps
 * the effect's dependency a scalar.
 */
export class IntelligenceRequestController {
  /** The key being fetched right now, if any. */
  private inFlight: string | null = null;
  /** The key whose answer is held. Cleared when a request fails. */
  private resolved: string | null = null;

  /**
   * Whether a request should start for this key.
   *
   * Refuses a duplicate of the key already in flight — two identical requests
   * cannot produce different answers, and the second only adds load and a
   * second chance to race.
   *
   * A **failed** key is not recorded as resolved, so a later attempt is still
   * allowed. Marking failure as done would make one bad response permanent for
   * as long as the traveller stayed on the deck.
   */
  shouldRequest(key: string): boolean {
    if (!key) return false;
    if (this.inFlight === key) return false;
    if (this.resolved === key) return false;
    return true;
  }

  begin(key: string): void {
    this.inFlight = key;
  }

  /**
   * Whether an arriving answer is still the one being waited for.
   *
   * This — not `AbortController` — is the actual safety mechanism. An abort is
   * an optimisation that may or may not land in time; comparing the key the
   * request was issued under against the key wanted now is deterministic.
   *
   * The race it prevents: a request for profile p1 is overtaken by one for p2,
   * p2 answers first, then p1 arrives late. Without this, the previous
   * traveller's personalisation would overwrite the current one's.
   */
  accepts(key: string, currentKey: string): boolean {
    return key === currentKey;
  }

  /** Record a completed request. `succeeded: false` leaves a retry possible. */
  settle(key: string, succeeded: boolean): void {
    if (this.inFlight === key) this.inFlight = null;
    this.resolved = succeeded ? key : null;
  }

  /** Test seam and unmount cleanup. */
  reset(): void {
    this.inFlight = null;
    this.resolved = null;
  }

  get pending(): string | null { return this.inFlight; }
}

/**
 * Fold a backend response into per-candidate state.
 *
 * Keyed by candidate id and held apart from the canonical candidate objects,
 * so intelligence arriving cannot recreate the ranked list — which is what
 * would let a late answer reorder the deck under the traveller's cursor.
 */
export function foldIntelligenceResults(
  results: Array<{ candidateId: string; intelligence: ValidatedIntelligence | null; status: string }>,
): Map<string, CandidateIntelligenceEntry> {
  const entries = new Map<string, CandidateIntelligenceEntry>();
  for (const result of results) {
    if (!result?.candidateId) continue;
    const status: IntelligenceStatus = result.status === 'ready' ? 'ready'
      : result.status === 'deterministic-only' ? 'deterministic-only'
        : 'unavailable';
    entries.set(result.candidateId, {
      intelligence: status === 'ready' ? result.intelligence : null,
      status,
    });
  }
  return entries;
}

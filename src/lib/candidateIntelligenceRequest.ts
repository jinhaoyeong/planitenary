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
  /**
   * The **canonical discovery pool**, before decisions filter or reorder it.
   *
   * This is load-bearing and easy to get wrong. Excluding decision state from
   * the key is not enough on its own: if the array passed in is the *visible*
   * deck, then pressing Skip removes a candidate, the fingerprint changes, and
   * a decision has silently become material after all. The traveller marking
   * three places would buy three fresh answers about the places they did not
   * mark.
   *
   * So the pool and the deck are different things and stay that way:
   *
   *   canonical candidates            → material key
   *   canonical candidates + decisions → visible, reordered deck
   */
  candidates: RequestableCandidate[];
  profileRevision: string;
  plannerContextRevision?: string;
}): string {
  /**
   * Structured serialisation rather than delimiter-joined strings.
   *
   * Concatenating with separators aliases here, and not hypothetically: this
   * app's candidate ids are OSM-style, so `osm:node:123` at revision `r1` and
   * `osm:node` at revision `123:r1` both render as `osm:node:123:r1`. Two
   * different material states, one key — and the consequence is serving one
   * traveller's answers for another state without anything looking wrong.
   *
   * `JSON.stringify` escapes its own delimiters, so no id can impersonate a
   * boundary.
   */
  return JSON.stringify([
    input.profileRevision,
    input.plannerContextRevision ?? null,
    input.candidates
      .map((candidate) => [candidate.candidateId, candidate.candidateRevision])
      // Sorted because the deck reorders as decisions are made, and a reorder
      // changes nothing about whether a place suits the traveller.
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
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
/**
 * How many material states are worth remembering in one session.
 *
 * Small on purpose. This exists to spare a round trip when a traveller undoes
 * a profile change, not to be a cache — the backend already holds the
 * authoritative one, keyed per candidate and shared across sessions.
 */
export const MAX_HELD_KEYS = 8;

export class IntelligenceRequestController {
  /** The key being fetched right now, if any. */
  private inFlight: string | null = null;
  /**
   * Answers already held, by material key.
   *
   * More than just the most recent one, because travellers move back and
   * forth: adjusting a profile and undoing the change would otherwise re-ask
   * for an answer still sitting in memory. The backend cache makes that free
   * in provider terms, but it is still a pointless round trip.
   *
   * Bounded, because this is a convenience rather than a store — an unbounded
   * map on a long session is a leak, and the backend cache is the real one.
   */
  private readonly held = new Map<string, Map<string, CandidateIntelligenceEntry>>();

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
    if (this.held.has(key)) return false;
    return true;
  }

  /** An answer already held for this key, or undefined. */
  cached(key: string): Map<string, CandidateIntelligenceEntry> | undefined {
    return this.held.get(key);
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

  /**
   * Record a completed request.
   *
   * A failure stores nothing, so the key stays requestable. Remembering it as
   * done would make one bad response permanent for as long as the traveller
   * stayed on the deck, recoverable only by a reload.
   */
  settle(key: string, entries?: Map<string, CandidateIntelligenceEntry>): void {
    if (this.inFlight === key) this.inFlight = null;
    if (!entries) return;
    this.held.set(key, entries);
    // Oldest first — `Map` preserves insertion order, so the first key is the
    // least recently added.
    while (this.held.size > MAX_HELD_KEYS) {
      const oldest = this.held.keys().next().value;
      if (oldest === undefined) break;
      this.held.delete(oldest);
    }
  }

  /** Test seam and unmount cleanup. */
  reset(): void {
    this.inFlight = null;
    this.held.clear();
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

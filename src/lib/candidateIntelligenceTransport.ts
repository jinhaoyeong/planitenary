/**
 * Asking the server for candidate intelligence.
 *
 * The frontend knows about *candidate intelligence*; it does not know about
 * OpenAI. No model name, no token budget, no provider concept crosses this
 * boundary — those live behind `travel-reasoning`, along with the spend guard
 * and the ledger. Keeping it that way is what stops a UI change from
 * accidentally becoming a billing change.
 *
 * Separate from the components for the same reason `discoveryRuntime.ts` is:
 * a card should render what it is given, not know how it was fetched.
 */

import { invokeTravelReasoning } from './supabase';
import type { ValidatedIntelligence } from '../../supabase/functions/_shared/candidateIntelligence';
import type { IntelligenceStatus } from './candidateIntelligenceRequest';

/** One candidate, as the server needs to see it. */
export interface IntelligenceRequestCandidate {
  candidateId: string;
  candidateRevision: string;
  plannerRevision: string;
  name: string;
  category: string;
  area?: string;
  clusterId?: string;
  matchedStyleTags: string[];
  durationRangeMinutes?: [number, number];
  indoorOutdoor?: 'indoor' | 'outdoor' | 'both';
  travelMinutesFromCluster?: number;
  pairableCandidateIds: string[];
  underrepresentedCategories?: string[];
}

export interface IntelligenceRequestTrip {
  tripMaterialRevision: string;
  styles: string[];
  pace: string;
  budgetTier?: string;
}

export interface IntelligenceResponseRow {
  candidateId: string;
  intelligence: ValidatedIntelligence | null;
  status: IntelligenceStatus;
}

/**
 * Read the server's answer defensively.
 *
 * A malformed response must degrade to "no intelligence" rather than throw:
 * every card is decidable without this, and a rendering crash would take away
 * something that was working to add something optional.
 */
export function parseIntelligenceResponse(payload: unknown): IntelligenceResponseRow[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((entry) => {
    const row = entry as Partial<IntelligenceResponseRow> | null;
    if (!row || typeof row.candidateId !== 'string' || !row.candidateId) return [];
    const status: IntelligenceStatus = row.status === 'ready' ? 'ready'
      : row.status === 'deterministic-only' ? 'deterministic-only'
        : 'unavailable';
    return [{
      candidateId: row.candidateId,
      // Only a `ready` row may carry intelligence. Anything beside another
      // status is not an answer and is dropped rather than rendered.
      intelligence: status === 'ready' ? (row.intelligence ?? null) : null,
      status,
    }];
  });
}

/**
 * Fetch intelligence for a candidate set.
 *
 * Never throws: a failed request is a missing enhancement, and the card keeps
 * its deterministic rationale. Returns `undefined` for "could not ask", which
 * the caller must not record as an answer — the same distinction the server
 * draws between a settled empty result and a call that never ran.
 */
export async function fetchCandidateIntelligence(
  trip: IntelligenceRequestTrip,
  candidates: IntelligenceRequestCandidate[],
  plannerContextRevision?: string,
  invoke: (operation: string, input: unknown) => Promise<unknown> = invokeTravelReasoning,
): Promise<IntelligenceResponseRow[] | undefined> {
  if (candidates.length === 0) return [];
  try {
    const payload = await invoke('candidate-intelligence', {
      trip,
      candidates,
      plannerContextRevision,
    });
    return parseIntelligenceResponse(payload);
  } catch {
    // No retry here. The server refuses on a spent budget or an exhausted
    // quota, and retrying would turn one refusal into several.
    return undefined;
  }
}

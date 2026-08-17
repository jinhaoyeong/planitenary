/**
 * The Phase 2B write boundary, as decision logic.
 *
 * Split from the Edge Function on purpose: everything that decides *whether* a
 * write may happen lives here behind injected dependencies, so the refusals
 * that matter — not yours, not pending, stale, expired, blocked, already
 * applied — are exercised by ordinary tests rather than only by a deployed
 * function. The Deno entry point supplies real database access and nothing else.
 *
 * ## What this layer may and may not do
 *
 * It may read the owned itinerary, read a cached Phase 2A proposal, stage an
 * immutable result, and ask the database to apply or undo one.
 *
 * It may not call a model. There is no model dependency in `ChangeDeps` at all,
 * which is what makes "no AI on confirm" a structural property rather than a
 * promise: `stage`, `apply` and `undo` have no way to reach a provider even if
 * a future edit tried to.
 *
 * ## Where the guarantees actually live
 *
 * Checks here are the fast, explainable ones. The binding guarantees —
 * atomicity, row locking, and the base-revision compare-and-swap — live in the
 * SQL functions this calls, because a check made in TypeScript and a write made
 * afterwards are two moments, and a concurrent save can land between them. Both
 * layers check; only the database layer is authoritative.
 */
import {
  applyProposalToItinerary,
  diffItineraries,
  validateStagedChange,
  type ChangeRefusal,
  type ItineraryChangeDiff,
} from './itineraryChange.ts';
import {
  buildPlanningMaterial,
  type TripItineraryProposal,
} from './itineraryProposal.ts';

export interface ChangeBase {
  itinerary: unknown;
  /** SQL-computed digest of the stored row. The only base authority. */
  baseHash: string;
  baseUpdatedAt: string;
}

export interface StagedProposalRecord {
  proposalId: string;
  tripId: string;
  materialRevision: string;
  baseHash: string;
  proposedHash: string;
  status: 'pending' | 'applied' | 'stale' | 'expired' | 'cancelled';
  expiresAt: string;
  appliedChangeId?: string;
}

export type ApplyOutcome =
  | { ok: true; changeId: string; beforeHash: string; afterHash: string; itinerary: unknown; alreadyApplied: boolean }
  | { ok: false; refusal: ChangeRefusal };

export type UndoOutcome =
  | { ok: true; changeId: string; itinerary: unknown; alreadyUndone: boolean }
  | { ok: false; refusal: ChangeRefusal };

export interface ChangeDeps {
  readBase(tripId: string, userId: string): Promise<ChangeBase | null>;
  readCachedProposal(tripId: string, materialRevision: string): Promise<TripItineraryProposal | null>;
  stageProposal(input: {
    tripId: string;
    userId: string;
    /** The Phase 2A proposal this authorisation was derived from, for the record. */
    sourceProposalId: string;
    materialRevision: string;
    baseHash: string;
    baseUpdatedAt: string;
    proposal: TripItineraryProposal;
    proposedItinerary: unknown;
    diff: ItineraryChangeDiff;
    validation: { ok: boolean; blocking: string[]; warnings: string[] };
    expiresAt: string;
  }): Promise<StagedProposalRecord | null>;
  applyProposal(proposalId: string, userId: string): Promise<ApplyOutcome>;
  undoChange(changeId: string, userId: string): Promise<UndoOutcome>;
  now(): number;
}

/**
 * How long a staged write stays authorised.
 *
 * Short on purpose. A staged proposal is permission to overwrite a trip with a
 * specific result; the longer it lives the more likely the traveller has
 * forgotten what they were agreeing to. Expiry never invalidates the *cached*
 * Phase 2A proposal, which can still be re-staged in a second.
 */
export const STAGED_PROPOSAL_TTL_MINUTES = 30;

export type StageResult =
  | {
      ok: true;
      proposal: StagedProposalRecord;
      diff: ItineraryChangeDiff;
      blocking: string[];
      warnings: string[];
      applicable: boolean;
    }
  | { ok: false; refusal: ChangeRefusal | 'trip-not-found' | 'storage-failed'; detail: string };

/**
 * Which proposal the traveller was actually looking at when they pressed Apply.
 *
 * Both halves are identity, never content: the browser names a plan, it does
 * not supply one. The server loads its own stored copy and refuses unless that
 * copy is the one named.
 */
export interface ReviewedProposalRef {
  proposalId: string;
  materialRevision: string;
}

const REVIEWED_ELSEWHERE =
  'This plan was replaced by a newer one. Review the current plan before applying it.';

/**
 * Turn the exact reviewed proposal into an immutable, base-bound authorisation.
 *
 * Two independent bindings have to hold, and either one failing refuses rather
 * than substitutes:
 *
 *   the trip has not changed  — the material revision is recomputed from the
 *   itinerary as it stands now, so a cache row is only reachable while it still
 *   describes this trip; dates, decisions, priorities and constraints all feed
 *   that revision.
 *
 *   the plan has not changed  — the stored proposal's own ID must equal the one
 *   the traveller reviewed. Regenerating overwrites the cache row for a given
 *   material revision, so without this check "the proposal for this trip" would
 *   quietly resolve to a plan nobody looked at. Since the ID is a fingerprint of
 *   the plan's content, matching IDs mean the same plan rather than merely a
 *   plan made at the same moment.
 *
 * A cache hit therefore never shortcuts either check; it only avoids paying for
 * a model round the trip did not need.
 */
export async function stageItineraryChange(
  tripId: string,
  userId: string,
  deps: ChangeDeps,
  reviewed: ReviewedProposalRef,
): Promise<StageResult> {
  if (!reviewed.proposalId || !reviewed.materialRevision) {
    return { ok: false, refusal: 'proposal-invalid', detail: 'A reviewed plan is required.' };
  }

  const base = await deps.readBase(tripId, userId);
  if (!base) return { ok: false, refusal: 'trip-not-found', detail: 'Trip not found.' };

  const material = await buildPlanningMaterial(tripId, base.itinerary);
  if (reviewed.materialRevision !== material.revision) {
    return {
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made. Generate a fresh proposal to review it.',
    };
  }

  const proposal = await deps.readCachedProposal(tripId, material.revision);
  if (!proposal) {
    return {
      ok: false,
      refusal: 'proposal-stale',
      detail: 'This trip has changed since the plan was made. Generate a fresh proposal to review it.',
    };
  }
  if (proposal.tripId !== tripId || proposal.materialRevision !== material.revision) {
    return { ok: false, refusal: 'proposal-stale', detail: 'The stored proposal does not describe this trip.' };
  }
  if (proposal.id !== reviewed.proposalId) {
    return { ok: false, refusal: 'proposal-stale', detail: REVIEWED_ELSEWHERE };
  }

  const applied = applyProposalToItinerary(base.itinerary, proposal);
  const validation = validateStagedChange(proposal, applied);
  const diff = diffItineraries(base.itinerary, applied.itinerary, proposal);

  const staged = await deps.stageProposal({
    tripId,
    userId,
    sourceProposalId: proposal.id,
    materialRevision: material.revision,
    baseHash: base.baseHash,
    baseUpdatedAt: base.baseUpdatedAt,
    proposal,
    proposedItinerary: applied.itinerary,
    diff,
    validation,
    expiresAt: new Date(deps.now() + STAGED_PROPOSAL_TTL_MINUTES * 60_000).toISOString(),
  });
  if (!staged) return { ok: false, refusal: 'storage-failed', detail: 'The proposal could not be staged.' };

  return {
    ok: true,
    proposal: staged,
    diff,
    blocking: validation.blocking,
    warnings: validation.warnings,
    applicable: validation.ok,
  };
}

export type ApplyResult =
  | { ok: true; changeId: string; beforeHash: string; afterHash: string; itinerary: unknown; alreadyApplied: boolean }
  | { ok: false; refusal: ChangeRefusal; detail: string };

const REFUSAL_DETAIL: Record<ChangeRefusal, string> = {
  'proposal-stale': 'Your itinerary changed after this plan was prepared. Review a fresh proposal before applying.',
  'proposal-expired': 'This plan has expired. Generate it again to apply it.',
  'proposal-not-pending': 'This plan is no longer awaiting your confirmation.',
  'proposal-blocked': 'This plan has unresolved conflicts and cannot be applied.',
  'proposal-invalid': 'This plan could not be read safely, so nothing was changed.',
  'undo-stale': 'Your itinerary changed after this plan was applied, so undoing it would discard newer edits.',
  'change-not-undoable': 'This change can no longer be undone.',
};

/**
 * Apply exactly what was staged.
 *
 * The only input is a proposal ID. There is deliberately no parameter carrying
 * itinerary content, a patch, or a proposal body — the result was fixed at
 * stage time and stored server-side, so a tampered request can at most name a
 * different proposal, which ownership then refuses.
 */
export async function applyItineraryChange(
  proposalId: string,
  userId: string,
  deps: ChangeDeps,
): Promise<ApplyResult> {
  const outcome = await deps.applyProposal(proposalId, userId);
  return outcome.ok
    ? {
        ok: true,
        changeId: outcome.changeId,
        beforeHash: outcome.beforeHash,
        afterHash: outcome.afterHash,
        itinerary: outcome.itinerary,
        alreadyApplied: outcome.alreadyApplied,
      }
    : { ok: false, refusal: outcome.refusal, detail: REFUSAL_DETAIL[outcome.refusal] };
}

export type UndoResult =
  | { ok: true; changeId: string; itinerary: unknown; alreadyUndone: boolean }
  | { ok: false; refusal: ChangeRefusal; detail: string };

/**
 * Restore the exact snapshot taken before the change.
 *
 * Refuses unless the itinerary is still bit-for-bit what the apply produced.
 * Undo is not a merge and must never become one: if the traveller has edited
 * since, their edits win and they are told why.
 */
export async function undoItineraryChange(
  changeId: string,
  userId: string,
  deps: ChangeDeps,
): Promise<UndoResult> {
  const outcome = await deps.undoChange(changeId, userId);
  return outcome.ok
    ? { ok: true, changeId: outcome.changeId, itinerary: outcome.itinerary, alreadyUndone: outcome.alreadyUndone }
    : { ok: false, refusal: outcome.refusal, detail: REFUSAL_DETAIL[outcome.refusal] };
}

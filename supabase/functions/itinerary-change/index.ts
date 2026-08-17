/**
 * The itinerary write endpoint — the only path in the app that an AI proposal
 * can reach the authoritative itinerary through.
 *
 * Deliberately not part of `planitenary-agent`. That function owns a model
 * budget, a tool loop and a provider allowlist; this one owns a database
 * transaction. Keeping them apart is what lets this file state, and mean, that
 * **no model is invoked here**: there is no reasoning import, no provider
 * client, no quota reservation and no spend ledger call anywhere in the module
 * graph below `stage`, `apply`, `undo` and `history`.
 *
 * ## The order, which is the security model
 *
 *   authenticate -> prove trip ownership -> resolve the staged authorisation
 *   -> locked compare-and-swap in SQL -> snapshot -> write -> history
 *
 * ## What a client may send
 *
 * A trip id, a proposal id, or a change id. Never itinerary content, never a
 * patch, never a proposal body. The result of an apply was fixed when it was
 * staged, and is stored server-side; the confirmation only names it. History
 * is a read of already-persisted rows for that owned trip.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { json, preflight } from '../_shared/providers.ts';
import { authenticateRequest } from '../_shared/auth.ts';
import { readOwnedTrip } from '../_shared/tripOwnership.ts';
import { serviceClient, readItineraryProposalCache } from '../_shared/cache.ts';
import {
  applyItineraryChange,
  stageItineraryChange,
  undoItineraryChange,
  type ApplyOutcome,
  type ChangeBase,
  type ChangeDeps,
  type StagedProposalRecord,
  type UndoOutcome,
} from '../_shared/itineraryChangeService.ts';
import type { ChangeRefusal } from '../_shared/itineraryChange.ts';
import {
  HISTORY_DIFF_SELECT,
  historyRecordFromAuthorityRow,
  listItineraryChangeHistory,
  type HistoryDeps,
  type HistoryRecord,
} from '../_shared/itineraryChangeHistory.ts';

/**
 * The entire request surface. Every field is an identifier — a trip, a plan, a
 * change — and none of them is content. There is nowhere here to put an
 * itinerary, a patch, or a proposal body.
 */
interface ChangeBody {
  operation?: string;
  tripId?: string;
  sourceProposalId?: string;
  materialRevision?: string;
  proposalId?: string;
  changeId?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown, max = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
};

/** Refusals are the traveller's problem to resolve, not server faults. */
const REFUSAL_STATUS: Record<string, number> = {
  'proposal-stale': 409,
  'undo-stale': 409,
  'proposal-expired': 410,
  'proposal-not-pending': 409,
  'proposal-blocked': 422,
  'proposal-invalid': 404,
  'change-not-undoable': 404,
  'trip-not-found': 404,
  'storage-failed': 503,
};

const refusalOutcome = (value: unknown): { refusal: ChangeRefusal } => {
  const record = asRecord(value);
  const refusal = text(record?.refusal, 60);
  const known: ChangeRefusal[] = [
    'proposal-stale', 'proposal-expired', 'proposal-not-pending',
    'proposal-blocked', 'proposal-invalid', 'undo-stale', 'change-not-undoable',
  ];
  return { refusal: known.find((entry) => entry === refusal) ?? 'proposal-invalid' };
};

const changeDeps = (client: SupabaseClient): ChangeDeps => ({
  async readBase(tripId, userId): Promise<ChangeBase | null> {
    const { data, error } = await client.rpc('itinerary_change_base', {
      p_trip_id: tripId,
      p_user_id: userId,
    });
    const record = asRecord(data);
    if (error || !record) return null;
    const baseHash = text(record.baseHash, 128);
    if (!baseHash) return null;
    return {
      itinerary: record.itinerary ?? null,
      baseHash,
      baseUpdatedAt: text(record.baseUpdatedAt, 60) ?? new Date(0).toISOString(),
    };
  },

  readCachedProposal: (tripId, materialRevision) =>
    readItineraryProposalCache(client, tripId, materialRevision),

  async stageProposal(input): Promise<StagedProposalRecord | null> {
    const { data, error } = await client.rpc('stage_itinerary_change', {
      p_trip_id: input.tripId,
      p_user_id: input.userId,
      p_source_proposal_id: input.sourceProposalId,
      p_material_revision: input.materialRevision,
      p_base_hash: input.baseHash,
      p_proposal: input.proposal,
      p_proposed_itinerary: input.proposedItinerary,
      p_diff: input.diff,
      p_blocking: input.validation.blocking,
      p_warnings: input.validation.warnings,
      p_applicable: input.validation.ok,
      p_expires_at: input.expiresAt,
    });
    const record = asRecord(data);
    if (error || record?.ok !== true) return null;
    const proposalId = text(record.proposalId, 80);
    if (!proposalId) return null;
    return {
      proposalId,
      tripId: input.tripId,
      materialRevision: input.materialRevision,
      baseHash: text(record.baseHash, 128) ?? input.baseHash,
      proposedHash: text(record.proposedHash, 128) ?? '',
      status: 'pending',
      expiresAt: text(record.expiresAt, 60) ?? input.expiresAt,
    };
  },

  async applyProposal(proposalId, userId): Promise<ApplyOutcome> {
    const { data, error } = await client.rpc('apply_itinerary_change', {
      p_proposal_id: proposalId,
      p_user_id: userId,
    });
    const record = asRecord(data);
    if (error || !record) return { ok: false, refusal: 'proposal-invalid' };
    if (record.ok !== true) return { ok: false, ...refusalOutcome(record) };
    const changeId = text(record.changeId, 80);
    if (!changeId) return { ok: false, refusal: 'proposal-invalid' };
    return {
      ok: true,
      changeId,
      beforeHash: text(record.beforeHash, 128) ?? '',
      afterHash: text(record.afterHash, 128) ?? '',
      itinerary: record.itinerary ?? null,
      alreadyApplied: record.alreadyApplied === true,
    };
  },

  async undoChange(changeId, userId): Promise<UndoOutcome> {
    const { data, error } = await client.rpc('undo_itinerary_change', {
      p_change_id: changeId,
      p_user_id: userId,
    });
    const record = asRecord(data);
    if (error || !record) return { ok: false, refusal: 'change-not-undoable' };
    if (record.ok !== true) return { ok: false, ...refusalOutcome(record) };
    const id = text(record.changeId, 80);
    if (!id) return { ok: false, refusal: 'change-not-undoable' };
    return {
      ok: true,
      changeId: id,
      itinerary: record.itinerary ?? null,
      alreadyUndone: record.alreadyUndone === true,
    };
  },

  now: () => Date.now(),
});

/**
 * Service-role read of history metadata + the staged proposal diff.
 *
 * Snapshots and hashes stay in the database. The join is inner because every
 * history row is bound to a proposal; a missing proposal would have cascaded.
 * The embed names `itinerary_change_history_proposal_id_fkey` because the two
 * tables also share `itinerary_change_proposals_resulting_change_fk`.
 */
const historyDeps = (client: SupabaseClient): HistoryDeps => ({
  async readHistory(tripId, userId, limit): Promise<HistoryRecord[] | null> {
    const { data, error } = await client
      .from('itinerary_change_history')
      .select(HISTORY_DIFF_SELECT)
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .order('applied_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('itinerary-change history read failed', error.code ?? 'unknown');
      return null;
    }
    return (Array.isArray(data) ? data : [])
      .map(historyRecordFromAuthorityRow)
      .filter((entry): entry is HistoryRecord => entry !== null);
  },
});

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Identity from the verified token only. A client-supplied user id is never
  // read here, so ownership cannot be asserted by the caller.
  const authentication = await authenticateRequest(request);
  if (authentication.ok === false) return json({ error: authentication.detail }, authentication.status);
  const userId = authentication.caller.userId;

  const body = (await request.json().catch(() => ({}))) as ChangeBody;
  const operation = text(body.operation, 20);
  if (operation !== 'stage' && operation !== 'apply' && operation !== 'undo' && operation !== 'history') {
    return json({ error: 'Unknown operation. Allowed: stage, apply, undo, history.' }, 400);
  }

  const client = serviceClient();
  if (!client) return json({ error: 'The itinerary write boundary is not configured.' }, 503);

  if (operation === 'history') {
    const tripId = text(body.tripId, 180);
    if (!tripId) return json({ error: 'A tripId is required.' }, 400);

    /**
     * Ownership before any history row is read. `readOwnedTrip` queries by trip
     * and verified user together, so a missing trip and somebody else's trip
     * are refused identically.
     */
    const trip = await readOwnedTrip(client, tripId, userId);
    if (trip.kind === 'error') return json({ error: 'The trip could not be read.' }, 503);
    if (trip.kind === 'missing') return json({ error: 'Trip not found.' }, 404);

    const listed = await listItineraryChangeHistory(trip.tripId, userId, historyDeps(client));
    if (!listed.ok) {
      return json({ operation, error: listed.detail }, REFUSAL_STATUS[listed.refusal] ?? 503);
    }
    return json({
      operation,
      tripId: trip.tripId,
      changes: listed.changes,
    });
  }

  const deps = changeDeps(client);

  if (operation === 'stage') {
    const tripId = text(body.tripId, 180);
    if (!tripId) return json({ error: 'A tripId is required.' }, 400);

    /**
     * Which plan the traveller was looking at. Names a proposal rather than
     * carrying one: the server loads its own stored copy and refuses if that
     * copy is not the one named, so a plan regenerated in another tab can never
     * be the thing that gets authorised here.
     */
    const sourceProposalId = text(body.sourceProposalId, 180);
    const materialRevision = text(body.materialRevision, 180);
    if (!sourceProposalId || !materialRevision) {
      return json({ error: 'A reviewed proposal is required.' }, 400);
    }

    /**
     * Ownership before anything is read or staged. `readOwnedTrip` queries by
     * trip and verified user together, so a missing trip and somebody else's
     * trip are refused identically.
     */
    const trip = await readOwnedTrip(client, tripId, userId);
    if (trip.kind === 'error') return json({ error: 'The trip could not be read.' }, 503);
    if (trip.kind === 'missing') return json({ error: 'Trip not found.' }, 404);

    const staged = await stageItineraryChange(trip.tripId, userId, deps, { proposalId: sourceProposalId, materialRevision });
    if (!staged.ok) {
      return json({ operation, refusal: staged.refusal, detail: staged.detail }, REFUSAL_STATUS[staged.refusal] ?? 409);
    }
    return json({
      operation,
      tripId: trip.tripId,
      proposalId: staged.proposal.proposalId,
      materialRevision: staged.proposal.materialRevision,
      baseHash: staged.proposal.baseHash,
      proposedHash: staged.proposal.proposedHash,
      expiresAt: staged.proposal.expiresAt,
      applicable: staged.applicable,
      blocking: staged.blocking,
      warnings: staged.warnings,
      diff: staged.diff,
      /** Stated rather than implied: staging authorises a write, it is not one. */
      applied: false,
    });
  }

  if (operation === 'apply') {
    const proposalId = text(body.proposalId, 80);
    if (!proposalId) return json({ error: 'A proposalId is required.' }, 400);

    const result = await applyItineraryChange(proposalId, userId, deps);
    if (!result.ok) {
      return json({ operation, refusal: result.refusal, detail: result.detail }, REFUSAL_STATUS[result.refusal] ?? 409);
    }
    return json({
      operation,
      applied: true,
      changeId: result.changeId,
      beforeHash: result.beforeHash,
      afterHash: result.afterHash,
      itinerary: result.itinerary,
      /** True when this confirmation was a retry of one already completed. */
      alreadyApplied: result.alreadyApplied,
    });
  }

  const changeId = text(body.changeId, 80);
  if (!changeId) return json({ error: 'A changeId is required.' }, 400);

  const result = await undoItineraryChange(changeId, userId, deps);
  if (!result.ok) {
    return json({ operation, refusal: result.refusal, detail: result.detail }, REFUSAL_STATUS[result.refusal] ?? 409);
  }
  return json({
    operation,
    undone: true,
    changeId: result.changeId,
    itinerary: result.itinerary,
    alreadyUndone: result.alreadyUndone,
  });
});

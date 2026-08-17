/** Client transport for the Phase 2B write boundary and its read-only history. */
import { invokeTravelFunction } from './supabase';
import { sanitizeItinerary } from './itinerarySanitize';
import type { Itinerary } from '../data';
import type { ItineraryChangeDiff } from '../../supabase/functions/_shared/itineraryChange';
import {
  presentHistoryRecord,
  type ItineraryHistoryItem,
} from '../../supabase/functions/_shared/itineraryChangeHistory';

export type ChangeRefusalCode =
  | 'proposal-stale'
  | 'proposal-expired'
  | 'proposal-not-pending'
  | 'proposal-blocked'
  | 'proposal-invalid'
  | 'undo-stale'
  | 'change-not-undoable'
  | 'trip-not-found'
  | 'storage-failed'
  | 'unavailable';

export interface StagedChange {
  proposalId: string;
  expiresAt: string;
  applicable: boolean;
  blocking: string[];
  warnings: string[];
  diff: ItineraryChangeDiff;
}

export type StageChangeResult =
  | { ok: true; staged: StagedChange }
  | { ok: false; refusal: ChangeRefusalCode; detail: string };

export type ApplyChangeResult =
  | { ok: true; changeId: string; itinerary: Itinerary; alreadyApplied: boolean }
  | { ok: false; refusal: ChangeRefusalCode; detail: string };

export type UndoChangeResult =
  | { ok: true; changeId: string; itinerary: Itinerary; alreadyUndone: boolean }
  | { ok: false; refusal: ChangeRefusalCode; detail: string };

export type HistoryChangeResult =
  | { ok: true; changes: ItineraryHistoryItem[] }
  | { ok: false; refusal: ChangeRefusalCode; detail: string };

export type { ItineraryHistoryItem };

type Invoke = (name: string, body: unknown) => Promise<unknown>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const text = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const strings = (value: unknown, max = 20): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, max)
    : [];

const REFUSALS: ChangeRefusalCode[] = [
  'proposal-stale', 'proposal-expired', 'proposal-not-pending', 'proposal-blocked',
  'proposal-invalid', 'undo-stale', 'change-not-undoable', 'trip-not-found', 'storage-failed',
];

const refusalOf = (value: unknown): ChangeRefusalCode =>
  REFUSALS.find((entry) => entry === value) ?? 'unavailable';

const failure = (envelope: Record<string, unknown>, fallback: string) => ({
  ok: false as const,
  refusal: refusalOf(envelope.refusal),
  detail: text(envelope.detail) ?? text(envelope.error) ?? fallback,
});

/**
 * The returned itinerary is the authoritative post-write state, so it replaces
 * local state wholesale. It still goes through `sanitizeItinerary`: the write
 * path is trusted, the transport is not, and adopting an unsanitised object
 * would let one malformed field reach every screen.
 */
const adopt = (value: unknown, fallback: Itinerary): Itinerary => sanitizeItinerary(value, fallback);

/**
 * Ask the server to bind the exact reviewed proposal to the trip's current state.
 *
 * `reviewed` names the plan on screen — its ID and the material revision it was
 * built from. It never carries the plan itself: the server holds its own copy
 * and refuses if that copy is not the one named, which is what stops a proposal
 * regenerated elsewhere from being authorised in its place.
 */
export async function stageItineraryChange(
  tripId: string,
  reviewed: { proposalId: string; materialRevision: string },
  invoke: Invoke = invokeTravelFunction,
): Promise<StageChangeResult> {
  if (!tripId) return { ok: false, refusal: 'trip-not-found', detail: 'A trip is required.' };
  if (!reviewed?.proposalId || !reviewed?.materialRevision) {
    return { ok: false, refusal: 'proposal-invalid', detail: 'A reviewed plan is required.' };
  }
  try {
    const envelope = record(await invoke('itinerary-change', {
      operation: 'stage',
      tripId,
      sourceProposalId: reviewed.proposalId,
      materialRevision: reviewed.materialRevision,
    }));
    const proposalId = text(envelope.proposalId, 80);
    if (!proposalId) return failure(envelope, 'The plan could not be prepared for saving.');
    return {
      ok: true,
      staged: {
        proposalId,
        expiresAt: text(envelope.expiresAt, 60) ?? '',
        applicable: envelope.applicable === true,
        blocking: strings(envelope.blocking),
        warnings: strings(envelope.warnings),
        diff: record(envelope.diff) as unknown as ItineraryChangeDiff,
      },
    };
  } catch (error) {
    return {
      ok: false,
      refusal: 'unavailable',
      detail: error instanceof Error ? error.message : 'The itinerary writer is unavailable.',
    };
  }
}

/**
 * Confirm the staged write. Sends only the proposal ID — never itinerary
 * content — so there is nothing here for a tampered request to steer.
 */
export async function applyItineraryChange(
  proposalId: string,
  fallback: Itinerary,
  invoke: Invoke = invokeTravelFunction,
): Promise<ApplyChangeResult> {
  if (!proposalId) return { ok: false, refusal: 'proposal-invalid', detail: 'A prepared plan is required.' };
  try {
    const envelope = record(await invoke('itinerary-change', { operation: 'apply', proposalId }));
    const changeId = text(envelope.changeId, 80);
    if (envelope.applied !== true || !changeId) return failure(envelope, 'The plan was not applied.');
    return {
      ok: true,
      changeId,
      itinerary: adopt(envelope.itinerary, fallback),
      alreadyApplied: envelope.alreadyApplied === true,
    };
  } catch (error) {
    return {
      ok: false,
      refusal: 'unavailable',
      detail: error instanceof Error ? error.message : 'The itinerary writer is unavailable.',
    };
  }
}

/** Restore the snapshot taken before an applied change. */
export async function undoItineraryChange(
  changeId: string,
  fallback: Itinerary,
  invoke: Invoke = invokeTravelFunction,
): Promise<UndoChangeResult> {
  if (!changeId) return { ok: false, refusal: 'change-not-undoable', detail: 'A change is required.' };
  try {
    const envelope = record(await invoke('itinerary-change', { operation: 'undo', changeId }));
    const id = text(envelope.changeId, 80);
    if (envelope.undone !== true || !id) return failure(envelope, 'The change was not undone.');
    return {
      ok: true,
      changeId: id,
      itinerary: adopt(envelope.itinerary, fallback),
      alreadyUndone: envelope.alreadyUndone === true,
    };
  } catch (error) {
    return {
      ok: false,
      refusal: 'unavailable',
      detail: error instanceof Error ? error.message : 'The itinerary writer is unavailable.',
    };
  }
}

/**
 * Load the traveller-facing plan-change history for an owned trip.
 *
 * Identifiers only go out; snapshots and hashes never come back. Transport
 * failures become a generic refusal so a database diagnostic cannot reach the UI.
 */
export async function listItineraryChangeHistory(
  tripId: string,
  invoke: Invoke = invokeTravelFunction,
): Promise<HistoryChangeResult> {
  if (!tripId) return { ok: false, refusal: 'trip-not-found', detail: 'A trip is required.' };
  try {
    const envelope = record(await invoke('itinerary-change', { operation: 'history', tripId }));
    if (Array.isArray(envelope.changes) || envelope.operation === 'history') {
      const changes = (Array.isArray(envelope.changes) ? envelope.changes : [])
        .flatMap((entry) => {
          const row = record(entry);
          const item = presentHistoryRecord({
            id: text(row.id, 80) ?? '',
            status: text(row.status, 20) ?? '',
            appliedAt: text(row.appliedAt, 60) ?? '',
            undoneAt: text(row.undoneAt, 60) ?? null,
            diff: row.diff,
          });
          return item ? [item] : [];
        });
      return { ok: true, changes };
    }
    return {
      ok: false,
      refusal: refusalOf(envelope.refusal),
      detail: 'Plan changes could not be loaded.',
    };
  } catch {
    return {
      ok: false,
      refusal: 'unavailable',
      detail: 'Plan changes could not be loaded.',
    };
  }
}

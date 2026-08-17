/**
 * The Phase 2B write boundary.
 *
 * Two kinds of test live here. Most run the real service against an in-memory
 * database that models the SQL functions' contract — status transitions, the
 * base-hash compare-and-swap, one history row per proposal, idempotent retries.
 * The rest read the Edge Function's own source to pin structural properties
 * that no runtime test can prove from outside: that identity is established
 * before anything is read, that a client-supplied user id is never trusted, and
 * that no model can be reached from the confirm path at all.
 *
 * What these do NOT prove: that the deployed PL/pgSQL behaves as modelled. That
 * needs a real PostgreSQL, which is not available on this machine.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyItineraryChange,
  stageItineraryChange,
  undoItineraryChange,
  type ApplyOutcome,
  type ChangeDeps,
  type UndoOutcome,
} from '../../supabase/functions/_shared/itineraryChangeService';
import {
  applyProposalToItinerary,
  canonicalFingerprint,
  canonicalJson,
  diffItineraries,
} from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  type RouteMatrixLeg,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';

const place = (id: string, name: string, coordinates: [number, number]) => ({
  id,
  kind: 'place',
  time: '09:00',
  durationMinutes: 90,
  name,
  description: `${name} description`,
  type: 'sight',
  location: 'Chuo',
  provider: 'osm',
  providerPlaceId: id.replace('discovered-osm-', ''),
  coordinates,
  openingHoursWeek: [{ opensAt: '09:00', closesAt: '20:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  sourceReferences: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${id}` }],
  lockedFields: [],
});

const tripFixture = () => ({
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
  revision: 2,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested' },
  },
  days: [
    {
      day: 1,
      date: '2026-08-17',
      city: 'Osaka',
      title: 'Day one',
      activities: [
        place('discovered-osm-n1', 'Glico Man Sign', [34.6687, 135.5013]),
        place('discovered-osm-n2', 'Kuromon Ichiba Market', [34.6653, 135.5062]),
      ],
    },
  ],
});

const matrix = (ids: string[]): RouteMatrixLeg[] => ids.flatMap((from) => ids.flatMap((to) => from === to ? [] : [{
  fromPlaceId: from,
  toPlaceId: to,
  status: 'ok' as const,
  durationMinutes: 11,
  distanceMeters: 900,
  mode: 'walking' as const,
  requestedMode: 'walking' as const,
  providerMode: 'foot-walking',
  provider: 'openrouteservice',
  source: 'provider' as const,
}]));

const proposalFor = async (
  itinerary: Record<string, unknown>,
  composition?: { days: Array<{ day: number; placeIds: string[] }> },
): Promise<TripItineraryProposal> => {
  const material = await buildPlanningMaterial('trip-1', itinerary);
  const ids = material.places.map((entry) => entry.id);
  return runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue(composition ?? { days: [{ day: 1, placeIds: ids }] }),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(ids)),
    now: () => '2026-08-17T08:00:00.000Z',
  });
};

// ---------------------------------------------------------------------------
// An in-memory model of the SQL write boundary
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  userId: string;
  tripId: string;
  materialRevision: string;
  baseHash: string;
  proposal: TripItineraryProposal;
  proposedItinerary: unknown;
  proposedHash: string;
  applicable: boolean;
  status: 'pending' | 'applied' | 'stale' | 'expired' | 'cancelled';
  expiresAt: number;
  resultingChangeId?: string;
}

interface ChangeRow {
  id: string;
  proposalId: string;
  userId: string;
  tripId: string;
  beforeHash: string;
  afterHash: string;
  beforeItinerary: unknown;
  afterItinerary: unknown;
  status: 'applied' | 'undone';
}

class FakeChangeDatabase {
  itineraries = new Map<string, { userId: string; data: unknown }>();
  proposals: ProposalRow[] = [];
  history: ChangeRow[] = [];
  cache = new Map<string, TripItineraryProposal>();
  clock = Date.parse('2026-08-17T09:00:00.000Z');
  writes = 0;
  private sequence = 0;

  constructor(tripId: string, userId: string, data: unknown) {
    this.itineraries.set(tripId, { userId, data });
  }

  /** Mirrors `itinerary_state_hash`: a digest of the stored value itself. */
  private hash(value: unknown): string {
    return canonicalJson(value);
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  /** The database's own view, used by tests rather than by the service. */
  currentItinerary(tripId: string): unknown {
    return this.itineraries.get(tripId)?.data;
  }

  cacheProposal(tripId: string, proposal: TripItineraryProposal) {
    this.cache.set(`${tripId}:${proposal.materialRevision}`, proposal);
  }

  /** A concurrent save from another tab, or the traveller editing by hand. */
  externalEdit(tripId: string, mutate: (data: Record<string, unknown>) => void) {
    const row = this.itineraries.get(tripId)!;
    const next = JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>;
    mutate(next);
    row.data = next;
  }

  /** Identity is a per-call argument, never baked into the gateway. */
  deps(): ChangeDeps {
    return {
      readBase: async (tripId, callerId) => {
        const row = this.itineraries.get(tripId);
        // Trip and verified user together — never an existence oracle.
        if (!row || row.userId !== callerId) return null;
        return { itinerary: row.data, baseHash: this.hash(row.data), baseUpdatedAt: '2026-08-17T08:00:00.000Z' };
      },

      readCachedProposal: async (tripId, materialRevision) =>
        this.cache.get(`${tripId}:${materialRevision}`) ?? null,

      stageProposal: async (input) => {
        const row = this.itineraries.get(input.tripId);
        if (!row || row.userId !== input.userId) return null;
        if (this.hash(row.data) !== input.baseHash) return null;
        for (const proposal of this.proposals) {
          if (proposal.tripId === input.tripId && proposal.status === 'pending') proposal.status = 'cancelled';
        }
        const staged: ProposalRow = {
          id: this.id('proposal'),
          userId: input.userId,
          tripId: input.tripId,
          materialRevision: input.materialRevision,
          baseHash: input.baseHash,
          proposal: input.proposal,
          proposedItinerary: input.proposedItinerary,
          proposedHash: this.hash(input.proposedItinerary),
          applicable: input.validation.ok,
          status: 'pending',
          expiresAt: Date.parse(input.expiresAt),
        };
        this.proposals.push(staged);
        return {
          proposalId: staged.id,
          tripId: staged.tripId,
          materialRevision: staged.materialRevision,
          baseHash: staged.baseHash,
          proposedHash: staged.proposedHash,
          status: 'pending',
          expiresAt: input.expiresAt,
        };
      },

      applyProposal: async (proposalId, callerId): Promise<ApplyOutcome> => {
        const staged = this.proposals.find((entry) => entry.id === proposalId && entry.userId === callerId);
        if (!staged) return { ok: false, refusal: 'proposal-invalid' };

        if (staged.status === 'applied') {
          const change = this.history.find((entry) => entry.proposalId === staged.id);
          if (!change) return { ok: false, refusal: 'proposal-invalid' };
          return {
            ok: true,
            changeId: change.id,
            beforeHash: change.beforeHash,
            afterHash: change.afterHash,
            itinerary: change.afterItinerary,
            alreadyApplied: true,
          };
        }
        if (staged.status !== 'pending') return { ok: false, refusal: 'proposal-not-pending' };
        if (staged.expiresAt <= this.clock) {
          staged.status = 'expired';
          return { ok: false, refusal: 'proposal-expired' };
        }
        if (!staged.applicable) return { ok: false, refusal: 'proposal-blocked' };

        const row = this.itineraries.get(staged.tripId);
        if (!row || row.userId !== callerId) return { ok: false, refusal: 'proposal-invalid' };

        const currentHash = this.hash(row.data);
        if (currentHash !== staged.baseHash) {
          staged.status = 'stale';
          return { ok: false, refusal: 'proposal-stale' };
        }

        const before = row.data;
        row.data = JSON.parse(JSON.stringify(staged.proposedItinerary));
        this.writes += 1;
        const change: ChangeRow = {
          id: this.id('change'),
          proposalId: staged.id,
          userId: callerId,
          tripId: staged.tripId,
          beforeHash: currentHash,
          afterHash: this.hash(row.data),
          beforeItinerary: before,
          afterItinerary: JSON.parse(JSON.stringify(row.data)),
          status: 'applied',
        };
        // The unique constraint on proposal_id, modelled.
        if (this.history.some((entry) => entry.proposalId === staged.id)) {
          throw new Error('duplicate history row for one proposal');
        }
        this.history.push(change);
        staged.status = 'applied';
        staged.resultingChangeId = change.id;
        return {
          ok: true,
          changeId: change.id,
          beforeHash: change.beforeHash,
          afterHash: change.afterHash,
          itinerary: change.afterItinerary,
          alreadyApplied: false,
        };
      },

      undoChange: async (changeId, callerId): Promise<UndoOutcome> => {
        const change = this.history.find((entry) => entry.id === changeId && entry.userId === callerId);
        if (!change) return { ok: false, refusal: 'change-not-undoable' };
        const row = this.itineraries.get(change.tripId);

        // A retry writes nothing and answers with the live row, never the
        // snapshot — the snapshot's revision is older than what is committed.
        if (change.status === 'undone') {
          if (!row || row.userId !== callerId) return { ok: false, refusal: 'change-not-undoable' };
          return { ok: true, changeId: change.id, itinerary: row.data, alreadyUndone: true };
        }
        if (!row || row.userId !== callerId) return { ok: false, refusal: 'change-not-undoable' };
        if (this.hash(row.data) !== change.afterHash) return { ok: false, refusal: 'undo-stale' };

        // Content from the snapshot, ordering from the row being undone.
        const current = row.data as { revision?: unknown };
        const currentRevision = typeof current?.revision === 'number' && Number.isFinite(current.revision)
          ? Math.max(0, Math.floor(current.revision))
          : 0;
        const restored = JSON.parse(JSON.stringify(change.beforeItinerary)) as Record<string, unknown>;
        restored.revision = currentRevision + 1;

        row.data = restored;
        this.writes += 1;
        change.status = 'undone';
        return { ok: true, changeId: change.id, itinerary: restored, alreadyUndone: false };
      },

      now: () => this.clock,
    };
  }
}

/** Everything a traveller can see — the ordering counter deliberately excluded. */
const withoutRevision = (itinerary: unknown): Record<string, unknown> => {
  const copy = { ...(itinerary ?? {}) as Record<string, unknown> };
  delete copy.revision;
  return copy;
};

const revisionOf = (itinerary: unknown): number => {
  const value = (itinerary as { revision?: unknown } | null)?.revision;
  return typeof value === 'number' ? value : 0;
};

/** Name a proposal the way the panel does: by what is on screen. */
const reviewed = (proposal: TripItineraryProposal) => ({
  proposalId: proposal.id,
  materialRevision: proposal.materialRevision,
});

const stagedTrip = async (composition?: { days: Array<{ day: number; placeIds: string[] }> }) => {
  const itinerary = tripFixture();
  const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
  const proposal = await proposalFor(itinerary, composition);
  database.cacheProposal('trip-1', proposal);
  const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(proposal));
  return { database, proposal, staged };
};

describe('Phase 2B write boundary', () => {
  it('stages an immutable result bound to the trip’s current base', async () => {
    const { staged, database } = await stagedTrip();
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    expect(staged.applicable).toBe(true);
    expect(staged.proposal.baseHash).toBe(canonicalJson(tripFixture()));
    expect(database.proposals).toHaveLength(1);
    // Staging authorises a write; it does not perform one.
    expect(database.writes).toBe(0);
    expect(database.currentItinerary('trip-1')).toEqual(tripFixture());
  });

  it('refuses to stage when the trip changed after the proposal was made', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const original = await proposalFor(itinerary);
    database.cacheProposal('trip-1', original);
    // A new place changes the planning material, so the cached proposal no
    // longer describes this trip and cannot be reached at all.
    database.externalEdit('trip-1', (data) => {
      (data.days as Array<{ activities: unknown[] }>)[0].activities.push(
        place('discovered-osm-n9', 'Shinsekai', [34.6524, 135.5063]),
      );
    });

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(original));
    expect(staged).toMatchObject({ ok: false, refusal: 'proposal-stale' });
  });

  it('refuses to stage a trip the caller does not own', async () => {
    const { database, proposal } = await stagedTrip();
    const staged = await stageItineraryChange('trip-1', STRANGER, database.deps(), reviewed(proposal));

    expect(staged).toMatchObject({ ok: false, refusal: 'trip-not-found' });
  });

  it('writes exactly the stored result and records one history row', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const stored = database.proposals[0].proposedItinerary;

    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    expect(canonicalJson(database.currentItinerary('trip-1'))).toBe(canonicalJson(stored));
    expect(canonicalJson(applied.itinerary)).toBe(canonicalJson(stored));
    expect(database.history).toHaveLength(1);
    expect(database.history[0]).toMatchObject({ proposalId: staged.proposal.proposalId, status: 'applied' });
    expect(applied.beforeHash).toBe(canonicalJson(tripFixture()));
    expect(applied.afterHash).toBe(canonicalJson(stored));
  });

  it('takes no itinerary content from the caller', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const deps = database.deps();
    const spy = vi.spyOn(deps, 'applyProposal');

    await applyItineraryChange(staged.proposal.proposalId, OWNER, deps);

    // The whole request surface is an ID and an identity. There is no
    // parameter a tampered client could put itinerary JSON into.
    expect(spy).toHaveBeenCalledWith(staged.proposal.proposalId, OWNER);
    expect(applyItineraryChange).toHaveLength(3);
  });

  it('refuses a proposal belonging to another user', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');

    const applied = await applyItineraryChange(staged.proposal.proposalId, STRANGER, database.deps());

    expect(applied).toMatchObject({ ok: false, refusal: 'proposal-invalid' });
    expect(database.writes).toBe(0);
    expect(database.currentItinerary('trip-1')).toEqual(tripFixture());
  });

  it('refuses when the itinerary moved between staging and confirming', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    database.externalEdit('trip-1', (data) => { data.name = 'Renamed while reviewing'; });

    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());

    expect(applied).toMatchObject({ ok: false, refusal: 'proposal-stale' });
    expect(database.writes).toBe(0);
    expect((database.currentItinerary('trip-1') as { name: string }).name).toBe('Renamed while reviewing');
    // A stale authorisation is spent, not left lying around to be retried.
    expect(database.proposals[0].status).toBe('stale');
  });

  it('refuses an expired authorisation', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    database.clock += 31 * 60_000;

    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());

    expect(applied).toMatchObject({ ok: false, refusal: 'proposal-expired' });
    expect(database.writes).toBe(0);
  });

  it('refuses to apply a plan with a blocking conflict', async () => {
    // A composition that omits the Must do leaves an error conflict behind.
    const { database, staged } = await stagedTrip({ days: [{ day: 1, placeIds: ['discovered-osm-n2'] }] });
    if (!staged.ok) throw new Error('staging failed');

    expect(staged.applicable).toBe(false);
    expect(staged.blocking.length).toBeGreaterThan(0);

    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    expect(applied).toMatchObject({ ok: false, refusal: 'proposal-blocked' });
    expect(database.writes).toBe(0);
  });

  it('refuses an unknown proposal without saying whether it exists', async () => {
    const { database } = await stagedTrip();
    const applied = await applyItineraryChange('proposal-does-not-exist', OWNER, database.deps());

    expect(applied).toMatchObject({ ok: false, refusal: 'proposal-invalid' });
    expect(database.writes).toBe(0);
  });

  it('treats a retried confirmation as the same single write', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');

    const first = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    const retry = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());

    expect(first.ok && retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(retry.changeId).toBe(first.changeId);
    expect(retry.alreadyApplied).toBe(true);
    expect(database.writes).toBe(1);
    expect(database.history).toHaveLength(1);
  });

  it('restores the exact snapshot on undo, apart from the version counter', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const before = database.currentItinerary('trip-1');

    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');
    expect(canonicalJson(database.currentItinerary('trip-1'))).not.toBe(canonicalJson(before));

    const undone = await undoItineraryChange(applied.changeId, OWNER, database.deps());
    const after = database.currentItinerary('trip-1');

    expect(undone.ok).toBe(true);
    // Every field the traveller can see comes back exactly...
    expect(withoutRevision(after)).toEqual(withoutRevision(before));
    // ...and the counter that orders writes across devices moves forward.
    expect(revisionOf(after)).toBe(revisionOf(before) + 2);
    // History is a record, not a workspace: the row survives the undo.
    expect(database.history).toHaveLength(1);
    expect(database.history[0].status).toBe('undone');
  });

  it('treats a retried undo as the same single restore', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');

    await undoItineraryChange(applied.changeId, OWNER, database.deps());
    const writesAfterFirst = database.writes;
    const retry = await undoItineraryChange(applied.changeId, OWNER, database.deps());

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.alreadyUndone).toBe(true);
    expect(database.writes).toBe(writesAfterFirst);
  });

  it('answers a lost-response retry with the committed state, not the snapshot', async () => {
    /**
     * The first undo commits revision 7 and its HTTP response is lost. The
     * client retries. Returning `before_itinerary` here would hand back revision
     * 5 over a database at 7 and recreate the ordering defect on the client.
     */
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');

    const first = await undoItineraryChange(applied.changeId, OWNER, database.deps());
    if (!first.ok) throw new Error('undo failed');
    const committed = revisionOf(database.currentItinerary('trip-1'));

    const retry = await undoItineraryChange(applied.changeId, OWNER, database.deps());

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.alreadyUndone).toBe(true);
    expect(revisionOf(retry.itinerary)).toBe(committed);
    expect(revisionOf(retry.itinerary)).toBeGreaterThan(revisionOf(applied.itinerary));
  });

  it('does not let a retry paper over an edit made after the undo', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');
    await undoItineraryChange(applied.changeId, OWNER, database.deps());

    // The traveller edits, the way `handleItineraryChange` would.
    database.externalEdit('trip-1', (data) => {
      data.name = 'Edited after undo';
      data.revision = revisionOf(data) + 1;
    });
    const writesBefore = database.writes;

    const retry = await undoItineraryChange(applied.changeId, OWNER, database.deps());

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(database.writes).toBe(writesBefore);
    expect((retry.itinerary as { name: string }).name).toBe('Edited after undo');
    expect(revisionOf(retry.itinerary)).toBe(revisionOf(database.currentItinerary('trip-1')));
    expect((database.currentItinerary('trip-1') as { name: string }).name).toBe('Edited after undo');
  });

  it('refuses to undo over a newer edit', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');

    database.externalEdit('trip-1', (data) => { data.name = 'Edited after applying'; });
    const undone = await undoItineraryChange(applied.changeId, OWNER, database.deps());

    expect(undone).toMatchObject({ ok: false, refusal: 'undo-stale' });
    expect((database.currentItinerary('trip-1') as { name: string }).name).toBe('Edited after applying');
  });

  it('refuses to undo somebody else’s change', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const applied = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    if (!applied.ok) throw new Error('apply failed');
    const afterApply = canonicalJson(database.currentItinerary('trip-1'));

    const undone = await undoItineraryChange(applied.changeId, STRANGER, database.deps());

    expect(undone).toMatchObject({ ok: false, refusal: 'change-not-undoable' });
    expect(canonicalJson(database.currentItinerary('trip-1'))).toBe(afterApply);
  });

  it('keeps a Must do through staging and the applied result', async () => {
    const { database, staged, proposal } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');

    expect(staged.diff.preservedMustDo.map((entry) => entry.name)).toContain('Glico Man Sign');

    await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    const written = database.currentItinerary('trip-1') as { days: Array<{ activities: Array<{ id: string }> }> };
    const ids = written.days.flatMap((day) => day.activities.map((activity) => activity.id));

    expect(ids).toContain('discovered-osm-n1');
    expect(proposal.conflicts.filter((conflict) => conflict.severity === 'error')).toEqual([]);
  });

  it('rebinds a cache hit to the current base rather than trusting the cache row', async () => {
    const { database, staged, proposal } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');

    // Same cached proposal, staged a second time after a real base change is
    // ruled out: the second authorisation is a new row bound to a fresh read,
    // and the first is cancelled rather than left applicable.
    const again = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(proposal));
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.proposal.proposalId).not.toBe(staged.proposal.proposalId);
    expect(database.proposals[0].status).toBe('cancelled');

    const stale = await applyItineraryChange(staged.proposal.proposalId, OWNER, database.deps());
    expect(stale).toMatchObject({ ok: false, refusal: 'proposal-not-pending' });
  });

  it('stages the proposal that was reviewed, not the newest one for the trip', async () => {
    /**
     * The cache is keyed by trip and material revision, so regenerating with an
     * unchanged trip *overwrites* the reviewed plan in place. Without a check on
     * the plan's own identity, "the proposal for this trip" would quietly become
     * one nobody looked at.
     */
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposalA = await proposalFor(itinerary, { days: [{ day: 1, placeIds: ['discovered-osm-n1', 'discovered-osm-n2'] }] });
    database.cacheProposal('trip-1', proposalA);

    // Another tab regenerates. Same trip, same material, a different plan.
    const proposalB = await proposalFor(itinerary, { days: [{ day: 1, placeIds: ['discovered-osm-n2', 'discovered-osm-n1'] }] });
    expect(proposalB.id).not.toBe(proposalA.id);
    database.cacheProposal('trip-1', proposalB);

    // Tab A is still showing A, and asks to apply A.
    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(proposalA));

    expect(staged).toMatchObject({ ok: false, refusal: 'proposal-stale' });
    expect(database.proposals).toHaveLength(0);
    expect(database.writes).toBe(0);
  });

  it('stages the reviewed proposal while it is still the stored one', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposalA = await proposalFor(itinerary);
    database.cacheProposal('trip-1', proposalA);

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(proposalA));

    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(database.proposals[0].proposal.id).toBe(proposalA.id);
  });

  it('derives the staged identity from the plan itself', async () => {
    /**
     * Two runs producing byte-identical plans share an identity, so staging
     * either stages what was reviewed. The full digest matters here: this ID is
     * compared for equality as an authorisation check, so a short
     * non-cryptographic hash would make "the plan you reviewed" a probabilistic
     * claim. See `proposalFingerprint.test.ts` for what moves it.
     */
    const itinerary = tripFixture();
    const first = await proposalFor(itinerary);
    const second = await proposalFor(itinerary);

    expect(second.id).toBe(first.id);
    expect(first.id).toMatch(/^proposal-[0-9a-f]{64}$/);
  });

  it('refuses a proposal identity that does not exist', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposal = await proposalFor(itinerary);
    database.cacheProposal('trip-1', proposal);

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), {
      proposalId: 'proposal-never-existed',
      materialRevision: proposal.materialRevision,
    });

    expect(staged).toMatchObject({ ok: false, refusal: 'proposal-stale' });
    expect(database.proposals).toHaveLength(0);
  });

  it('refuses a proposal identity from another trip', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    database.cacheProposal('trip-1', await proposalFor(itinerary));
    // A real proposal — for a different trip, so its material revision and ID
    // belong to material this trip never produced.
    const otherTrip = { ...tripFixture(), id: 'trip-2', name: 'Kyoto only', cities: ['Kyoto'] };
    const foreign = await proposalFor(otherTrip);

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), reviewed(foreign));

    expect(staged).toMatchObject({ ok: false, refusal: 'proposal-stale' });
    expect(database.proposals).toHaveLength(0);
  });

  it('refuses a reviewed proposal when the caller does not own the trip', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposal = await proposalFor(itinerary);
    database.cacheProposal('trip-1', proposal);

    const staged = await stageItineraryChange('trip-1', STRANGER, database.deps(), reviewed(proposal));

    expect(staged).toMatchObject({ ok: false, refusal: 'trip-not-found' });
    expect(database.proposals).toHaveLength(0);
  });

  it('refuses a reviewed proposal whose material revision is no longer current', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposal = await proposalFor(itinerary);
    database.cacheProposal('trip-1', proposal);

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps(), {
      proposalId: proposal.id,
      materialRevision: 'plan-v1-fromanolderversionofthistrip',
    });

    expect(staged).toMatchObject({ ok: false, refusal: 'proposal-stale' });
    expect(database.proposals).toHaveLength(0);
  });

  it('takes no proposal content from the caller when staging', async () => {
    const itinerary = tripFixture();
    const database = new FakeChangeDatabase('trip-1', OWNER, itinerary);
    const proposal = await proposalFor(itinerary);
    database.cacheProposal('trip-1', proposal);
    const deps = database.deps();
    const readCached = vi.spyOn(deps, 'readCachedProposal');

    const staged = await stageItineraryChange('trip-1', OWNER, database.deps.call(database), reviewed(proposal));
    expect(staged.ok).toBe(true);

    // The service resolves the plan from storage; the reference is two strings.
    await stageItineraryChange('trip-1', OWNER, deps, reviewed(proposal));
    expect(readCached).toHaveBeenCalledWith('trip-1', proposal.materialRevision);
    expect(database.proposals.every((row) => row.proposal.id === proposal.id)).toBe(true);
  });

  it('stages a diff that matches the result that will actually be written', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');

    const expected = diffItineraries(
      tripFixture(),
      applyProposalToItinerary(tripFixture(), database.proposals[0].proposal).itinerary,
      database.proposals[0].proposal,
    );
    expect(staged.diff).toEqual(expected);
  });

  it('binds the staged result to a stable fingerprint', async () => {
    const { database, staged } = await stagedTrip();
    if (!staged.ok) throw new Error('staging failed');
    const stored = database.proposals[0].proposedItinerary;

    expect(await canonicalFingerprint(stored))
      .toBe(await canonicalFingerprint(applyProposalToItinerary(tripFixture(), database.proposals[0].proposal).itinerary));
  });
});

// ---------------------------------------------------------------------------
// Structural guarantees
// ---------------------------------------------------------------------------

const sourceOf = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/** Prose that mentions a model is fine; code that reaches one is not. */
const codeOf = (relative: string) => sourceOf(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('write boundary structure', () => {
  const handler = sourceOf('supabase/functions/itinerary-change/index.ts');
  const service = sourceOf('supabase/functions/_shared/itineraryChangeService.ts');

  it('authenticates before it reads or writes anything', () => {
    const authenticated = handler.indexOf('authenticateRequest(request)');
    expect(authenticated).toBeGreaterThan(-1);
    for (const call of ['serviceClient()', 'readOwnedTrip(', 'listItineraryChangeHistory(', 'stageItineraryChange(', 'applyItineraryChange(', 'undoItineraryChange(']) {
      expect(handler.indexOf(call)).toBeGreaterThan(authenticated);
    }
  });

  it('never reads an identity the client supplied', () => {
    expect(handler).not.toMatch(/body\s*\.\s*userId/);
    expect(handler).toMatch(/const userId = authentication\.caller\.userId/);
  });

  it('accepts no itinerary content from the client', () => {
    // The request body's entire shape, declared in one place. Every field is an
    // identifier; none of them can carry a plan or an itinerary.
    const body = handler.slice(handler.indexOf('interface ChangeBody {'));
    const fields = body.slice(0, body.indexOf('}')).match(/^\s*(\w+)\?:\s*(\w+);$/gm) ?? [];

    expect(fields.map((field) => field.trim())).toEqual([
      'operation?: string;',
      'tripId?: string;',
      'sourceProposalId?: string;',
      'materialRevision?: string;',
      'proposalId?: string;',
      'changeId?: string;',
    ]);
  });

  it('stages by a named proposal rather than by trip alone', () => {
    // A trip ID cannot say *which* plan was reviewed, so it is never enough.
    expect(handler).toMatch(/const sourceProposalId = text\(body\.sourceProposalId/);
    expect(handler).toMatch(/if \(!sourceProposalId \|\| !materialRevision\) \{/);
    expect(codeOf('supabase/functions/_shared/itineraryChangeService.ts'))
      .toMatch(/if \(proposal\.id !== reviewed\.proposalId\)/);
  });

  it('cannot reach a model from the confirm path', () => {
    // Not a promise about behaviour — there is no import to call.
    const files = [
      'supabase/functions/itinerary-change/index.ts',
      'supabase/functions/_shared/itineraryChangeService.ts',
      'supabase/functions/_shared/itineraryChange.ts',
      'supabase/functions/_shared/itineraryChangeHistory.ts',
    ];
    for (const file of files) {
      expect(codeOf(file)).not.toMatch(
        /reasoning|meteredModel|callModel|openai|OPENAI|reserveAiReasoningAttempt|ai_spend_ledger|SpendSession/,
      );
    }
  });

  it('reads history only after identity and ownership are proven', () => {
    const history = handler.indexOf("operation === 'history'");
    const owned = handler.indexOf('readOwnedTrip(', history);
    const listed = handler.indexOf('listItineraryChangeHistory(', history);
    expect(history).toBeGreaterThan(-1);
    expect(owned).toBeGreaterThan(history);
    expect(listed).toBeGreaterThan(owned);
    expect(handler).toContain(".from('itinerary_change_history')");
    expect(handler).toContain(".select('id, status, applied_at, undone_at, itinerary_change_proposals!inner(diff)')");
    expect(handler).not.toMatch(/before_itinerary|after_itinerary|before_hash|after_hash/);
  });

  it('never marks a proposal cache row as authorisation to write', () => {
    // The cache may be read for a proposal; it is never the thing applied.
    expect(handler).not.toMatch(/itinerary_proposal_cache/);
    expect(service).toMatch(/readCachedProposal/);
    expect(service).toMatch(/stageProposal/);
  });
});

describe('write boundary migration', () => {
  const migration = sourceOf('supabase/migrations/20260817090000_add_itinerary_change_boundary.sql');

  it('keeps both authority tables away from browser roles', () => {
    for (const table of ['itinerary_change_proposals', 'itinerary_change_history']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
      expect(migration).toMatch(new RegExp(`grant select, insert, update on table public\\.${table} to service_role`));
      // No mutation policy exists for a browser role, so RLS denies by default.
      expect(migration).not.toMatch(new RegExp(`create policy[\\s\\S]*on public\\.${table}[\\s\\S]*to authenticated`));
    }
  });

  it('locks every row it decides on', () => {
    for (const routine of ['apply_itinerary_change', 'undo_itinerary_change']) {
      const body = migration.slice(migration.indexOf(`function public.${routine}`));
      expect(body).toContain('for update');
    }
  });

  it('pins an explicit search path on every definer function', () => {
    const definers = migration.match(/security definer/g) ?? [];
    const paths = migration.match(/set search_path = public, pg_catalog, pg_temp/g) ?? [];
    expect(definers.length).toBeGreaterThan(0);
    expect(paths.length).toBe(definers.length);
  });

  it('grants execute only to the service role', () => {
    const grants = migration.match(/grant execute on function [^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant).toContain('to service_role');
    const revokes = migration.match(/revoke all on function [^;]+;/g) ?? [];
    expect(revokes.length).toBe(grants.length);
  });

  it('allows only one history row per proposal', () => {
    expect(migration).toMatch(/proposal_id uuid not null unique/);
  });
});

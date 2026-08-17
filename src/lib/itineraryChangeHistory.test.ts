/**
 * Read-only itinerary change history: summaries, sanitisation, ownership filter.
 *
 * No database and no model. The Edge Function's auth/ownership order is pinned
 * in itineraryChangeBoundary.test.ts; this file pins what a caller actually
 * receives after that gate.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  formatHistoryAppliedAt,
  historyDetailSections,
  historyRecordFromAuthorityRow,
  listItineraryChangeHistory,
  presentHistoryRecord,
  sanitizeHistoryDiff,
  summarizeItineraryChangeDiff,
  type HistoryDeps,
  type HistoryRecord,
  type PublicHistoryDiff,
} from '../../supabase/functions/_shared/itineraryChangeHistory';
import { listItineraryChangeHistory as fetchHistory } from './itineraryChangeClient';

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';

const emptyDiff = (): PublicHistoryDiff => ({
  added: [],
  removed: [],
  moved: [],
  retimed: [],
  durationChanged: [],
  travelChanged: [],
  windowsAdded: [],
  windowsRemoved: [],
  dayCounts: [],
  preservedMustDo: [],
  unscheduled: [],
  warnings: [],
  conflicts: [],
});

const retimedDiff = (): PublicHistoryDiff => ({
  ...emptyDiff(),
  retimed: [{ name: 'Glico Man Sign', fromTime: '10:25', toTime: '11:00' }],
  travelChanged: [{ name: 'Travel', fromMinutes: 8, toMinutes: 11 }],
  preservedMustDo: [{ name: 'Glico Man Sign' }],
});

const movedDiff = (): PublicHistoryDiff => ({
  ...emptyDiff(),
  moved: [{ name: 'Kuromon Ichiba Market', fromDay: 1, toDay: 2, time: '10:30' }],
  retimed: [{ name: 'Kuromon Ichiba Market', fromTime: '14:48', toTime: '10:30' }],
  windowsAdded: [{ kind: 'meal-window', name: 'Lunch', day: 1, time: '12:00' }],
});

const record = (entry: Partial<HistoryRecord> & Pick<HistoryRecord, 'id' | 'appliedAt'>): HistoryRecord => ({
  status: 'applied',
  undoneAt: null,
  diff: retimedDiff(),
  ...entry,
});

type Stored = HistoryRecord & { tripId: string; userId: string };

const stored = (entry: Stored) => entry;

const depsFor = (rows: Stored[]): HistoryDeps => ({
  readHistory: async (tripId, userId, limit) =>
    rows
      .filter((row) => row.tripId === tripId && row.userId === userId)
      .sort((left, right) => right.appliedAt.localeCompare(left.appliedAt))
      .slice(0, limit),
});

describe('deterministic history summary', () => {
  it('summarises retimes and travel without calling a model', () => {
    expect(summarizeItineraryChangeDiff(retimedDiff()))
      .toBe('1 place retimed · 1 travel leg updated');
  });

  it('summarises moves and meal windows', () => {
    expect(summarizeItineraryChangeDiff(movedDiff()))
      .toBe('1 place moved · 1 place retimed · 1 meal window added');
  });

  it('falls back when the diff has no traveller-facing atoms', () => {
    expect(summarizeItineraryChangeDiff(emptyDiff())).toBe('Times and details only');
  });
});

describe('history sanitisation', () => {
  it('drops identities, hashes and snapshots from a stored diff', () => {
    const diff = sanitizeHistoryDiff({
      added: [{ id: 'discovered-osm-n1', name: 'Glico Man Sign', hash: 'abc', day: 1 }],
      before_itinerary: { days: [] },
      afterHash: 'deadbeef',
      proposalId: 'proposal-secret',
      totals: { added: 99 },
    });
    expect(diff.added).toEqual([{ name: 'Glico Man Sign', day: 1 }]);
    expect(JSON.stringify(diff)).not.toMatch(/discovered-osm-n1|deadbeef|proposal-secret|before_itinerary|afterHash/);
  });

  it('ignores snapshots if an authority row accidentally includes them', () => {
    const mapped = historyRecordFromAuthorityRow({
      id: 'change-1',
      status: 'applied',
      applied_at: '2026-08-17T11:42:00.000Z',
      undone_at: null,
      before_itinerary: { secret: true },
      after_hash: 'ffff',
      itinerary_change_proposals: { diff: retimedDiff() },
    });
    expect(mapped).toEqual({
      id: 'change-1',
      status: 'applied',
      appliedAt: '2026-08-17T11:42:00.000Z',
      undoneAt: null,
      diff: retimedDiff(),
    });
    expect(JSON.stringify(mapped)).not.toMatch(/before_itinerary|after_hash|secret/);
  });
});

describe('history list', () => {
  it('loads the owner\'s newest changes first and caps the list', async () => {
    const rows = Array.from({ length: 22 }, (_, index) => stored({
      id: `change-${String(index).padStart(2, '0')}`,
      tripId: 'trip-1',
      userId: OWNER,
      status: 'applied',
      appliedAt: new Date(Date.UTC(2026, 7, 17, 8, index, 0)).toISOString(),
      undoneAt: null,
      diff: retimedDiff(),
    }));
    const listed = await listItineraryChangeHistory('trip-1', OWNER, depsFor(rows));
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.changes).toHaveLength(HISTORY_LIMIT);
    expect(listed.changes[0]?.id).toBe('change-21');
    expect(listed.changes.map((entry) => entry.id)).not.toContain('change-00');
    const times = listed.changes.map((entry) => entry.appliedAt);
    expect(times).toEqual([...times].sort((left, right) => right.localeCompare(left)));
  });

  it('does not return another user\'s trip history', async () => {
    const listed = await listItineraryChangeHistory('trip-1', STRANGER, depsFor([
      stored({
        id: 'change-owner',
        tripId: 'trip-1',
        userId: OWNER,
        status: 'applied',
        appliedAt: '2026-08-17T11:42:00.000Z',
        undoneAt: null,
        diff: retimedDiff(),
      }),
    ]));
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.changes).toEqual([]);
  });

  it('returns the owner\'s applied and undone items with summaries', async () => {
    const listed = await listItineraryChangeHistory('trip-1', OWNER, depsFor([
      stored({
        id: 'change-new',
        tripId: 'trip-1',
        userId: OWNER,
        status: 'undone',
        appliedAt: '2026-08-17T11:42:00.000Z',
        undoneAt: '2026-08-17T12:14:00.000Z',
        diff: retimedDiff(),
      }),
      stored({
        id: 'change-old',
        tripId: 'trip-1',
        userId: OWNER,
        status: 'applied',
        appliedAt: '2026-08-17T09:18:00.000Z',
        undoneAt: null,
        diff: movedDiff(),
      }),
    ]));
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.changes.map((entry) => entry.id)).toEqual(['change-new', 'change-old']);
    expect(listed.changes[0]).toMatchObject({
      status: 'undone',
      title: 'AI plan applied',
      summary: '1 place retimed · 1 travel leg updated',
      undoneAt: '2026-08-17T12:14:00.000Z',
    });
    expect(listed.changes[1]?.status).toBe('applied');
    expect(JSON.stringify(listed.changes)).not.toMatch(/before_itinerary|afterHash|proposalId|materialRevision/);
  });

  it('reports a storage failure without a database diagnostic', async () => {
    const listed = await listItineraryChangeHistory('trip-1', OWNER, {
      readHistory: async () => null,
    });
    expect(listed).toEqual({
      ok: false,
      refusal: 'storage-failed',
      detail: 'Plan changes could not be loaded.',
    });
  });
});

describe('history detail sections', () => {
  it('renders only categories that changed', () => {
    const sections = historyDetailSections({
      ...retimedDiff(),
      moved: [{ name: 'Kuromon Ichiba Market', fromDay: 1, toDay: 2 }],
    });
    expect(sections.map((section) => section.title)).toEqual([
      'Places moved',
      'Times changed',
      'Travel time changed',
      'Must do',
    ]);
    expect(sections.find((section) => section.title === 'Times changed')?.items[0]).toEqual({
      name: 'Glico Man Sign',
      detail: '10:25 → 11:00',
    });
    expect(sections.find((section) => section.title === 'Places moved')?.items[0]?.detail)
      .toMatch(/Moved from Day 1 → Day 2/);
    expect(sections.map((section) => section.title)).not.toContain('Places added');
  });
});

describe('history timestamps', () => {
  it('labels the same local day as Today', () => {
    const now = new Date('2026-08-17T20:00:00');
    expect(formatHistoryAppliedAt('2026-08-17T19:42:00', now)).toMatch(/^Today · /);
    expect(formatHistoryAppliedAt('2026-08-16T19:42:00', now)).not.toMatch(/^Today/);
  });
});

describe('history client transport', () => {
  it('rejects an unauthenticated read without leaking the provider error', async () => {
    const result = await fetchHistory('trip-1', async () => {
      throw new Error('Invalid JWT: PGRST301 relation itinerary_change_history');
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toBe('Plan changes could not be loaded.');
    expect(result.detail).not.toMatch(/JWT|PGRST|itinerary_change_history/);
  });

  it('does not send a user id and only names the trip', async () => {
    const invoke = async (name: string, body: unknown) => {
      expect(name).toBe('itinerary-change');
      expect(body).toEqual({ operation: 'history', tripId: 'trip-1' });
      return { operation: 'history', changes: [presentHistoryRecord(record({
        id: 'change-1',
        appliedAt: '2026-08-17T11:42:00.000Z',
      }))] };
    };
    const result = await fetchHistory('trip-1', invoke);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
  });
});

describe('history path has no billed providers', () => {
  it('keeps the helper free of models, routes, weather and web research', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/itineraryChangeHistory.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /openai|OPENAI|openrouteservice|ORS_|get_weather|search_web|callModel|meteredModel|reasoning/i,
    );
    expect(source).not.toContain('itineraryProposal');
    expect(source).not.toContain('localStorage');
  });
});

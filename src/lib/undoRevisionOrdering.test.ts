/**
 * Undo has to restore content without rewinding the clock.
 *
 * `itinerary.revision` is the counter `isNewerItineraryRevision` orders remote
 * payloads by: the cloud fetch and the realtime subscription both accept a
 * payload only when its revision is strictly higher than what the client holds.
 * The first Undo restored the BEFORE snapshot whole, revision included, so a
 * trip went 5 → 6 on apply and 6 → 5 on undo — and a second device sitting on 6
 * discarded the undo, then overwrote it on its next edit.
 *
 * These tests pin both halves of the corrected contract: the traveller's content
 * comes back byte for byte, and the version strictly advances.
 *
 * Nothing here touches a model, a route provider, or a database.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyProposalToItinerary, canonicalJson } from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  type RouteMatrixLeg,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import { emptyItinerary, isNewerItineraryRevision, sanitizeItinerary } from './itinerarySanitize';
import type { Itinerary } from '../data';

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

/** Revision 5, matching the trip the production acceptance ran against. */
const beforeItinerary = () => ({
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
  revision: 5,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested' },
  },
  days: [{
    day: 1,
    date: '2026-08-17',
    city: 'Osaka',
    title: 'Day one',
    activities: [
      place('discovered-osm-n1', 'Glico Man Sign', [34.6687, 135.5013]),
      place('discovered-osm-n2', 'Kuromon Ichiba Market', [34.6653, 135.5062]),
    ],
  }],
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

const proposalFor = async (itinerary: Record<string, unknown>): Promise<TripItineraryProposal> => {
  const material = await buildPlanningMaterial('trip-1', itinerary);
  const ids = material.places.map((entry) => entry.id);
  return runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue({ days: [{ day: 1, placeIds: ids }] }),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(ids)),
    now: () => '2026-08-17T08:00:00.000Z',
  });
};

const revisionOf = (value: unknown): number => {
  const revision = (value as { revision?: unknown } | null)?.revision;
  return typeof revision === 'number' ? revision : 0;
};

const withoutRevision = (value: unknown): Record<string, unknown> => {
  const copy = { ...(value ?? {}) as Record<string, unknown> };
  delete copy.revision;
  return copy;
};

/**
 * The corrected `undo_itinerary_change` rule, mirrored from
 * `20260817120000_undo_preserves_revision_ordering.sql`: snapshot content, with
 * the version taken from the row being undone rather than from the snapshot.
 */
const undoRestore = (beforeSnapshot: unknown, currentRow: unknown): Record<string, unknown> => {
  const restored = JSON.parse(JSON.stringify(beforeSnapshot)) as Record<string, unknown>;
  const raw = (currentRow as { revision?: unknown } | null)?.revision;
  const currentRevision = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  restored.revision = currentRevision + 1;
  return restored;
};

describe('undo keeps the synchronization counter moving forward', () => {
  it('applies 5 → 6 and undoes 6 → 7', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);

    expect(revisionOf(before)).toBe(5);
    expect(revisionOf(applied)).toBe(6);
    expect(revisionOf(undone)).toBe(7);
    expect(revisionOf(undone)).toBeGreaterThan(revisionOf(applied));
  });

  it('restores every field of the before snapshot except the counter', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);

    expect(withoutRevision(undone)).toEqual(withoutRevision(before));
    expect(canonicalJson(withoutRevision(undone))).toBe(canonicalJson(withoutRevision(before)));
  });

  it('produces a full hash that differs from the before hash, by design', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);

    // The old acceptance invariant. It is deliberately no longer true: the
    // counter advanced, and `itinerary_state_hash` digests the whole record.
    expect(canonicalJson(undone)).not.toBe(canonicalJson(before));
  });

  it('lets a device still holding the applied revision accept the undo', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);

    const deviceB = sanitizeItinerary(applied, emptyItinerary);
    const payload = sanitizeItinerary(undone, emptyItinerary);

    expect(revisionOf(deviceB)).toBe(6);
    expect(isNewerItineraryRevision(payload, deviceB)).toBe(true);
  });

  it('is exactly the case the old behaviour got wrong', async () => {
    // Characterising the defect, so a regression is unmistakable: restoring the
    // snapshot whole hands a revision-6 device a revision-5 payload, which it
    // is required to reject.
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;

    const deviceB = sanitizeItinerary(applied, emptyItinerary);
    const oldStylePayload = sanitizeItinerary(before, emptyItinerary);

    expect(isNewerItineraryRevision(oldStylePayload, deviceB)).toBe(false);
  });

  it('lets the first edit after an undo become revision 8', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = sanitizeItinerary(undoRestore(before, applied), emptyItinerary);

    // `handleItineraryChange`'s rule, verbatim.
    const edited: Itinerary = {
      ...undone,
      name: 'Renamed after undo',
      revision: Math.max(undone.revision || 0, (undone.revision || 0) + 1),
    };

    expect(edited.revision).toBe(8);
    expect(isNewerItineraryRevision(edited, undone)).toBe(true);
  });

  it('keeps an adopted undo stable through the save path', async () => {
    const before = beforeItinerary();
    const proposal = await proposalFor(before);
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);

    // `adoptWrittenItinerary` sanitises the server result and does not bump; the
    // autosave then writes exactly that. Both must be fixed points.
    const adopted = sanitizeItinerary(undone, emptyItinerary);
    const resaved = sanitizeItinerary(adopted, emptyItinerary);

    expect(adopted.revision).toBe(7);
    expect(canonicalJson(resaved)).toBe(canonicalJson(adopted));
    // The realtime echo of that save carries the same revision, so it is ignored.
    expect(isNewerItineraryRevision(resaved, adopted)).toBe(false);
  });

  it('advances from the live row even when the snapshot carries a higher revision', () => {
    // Ordering authority is the row being undone, never the snapshot. A snapshot
    // with a stale-but-larger number must not drag the counter around.
    const snapshot = { id: 'trip-1', revision: 40, days: [] };
    const current = { id: 'trip-1', revision: 6, days: [] };

    expect(revisionOf(undoRestore(snapshot, current))).toBe(7);
  });

  it('treats a missing or malformed revision as zero, like the sanitiser', () => {
    expect(revisionOf(undoRestore({ id: 't', days: [] }, { id: 't', days: [] }))).toBe(1);
    expect(revisionOf(undoRestore({ id: 't' }, { id: 't', revision: 'nine' }))).toBe(1);
    expect(revisionOf(undoRestore({ id: 't' }, { id: 't', revision: -3 }))).toBe(1);
    expect(revisionOf(undoRestore({ id: 't' }, { id: 't', revision: 6.7 }))).toBe(7);
  });
});

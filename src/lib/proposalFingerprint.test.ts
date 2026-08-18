/**
 * Proposal identity, as an authorisation boundary.
 *
 * Phase 2B stages by `proposal.id`: the browser names the plan on screen, and
 * the server refuses unless its stored copy carries the same ID. That makes ID
 * equality a security claim — "this is the plan the traveller reviewed" — so it
 * has to hold against a collision, not merely usually.
 *
 * These tests pin two things: that the digest is a real cryptographic
 * fingerprint of a canonical serialisation, and that every field which can
 * change what the traveller sees or what Apply writes actually moves it.
 *
 * Nothing here touches a model, a provider, or a database.
 */
import { describe, expect, it, vi } from 'vitest';
import { canonicalFingerprint, canonicalJson } from '../../supabase/functions/_shared/canonicalHash';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  type PlanningMaterial,
  type RouteMatrixLeg,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';

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

const trip = (overrides: Record<string, unknown> = {}) => ({
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
  revision: 2,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'interested', 'osm-n2': 'interested', 'osm-n3': 'interested' },
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
    {
      day: 2,
      date: '2026-08-18',
      city: 'Osaka',
      title: 'Day two',
      activities: [place('discovered-osm-n3', 'Mint Museum', [34.6947, 135.5197])],
    },
  ],
  ...overrides,
});

const matrix = (ids: string[], durationMinutes = 11): RouteMatrixLeg[] =>
  ids.flatMap((from) => ids.flatMap((to) => from === to ? [] : [{
    fromPlaceId: from,
    toPlaceId: to,
    status: 'ok' as const,
    durationMinutes,
    distanceMeters: 900,
    mode: 'walking' as const,
    requestedMode: 'walking' as const,
    providerMode: 'foot-walking',
    provider: 'openrouteservice',
    source: 'provider' as const,
  }]));

const DEFAULT_COMPOSITION = {
  days: [
    { day: 1, placeIds: ['discovered-osm-n1', 'discovered-osm-n2'] },
    { day: 2, placeIds: ['discovered-osm-n3'] },
  ],
};

const propose = async (options: {
  itinerary?: Record<string, unknown>;
  composition?: { days: Array<{ day: number; placeIds: string[] }> };
  route?: RouteMatrixLeg[];
  now?: string;
  material?: (source: PlanningMaterial) => PlanningMaterial;
} = {}): Promise<TripItineraryProposal> => {
  const source = await buildPlanningMaterial('trip-1', options.itinerary ?? trip());
  const material = options.material ? options.material(source) : source;
  const ids = material.places.map((entry) => entry.id);
  return runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue(options.composition ?? DEFAULT_COMPOSITION),
    getRouteMatrix: vi.fn().mockResolvedValue(options.route ?? matrix(ids)),
    now: () => options.now ?? '2026-08-17T08:00:00.000Z',
  });
};

describe('canonical fingerprints', () => {
  it('is SHA-256, not a short non-cryptographic digest', async () => {
    const digest = await canonicalFingerprint({ any: 'value' });

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The known vector for the empty string, proving this is really SHA-256.
    const empty = new TextEncoder().encode('""');
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', empty)))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(await canonicalFingerprint('')).toBe(expected);
  });

  it('ignores key insertion order but respects array order', async () => {
    const ordered = { alpha: 1, beta: { gamma: [1, 2], delta: 'x' } };
    const shuffled = { beta: { delta: 'x', gamma: [1, 2] }, alpha: 1 };
    const reversedArray = { alpha: 1, beta: { gamma: [2, 1], delta: 'x' } };

    expect(await canonicalFingerprint(ordered)).toBe(await canonicalFingerprint(shuffled));
    // Order is meaning in a plan, so arrays are never sorted.
    expect(await canonicalFingerprint(ordered)).not.toBe(await canonicalFingerprint(reversedArray));
  });

  it('drops undefined rather than letting its presence change the digest', async () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe('proposal identity', () => {
  it('is a full-width cryptographic fingerprint', async () => {
    const proposal = await propose();

    expect(proposal.id).toMatch(/^proposal-[0-9a-f]{64}$/);
  });

  it('gives the same plan the same identity', async () => {
    expect((await propose()).id).toBe((await propose()).id);
  });

  it('changes when places move to a different day', async () => {
    const moved = await propose({
      composition: {
        days: [
          { day: 1, placeIds: ['discovered-osm-n1'] },
          { day: 2, placeIds: ['discovered-osm-n2', 'discovered-osm-n3'] },
        ],
      },
    });

    expect(moved.id).not.toBe((await propose()).id);
  });

  it('changes when the order within a day changes', async () => {
    const reordered = await propose({
      composition: {
        days: [
          { day: 1, placeIds: ['discovered-osm-n2', 'discovered-osm-n1'] },
          { day: 2, placeIds: ['discovered-osm-n3'] },
        ],
      },
    });

    expect(reordered.id).not.toBe((await propose()).id);
  });

  it('changes when a start time changes', async () => {
    const baseline = await propose();
    // A longer first leg pushes every later clock, without touching membership.
    const later = await propose({ route: matrix(['discovered-osm-n1', 'discovered-osm-n2', 'discovered-osm-n3'], 44) });
    const times = (proposal: TripItineraryProposal) =>
      proposal.days.flatMap((day) => day.items.map((item) => item.startTime));

    expect(times(later)).not.toEqual(times(baseline));
    expect(later.id).not.toBe(baseline.id);
  });

  it('changes when a travel duration or its provenance changes', async () => {
    const baseline = await propose();
    const unavailable = await propose({ route: [] });

    expect(unavailable.routeSummary.confirmedLegs).not.toBe(baseline.routeSummary.confirmedLegs);
    expect(unavailable.id).not.toBe(baseline.id);
  });

  it('changes when the conflicts change', async () => {
    // Omitting a Must do adds an error conflict and flips the status.
    const withConflict = await propose({
      itinerary: trip({
        discoveryState: {
          city: 'Osaka',
          mode: 'live',
          decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested', 'osm-n3': 'interested' },
        },
      }),
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n2'] }, { day: 2, placeIds: [] }] },
    });

    expect(withConflict.status).toBe('needs-review');
    expect(withConflict.conflicts.length).toBeGreaterThan(0);
    expect(withConflict.id).not.toBe((await propose()).id);
  });

  it('changes when the set of omitted places changes', async () => {
    const baseline = await propose();
    const omitting = await propose({
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }, { day: 2, placeIds: [] }] },
    });

    expect(omitting.omittedPlaceIds).not.toEqual(baseline.omittedPlaceIds);
    expect(omitting.id).not.toBe(baseline.id);
  });

  it('changes when the planning material changes', async () => {
    const baseline = await propose();
    const renamed = await propose({ itinerary: trip({ revision: 3 }) });

    expect(renamed.materialRevision).not.toBe(baseline.materialRevision);
    expect(renamed.id).not.toBe(baseline.id);
  });

  it('changes when only the generation timestamp changes', async () => {
    /**
     * Deliberate, and the reason is not decoration: `applyProposalToItinerary`
     * stamps `createdAt` onto every generated meal and rest window, so two
     * otherwise identical plans made at different moments produce *different*
     * itineraries. Sharing an ID would break the property the write boundary
     * rests on — that the same ID means the same bytes will be written.
     */
    const earlier = await propose({ now: '2026-08-17T08:00:00.000Z' });
    const later = await propose({ now: '2026-08-17T09:30:00.000Z' });

    expect(later.id).not.toBe(earlier.id);
  });

  it('changes when the repair count differs', async () => {
    // Visible in the preview, and not derivable from the days, so it is bound.
    const baseline = await propose();
    const repaired = await propose({
      itinerary: trip({
        discoveryState: {
          city: 'Osaka',
          mode: 'live',
          decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested', 'osm-n3': 'interested' },
        },
      }),
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n2'] }, { day: 2, placeIds: [] }] },
    });

    expect(repaired.repairIterations).not.toBe(baseline.repairIterations);
    expect(repaired.id).not.toBe(baseline.id);
  });
});

describe('material revision identity', () => {
  it('is a full-width cryptographic fingerprint', async () => {
    const material = await buildPlanningMaterial('trip-1', trip());

    expect(material.revision).toMatch(/^plan-v1-[0-9a-f]{64}$/);
  });

  it('is stable for the same trip and moves for a different one', async () => {
    const first = await buildPlanningMaterial('trip-1', trip());
    const same = await buildPlanningMaterial('trip-1', trip());
    const changed = await buildPlanningMaterial('trip-1', trip({
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested', 'osm-n3': 'interested' },
      },
    }));

    expect(same.revision).toBe(first.revision);
    expect(changed.revision).not.toBe(first.revision);
  });

  it('changes when a saved-activity Skip excludes a place and is stable when that Skip is unchanged', async () => {
    const activities = [
      {
        id: 'activity-legacy-iwbmuz',
        kind: 'place',
        time: '09:00',
        durationMinutes: 90,
        name: 'Kushida Shrine',
        type: 'sight',
        source: 'manual',
        coordinates: [33.59307, 130.4106837],
        lockedFields: [],
      },
      place('discovered-osm-n2', 'Kuromon Ichiba Market', [34.6653, 135.5062]),
    ];
    const days = [{ day: 1, date: '2026-08-20', city: 'Osaka', title: 'Day one', activities }];
    const interested = trip({
      revision: 9,
      days,
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'activity-legacy-iwbmuz': 'interested', 'osm-n2': 'interested' },
      },
    });
    const skipped = trip({
      revision: 9,
      days,
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'activity-legacy-iwbmuz': 'skip', 'osm-n2': 'interested' },
      },
    });

    const left = await buildPlanningMaterial('trip-1', interested);
    const right = await buildPlanningMaterial('trip-1', skipped);
    const again = await buildPlanningMaterial('trip-1', skipped);

    expect(left.places.map((entry) => entry.id)).toContain('activity-legacy-iwbmuz');
    expect(right.places.map((entry) => entry.id)).not.toContain('activity-legacy-iwbmuz');
    expect(right.revision).not.toBe(left.revision);
    expect(again.revision).toBe(right.revision);
  });
});

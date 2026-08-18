/**
 * The transform an Apply writes.
 *
 * Everything here is deterministic and offline: a real itinerary, a real
 * proposal produced by the real engine, and the exact resulting itinerary. No
 * model, no route provider, no database. These tests are what make it safe for
 * the server to fix a result at stage time and write it verbatim later.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyProposalToItinerary,
  canonicalFingerprint,
  canonicalJson,
  diffItineraries,
  validateStagedChange,
} from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  runItineraryProposalEngine,
  type RouteMatrixLeg,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import type { Itinerary } from '../data';

const place = (id: string, name: string, coordinates: [number, number], extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});

const glico = place('discovered-osm-n1', 'Glico Man Sign', [34.6687, 135.5013]);
const kuromon = place('discovered-osm-n2', 'Kuromon Ichiba Market', [34.6653, 135.5062]);
const mint = place('discovered-osm-n3', 'Mint Museum', [34.6947, 135.5197]);

/**
 * A flight the planner has no authority over, and must never touch.
 * Timed flights are hard scheduling constraints; Apply still copies this
 * object through byte-for-byte.
 */
const flight = {
  id: 'flight-out',
  time: '06:00',
  durationMinutes: 120,
  name: 'KIX → HND',
  description: 'Return flight',
  type: 'flight',
};

const trip = (overrides: Record<string, unknown> = {}) => ({
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
  revision: 4,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested', 'osm-n3': 'interested' },
  },
  days: [
    { day: 1, date: '2026-08-17', city: 'Osaka', title: 'Day one', activities: [glico, kuromon] },
    { day: 2, date: '2026-08-18', city: 'Osaka', title: 'Day two', activities: [mint, flight] },
  ],
  ...overrides,
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

const propose = async (
  itinerary: Record<string, unknown>,
  composition?: { days: Array<{ day: number; placeIds: string[] }> },
): Promise<TripItineraryProposal> => {
  const material = await buildPlanningMaterial('trip-1', itinerary);
  const ids = material.places.map((entry) => entry.id);
  return runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue(composition ?? {
      days: [
        { day: 1, placeIds: ids.filter((id) => id !== 'discovered-osm-n3') },
        { day: 2, placeIds: ids.filter((id) => id === 'discovered-osm-n3') },
      ],
    }),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(ids)),
    now: () => '2026-08-17T08:00:00.000Z',
  });
};

describe('applying a proposal to an itinerary', () => {
  it('produces the same bytes for the same inputs', async () => {
    const proposal = await propose(trip());
    const first = applyProposalToItinerary(trip(), proposal);
    const second = applyProposalToItinerary(trip(), proposal);

    expect(canonicalJson(first.itinerary)).toBe(canonicalJson(second.itinerary));
    expect(await canonicalFingerprint(first.itinerary)).toBe(await canonicalFingerprint(second.itinerary));
  });

  it('canonicalises key order so a re-serialised itinerary hashes the same', async () => {
    const ordered = { a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } };
    const shuffled = { b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 };

    expect(canonicalJson(ordered)).toBe(canonicalJson(shuffled));
    expect(await canonicalFingerprint(ordered)).toBe(await canonicalFingerprint(shuffled));
  });

  it('never mutates the itinerary it was given', async () => {
    const source = trip();
    const before = JSON.stringify(source);
    const proposal = await propose(source);
    applyProposalToItinerary(source, proposal);

    expect(JSON.stringify(source)).toBe(before);
  });

  it('schedules every proposed place at the proposal’s exact times', async () => {
    const proposal = await propose(trip());
    const { itinerary } = applyProposalToItinerary(trip(), proposal);
    const days = itinerary.days as Array<{ day: number; activities: Array<Record<string, unknown>> }>;
    const scheduled = days.flatMap((day) => day.activities.filter((activity) => activity.kind === 'place'));
    const proposedItems = proposal.days.flatMap((day) => day.items.filter((item) => item.type === 'place'));

    expect(scheduled).toHaveLength(proposedItems.length);
    for (const item of proposedItems) {
      const activity = scheduled.find((entry) => entry.id === item.placeId);
      expect(activity).toMatchObject({ time: item.startTime, durationMinutes: item.visitDurationMinutes });
    }
  });

  it('copies travel figures verbatim and invents none', async () => {
    const proposal = await propose(trip());
    const { itinerary } = applyProposalToItinerary(trip(), proposal);
    const days = itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>;
    const routed = days.flatMap((day) => day.activities).filter((activity) => activity.transportMinutes !== undefined);
    const confirmed = proposal.days.flatMap((day) => day.items)
      .filter((item) => item.travelFromPrevious?.status === 'confirmed');

    expect(routed).toHaveLength(confirmed.length);
    for (const activity of routed) {
      expect(activity.travelEstimateSource).toBe('provider-route');
      expect(activity.transportMinutes).toBe(11);
    }
    // Everything else says "unknown" rather than carrying a made-up number.
    const unrouted = days.flatMap((day) => day.activities)
      .filter((activity) => activity.kind === 'place' && activity.transportMinutes === undefined);
    for (const activity of unrouted) expect(activity.travelEstimateSource).toBe('unknown');
  });

  it('leaves activities the planner has no authority over exactly where they were', async () => {
    const proposal = await propose(trip());
    const { itinerary } = applyProposalToItinerary(trip(), proposal);
    const days = itinerary.days as Array<{ day: number; activities: Array<Record<string, unknown>> }>;
    const preserved = days.find((day) => day.day === 2)?.activities.find((activity) => activity.id === 'flight-out');

    expect(preserved).toEqual(flight);
  });

  it('moves a place the proposal did not schedule to the inbox instead of deleting it', async () => {
    const proposal = await propose(trip(), {
      days: [{ day: 1, placeIds: ['discovered-osm-n1'] }, { day: 2, placeIds: ['discovered-osm-n3'] }],
    });
    const applied = applyProposalToItinerary(trip(), proposal);
    const days = applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>;
    const inbox = applied.itinerary.unassignedActivities as Array<Record<string, unknown>>;
    const stillScheduled = days.flatMap((day) => day.activities).map((activity) => activity.id);

    expect(stillScheduled).not.toContain('discovered-osm-n2');
    expect(inbox.map((activity) => activity.id)).toContain('discovered-osm-n2');
    expect(applied.unscheduledPlaceIds).toEqual(['discovered-osm-n2']);
  });

  it('raises the itinerary revision exactly once', async () => {
    const proposal = await propose(trip());
    const { itinerary } = applyProposalToItinerary(trip(), proposal);

    expect(itinerary.revision).toBe(5);
  });

  it('keeps a Must do scheduled and reports it as preserved', async () => {
    const proposal = await propose(trip());
    const applied = applyProposalToItinerary(trip(), proposal);
    const diff = diffItineraries(trip(), applied.itinerary, proposal);

    expect(proposal.status).toBe('valid');
    expect(diff.preservedMustDo.map((entry) => entry.name)).toContain('Glico Man Sign');
    expect(diff.removed).toEqual([]);
  });

  it('keeps Interested as a preference rather than a requirement', async () => {
    // Dropping an Interested place is allowed and shows up as a real change;
    // it must not become a blocking conflict the way a Must do would.
    const proposal = await propose(trip(), {
      days: [{ day: 1, placeIds: ['discovered-osm-n1'] }, { day: 2, placeIds: ['discovered-osm-n3'] }],
    });
    const applied = applyProposalToItinerary(trip(), proposal);

    expect(proposal.status).toBe('valid');
    expect(validateStagedChange(proposal, applied).ok).toBe(true);
  });

  it('refuses to apply a proposal that omits a Must do', async () => {
    const proposal = await propose(trip(), {
      days: [{ day: 1, placeIds: ['discovered-osm-n2'] }, { day: 2, placeIds: ['discovered-osm-n3'] }],
    });
    const applied = applyProposalToItinerary(trip(), proposal);
    const validation = validateStagedChange(proposal, applied);

    expect(proposal.status).toBe('needs-review');
    expect(validation.ok).toBe(false);
    expect(validation.blocking.join(' ')).toMatch(/conflict|Glico/i);
  });

  it('refuses a proposal naming a place the trip no longer has', async () => {
    const proposal = await propose(trip());
    const withoutKuromon = trip({
      days: [
        { day: 1, date: '2026-08-17', city: 'Osaka', title: 'Day one', activities: [glico] },
        { day: 2, date: '2026-08-18', city: 'Osaka', title: 'Day two', activities: [mint, flight] },
      ],
    });
    const applied = applyProposalToItinerary(withoutKuromon, proposal);
    const validation = validateStagedChange(proposal, applied);

    expect(applied.unresolvedPlaceIds).toContain('discovered-osm-n2');
    expect(validation.ok).toBe(false);
  });

  it('keeps a warning a warning', async () => {
    const noHours = trip({
      days: [
        {
          day: 1,
          date: '2026-08-17',
          city: 'Osaka',
          title: 'Day one',
          activities: [{ ...glico, openingHoursWeek: undefined }, kuromon],
        },
        { day: 2, date: '2026-08-18', city: 'Osaka', title: 'Day two', activities: [mint, flight] },
      ],
    });
    const proposal = await propose(noHours);
    const applied = applyProposalToItinerary(noHours, proposal);
    const validation = validateStagedChange(proposal, applied);

    expect(proposal.conflicts.some((conflict) => conflict.code === 'opening-hours-unknown')).toBe(true);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  it('does not write sightseeing on top of a preserved flight', async () => {
    const lateFlight = trip({
      days: [
        { day: 1, date: '2026-08-17', city: 'Osaka', title: 'Day one', activities: [glico, kuromon] },
        {
          day: 2,
          date: '2026-08-18',
          city: 'Osaka',
          title: 'Day two',
          activities: [mint, { ...flight, time: '08:00', durationMinutes: 180 }],
        },
      ],
    });
    const proposal = await propose(lateFlight);
    const applied = applyProposalToItinerary(lateFlight, proposal);
    const dayTwo = (applied.itinerary.days as Array<{ day: number; activities: Array<Record<string, unknown>> }>)
      .find((day) => day.day === 2);
    const preserved = dayTwo?.activities.find((activity) => activity.id === 'flight-out');
    const overlap = (dayTwo?.activities ?? []).filter((activity) => {
      if (activity.id === 'flight-out' || typeof activity.time !== 'string') return false;
      const start = Number(activity.time.slice(0, 2)) * 60 + Number(activity.time.slice(3, 5));
      const end = start + (typeof activity.durationMinutes === 'number' ? activity.durationMinutes : 0);
      return start < 11 * 60 && end > 8 * 60;
    });

    expect(preserved).toEqual({ ...flight, time: '08:00', durationMinutes: 180 });
    expect(overlap).toEqual([]);
    expect(proposal.days[1]?.items.some((item) => {
      const start = Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3, 5));
      const end = Number(item.endTime.slice(0, 2)) * 60 + Number(item.endTime.slice(3, 5));
      return start < 11 * 60 && end > 8 * 60;
    })).toBe(false);
  });

  it('blocks a resulting itinerary whose activities overlap', async () => {
    const proposal = await propose(trip());
    const applied = applyProposalToItinerary(trip(), proposal);
    const days = applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>;
    // Corrupt the staged result the way a bad transform would.
    days[0].activities = [
      { id: 'a', name: 'First', time: '10:00', durationMinutes: 120, kind: 'place' },
      { id: 'b', name: 'Second', time: '10:30', durationMinutes: 60, kind: 'place' },
    ];

    expect(validateStagedChange(proposal, applied).ok).toBe(false);
  });

  it('describes the change as structured atoms', async () => {
    const proposal = await propose(trip());
    const applied = applyProposalToItinerary(trip(), proposal);
    const diff = diffItineraries(trip(), applied.itinerary, proposal);

    expect(diff.moved.map((entry) => entry.name)).not.toContain('KIX → HND');
    expect(diff.totals.daysTouched).toBeGreaterThan(0);
    expect(diff.windowsAdded.every((entry) => ['meal-window', 'rest-window', 'free-time'].includes(entry.kind))).toBe(true);
    expect(diff.conflicts).toEqual(proposal.conflicts);
  });

  it('produces a result that is already in saved form', async () => {
    /**
     * The client adopts the applied itinerary into local state, and its next
     * autosave writes whatever local state holds. If the save path normalised
     * the applied result into anything different, the stored bytes would drift
     * away from the recorded after-hash and Undo would start refusing. So the
     * transform has to land on a fixed point of the sanitiser.
     */
    const saved = sanitizeItinerary(trip() as unknown, emptyItinerary) as unknown as Record<string, unknown>;
    const proposal = await propose(saved);
    const applied = applyProposalToItinerary(saved, proposal).itinerary;

    const resaved = sanitizeItinerary(applied, saved as unknown as Itinerary);
    expect(canonicalJson(resaved)).toBe(canonicalJson(applied));
  });

  it('reports a place moved between days as a move, not a delete and an add', async () => {
    const proposal = await propose(trip(), {
      days: [{ day: 1, placeIds: [] }, { day: 2, placeIds: ['discovered-osm-n1', 'discovered-osm-n3'] }],
    });
    const applied = applyProposalToItinerary(trip(), proposal);
    const diff = diffItineraries(trip(), applied.itinerary, proposal);

    expect(diff.moved.map((entry) => ({ name: entry.name, from: entry.fromDay, to: entry.toDay })))
      .toContainEqual({ name: 'Glico Man Sign', from: 1, to: 2 });
    expect(diff.removed).toEqual([]);
  });

  it('moves a skipped planner place to the inbox instead of deleting it', async () => {
    const source = trip({
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'osm-n1': 'skip', 'osm-n2': 'interested', 'osm-n3': 'interested' },
      },
    });
    const before = JSON.stringify(source);
    const proposal = await propose(source);
    const applied = applyProposalToItinerary(source, proposal);
    const scheduled = (applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>)
      .flatMap((day) => day.activities);
    const inbox = applied.itinerary.unassignedActivities as Array<Record<string, unknown>>;
    const discovery = applied.itinerary.discoveryState as { decisions: Record<string, string> };

    expect(JSON.stringify(source)).toBe(before);
    expect(proposal.days.flatMap((day) => day.items).some((item) => item.placeId === 'discovered-osm-n1')).toBe(false);
    expect(scheduled.some((activity) => activity.id === 'discovered-osm-n1')).toBe(false);
    expect(inbox.map((activity) => activity.id)).toContain('discovered-osm-n1');
    expect(inbox.find((activity) => activity.id === 'discovered-osm-n1')).toMatchObject({ name: 'Glico Man Sign' });
    expect(discovery.decisions['osm-n1']).toBe('skip');
    expect(scheduled.find((activity) => activity.id === 'flight-out')).toEqual(flight);
  });

  it('moves a visited planner place to the inbox and keeps a flight byte-for-byte', async () => {
    const source = trip({
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'osm-n1': 'visited', 'osm-n2': 'interested', 'osm-n3': 'interested' },
      },
    });
    const proposal = await propose(source);
    const applied = applyProposalToItinerary(source, proposal);
    const scheduled = (applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>)
      .flatMap((day) => day.activities);
    const inbox = applied.itinerary.unassignedActivities as Array<Record<string, unknown>>;
    const discovery = applied.itinerary.discoveryState as { decisions: Record<string, string> };

    expect(proposal.days.flatMap((day) => day.items).some((item) => item.placeId === 'discovered-osm-n1')).toBe(false);
    expect(inbox.map((activity) => activity.id)).toContain('discovered-osm-n1');
    expect(discovery.decisions['osm-n1']).toBe('visited');
    expect(scheduled.find((activity) => activity.id === 'flight-out')).toEqual(flight);
  });
});

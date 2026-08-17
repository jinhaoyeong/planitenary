/**
 * Flight-Aware Planning V1: existing timed flights/transport are hard
 * constraints. The model does not invent, move, or delete them; the
 * deterministic scheduler/validator owns whether sightseeing fits around them.
 *
 * No model, no paid route provider, no database.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyProposalToItinerary, canonicalJson } from '../../supabase/functions/_shared/itineraryChange';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from '../../supabase/functions/_shared/itineraryEdgeTiming';
import {
  ARRIVAL_SETTLING_MINUTES as proposalArrivalSettling,
  DEPARTURE_LEAD_MINUTES as proposalDepartureLead,
  buildPlanningMaterial,
  clockToMinutes,
  isPlannerPlace,
  runItineraryProposalEngine,
  validateItineraryProposal,
  type PlanningMaterial,
  type ProposedItineraryDay,
  type RouteMatrixLeg,
  type TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import { lookupExactItineraryProposalCache } from '../../supabase/functions/_shared/itineraryProposalCache';
import { applyActivityDuration } from './flightDuration';
import { emptyItinerary, isNewerItineraryRevision, sanitizeItinerary } from './itinerarySanitize';

const hours = [{ opensAt: '09:00', closesAt: '21:00', days: [0, 1, 2, 3, 4, 5, 6] }];

const sight = (
  id: string,
  name: string,
  city: string,
  coordinates: [number, number],
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'place',
  time: '09:00',
  durationMinutes: 60,
  name,
  description: `${name} description`,
  type: 'sight',
  location: city,
  provider: 'osm',
  providerPlaceId: id.replace('discovered-osm-', ''),
  coordinates,
  openingHoursWeek: hours,
  lockedFields: [],
  ...extra,
});

const flight = (over: Record<string, unknown> = {}) => ({
  id: 'flight-1',
  time: '08:00',
  durationMinutes: 90,
  name: 'HND → KIX',
  description: 'Inbound flight',
  type: 'flight',
  ...over,
});

const castle = sight('discovered-osm-n1', 'Osaka Castle', 'Osaka', [34.6873, 135.5262]);
const dotonbori = sight('discovered-osm-n2', 'Dotonbori', 'Osaka', [34.6687, 135.5013]);
const sensoji = sight('discovered-osm-n3', 'Senso-ji', 'Tokyo', [35.7148, 139.7967]);

const itinerary = (over: Record<string, unknown> = {}) => ({
  id: 'trip-1',
  name: 'Osaka days',
  cities: ['Osaka'],
  revision: 4,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'interested', 'osm-n2': 'interested', 'osm-n3': 'interested' },
  },
  days: [
    { day: 1, date: '2026-08-17', city: 'Osaka', title: 'Day one', activities: [castle, flight()] },
  ],
  ...over,
});

const matrix = (ids: string[], durationMinutes = 12): RouteMatrixLeg[] =>
  ids.flatMap((from) => ids.flatMap((to) => from === to ? [] : [{
    fromPlaceId: from,
    toPlaceId: to,
    status: 'ok' as const,
    durationMinutes,
    distanceMeters: 1_000,
    mode: 'walking' as const,
    requestedMode: 'walking' as const,
    providerMode: 'foot-walking',
    provider: 'openrouteservice',
    source: 'provider' as const,
  }]));

const propose = async (
  source: Record<string, unknown>,
  options: {
    composition?: { days: Array<{ day: number; placeIds: string[] }> };
    route?: RouteMatrixLeg[] | ((ids: string[]) => RouteMatrixLeg[]);
    now?: string;
  } = {},
) => {
  const material = await buildPlanningMaterial('trip-1', source);
  const getRouteMatrix = vi.fn(async ({ placeIds }: { placeIds: string[] }) => {
    if (typeof options.route === 'function') return options.route(placeIds);
    if (options.route) return options.route;
    return matrix(placeIds);
  });
  const proposal = await runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue(options.composition ?? {
      days: material.days.map((day) => ({
        day: day.day,
        placeIds: material.places.filter((place) => place.city === day.city || material.days.length === 1).map((place) => place.id),
      })),
    }),
    getRouteMatrix,
    now: () => options.now ?? '2026-08-17T08:00:00.000Z',
  });
  return { material, proposal, getRouteMatrix };
};

const placeItems = (proposal: TripItineraryProposal, day: number) =>
  proposal.days.find((entry) => entry.day === day)?.items.filter((item) => item.type === 'place' || item.type === 'reservation') ?? [];

const startsBefore = (item: { startTime: string }, clock: string) =>
  (clockToMinutes(item.startTime) ?? 0) < (clockToMinutes(clock) ?? 0);

const endsAfter = (item: { endTime: string }, clock: string) =>
  (clockToMinutes(item.endTime) ?? 0) > (clockToMinutes(clock) ?? 0);

const overlaps = (item: { startTime: string; endTime: string }, start: string, end: string) =>
  (clockToMinutes(item.startTime) ?? 0) < (clockToMinutes(end) ?? 0)
  && (clockToMinutes(item.endTime) ?? 0) > (clockToMinutes(start) ?? 0);

const undoRestore = (beforeSnapshot: unknown, currentRow: unknown): Record<string, unknown> => {
  const restored = JSON.parse(JSON.stringify(beforeSnapshot)) as Record<string, unknown>;
  const raw = (currentRow as { revision?: unknown } | null)?.revision;
  const currentRevision = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  restored.revision = currentRevision + 1;
  return restored;
};

describe('Flight-Aware Planning V1', () => {
  it('A. schedules sightseeing after a morning arrival flight', async () => {
    const { material, proposal } = await propose(itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '08:00', durationMinutes: 90 })] }],
    }), {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });

    expect(material.days[0]?.fixedEvents).toEqual([expect.objectContaining({
      id: 'flight-1', role: 'arrival', transportKind: 'flight', startTime: '08:00', endTime: '09:30',
    })]);
    expect(material.days[0]?.startTime).toBe('11:30');
    expect(ARRIVAL_SETTLING_MINUTES).toBe(120);
    expect(proposalArrivalSettling).toBe(ARRIVAL_SETTLING_MINUTES);
    expect(proposal.days[0]?.warnings.join(' ')).toMatch(/Arrival at 9:30 AM/i);
    expect(placeItems(proposal, 1).every((item) => !startsBefore(item, '11:30'))).toBe(true);
    expect(placeItems(proposal, 1).some((item) => overlaps(item, '08:00', '09:30'))).toBe(false);
  });

  it('B. does not schedule sightseeing before a late-afternoon arrival', async () => {
    const { material, proposal } = await propose(itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '15:00', durationMinutes: 90 })] }],
    }), {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });

    expect(material.days[0]?.startTime).toBe('18:30');
    expect(material.days[0]?.maxMainActivities).toBe(0);
    expect(placeItems(proposal, 1)).toHaveLength(0);
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'arrival-day-infeasible' }),
    ]));
  });

  it('C. finishes activities before an evening departure constraint', async () => {
    const { material, proposal } = await propose(itinerary({
      cities: ['Osaka'],
      days: [
        { day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle] },
        { day: 2, date: '2026-08-18', city: 'Osaka', activities: [dotonbori, flight({ time: '18:00', durationMinutes: 120, name: 'KIX → HND' })] },
      ],
    }), {
      composition: {
        days: [
          { day: 1, placeIds: ['discovered-osm-n1'] },
          { day: 2, placeIds: ['discovered-osm-n2'] },
        ],
      },
    });

    expect(DEPARTURE_LEAD_MINUTES).toBe(210);
    expect(proposalDepartureLead).toBe(DEPARTURE_LEAD_MINUTES);
    expect(material.days[1]?.fixedEvents).toEqual([expect.objectContaining({ role: 'departure', startTime: '18:00' })]);
    expect(material.days[1]?.endTime).toBe('14:30');
    expect(placeItems(proposal, 2).every((item) => !endsAfter(item, '14:30'))).toBe(true);
    expect(placeItems(proposal, 2).some((item) => overlaps(item, '18:00', '20:00'))).toBe(false);
  });

  it('D. rejects an activity that overlaps a fixed flight', () => {
    const day: ProposedItineraryDay = {
      day: 1,
      city: 'Osaka',
      startTime: '09:15',
      endTime: '21:30',
      warnings: [],
      metrics: { placeCount: 1, travelMinutes: 0, freeMinutes: 0, clusterChanges: 0 },
      items: [{
        id: 'castle',
        placeId: 'discovered-osm-n1',
        type: 'place',
        name: 'Osaka Castle',
        arrivalTime: '10:00',
        startTime: '10:00',
        endTime: '11:00',
        visitDurationMinutes: 60,
        bufferMinutes: 0,
        rationale: '',
        warnings: [],
        evidence: [],
      }],
    };
    const material = {
      version: 1 as const,
      tripId: 'trip-1',
      revision: 'plan-v1-test',
      name: 'Osaka',
      cities: ['Osaka'],
      pace: 'balanced' as const,
      styles: [],
      tripTypes: [],
      moods: [],
      transportModes: [],
      preferences: {},
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        startTime: '09:15',
        endTime: '21:30',
        maxMainActivities: 3,
        fixedPlaceIds: [],
        fixedEvents: [{
          id: 'flight-1',
          name: 'HND → KIX',
          startTime: '09:00',
          endTime: '11:30',
          role: 'arrival' as const,
          transportKind: 'flight' as const,
        }],
      }],
      places: [],
      excludedRequiredPlaces: [],
      clusters: [],
      limits: { maxPlaces: 25, maxDays: 21, maxRepairIterations: 2 },
    } satisfies PlanningMaterial;

    expect(validateItineraryProposal([day], material)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'activity-overlap', message: expect.stringMatching(/overlaps HND → KIX/) }),
    ]));
  });

  it('E. reports a Must Do that cannot fit around a flight and leaves the flight untouched', async () => {
    const source = itinerary({
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        decisions: { 'osm-n2': 'must-do' },
      },
      days: [
        { day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle] },
        {
          day: 2,
          date: '2026-08-18',
          city: 'Osaka',
          activities: [dotonbori, flight({ time: '10:00', durationMinutes: 120, name: 'KIX → HND' })],
        },
      ],
    });
    const { proposal } = await propose(source, {
      composition: {
        days: [
          { day: 1, placeIds: ['discovered-osm-n1'] },
          { day: 2, placeIds: ['discovered-osm-n2'] },
        ],
      },
    });
    const applied = applyProposalToItinerary(source, proposal);
    const preserved = (applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>)[1]
      ?.activities.find((activity) => activity.id === 'flight-1');

    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'must-do-omitted',
        placeId: 'discovered-osm-n2',
        message: expect.stringMatching(/could not fit before your departure/i),
      }),
    ]));
    expect(placeItems(proposal, 2).some((item) => overlaps(item, '10:00', '12:00'))).toBe(false);
    expect(preserved).toEqual(expect.objectContaining({
      id: 'flight-1', time: '10:00', durationMinutes: 120, type: 'flight', name: 'KIX → HND',
    }));
  });

  it('F. does not force sightseeing into a day consumed by fixed transport', async () => {
    const { material, proposal } = await propose(itinerary({
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        activities: [castle, flight({ time: '08:00', durationMinutes: 600, name: 'Long haul' })],
      }],
    }), {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });

    expect(material.days[0]?.maxMainActivities).toBe(0);
    expect(placeItems(proposal, 1)).toHaveLength(0);
    expect(proposal.conflicts.map((conflict) => `${conflict.code} ${conflict.message}`).join(' '))
      .toMatch(/no usable planning window|before you arrive|arrival-day/i);
  });

  it('G. keeps multi-city activities on the correct side of transport', async () => {
    const { material, proposal } = await propose(itinerary({
      cities: ['Osaka', 'Tokyo'],
      days: [
        {
          day: 1,
          date: '2026-08-17',
          city: 'Osaka',
          activities: [
            castle,
            {
              id: 'osaka-tokyo',
              kind: 'transport',
              type: 'travel',
              time: '14:00',
              durationMinutes: 150,
              name: 'Osaka → Tokyo',
              description: 'Shinkansen',
            },
          ],
        },
        { day: 2, date: '2026-08-18', city: 'Tokyo', activities: [sensoji] },
      ],
    }), {
      composition: {
        days: [
          { day: 1, placeIds: ['discovered-osm-n1'] },
          { day: 2, placeIds: ['discovered-osm-n3'] },
        ],
      },
    });

    expect(material.days[0]?.fixedEvents?.[0]).toMatchObject({
      id: 'osaka-tokyo', role: 'transfer', transportKind: 'transport',
    });
    expect(placeItems(proposal, 1).every((item) => !endsAfter(item, '14:00'))).toBe(true);
    expect(placeItems(proposal, 1).some((item) => item.placeId === 'discovered-osm-n3')).toBe(false);
    expect(placeItems(proposal, 2).every((item) => item.placeId === 'discovered-osm-n3')).toBe(true);
  });

  it('H. keeps the fixed flight byte-identical after proposal→Apply', async () => {
    const source = itinerary();
    const inbound = flight();
    const { proposal } = await propose(source, {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });
    const applied = applyProposalToItinerary(source, proposal);
    const preserved = (applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>)[0]
      ?.activities.find((activity) => activity.id === 'flight-1');

    expect(preserved).toEqual(inbound);
    expect((applied.itinerary.days as Array<{ activities: Array<Record<string, unknown>> }>)[0]
      ?.activities.filter((activity) => activity.type === 'flight')).toHaveLength(1);
  });

  it('I. restores the previous itinerary on Undo with a monotonic revision', async () => {
    const before = itinerary({ revision: 5 });
    const { proposal } = await propose(before, {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });
    const applied = applyProposalToItinerary(before, proposal).itinerary;
    const undone = undoRestore(before, applied);
    const beforeBody = { ...before as Record<string, unknown> };
    const undoneBody = { ...undone };
    delete beforeBody.revision;
    delete undoneBody.revision;

    expect(applied.revision).toBe(6);
    expect(undone.revision).toBe(7);
    expect(undoneBody).toEqual(beforeBody);
    expect(canonicalJson(undoneBody)).toBe(canonicalJson(beforeBody));
    expect(isNewerItineraryRevision(undone as never, applied as never)).toBe(true);
  });

  it('J. changes the material revision when flight timing changes', async () => {
    const first = await buildPlanningMaterial('trip-1', itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '08:00' })] }],
    }));
    const changed = await buildPlanningMaterial('trip-1', itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '10:30' })] }],
    }));

    expect(changed.revision).not.toBe(first.revision);
    expect(changed.days[0]?.fixedEvents?.[0]?.startTime).toBe('10:30');
  });

  it('K. keeps the material revision stable when flight data is unchanged', async () => {
    const first = await buildPlanningMaterial('trip-1', itinerary());
    const same = await buildPlanningMaterial('trip-1', itinerary());

    expect(same.revision).toBe(first.revision);
  });

  it('L. does not invent a transfer duration when the airport route is unavailable', async () => {
    const source = itinerary({
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        activities: [castle, flight({ time: '08:00', coordinates: [34.434, 135.244] })],
      }],
    });
    const { proposal } = await propose(source, {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
      route: [],
    });
    const first = placeItems(proposal, 1)[0];

    expect(first?.travelFromPrevious?.durationMinutes).toBeUndefined();
    expect(first?.travelFromPrevious?.source === 'unavailable' || first?.travelFromPrevious === undefined).toBe(true);
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'route-unavailable', message: expect.stringMatching(/no travel duration was invented/i) }),
    ]));
    expect(proposal.routeSummary.allDurationsProviderDerived).toBe(true);
  });

  it('M. may use a deterministic provider transfer when the airport route exists', async () => {
    const source = itinerary({
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        activities: [castle, flight({ time: '08:00', coordinates: [34.434, 135.244] })],
      }],
    });
    const { proposal, getRouteMatrix } = await propose(source, {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
      route: (ids) => matrix(ids, 37),
    });
    const first = placeItems(proposal, 1)[0];

    expect(getRouteMatrix).toHaveBeenCalledWith(expect.objectContaining({
      placeIds: expect.arrayContaining(['discovered-osm-n1', 'flight-1']),
      mode: 'walking',
    }));
    expect(first?.travelFromPrevious).toMatchObject({
      fromPlaceId: 'flight-1',
      durationMinutes: 37,
      source: 'provider',
      status: 'confirmed',
    });
  });

  it('N. relaxed, balanced, and packed pace all stay inside the flight window', async () => {
    const withPace = (moods: string[]) => itinerary({
      tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'], moods },
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, dotonbori, flight({ time: '08:00', durationMinutes: 90 })] }],
    });
    const cases = [
      { moods: ['calm'], label: 'relaxed' },
      { moods: [], label: 'balanced' },
      { moods: ['fast-paced'], label: 'fast' },
    ];

    for (const entry of cases) {
      const { material, proposal } = await propose(withPace(entry.moods), {
        composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1', 'discovered-osm-n2'] }] },
      });
      expect(material.pace === 'relaxed' || material.pace === 'balanced' || material.pace === 'fast').toBe(true);
      expect(placeItems(proposal, 1).every((item) => !startsBefore(item, material.days[0]!.startTime))).toBe(true);
      expect(placeItems(proposal, 1).some((item) => overlaps(item, '08:00', '09:30'))).toBe(false);
    }
  });

  it('O. does not return a cached proposal produced against old flight timing', async () => {
    const original = itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '08:00' })] }],
    });
    const moved = itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '12:00' })] }],
    });
    const originalMaterial = await buildPlanningMaterial('trip-1', original);
    const movedMaterial = await buildPlanningMaterial('trip-1', moved);
    expect(movedMaterial.revision).not.toBe(originalMaterial.revision);

    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: moved,
      maxInputChars: 20_000,
      readCache: async () => ({
        kind: 'itinerary-proposal-v1',
        id: 'proposal-old-flight',
        tripId: 'trip-1',
        materialRevision: originalMaterial.revision,
        createdAt: '2026-08-17T08:00:00.000Z',
        status: 'valid',
        applied: false,
        pace: 'balanced',
        days: [],
        conflicts: [],
        warnings: [],
        omittedPlaceIds: [],
        routeSummary: { matrixCalls: 0, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
        repairIterations: 0,
      }),
    });

    expect(lookup.kind).toBe('miss');
  });

  it('P. never uses a GPT-estimated flight or airport duration', async () => {
    const engine = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/itineraryProposal.ts'),
      'utf8',
    );
    expect(engine).not.toMatch(/openai|gpt-|estimated airport|45 minutes to (the )?airport/i);
    const { proposal } = await propose(itinerary(), {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
      route: [],
    });
    expect(proposal.routeSummary.allDurationsProviderDerived).toBe(true);
    expect(proposal.days.flatMap((day) => day.items).every((item) =>
      item.travelFromPrevious?.durationMinutes === undefined
      || item.travelFromPrevious.source === 'provider'
      || item.travelFromPrevious.source === 'cache')).toBe(true);
  });

  it('recognises a Flight created through the Add Flight form as a timed fixed event', async () => {
    const committed = applyActivityDuration({
      type: 'flight',
      time: '10:00',
      name: 'HND → KIX',
      description: 'Added manually',
    }, '2', '0');
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    const source = sanitizeItinerary(itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, committed.activity] }],
    }) as never, emptyItinerary);
    const savedFlight = source.days[0].activities.find((activity) => activity.type === 'flight')!;
    const { material, proposal } = await propose(JSON.parse(JSON.stringify(source)) as Record<string, unknown>, {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });

    expect(isPlannerPlace({ ...savedFlight })).toBe(false);
    expect(material.days[0]?.fixedEvents).toEqual([expect.objectContaining({
      role: 'arrival',
      transportKind: 'flight',
      startTime: '10:00',
      endTime: '12:00',
    })]);
    expect(material.days[0]?.startTime).toBe('14:00');
    expect(placeItems(proposal, 1).every((item) => !startsBefore(item, '14:00'))).toBe(true);
  });

  it('still ignores a legacy Flight that has no durationMinutes', async () => {
    const { material } = await propose(itinerary({
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        activities: [castle, { id: 'flight-legacy', time: '10:00', name: 'HND → KIX', description: '', type: 'flight' }],
      }],
    }), {
      composition: { days: [{ day: 1, placeIds: ['discovered-osm-n1'] }] },
    });

    expect(material.days[0]?.fixedEvents ?? []).toEqual([]);
    expect(material.days[0]?.startTime).not.toBe('14:00');
  });

  it('changes planning material revision when only the flight duration changes', async () => {
    const twoHours = itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '10:00', durationMinutes: 120 })] }],
    });
    const threeHours = itinerary({
      days: [{ day: 1, date: '2026-08-17', city: 'Osaka', activities: [castle, flight({ time: '10:00', durationMinutes: 180 })] }],
    });
    const originalMaterial = await buildPlanningMaterial('trip-1', twoHours);
    const editedMaterial = await buildPlanningMaterial('trip-1', threeHours);
    expect(editedMaterial.revision).not.toBe(originalMaterial.revision);

    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: threeHours,
      maxInputChars: 20_000,
      readCache: async () => ({
        kind: 'itinerary-proposal-v1',
        id: 'proposal-old-duration',
        tripId: 'trip-1',
        materialRevision: originalMaterial.revision,
        createdAt: '2026-08-17T08:00:00.000Z',
        status: 'valid',
        applied: false,
        pace: 'balanced',
        days: [],
        conflicts: [],
        warnings: [],
        omittedPlaceIds: [],
        routeSummary: { matrixCalls: 0, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
        repairIterations: 0,
      }),
    });
    expect(lookup.kind).toBe('miss');
  });
});

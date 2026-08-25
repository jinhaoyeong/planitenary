import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanningMaterial,
  defaultComposition,
  runItineraryProposalEngine,
  validateItineraryProposal,
  type ModelItineraryComposition,
  type PlanningMaterial,
  type PlanningPlace,
  type ProposedItineraryDay,
  type RouteMatrixLeg,
} from '../../supabase/functions/_shared/itineraryProposal';

const hours = [{ opensAt: '09:00', closesAt: '20:00', days: [1, 2, 3, 4, 5, 6, 0] }];

const place = (id: string, override: Partial<PlanningPlace> = {}): PlanningPlace => ({
  id,
  name: `Place ${id.toUpperCase()}`,
  city: 'Osaka',
  cluster: id === 'c' ? 'North' : 'Central',
  coordinates: [34.68 + id.charCodeAt(0) / 10_000, 135.5],
  categories: ['sight'],
  priority: 'interested',
  durationRangeMinutes: [60, 90],
  openingHours: hours,
  sourceUrls: [`https://example.test/${id}`],
  locked: false,
  reservation: false,
  ...override,
  source: override.source ?? 'saved',
});

const material = (override: Partial<PlanningMaterial> = {}): PlanningMaterial => ({
  version: 1,
  tripId: 'trip-1',
  revision: 'plan-v1-test',
  name: 'Osaka trip',
  cities: ['Osaka'],
  pace: 'balanced',
  styles: ['history'],
  tripTypes: ['couple'],
  moods: ['calm'],
  transportModes: ['public-transport'],
  preferences: { hiddenGems: true },
  days: [
    { day: 1, date: '2026-08-17', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:15', endTime: '21:30', maxMainActivities: 3, fixedPlaceIds: [] },
    { day: 2, date: '2026-08-18', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:15', endTime: '21:30', maxMainActivities: 3, fixedPlaceIds: [] },
  ],
  places: [place('a'), place('b')],
  excludedRequiredPlaces: [],
  clusters: [{ id: 'osaka::central', city: 'Osaka', placeIds: ['a', 'b'] }],
  limits: { maxPlaces: 25, maxDays: 21, maxRepairIterations: 2 },
  ...override,
  intent: override.intent ?? { scope: { type: 'trip' }, sourcePolicy: 'saved-only', cachePolicy: 'prefer-cache' },
  savedPlaceCount: override.savedPlaceCount ?? 2,
  suggestedPlaceCount: override.suggestedPlaceCount ?? 0,
});

const matrix = (ids: string[], duration = 27): RouteMatrixLeg[] => ids.flatMap((from) =>
  ids.flatMap((to) => from === to ? [] : [{
    fromPlaceId: from,
    toPlaceId: to,
    status: 'ok' as const,
    durationMinutes: duration,
    distanceMeters: 3_000,
    mode: 'walking' as const,
    source: 'provider' as const,
  }]));

const run = (
  source: PlanningMaterial,
  composition: ModelItineraryComposition,
  route = matrix(source.places.map((entry) => entry.id)),
) => runItineraryProposalEngine(source, {
  chooseComposition: vi.fn().mockResolvedValue(composition),
  getRouteMatrix: vi.fn().mockResolvedValue(route),
  now: () => '2026-08-16T08:00:00.000Z',
});

describe('Phase 2A deterministic itinerary proposal', () => {
  it('never silently omits a Must do place', async () => {
    const source = material({ places: [place('a', { priority: 'must-do' }), place('b')] });
    const proposal = await run(source, { days: [{ day: 1, placeIds: ['b'] }, { day: 2, placeIds: [] }] });

    expect(proposal.status).toBe('needs-review');
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'must-do-omitted', placeId: 'a', severity: 'error' }),
    ]));
    expect(proposal.repairIterations).toBe(2);
  });

  it('reports required places beyond the bounded 25-place route matrix', async () => {
    const activities = Array.from({ length: 26 }, (_, index) => ({
      id: `place-${index}`,
      name: `Place ${index}`,
      durationMinutes: 60,
      coordinates: [34.6 + index / 10_000, 135.5],
    }));
    const source = await buildPlanningMaterial('trip-1', {
      tripProfile: { styles: [] },
      planningConstraints: { mustDoActivityIds: activities.map((activity) => activity.id) },
      days: [{ day: 1, city: 'Osaka', activities }],
    });
    const proposal = await run(source, { days: [{ day: 1, placeIds: [] }] }, []);

    expect(source.places).toHaveLength(25);
    expect(source.excludedRequiredPlaces).toEqual([{ id: 'place-25', name: 'Place 25' }]);
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'must-do-omitted', placeId: 'place-25' }),
    ]));
  });

  it('changes the exact proposal revision when planning preferences change', async () => {
    const itinerary = {
      cities: ['Osaka'],
      tripProfile: {
        styles: ['history'],
        tripTypes: ['couple'],
        moods: ['calm'],
        transport: ['public-transport'],
        hiddenGems: true,
      },
      planningConstraints: { accommodationLocation: 'Namba', accommodationCoordinates: [34.67, 135.5] },
      days: [{ day: 1, city: 'Osaka', activities: [] }],
    };
    const first = await buildPlanningMaterial('trip-1', itinerary);
    const changed = await buildPlanningMaterial('trip-1', {
      ...itinerary,
      tripProfile: { ...itinerary.tripProfile, styles: ['food'] },
    });

    expect(first.revision).not.toBe(changed.revision);
    expect(first).toMatchObject({
      tripTypes: ['couple'],
      moods: ['calm'],
      transportModes: ['public-transport'],
      preferences: { hiddenGems: true },
    });
  });

  it('copies every visible travel time from one batched route result', async () => {
    const getRouteMatrix = vi.fn().mockResolvedValue(matrix(['a', 'b'], 27));
    const proposal = await runItineraryProposalEngine(material(), {
      chooseComposition: vi.fn().mockResolvedValue({ days: [{ day: 1, placeIds: ['a', 'b'] }, { day: 2, placeIds: [] }] }),
      getRouteMatrix,
      now: () => '2026-08-16T08:00:00.000Z',
    });
    const second = proposal.days[0].items.find((item) => item.placeId === 'b');

    expect(getRouteMatrix).toHaveBeenCalledTimes(1);
    expect(getRouteMatrix).toHaveBeenCalledWith({ placeIds: ['a', 'b'], mode: 'walking' });
    expect(second?.travelFromPrevious).toMatchObject({ durationMinutes: 27, source: 'provider', status: 'confirmed' });
    expect(proposal.routeSummary).toMatchObject({ matrixCalls: 1, confirmedLegs: 1, allDurationsProviderDerived: true });
  });

  it('leaves unavailable routes explicit and never creates an estimated duration', async () => {
    const proposal = await run(
      material(),
      { days: [{ day: 1, placeIds: ['a', 'b'] }, { day: 2, placeIds: [] }] },
      [],
    );
    const second = proposal.days[0].items.find((item) => item.placeId === 'b');

    expect(second?.travelFromPrevious).toMatchObject({
      status: 'unavailable',
      source: 'unavailable',
    });
    expect(second?.travelFromPrevious?.durationMinutes).toBeUndefined();
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'route-unavailable', placeId: 'b' }),
    ]));
  });

  it('rejects a place that cannot fit before its verified closing time', async () => {
    const source = material({
      places: [place('a', { durationRangeMinutes: [120, 120], openingHours: [{ opensAt: '09:00', closesAt: '10:00' }] })],
    });
    const proposal = await run(source, { days: [{ day: 1, placeIds: ['a'] }, { day: 2, placeIds: [] }] }, []);

    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'opening-hours-conflict', placeId: 'a' }),
    ]));
  });

  it('applies the arrival buffer and rejects an overfilled arrival day', async () => {
    const source = await buildPlanningMaterial('trip-1', {
      name: 'Late arrival',
      cities: ['Osaka'],
      tripProfile: { arrivalTime: '16:00', startDate: '2026-08-17', moods: [], tripTypes: [], styles: [] },
      days: [{ day: 1, city: 'Osaka', activities: [] }],
      unassignedActivities: [
        { id: 'a', name: 'Museum', type: 'sight', durationMinutes: 60, coordinates: [34.6, 135.5] },
      ],
    });
    const proposal = await run(source, { days: [{ day: 1, placeIds: ['a'] }] }, []);

    expect(source.days[0]).toMatchObject({ startTime: '18:00', maxMainActivities: 0 });
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'arrival-day-infeasible', day: 1 }),
    ]));
  });

  it('keeps the final day clear of the departure lead time', async () => {
    const source = material({
      departureTime: '12:00',
      days: [
        { day: 1, date: '2026-08-17', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:15', endTime: '21:30', maxMainActivities: 3, fixedPlaceIds: [] },
        { day: 2, date: '2026-08-18', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:15', endTime: '08:30', maxMainActivities: 1, fixedPlaceIds: [] },
      ],
      places: [place('a')],
    });
    const proposal = await run(source, { days: [{ day: 1, placeIds: [] }, { day: 2, placeIds: ['a'] }] }, []);

    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'departure-day-infeasible', day: 2, placeId: 'a' }),
    ]));
  });

  it('detects overlapping locked reservations', async () => {
    const source = material({
      places: [
        place('a', { priority: 'locked', locked: true, reservation: true, fixedDay: 1, fixedStartTime: '10:00', durationRangeMinutes: [120, 120] }),
        place('b', { priority: 'locked', locked: true, reservation: true, fixedDay: 1, fixedStartTime: '11:00', durationRangeMinutes: [60, 60] }),
      ],
      days: [
        { day: 1, date: '2026-08-17', stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '09:15', endTime: '21:30', maxMainActivities: 3, fixedPlaceIds: ['a', 'b'] },
      ],
    });
    const proposal = await run(source, { days: [{ day: 1, placeIds: [] }] });

    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'fixed-reservation-conflict', day: 1 }),
    ]));
  });

  it('makes relaxed pace lower-density with larger transition buffers', async () => {
    const places = [place('a'), place('b'), place('c'), place('d')];
    const relaxed = material({ pace: 'relaxed', places, days: [
      { day: 1, stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '10:00', endTime: '20:30', maxMainActivities: 2, fixedPlaceIds: [] },
      { day: 2, stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '10:00', endTime: '20:30', maxMainActivities: 2, fixedPlaceIds: [] },
    ] });
    const fast = material({ pace: 'fast', places, days: [
      { day: 1, stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '08:30', endTime: '22:00', maxMainActivities: 4, fixedPlaceIds: [] },
      { day: 2, stayCity: 'Osaka', activityCities: [], city: 'Osaka', startTime: '08:30', endTime: '22:00', maxMainActivities: 4, fixedPlaceIds: [] },
    ] });
    const relaxedComposition = defaultComposition(relaxed);
    const fastComposition = defaultComposition(fast);
    const relaxedProposal = await run(relaxed, relaxedComposition, matrix(['a', 'b', 'c', 'd']));
    const fastProposal = await run(fast, fastComposition, matrix(['a', 'b', 'c', 'd']));

    expect(relaxedComposition.days[0].placeIds).toHaveLength(2);
    expect(fastComposition.days[0].placeIds).toHaveLength(4);
    expect(relaxedProposal.days[0].items.find((item) => item.travelFromPrevious)?.bufferMinutes).toBe(35);
    expect(fastProposal.days[0].items.find((item) => item.travelFromPrevious)?.bufferMinutes).toBe(18);
  });

  it('catches overlaps in a proposal built outside the scheduler', () => {
    const day: ProposedItineraryDay = {
      day: 1,
      stayCity: 'Osaka',
      activityCities: [],
      city: 'Osaka',
      startTime: '09:15',
      endTime: '21:30',
      warnings: [],
      metrics: { placeCount: 2, travelMinutes: 0, freeMinutes: 0, clusterChanges: 0 },
      items: [
        { id: 'a', placeId: 'a', type: 'place', name: 'A', arrivalTime: '10:00', startTime: '10:00', endTime: '12:00', visitDurationMinutes: 120, bufferMinutes: 0, rationale: '', warnings: [], evidence: [] },
        { id: 'b', placeId: 'b', type: 'place', name: 'B', arrivalTime: '11:30', startTime: '11:30', endTime: '12:30', visitDurationMinutes: 60, bufferMinutes: 0, rationale: '', warnings: [], evidence: [] },
      ],
    };
    expect(validateItineraryProposal([day], material())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'activity-overlap', day: 1 }),
    ]));
  });

  it('caps the repair loop at two iterations and never mutates its input', async () => {
    const source = material({ places: [place('a', { priority: 'must-do' })] });
    const before = JSON.stringify(source);
    const chooseComposition = vi.fn().mockResolvedValue({ days: [{ day: 1, placeIds: [] }, { day: 2, placeIds: [] }] });
    const proposal = await runItineraryProposalEngine(source, {
      chooseComposition,
      getRouteMatrix: vi.fn().mockResolvedValue([]),
      now: () => '2026-08-16T08:00:00.000Z',
    });

    expect(chooseComposition).toHaveBeenCalledTimes(3);
    expect(proposal.repairIterations).toBe(2);
    expect(proposal.applied).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
});

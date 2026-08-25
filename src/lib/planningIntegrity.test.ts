import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanningMaterial,
  planningPlaceFromDiscoveryCandidate,
  planningPreflight,
  runItineraryProposalEngine,
  scopePlanningMaterial,
  type PlanningMaterial,
  type PlanningPlace,
} from '../../supabase/functions/_shared/itineraryProposal';
import { usableCachedItineraryProposal } from '../../supabase/functions/_shared/itineraryProposalCache';
import type { PlanningRequest } from '../../supabase/functions/_shared/planningIntent';

const dayRequest: PlanningRequest = {
  scope: { type: 'day', day: 1 },
  sourcePolicy: 'saved-plus-suggestions',
  cachePolicy: 'prefer-cache',
};

const itinerary = (activities: unknown[] = []) => ({
  id: 'trip-1',
  revision: 3,
  name: 'Tokyo',
  cities: ['Tokyo'],
  tripProfile: {
    destinations: [{ city: 'Tokyo', countryCode: 'JP' }],
    styles: ['cafes'],
    transport: ['public-transport'],
  },
  days: [{
    day: 1,
    date: '2026-08-12',
    stayCity: 'Tokyo',
    city: 'Tokyo',
    activities,
  }],
});

const savedActivity = (id: string) => ({
  id,
  kind: 'place',
  time: '10:00',
  durationMinutes: 75,
  name: `Saved ${id}`,
  city: 'Tokyo',
  location: 'Shinjuku',
  type: 'sight',
  provider: 'osm',
  providerPlaceId: id,
  placeRef: { canonicalPlaceId: `canonical-${id}`, provider: 'osm', providerPlaceId: id },
  coordinates: [35.68, 139.76],
  sourceReferences: [{ label: 'OSM', url: `https://www.openstreetmap.org/${id}` }],
});

const run = (material: PlanningMaterial, progress: string[] = []) => runItineraryProposalEngine(material, {
  chooseComposition: vi.fn().mockResolvedValue(undefined),
  getRouteMatrix: vi.fn().mockResolvedValue([]),
  now: () => '2026-08-25T12:00:00.000Z',
  onProgress: (stage) => progress.push(stage),
});

const suggestion = (id = 'n42'): PlanningPlace => {
  const place = planningPlaceFromDiscoveryCandidate({
    id: `osm-${id}`,
    name: 'Shinjuku Gyoen',
    city: 'Tokyo',
    neighbourhood: 'Shinjuku',
    coordinates: [35.6852, 139.7101],
    categories: ['garden'],
    estimatedVisitMinutes: 90,
    indoorOutdoor: 'outdoor',
    placeRef: { canonicalPlaceId: `canonical-${id}`, provider: 'osm', providerPlaceId: id },
    sourceReferences: [{ label: 'OSM', url: `https://www.openstreetmap.org/${id}` }],
  });
  if (!place) throw new Error('Fixture should be a verified planning place.');
  return place;
};

describe('planning integrity', () => {
  it('assigns eligible saved material inside an explicit day scope', async () => {
    const base = await buildPlanningMaterial('trip-1', itinerary([savedActivity('n1')]));
    const scoped = await scopePlanningMaterial(base, dayRequest);
    const proposal = await run(scoped);

    expect(proposal.status).toBe('valid');
    expect(proposal.meta).toMatchObject({ scope: { type: 'day', day: 1 }, assignedCount: 1, savedPlaceCount: 1 });
    expect(proposal.days[0].items.some((item) => item.placeId === 'n1')).toBe(true);
  });

  it('turns verified discovery material into a proposal-only suggested assignment', async () => {
    const base = await buildPlanningMaterial('trip-1', itinerary());
    const candidate = suggestion();
    const preflight = planningPreflight(base, dayRequest, [candidate]);
    const scoped = await scopePlanningMaterial(base, dayRequest, [candidate]);
    const proposal = await run(scoped);

    expect(preflight).toMatchObject({ eligibleSavedPlaces: 0, suggestedPlaces: 1 });
    expect(proposal.status).toBe('valid');
    expect(proposal.meta).toMatchObject({ suggestedPlaceCount: 1, assignedCount: 1 });
    expect(proposal.days[0].items[0].suggestedPlace?.ref.canonicalPlaceId).toBe('canonical-n42');
  });

  it('never validates a structurally correct but empty proposal', async () => {
    const base = await buildPlanningMaterial('trip-1', itinerary());
    const scoped = await scopePlanningMaterial(base, { ...dayRequest, sourcePolicy: 'saved-only' });
    const proposal = await run(scoped);

    expect(proposal.status).toBe('needs-review');
    expect(proposal.meta.assignedCount).toBe(0);
    expect(proposal.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty-proposal', severity: 'error' }),
    ]));
    expect(usableCachedItineraryProposal(proposal, proposal.tripId, proposal.materialRevision)).toBeNull();
  });

  it('reports route progress only when a route matrix actually runs', async () => {
    const oneBase = await buildPlanningMaterial('trip-1', itinerary([savedActivity('n1')]));
    const one = await scopePlanningMaterial(oneBase, dayRequest);
    const oneProgress: string[] = [];
    await run(one, oneProgress);
    expect(oneProgress).not.toContain('routing_started');

    const twoBase = await buildPlanningMaterial('trip-1', itinerary([savedActivity('n1'), savedActivity('n2')]));
    const two = await scopePlanningMaterial(twoBase, dayRequest);
    const twoProgress: string[] = [];
    await run(two, twoProgress);
    expect(twoProgress).toEqual(expect.arrayContaining(['routing_started', 'routing_complete']));
  });
});

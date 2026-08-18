/**
 * Skip / Visited planning eligibility V1.
 *
 * Discovery already stores these decisions. Plan my trip must exclude them
 * from deterministic material before any model composition. Nothing here
 * calls a model or a paid provider.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyProposalToItinerary } from '../../supabase/functions/_shared/itineraryChange';
import {
  buildPlanningMaterial,
  parseModelComposition,
  runItineraryProposalEngine,
  type RouteMatrixLeg,
} from '../../supabase/functions/_shared/itineraryProposal';
import { candidateToActivity } from './destinationIntelligence';
import type { PlaceCandidate } from './destinationIntelligence';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import type { Activity, Itinerary } from '../data';

const osmCandidate = (
  providerPlaceId: string,
  name: string,
  coordinates: [number, number],
  overrides: Partial<PlaceCandidate> = {},
): PlaceCandidate => ({
  id: `osm-${providerPlaceId}`,
  provider: 'osm',
  providerPlaceId,
  name,
  city: 'Osaka',
  neighbourhood: 'Chuo',
  countryCode: 'JP',
  categories: ['sight'],
  experienceTags: ['sight'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'outdoor',
  reservationStatus: 'not-needed',
  coordinates,
  sourceReferences: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${providerPlaceId}` }],
  sourceConfidence: 'medium',
  lastVerifiedAt: '2026-08-17T00:00:00.000Z',
  ...overrides,
} as PlaceCandidate);

const glico = osmCandidate('n3507545614', 'Glico Man Sign', [34.6687, 135.5013]);
const kuromon = osmCandidate('w120847263', 'Kuromon Ichiba Market', [34.6653, 135.5062]);
const mint = osmCandidate('n1904772100', 'Mint Museum', [34.6947, 135.5197]);

const savedTrip = (
  candidates: PlaceCandidate[],
  decisions: Record<string, string>,
  overrides: Partial<Itinerary> = {},
): Itinerary => sanitizeItinerary({
  ...emptyItinerary,
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
  revision: 4,
  tripProfile: { destinations: [{ id: 'osaka', city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  days: [{
    day: 1,
    date: '2026-08-17',
    city: 'Osaka',
    title: 'Day one',
    activities: candidates.map((candidate) => candidateToActivity(candidate)),
  }],
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    candidateIds: candidates.map((candidate) => candidate.id),
    decisions,
    discoveredAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    stage: 'itinerary-built',
  },
  ...overrides,
} as unknown, emptyItinerary);

const namesOf = async (itinerary: Itinerary): Promise<string[]> =>
  (await buildPlanningMaterial('trip-1', itinerary)).places.map((place) => place.name);

const priorities = async (itinerary: Itinerary): Promise<Record<string, string>> => Object.fromEntries(
  (await buildPlanningMaterial('trip-1', itinerary)).places.map((place) => [place.name, place.priority]),
);

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
  itinerary: Itinerary,
  compositionIds?: string[],
) => {
  const material = await buildPlanningMaterial('trip-1', itinerary);
  const ids = compositionIds ?? material.places.map((place) => place.id);
  const proposal = await runItineraryProposalEngine(material, {
    chooseComposition: vi.fn().mockResolvedValue({
      days: [{ day: 1, placeIds: ids }],
    }),
    getRouteMatrix: vi.fn().mockResolvedValue(matrix(material.places.map((place) => place.id))),
    now: () => '2026-08-17T08:00:00.000Z',
  });
  return { material, proposal };
};

const proposedPlaceIds = (proposal: { days: Array<{ items: Array<{ type: string; placeId?: string }> }> }) =>
  proposal.days.flatMap((day) => day.items.filter((item) => item.type === 'place' || item.type === 'reservation'))
    .map((item) => item.placeId);

describe('Skip / Visited planning eligibility', () => {
  it('A. still admits Must do', async () => {
    expect(await priorities(savedTrip([glico], { [glico.id]: 'must-do' }))).toEqual({
      'Glico Man Sign': 'must-do',
    });
  });

  it('B. still admits Interested', async () => {
    expect(await priorities(savedTrip([kuromon], { [kuromon.id]: 'interested' }))).toEqual({
      'Kuromon Ichiba Market': 'interested',
    });
  });

  it('C. excludes Skip from planning candidates', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'must-do' });
    expect(await namesOf(trip)).toEqual(['Kuromon Ichiba Market']);
  });

  it('D. excludes Visited from planning candidates', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'visited', [kuromon.id]: 'interested' });
    expect(await namesOf(trip)).toEqual(['Kuromon Ichiba Market']);
  });

  it('E/F. never puts Skip or Visited in model-visible candidate material', async () => {
    const trip = savedTrip([glico, kuromon, mint], {
      [glico.id]: 'skip',
      [kuromon.id]: 'must-do',
      [mint.id]: 'visited',
    });
    const material = await buildPlanningMaterial('trip-1', trip);
    const parsed = parseModelComposition({
      days: [{
        day: 1,
        placeIds: [
          'discovered-osm-n3507545614',
          'discovered-osm-n1904772100',
          'discovered-osm-w120847263',
        ],
        rationale: 'include excluded ids if the model tries',
      }],
    }, material);

    expect(material.places.map((place) => place.id)).toEqual(['discovered-osm-w120847263']);
    expect(JSON.stringify(material)).not.toContain('Glico Man Sign');
    expect(JSON.stringify(material)).not.toContain('Mint Museum');
    expect(parsed?.days[0]?.placeIds).toEqual(['discovered-osm-w120847263']);
  });

  it('G. Skip → Interested restores eligibility', async () => {
    const skipped = savedTrip([glico], { [glico.id]: 'skip' });
    const interested = savedTrip([glico], { [glico.id]: 'interested' });

    expect(await namesOf(skipped)).toEqual([]);
    expect(await priorities(interested)).toEqual({ 'Glico Man Sign': 'interested' });
  });

  it('H. Visited → Must do restores eligibility', async () => {
    const visited = savedTrip([glico], { [glico.id]: 'visited' });
    const mustDo = savedTrip([glico], { [glico.id]: 'must-do' });

    expect(await namesOf(visited)).toEqual([]);
    expect(await priorities(mustDo)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('I. Interested → Skip changes material revision, including when truncated', async () => {
    const filler = Array.from({ length: 30 }, (_, index) => osmCandidate(
      `n${8000000 + index}`,
      `Filler ${index}`,
      [34.66 + index / 10_000, 135.5],
    ));
    const decisions = Object.fromEntries(filler.map((candidate) => [candidate.id, 'interested']));
    const interested = savedTrip([...filler, glico], { ...decisions, [glico.id]: 'interested' });
    const skipped = savedTrip([...filler, glico], { ...decisions, [glico.id]: 'skip' });
    const interestedMaterial = await buildPlanningMaterial('trip-1', interested);
    const skippedMaterial = await buildPlanningMaterial('trip-1', skipped);

    expect(interestedMaterial.places.map((place) => place.name)).not.toContain('Glico Man Sign');
    expect(skippedMaterial.places.map((place) => place.name)).not.toContain('Glico Man Sign');
    expect(skippedMaterial.revision).not.toBe(interestedMaterial.revision);
    expect((await buildPlanningMaterial('trip-1', savedTrip([glico], { [glico.id]: 'interested' }))).revision)
      .not.toBe((await buildPlanningMaterial('trip-1', savedTrip([glico], { [glico.id]: 'skip' }))).revision);
  });

  it('J. Interested → Visited changes material revision', async () => {
    const interested = savedTrip([glico], { [glico.id]: 'interested' });
    const visited = savedTrip([glico], { [glico.id]: 'visited' });

    expect((await buildPlanningMaterial('trip-1', interested)).revision)
      .not.toBe((await buildPlanningMaterial('trip-1', visited)).revision);
  });

  it('K. an unchanged decision keeps a stable material revision', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'interested' });
    const first = await buildPlanningMaterial('trip-1', trip);
    const second = await buildPlanningMaterial('trip-1', trip);

    expect(second.revision).toBe(first.revision);
  });

  it('L. an ambiguous raw provider ID still does not inherit Skip', async () => {
    const otherProvider = osmCandidate('n3507545614', 'Namba Parks', [34.6614, 135.5021], {
      id: 'google-n3507545614',
      provider: 'google',
    });
    const trip = savedTrip([glico, otherProvider], { n3507545614: 'skip' });

    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'optional',
      'Namba Parks': 'optional',
    });
  });

  it('M. canonical candidate identity still wins over a stale legacy raw ID', async () => {
    const trip = savedTrip([glico, kuromon], {
      'osm-n3507545614': 'skip',
      n3507545614: 'must-do',
      [kuromon.id]: 'interested',
    });

    expect(await namesOf(trip)).toEqual(['Kuromon Ichiba Market']);
  });

  it('N. building material does not delete a skipped saved place or its decision', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'interested' });
    const before = JSON.stringify(trip);
    await buildPlanningMaterial('trip-1', trip);

    expect(JSON.stringify(trip)).toBe(before);
    expect(trip.days[0].activities.map((activity) => activity.name)).toContain('Glico Man Sign');
    expect(trip.discoveryState?.decisions[glico.id]).toBe('skip');
  });

  it('O. Apply preserves visited historical inbox content instead of deleting it', async () => {
    const scheduled = candidateToActivity(kuromon);
    const historical = candidateToActivity(mint);
    const trip = savedTrip([kuromon], { [kuromon.id]: 'interested', [mint.id]: 'visited' }, {
      days: [{
        day: 1,
        date: '2026-08-17',
        city: 'Osaka',
        title: 'Day one',
        activities: [scheduled],
      }],
      unassignedActivities: [historical],
    });
    const { proposal } = await propose(trip);
    const applied = applyProposalToItinerary(trip, proposal);
    const inbox = applied.itinerary.unassignedActivities as Activity[];
    const discovery = applied.itinerary.discoveryState as { decisions: Record<string, string> };

    expect(inbox.map((activity) => activity.id)).toContain(historical.id);
    expect(inbox.find((activity) => activity.id === historical.id)).toMatchObject({ name: 'Mint Museum' });
    expect(discovery.decisions[mint.id]).toBe('visited');
  });

  it('P. a generated proposal does not contain an excluded Skip place', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'must-do' });
    const { material, proposal } = await propose(trip, [
      'discovered-osm-n3507545614',
      'discovered-osm-w120847263',
    ]);

    expect(material.places.map((place) => place.name)).not.toContain('Glico Man Sign');
    expect(proposedPlaceIds(proposal)).toEqual(['discovered-osm-w120847263']);
    expect(proposal.conflicts.some((conflict) => conflict.placeId === 'discovered-osm-n3507545614')).toBe(false);
  });

  it('Q. a generated proposal does not contain an excluded Visited place', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'visited', [kuromon.id]: 'interested' });
    const { proposal } = await propose(trip, [
      'discovered-osm-n3507545614',
      'discovered-osm-w120847263',
    ]);

    expect(proposedPlaceIds(proposal)).toEqual(['discovered-osm-w120847263']);
  });

  it('does not treat Skip as a Must-do omission conflict', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'interested' }, {
      planningConstraints: { mustDoActivityIds: ['discovered-osm-n3507545614'] },
    });
    const { material, proposal } = await propose(trip);

    expect(material.places.map((place) => place.name)).toEqual(['Kuromon Ichiba Market']);
    expect(material.excludedRequiredPlaces).toEqual([]);
    expect(proposal.conflicts.some((conflict) => conflict.code === 'must-do-omitted')).toBe(false);
  });

  it('still admits a locked Skip/Visited place as fixed schedule', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'interested' });
    trip.days[0].activities = trip.days[0].activities.map((activity) => (
      activity.name === 'Glico Man Sign'
        ? { ...activity, locked: true, lockedFields: ['schedule'] }
        : activity
    ));
    const material = await buildPlanningMaterial('trip-1', trip);

    expect(material.places).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Glico Man Sign', priority: 'locked', locked: true }),
      expect.objectContaining({ name: 'Kuromon Ichiba Market', priority: 'interested' }),
    ]));
  });
});

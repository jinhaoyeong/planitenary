/**
 * Discovery priorities have to survive the save.
 *
 * A production acceptance run selected one place as Must do and two as
 * Interested, and `buildPlanningMaterial` reported `must-do: 0, interested: 0`.
 * The traveller's explicit choice was reaching the planner as `optional`, which
 * is harmless while proposals are read-only and is not harmless the moment one
 * can be applied. These tests run the real save path — a provider candidate
 * through `candidateToActivity`, through `sanitizeItinerary`, into
 * `buildPlanningMaterial` — because every identity in this bug was created by
 * one of those steps.
 *
 * Nothing here touches a model or a route provider.
 */
import { describe, expect, it } from 'vitest';
import { buildPlanningMaterial } from '../../supabase/functions/_shared/itineraryProposal';
import { candidateToActivity } from './destinationIntelligence';
import type { PlaceCandidate } from './destinationIntelligence';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import type { Activity, Itinerary } from '../data';

/**
 * Shaped exactly as `travel-discover` supplies it: OpenStreetMap's own
 * `n<id>`/`w<id>` place ID, with the candidate ID being that prefixed by the
 * provider name.
 */
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

/** The trip as it exists after the discovery UI has applied a plan and saved. */
const savedTrip = (
  candidates: PlaceCandidate[],
  decisions: Record<string, string>,
  overrides: Partial<Itinerary> = {},
): Itinerary => sanitizeItinerary({
  ...emptyItinerary,
  id: 'trip-1',
  name: 'Osaka to Nara',
  cities: ['Osaka'],
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

const priorities = async (itinerary: Itinerary): Promise<Record<string, string>> => Object.fromEntries(
  (await buildPlanningMaterial('trip-1', itinerary)).places.map((place) => [place.name, place.priority]),
);

describe('discovery priorities reach the planner', () => {
  it('carries a Must do from the discovery panel into planning material', async () => {
    // The exact production case: the decision is keyed by `osm-n3507545614`
    // while the saved place is `discovered-osm-n3507545614`.
    const trip = savedTrip([glico], { [glico.id]: 'must-do' });

    expect(trip.days[0].activities[0].id).toBe('discovered-osm-n3507545614');
    expect(await priorities(trip)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('carries an Interested decision through the same save path', async () => {
    const trip = savedTrip([kuromon, mint], { [kuromon.id]: 'interested', [mint.id]: 'interested' });

    expect(await priorities(trip)).toEqual({
      'Kuromon Ichiba Market': 'interested',
      'Mint Museum': 'interested',
    });
  });

  it('resolves the whole shortlist the way the traveller marked it', async () => {
    const trip = savedTrip([glico, kuromon, mint], {
      [glico.id]: 'must-do',
      [kuromon.id]: 'interested',
      [mint.id]: 'interested',
    });
    const material = await buildPlanningMaterial('trip-1', trip);

    expect(material.places.filter((place) => place.priority === 'must-do')).toHaveLength(1);
    expect(material.places.filter((place) => place.priority === 'interested')).toHaveLength(2);
    // Must do sorts ahead of Interested, which is what protects it from the
    // 25-place truncation.
    expect(material.places.map((place) => place.priority))
      .toEqual(['must-do', 'interested', 'interested']);
  });

  it('keeps the provider identity that the decision is resolved from', async () => {
    const trip = savedTrip([glico], { [glico.id]: 'must-do' });
    const saved = trip.days[0].activities[0];

    // `sanitizeActivity` is the only thing standing between the panel and
    // storage; if it drops either identity the lookup has nothing to match on.
    expect(saved.providerPlaceId).toBe('n3507545614');
    expect(saved.provider).toBe('osm');
  });

  it('resolves a legacy decision keyed by the provider place ID alone', async () => {
    // Read compatibility only — older stored decisions are never rewritten.
    const trip = savedTrip([glico], { n3507545614: 'must-do' });

    expect(await priorities(trip)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('lets the current decision win over a stale bare-ID one for the same place', async () => {
    const trip = savedTrip([glico], { 'osm-n3507545614': 'must-do', n3507545614: 'interested' });

    expect(await priorities(trip)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('lets a provider-qualified decision win over a stale bare-ID one', async () => {
    const trip = savedTrip([glico], { 'osm-n3507545614': 'must-do', n3507545614: 'interested' });
    const withoutCandidateId: Itinerary = {
      ...trip,
      days: [{
        ...trip.days[0],
        activities: trip.days[0].activities.map((activity): Activity => ({ ...activity, id: 'activity-legacy-91af2c' })),
      }],
    };

    // The place no longer carries its candidate ID, so `osm-n3507545614` can
    // only be reached by rebuilding it from provider + providerPlaceId.
    expect(await priorities(withoutCandidateId)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('does not let two providers sharing a raw place ID inherit each other’s decision', async () => {
    const otherProvider = osmCandidate('n3507545614', 'Namba Parks', [34.6614, 135.5021], {
      id: 'google-n3507545614',
      provider: 'google',
    });
    const trip = savedTrip([glico, otherProvider], { n3507545614: 'must-do' });

    // The raw ID names two different places, so it names neither. Failing
    // closed loses a legacy decision; guessing would promote the wrong place.
    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'optional',
      'Namba Parks': 'optional',
    });
  });

  it('keeps the canonical decision exact even when the raw ID is ambiguous', async () => {
    const otherProvider = osmCandidate('n3507545614', 'Namba Parks', [34.6614, 135.5021], {
      id: 'google-n3507545614',
      provider: 'google',
    });
    const trip = savedTrip([glico, otherProvider], {
      'osm-n3507545614': 'must-do',
      n3507545614: 'interested',
    });

    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'must-do',
      'Namba Parks': 'optional',
    });
  });

  it('does not let an ambiguous bare Must do constraint promote another provider’s place', async () => {
    const otherProvider = osmCandidate('n3507545614', 'Namba Parks', [34.6614, 135.5021], {
      id: 'google-n3507545614',
      provider: 'google',
    });
    const trip = savedTrip([glico, otherProvider], {}, {
      planningConstraints: { mustDoActivityIds: ['n3507545614'] },
    });

    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'optional',
      'Namba Parks': 'optional',
    });
  });

  it('still honours a bare Must do constraint where the raw ID names one place', async () => {
    const trip = savedTrip([glico, kuromon], {}, {
      planningConstraints: { mustDoActivityIds: ['n3507545614'] },
    });

    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'must-do',
      'Kuromon Ichiba Market': 'optional',
    });
  });

  it('resolves a decision for a place saved without its candidate ID', async () => {
    const trip = savedTrip([glico], { [glico.id]: 'must-do' });
    const legacy: Itinerary = {
      ...trip,
      days: [{
        ...trip.days[0],
        // Hand-entered and imported places predate the `discovered-` prefix but
        // still carry the provider pair the decision can be rebuilt from.
        activities: trip.days[0].activities.map((activity): Activity => ({ ...activity, id: 'activity-legacy-91af2c' })),
      }],
    };

    expect(await priorities(legacy)).toEqual({ 'Glico Man Sign': 'must-do' });
  });

  it('does not give one place another place’s decision because the names match', async () => {
    const otherKuromon = osmCandidate('n9900112233', 'Kuromon Ichiba Market', [34.7101, 135.4989]);
    const trip = savedTrip([kuromon, otherKuromon], { [kuromon.id]: 'must-do' });
    const material = await buildPlanningMaterial('trip-1', trip);

    expect(material.places.map((place) => [place.id, place.priority])).toEqual([
      ['discovered-osm-w120847263', 'must-do'],
      ['discovered-osm-n9900112233', 'optional'],
    ]);
  });

  it('reads the Must do constraint through the same canonical identity', async () => {
    const trip = savedTrip([glico, kuromon], {}, {
      planningConstraints: { mustDoActivityIds: ['discovered-osm-n3507545614'] },
    });

    expect(await priorities(trip)).toEqual({
      'Glico Man Sign': 'must-do',
      'Kuromon Ichiba Market': 'optional',
    });
  });

  it('excludes a skipped place from planning candidates without deleting it', async () => {
    const trip = savedTrip([glico, kuromon], { [glico.id]: 'skip', [kuromon.id]: 'must-do' });
    const before = JSON.stringify(trip);
    const material = await buildPlanningMaterial('trip-1', trip);

    expect(material.places.map((place) => place.name)).toEqual(['Kuromon Ichiba Market']);
    expect(material.places.map((place) => place.priority)).toEqual(['must-do']);
    expect(JSON.stringify(trip)).toBe(before);
    expect(trip.discoveryState?.decisions[glico.id]).toBe('skip');
    expect(trip.days[0].activities.some((activity) => activity.name === 'Glico Man Sign')).toBe(true);
  });

  it('keeps a Must do ahead of optional places when the material is truncated', async () => {
    const filler = Array.from({ length: 30 }, (_, index) => osmCandidate(
      `n${8000000 + index}`,
      `Filler ${index}`,
      [34.66 + index / 10_000, 135.5],
    ));
    const trip = savedTrip([...filler, glico], { [glico.id]: 'must-do' });
    const material = await buildPlanningMaterial('trip-1', trip);

    expect(material.places).toHaveLength(25);
    expect(material.places[0]).toMatchObject({ name: 'Glico Man Sign', priority: 'must-do' });
    expect(material.excludedRequiredPlaces).toEqual([]);
  });

  it('changes the planning revision when the traveller changes a decision', async () => {
    const interested = savedTrip([glico], { [glico.id]: 'interested' });
    const mustDo = savedTrip([glico], { [glico.id]: 'must-do' });

    expect((await buildPlanningMaterial('trip-1', interested)).revision)
      .not.toBe((await buildPlanningMaterial('trip-1', mustDo)).revision);
  });
});

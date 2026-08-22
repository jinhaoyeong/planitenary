/**
 * Saved-place decision identity — production-shaped binding, not names.
 */
import { describe, expect, it } from 'vitest';
import { buildPlanningMaterial } from '../../supabase/functions/_shared/itineraryProposal';
import type { Activity, Itinerary } from '../data';
import type { PlaceCandidate } from './destinationIntelligence';
import {
  bindSavedActivityIds,
  cardDecisionWrites,
  candidateIdentityKeys,
  decisionTargetIdOf,
  resolvedCardDecision,
  retainedDecisionIdsOf,
  reviewCandidatesForItinerary,
} from './decisionTarget';
import { pruneDecisionsToCandidates } from './destinationPlanner';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import type { CandidateDecision } from './destinationIntelligence';

const wikivoyageKushida: PlaceCandidate = {
  id: 'wikivoyage-Kushida%20Shrine',
  provider: 'wikivoyage',
  providerPlaceId: 'wv:Kushida Shrine',
  name: 'Kushida Shrine',
  city: 'Fukuoka',
  countryCode: 'JP',
  categories: ['sight'],
  experienceTags: ['sight'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'outdoor',
  reservationStatus: 'not-needed',
  coordinates: [33.5931, 130.4107],
  sourceReferences: [{ label: 'Wikivoyage', url: 'https://en.wikivoyage.org/wiki/Fukuoka' }],
  sourceConfidence: 'medium',
  lastVerifiedAt: '2026-08-18T00:00:00.000Z',
} as PlaceCandidate;

const savedKushida: Activity = {
  id: 'activity-legacy-iwbmuz',
  time: '09:00',
  name: 'Kushida Shrine',
  description: 'Added manually',
  type: 'sight',
  source: 'manual',
  location: 'Hakata Kawabata Shopping Street, Nakasu 4',
  coordinates: [33.59307, 130.4106837],
  locked: false,
  lockedFields: [],
};

const osmGlico: PlaceCandidate = {
  id: 'osm-n3507545614',
  provider: 'osm',
  providerPlaceId: 'n3507545614',
  name: 'Glico Man Sign',
  city: 'Osaka',
  countryCode: 'JP',
  categories: ['sight'],
  experienceTags: ['sight'],
  estimatedVisitMinutes: 45,
  indoorOutdoor: 'outdoor',
  reservationStatus: 'not-needed',
  coordinates: [34.6687, 135.5013],
  sourceReferences: [{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/3507545614' }],
  sourceConfidence: 'medium',
  lastVerifiedAt: '2026-08-17T00:00:00.000Z',
} as PlaceCandidate;

const tripWith = (
  activities: Activity[],
  decisions: Record<string, string> = {},
  extra: Partial<Itinerary> = {},
): Itinerary => sanitizeItinerary({
  ...emptyItinerary,
  id: 'trip-f5262604-cb74-4d39-af90-0d8a233c9906',
  name: 'Flight Acceptance Test',
  cities: ['Fukuoka'],
  revision: 9,
  tripProfile: { destinations: [{ id: 'fukuoka', city: 'Fukuoka', countryCode: 'JP' }], styles: [], transport: [] },
  days: [{
    day: 1,
    date: '2026-08-20',
    city: 'Fukuoka',
    title: 'Arrive in Fukuoka',
    activities,
  }],
  discoveryState: {
    city: 'Fukuoka',
    mode: 'live',
    candidateIds: [wikivoyageKushida.id],
    decisions,
    discoveredAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    stage: 'reviewing',
  },
  ...extra,
} as unknown, emptyItinerary);

describe('decision target identity', () => {
  it('A. an explicitly linked saved card targets the saved activity id', () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    expect(decisionTargetIdOf(card)).toBe('activity-legacy-iwbmuz');
    expect(card.id).toBe('wikivoyage-Kushida%20Shrine');
  });

  it('B. selecting Skip writes the canonical saved-activity decision', () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    const writes = cardDecisionWrites(card, 'skip');
    expect(writes['activity-legacy-iwbmuz']).toBe('skip');
  });

  it('C. the card keeps its discovery candidate id', () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    const writes = cardDecisionWrites(card, 'skip');
    expect(writes['wikivoyage-Kushida%20Shrine']).toBe('skip');
    expect(candidateIdentityKeys(card)).toContain('wikivoyage-Kushida%20Shrine');
  });

  it('unsaved candidates still target candidate.id', () => {
    expect(decisionTargetIdOf(wikivoyageKushida)).toBe('wikivoyage-Kushida%20Shrine');
    expect(cardDecisionWrites(wikivoyageKushida, 'skip')).toEqual({
      'wikivoyage-Kushida%20Shrine': 'skip',
    });
    expect(resolvedCardDecision({
      'wikivoyage-Kushida%20Shrine': 'skip',
    }, wikivoyageKushida)).toBe('skip');
  });

  it('read precedence: saved-activity decision beats a leftover candidate-key Skip', () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    expect(resolvedCardDecision({
      'wikivoyage-Kushida%20Shrine': 'skip',
      'activity-legacy-iwbmuz': 'interested',
    }, card)).toBe('interested');
  });

  it('read precedence: linked card can display the old candidate-key Skip until the saved key exists', () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    expect(resolvedCardDecision({
      'wikivoyage-Kushida%20Shrine': 'skip',
    }, card)).toBe('skip');
  });

  it('does not treat a candidate-key Skip as the decision for an unlinked saved activity', () => {
    expect(resolvedCardDecision({
      'wikivoyage-Kushida%20Shrine': 'skip',
    }, savedKushida as unknown as PlaceCandidate)).toBeUndefined();
    expect(resolvedCardDecision({
      'wikivoyage-Kushida%20Shrine': 'skip',
    }, { id: 'activity-legacy-iwbmuz' })).toBeUndefined();
  });
});

describe('explicit saved-activity linkage without names', () => {
  it('does not bind a Wikivoyage listing to a manual saved activity that only shares a name', () => {
    const bound = bindSavedActivityIds([wikivoyageKushida], tripWith([savedKushida]));
    expect(bound[0]?.savedActivityId).toBeUndefined();
    expect(bound[0]?.id).toBe('wikivoyage-Kushida%20Shrine');
  });

  it('injects the unmatched manual saved activity as its own decision target', () => {
    const review = reviewCandidatesForItinerary([wikivoyageKushida], tripWith([savedKushida]), { city: 'Fukuoka' });
    const savedCard = review.find((candidate) => candidate.savedActivityId === 'activity-legacy-iwbmuz');
    const listing = review.find((candidate) => candidate.id === 'wikivoyage-Kushida%20Shrine');
    expect(savedCard).toMatchObject({
      id: 'activity-legacy-iwbmuz',
      savedActivityId: 'activity-legacy-iwbmuz',
      name: 'Kushida Shrine',
    });
    expect(listing?.savedActivityId).toBeUndefined();
    expect(review.filter((candidate) => candidate.name === 'Kushida Shrine')).toHaveLength(2);
  });

  it('links a discovered-* saved activity to the listing whose id it recovered', () => {
    const saved = {
      ...savedKushida,
      id: 'discovered-osm-n3507545614',
      source: 'imported' as const,
      provider: 'osm' as const,
      providerPlaceId: 'n3507545614',
    };
    const bound = bindSavedActivityIds([osmGlico], tripWith([saved], {}, { cities: ['Osaka'], days: [{ day: 1, date: '2026-08-17', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Day one', activities: [saved] }] }));
    expect(bound[0]?.savedActivityId).toBe('discovered-osm-n3507545614');
    expect(bound[0]?.id).toBe('osm-n3507545614');
    expect(decisionTargetIdOf(bound[0]!)).toBe('discovered-osm-n3507545614');
  });

  it('links a provider-qualified saved activity without using its name', () => {
    const saved = {
      ...savedKushida,
      id: 'activity-legacy-glico',
      name: 'A completely different label',
      provider: 'osm' as const,
      providerPlaceId: 'n3507545614',
    };
    const bound = bindSavedActivityIds([osmGlico], tripWith([saved], {}, {
      cities: ['Osaka'],
      days: [{ day: 1, date: '2026-08-17', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Day one', activities: [saved] }],
    }));
    expect(bound[0]?.savedActivityId).toBe('activity-legacy-glico');
  });
});

describe('same-name collision safety', () => {
  const parkA: Activity = {
    id: 'activity-park-a',
    time: '10:00',
    name: 'Central Park',
    description: 'Park A',
    type: 'sight',
    source: 'manual',
    coordinates: [40.782, -73.965],
  };
  const parkB: Activity = {
    id: 'activity-park-b',
    time: '11:00',
    name: 'Central Park',
    description: 'Park B',
    type: 'sight',
    source: 'manual',
    coordinates: [41.882, -87.623],
  };
  const listing: PlaceCandidate = {
    ...wikivoyageKushida,
    id: 'wikivoyage-Central%20Park',
    name: 'Central Park',
  };

  it('a card explicitly linked to Activity A never writes Activity B', () => {
    const card = { ...listing, savedActivityId: 'activity-park-a' };
    const writes = cardDecisionWrites(card, 'skip');
    expect(writes['activity-park-a']).toBe('skip');
    expect(writes['activity-park-b']).toBeUndefined();
  });

  it('a same-name listing with no savedActivityId does not acquire a saved Skip', () => {
    const itinerary = tripWith([parkA, parkB], { 'activity-park-a': 'skip' });
    const bound = bindSavedActivityIds([listing], itinerary);
    expect(bound[0]?.savedActivityId).toBeUndefined();
    expect(resolvedCardDecision(itinerary.discoveryState!.decisions as Record<string, CandidateDecision>, bound[0]!)).toBeUndefined();
    const review = reviewCandidatesForItinerary([listing], itinerary, { city: 'Fukuoka' });
    expect(review.map((candidate) => decisionTargetIdOf(candidate)).sort()).toEqual([
      'activity-park-a',
      'activity-park-b',
      'wikivoyage-Central%20Park',
    ].sort());
  });
});

describe('production-shaped planning after a canonical write', () => {
  it('E/F/G. Skip excludes the saved activity from material and keeps it stored', async () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    const itinerary = tripWith([savedKushida], {
      'wikivoyage-Kushida%20Shrine': 'skip',
      ...cardDecisionWrites(card, 'skip'),
    });
    const before = JSON.stringify(itinerary.days);
    const material = await buildPlanningMaterial(itinerary.id, itinerary);

    expect(material.places.map((place) => place.id)).not.toContain('activity-legacy-iwbmuz');
    expect(material.places.map((place) => place.name)).not.toContain('Kushida Shrine');
    expect(JSON.parse(before)[0].activities.some((activity: Activity) => activity.id === 'activity-legacy-iwbmuz')).toBe(true);
    expect(itinerary.discoveryState?.decisions['activity-legacy-iwbmuz']).toBe('skip');
    expect(itinerary.discoveryState?.decisions['wikivoyage-Kushida%20Shrine']).toBe('skip');
  });

  it('H. Visited follows the same write path', async () => {
    const card = { ...wikivoyageKushida, savedActivityId: 'activity-legacy-iwbmuz' };
    const itinerary = tripWith([savedKushida], cardDecisionWrites(card, 'visited'));
    const material = await buildPlanningMaterial(itinerary.id, itinerary);
    expect(material.places.map((place) => place.id)).not.toContain('activity-legacy-iwbmuz');
    expect(itinerary.days[0].activities.some((activity) => activity.id === 'activity-legacy-iwbmuz')).toBe(true);
  });

  it('an old candidate-key Skip alone does not exclude an unlinked saved activity', async () => {
    const itinerary = tripWith([savedKushida], { 'wikivoyage-Kushida%20Shrine': 'skip' });
    const material = await buildPlanningMaterial(itinerary.id, itinerary);
    expect(material.places.map((place) => place.id)).toContain('activity-legacy-iwbmuz');
  });

  it('keeps a locked Skip admitted as fixed schedule', async () => {
    const itinerary = tripWith([{ ...savedKushida, locked: true, lockedFields: ['schedule'] }], {
      'activity-legacy-iwbmuz': 'skip',
    });
    const material = await buildPlanningMaterial(itinerary.id, itinerary);
    expect(material.places).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'activity-legacy-iwbmuz', priority: 'locked', locked: true }),
    ]));
  });

  it('canonical Skip changes material revision with itinerary content otherwise unchanged', async () => {
    const interested = tripWith([savedKushida, { ...savedKushida, id: 'activity-legacy-1y40ze0', name: 'Ōhori Park' }], {
      'activity-legacy-iwbmuz': 'interested',
    });
    const skipped = tripWith([savedKushida, { ...savedKushida, id: 'activity-legacy-1y40ze0', name: 'Ōhori Park' }], {
      'activity-legacy-iwbmuz': 'skip',
    });
    expect(interested.revision).toBe(skipped.revision);
    const left = await buildPlanningMaterial(interested.id, interested);
    const right = await buildPlanningMaterial(skipped.id, skipped);
    expect(right.revision).not.toBe(left.revision);
    expect(left.places.map((place) => place.id)).toContain('activity-legacy-iwbmuz');
    expect(right.places.map((place) => place.id)).not.toContain('activity-legacy-iwbmuz');
    const again = await buildPlanningMaterial(skipped.id, skipped);
    expect(again.revision).toBe(right.revision);
  });

  it('does not drop a saved-activity Skip on rediscovery of unrelated listings', () => {
    const pruned = pruneDecisionsToCandidates(
      { 'activity-legacy-iwbmuz': 'skip', 'gone-listing': 'must-do' },
      [wikivoyageKushida],
      retainedDecisionIdsOf(tripWith([savedKushida])),
    );
    expect(pruned.decisions['activity-legacy-iwbmuz']).toBe('skip');
    expect(pruned.decisions['gone-listing']).toBeUndefined();
  });
});

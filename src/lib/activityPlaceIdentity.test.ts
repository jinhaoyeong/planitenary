/**
 * Collapsing a preserved activity and the candidate offering the same place.
 *
 * The defect: identity was `savedActivityId || candidate.id`, so a place saved
 * as `discovered-osm-n1` and the candidate `osm-n1` looked like two places and
 * both were kept.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary } from './itinerarySanitize';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import { buildDestinationItinerary, rankDestinationCandidates } from './destinationPlanner';
import { reviewCandidatesForItinerary } from './decisionTarget';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import {
  activityPlaceIdentityKeys,
  candidatePlaceIdentityKeys,
  indexHasPlace,
  placeIdentityIndex,
} from './activityPlaceIdentity';

const profile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2026-10-01',
  endDate: '2026-10-11',
  dayCount: 11,
  styles: ['street-food', 'history', 'nightlife', 'architecture'],
  transport: ['public-transport'],
});

const itinerary = (): Itinerary => ({
  id: 'osaka-11-day',
  name: 'Osaka 2026',
  cities: ['Osaka'],
  description: '',
  days: Array.from({ length: 11 }, (_, index) => ({
    day: index + 1,
    date: `Oct ${index + 1}`,
    stayCity: 'Osaka',
    activityCities: [],
    city: 'Osaka',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

const activity = (overrides: Partial<Activity>): Activity => ({
  id: 'a1',
  kind: 'place',
  time: '10:00',
  durationMinutes: 90,
  name: 'Somewhere',
  description: '',
  type: 'sight',
  ...overrides,
} as Activity);

describe('proving two records are the same place', () => {
  it('matches a place saved before candidate ids were kept against the candidate offering it', () => {
    const saved = activity({ id: 'discovered-osm-n1420780980' });
    const candidate = { id: 'osm-n1420780980' };
    expect(indexHasPlace(placeIdentityIndex([saved]), candidatePlaceIdentityKeys(candidate))).toBe(true);
  });

  it('matches on the canonical ref across different provider ids', () => {
    const saved = activity({
      id: 'legacy-1',
      placeRef: { canonicalPlaceId: 'cp-42', provider: 'osm', providerPlaceId: 'n1' },
    });
    const candidate = {
      id: 'wikivoyage-Osaka%20Castle',
      placeRef: { canonicalPlaceId: 'cp-42', provider: 'wikivoyage', providerPlaceId: 'x9' },
    };
    expect(indexHasPlace(placeIdentityIndex([saved]), candidatePlaceIdentityKeys(candidate))).toBe(true);
  });

  it('matches on the provider pair when only the flat legacy fields survive', () => {
    const saved = activity({ id: 'legacy-2', provider: 'osm', providerPlaceId: 'n77' });
    expect(indexHasPlace(placeIdentityIndex([saved]), candidatePlaceIdentityKeys({ id: 'osm-n77' }))).toBe(true);
  });

  it('matches a candidate that names the saved activity it stands for', () => {
    const saved = activity({ id: 'discovered-osm-n5' });
    const candidate = { id: 'osm-n5-refreshed', savedActivityId: 'discovered-osm-n5' };
    expect(indexHasPlace(placeIdentityIndex([saved]), candidatePlaceIdentityKeys(candidate))).toBe(true);
  });

  it('does not collapse two different places that share a name', () => {
    const saved = activity({ id: 'discovered-osm-n1', name: 'Ichiran Ramen' });
    const candidate = { id: 'osm-n2', name: 'Ichiran Ramen' };
    expect(indexHasPlace(placeIdentityIndex([saved]), candidatePlaceIdentityKeys(candidate))).toBe(false);
  });

  it('proves nothing from a record carrying no identity at all', () => {
    expect(activityPlaceIdentityKeys(activity({ id: '' }))).toEqual([]);
    expect(indexHasPlace(placeIdentityIndex([activity({ id: '' })]), candidatePlaceIdentityKeys({ id: 'osm-n1' })))
      .toBe(false);
  });
});

describe('a rebuild does not offer back a place it is already keeping', () => {
  const replan = (current: Itinerary, count: number): Itinerary => {
    const ranked = rankDestinationCandidates(
      reviewCandidatesForItinerary(OSAKA_PLACE_FIXTURE.slice(0, count), current, { city: 'Osaka' }),
      profile(),
    );
    const decisions = Object.fromEntries(ranked.map(({ candidate }) => [candidate.id, 'interested' as const]));
    return { ...current, days: buildDestinationItinerary(current, profile(), ranked, decisions).days };
  };

  it('keeps exactly one copy of a legacy place discovery offers again', () => {
    const target = OSAKA_PLACE_FIXTURE[0];
    const legacySavedForm = {
      id: `discovered-${target.id}`,
      kind: 'place',
      time: '10:00',
      durationMinutes: 90,
      name: target.name,
      description: '',
      type: 'sight',
      // No `source`: saved before provenance, exactly as production holds it.
    };
    const loaded = sanitizeItinerary(
      {
        ...itinerary(),
        days: itinerary().days.map((day, index) => (
          index === 0 ? { ...day, activities: [legacySavedForm] } : day
        )),
      },
      { ...emptyItinerary, id: 'osaka-11-day' },
    );
    expect(loaded.days[0].activities[0].source).toBe('legacy-unknown');

    let next = loaded;
    for (let round = 0; round < 3; round += 1) {
      next = replan(next, 1);
      const copies = next.days.flatMap((day) => day.activities).filter((entry) => entry.name === target.name);
      expect(copies).toHaveLength(1);
    }
  });
});

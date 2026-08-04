import { describe, expect, it } from 'vitest';
import type { PlaceCandidate } from './destinationIntelligence';
import {
  clusterCandidates,
  estimateLeg,
  queueMinutesFor,
  simulateDay,
  toMinutes,
  toTime,
} from './humanScheduler';
import { deriveTravelBehaviour } from './travelBehaviour';

/** Melbourne, deliberately — the engine must not care which city this is. */
const place = (overrides: Partial<PlaceCandidate> & { id: string }): PlaceCandidate => ({
  provider: 'google',
  providerPlaceId: `google:${overrides.id}`,
  name: overrides.id,
  countryCode: 'AU',
  city: 'Melbourne',
  neighbourhood: 'CBD',
  coordinates: [-37.8136, 144.9631],
  categories: ['essential'],
  experienceTags: ['architecture'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  sourceConfidence: 'high',
  sourceReferences: [{ label: 'Visit Victoria', url: 'https://www.visitmelbourne.com/' }],
  lastVerifiedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const hours = (opensAt: string, closesAt: string) => ({
  periods: [{ opensAt, closesAt }],
  sourceConfidence: 'high' as const,
});

/** Six real-ish Melbourne stops spread across the city. */
const melbourneCandidates = (): PlaceCandidate[] => [
  place({ id: 'fed-square', name: 'Federation Square', coordinates: [-37.8180, 144.9691], openingHours: hours('08:00', '20:00') }),
  place({ id: 'ngv', name: 'NGV International', coordinates: [-37.8226, 144.9689], estimatedVisitMinutes: 120, openingHours: hours('10:00', '17:00') }),
  place({ id: 'queen-vic', name: 'Queen Victoria Market', coordinates: [-37.8076, 144.9568], categories: ['market', 'food'], openingHours: hours('06:00', '15:00') }),
  place({ id: 'botanic', name: 'Royal Botanic Gardens', coordinates: [-37.8304, 144.9796], categories: ['park'], openingHours: hours('07:30', '19:30') }),
  place({ id: 'fitzroy', name: 'Fitzroy', coordinates: [-37.7987, 144.9784], neighbourhood: 'Fitzroy', categories: ['local-character'] }),
  place({ id: 'st-kilda', name: 'St Kilda Beach', coordinates: [-37.8677, 144.9740], neighbourhood: 'St Kilda', categories: ['waterfront'] }),
];

const hotel = place({ id: 'hotel', name: 'Hotel', coordinates: [-37.8150, 144.9650], estimatedVisitMinutes: 0 });

describe('travel time estimation', () => {
  it('puts indoor places first when weather marks the day as rain-sensitive', () => {
    const result = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [
        place({ id: 'garden', indoorOutdoor: 'outdoor', openingHours: hours('08:00', '20:00') }),
        place({ id: 'gallery', indoorOutdoor: 'indoor', openingHours: hours('08:00', '20:00') }),
      ],
      behaviour: deriveTravelBehaviour({
        moods: [], styles: [], tripTypes: [], destinations: [{ city: 'Melbourne', countryCode: 'AU' }],
        budgetTier: 'mid-range', transport: ['walking'], dayCount: 1,
      } as never),
      preferIndoor: true,
    });
    expect(result.slots.find((slot) => slot.kind === 'place')?.candidate?.id).toBe('gallery');
  });
  it('walks short hops and takes transit for long ones', () => {
    const near = estimateLeg(
      place({ id: 'a', coordinates: [-37.8136, 144.9631] }),
      place({ id: 'b', coordinates: [-37.8180, 144.9691] }),
    );
    expect(near?.mode).toBe('walking');

    const far = estimateLeg(
      place({ id: 'a', coordinates: [-37.8136, 144.9631] }),
      place({ id: 'b', coordinates: [-37.8677, 144.9740] }),
    );
    expect(far?.mode).toBe('public-transport');
    expect(far?.durationMinutes).toBeGreaterThan(near!.durationMinutes);
  });

  it('always labels an estimate as an estimate', () => {
    const leg = estimateLeg(place({ id: 'a' }), place({ id: 'b', coordinates: [-37.82, 144.97] }));
    expect(leg?.source).toBe('offline-straight-line');
  });

  it('refuses to guess without coordinates', () => {
    expect(estimateLeg(place({ id: 'a', coordinates: undefined }), place({ id: 'b' }))).toBeUndefined();
  });
});

describe('queue estimation', () => {
  it('prefers reported evidence over a guess', () => {
    expect(queueMinutesFor(place({ id: 'a' }), 45)).toBe(45);
  });

  it('assumes a walk-in for a required reservation and a wait for a headline sight', () => {
    expect(queueMinutesFor(place({ id: 'a', reservationStatus: 'required' })))
      .toBeLessThan(queueMinutesFor(place({ id: 'b', categories: ['essential'] })));
  });
});

describe('pace changes the actual plan', () => {
  const candidates = melbourneCandidates();

  it('produces materially different days from identical candidates', () => {
    const relaxed = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: ['calm'], tripTypes: [] }),
      origin: hotel,
    });
    const active = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: ['fast-paced'], tripTypes: [] }),
      origin: hotel,
    });

    // The requirement: same candidates, provably different plans.
    expect(active.load.mainActivities).toBeGreaterThan(relaxed.load.mainActivities);
    expect(relaxed.load.departureTime > active.load.departureTime).toBe(true);
    expect(relaxed.load.freeTimeMinutes).toBeGreaterThan(active.load.freeTimeMinutes);
    expect(active.load.fatigueScore).toBeGreaterThan(relaxed.load.fatigueScore);
  });

  it('reports every place it could not fit, with a reason', () => {
    const relaxed = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: ['calm'], tripTypes: [] }),
      origin: hotel,
    });
    const scheduled = relaxed.slots.filter((slot) => slot.kind === 'place').length;
    // Nothing disappears silently: scheduled + rejected accounts for everything.
    expect(scheduled + relaxed.rejections.length).toBe(candidates.length);
    for (const rejection of relaxed.rejections) {
      expect(rejection.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('the day is physically possible', () => {
  const candidates = melbourneCandidates();

  it('never schedules a visit that ends after closing', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    for (const slot of day.slots) {
      if (slot.kind !== 'place' || !slot.candidate?.openingHours) continue;
      const period = slot.candidate.openingHours.periods[0];
      expect(slot.endMinutes).toBeLessThanOrEqual(toMinutes(period.closesAt!));
      expect(slot.startMinutes).toBeGreaterThanOrEqual(toMinutes(period.opensAt!));
    }
  });

  it('never overlaps two slots', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: ['fast-paced'], tripTypes: [] }),
      origin: hotel,
    });
    for (let i = 1; i < day.slots.length; i += 1) {
      expect(day.slots[i].startMinutes).toBeGreaterThanOrEqual(day.slots[i - 1].endMinutes);
    }
  });

  it('respects the walking ceiling', () => {
    const behaviour = deriveTravelBehaviour({ moods: [], tripTypes: [] }, {
      walking: { maximumDailyMinutes: 20, maximumContinuousMinutes: 10 },
    });
    const day = simulateDay({ dayNumber: 1, city: 'Melbourne', candidates, behaviour, origin: hotel });
    expect(day.load.walkingMinutes).toBeLessThanOrEqual(20);
    expect(day.rejections.some((rejection) => rejection.reason === 'walking-limit-exceeded')).toBe(true);
  });

  it('drops a place whose queue exceeds the traveller tolerance', () => {
    const behaviour = deriveTravelBehaviour({ moods: [], tripTypes: [] }, {
      meals: { breakfastRequired: false, dietaryNeeds: [], maximumQueueMinutes: 5 },
    });
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour,
      origin: hotel,
      queueEvidence: { 'fed-square': 90 },
    });
    const rejection = day.rejections.find((item) => item.candidate.id === 'fed-square');
    expect(rejection?.reason).toBe('queue-exceeds-tolerance');
    expect(rejection?.detail).toContain('90');
  });

  it('will not strand the traveller past their return time', () => {
    const behaviour = deriveTravelBehaviour({ moods: [], tripTypes: [] }, {
      preferredStartTime: '16:00',
      preferredReturnTime: '18:00',
    });
    const day = simulateDay({ dayNumber: 1, city: 'Melbourne', candidates, behaviour, origin: hotel });
    expect(toMinutes(day.load.expectedReturnTime)).toBeLessThanOrEqual(toMinutes('18:00') + 1);
    expect(day.rejections.some((item) => item.reason === 'return-time-exceeded')).toBe(true);
  });
});

describe('meals and rest are real time, not labels', () => {
  it('inserts a lunch window and counts its minutes', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    const lunch = day.slots.find((slot) => slot.kind === 'meal' && slot.label === 'Lunch');
    expect(lunch).toBeDefined();
    expect(day.load.mealMinutes).toBeGreaterThan(0);
    // A meal window is a constraint, never presented as a discovered attraction.
    expect(lunch!.reason).toContain('not a recommended attraction');
  });

  it('counts queueing separately from visiting', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: ['fast-paced'], tripTypes: [] }),
      origin: hotel,
      queueEvidence: { 'fed-square': 30 },
    });
    expect(day.load.queueMinutes).toBeGreaterThanOrEqual(30);
    expect(day.load.visitMinutes).toBeGreaterThan(0);
  });
});

describe('honesty about confidence', () => {
  it('never claims high confidence on estimated routes', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    expect(day.load.confidence).not.toBe('high');
    expect(day.warnings.join(' ')).toContain('straight-line');
  });

  it('raises confidence when a real routing provider answers and hours are known', () => {
    const candidates = [
      place({ id: 'a', coordinates: [-37.8136, 144.9631], openingHours: hours('08:00', '20:00') }),
      place({ id: 'b', coordinates: [-37.8180, 144.9691], openingHours: hours('08:00', '20:00') }),
    ];
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates,
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      routeResolver: () => ({ durationMinutes: 12, distanceMeters: 900, mode: 'walking', source: 'provider' }),
    });
    expect(day.load.confidence).toBe('high');
  });
});

describe('clustering replaces hardcoded themes', () => {
  it('groups nearby places and separates distant ones, in any city', () => {
    const clusters = clusterCandidates(melbourneCandidates(), 2500);
    expect(clusters.length).toBeGreaterThan(1);
    // St Kilda is ~6km south; it must not land with the CBD cluster.
    const cbd = clusters.find((cluster) => cluster.some((item) => item.id === 'fed-square'))!;
    expect(cbd.some((item) => item.id === 'st-kilda')).toBe(false);
  });

  it('accounts for every candidate exactly once', () => {
    const candidates = melbourneCandidates();
    const clusters = clusterCandidates(candidates);
    const ids = clusters.flat().map((item) => item.id).sort();
    expect(ids).toEqual(candidates.map((item) => item.id).sort());
  });

  it('does not let a mislabelled neighbourhood merge distant places', () => {
    // Providers mislabel. A beach 6 km away tagged "CBD" must still split out,
    // or a "walkable" day becomes an hour of transit the traveller did not expect.
    const clusters = clusterCandidates([
      place({ id: 'fed-square', coordinates: [-37.8180, 144.9691], neighbourhood: 'CBD' }),
      place({ id: 'mislabelled-beach', coordinates: [-37.8677, 144.9740], neighbourhood: 'CBD' }),
    ], 2500);
    expect(clusters).toHaveLength(2);
  });

  it('falls back to neighbourhood labels when coordinates are missing', () => {
    const clusters = clusterCandidates([
      place({ id: 'a', coordinates: undefined, neighbourhood: 'Fitzroy' }),
      place({ id: 'b', coordinates: undefined, neighbourhood: 'Fitzroy' }),
      place({ id: 'c', coordinates: undefined, neighbourhood: 'St Kilda' }),
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('time helpers', () => {
  it('round-trips times and clamps out-of-range minutes', () => {
    expect(toTime(toMinutes('09:30'))).toBe('09:30');
    expect(toTime(-10)).toBe('00:00');
    expect(toTime(99_999)).toBe('23:59');
  });
});

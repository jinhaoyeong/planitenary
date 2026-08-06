import { describe, expect, it } from 'vitest';
import type { PlaceCandidate } from './destinationIntelligence';
import {
  clusterCandidates,
  estimateLeg,
  queueMinutesFor,
  selectMealPlace,
  simulateDay,
  toMinutes,
  toTime,
  weekdayOf,
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
    const relaxedBehaviour = deriveTravelBehaviour({ moods: ['calm'], tripTypes: [] });
    const activeBehaviour = deriveTravelBehaviour({ moods: ['fast-paced'], tripTypes: [] });
    const relaxed = simulateDay({
      dayNumber: 1, city: 'Melbourne', candidates, behaviour: relaxedBehaviour, origin: hotel,
    });
    const active = simulateDay({
      dayNumber: 1, city: 'Melbourne', candidates, behaviour: activeBehaviour, origin: hotel,
    });

    // The requirement: same candidates, provably different plans.
    expect(active.load.mainActivities).toBeGreaterThan(relaxed.load.mainActivities);
    expect(relaxed.load.departureTime > active.load.departureTime).toBe(true);

    /**
     * Absolute exertion, not `fatigueScore`.
     *
     * `fatigueScore` is normalised to each traveller's own limits, and its own
     * documentation says it is therefore not comparable across pace profiles —
     * a gentle day can read high for someone with gentle limits, which is the
     * whole point of it. Comparing it here happened to pass and was never
     * measuring what this test claims.
     */
    const exertion = (day: typeof relaxed) => day.load.walkingMinutes + day.load.transportMinutes;
    expect(exertion(active)).toBeGreaterThan(exertion(relaxed));

    /**
     * Free time as a *share* of the day, not raw minutes.
     *
     * An active profile runs 08:30–22:00 and a relaxed one 10:00–20:30, so the
     * active day has nearly three more hours to leave unfilled. Comparing raw
     * minutes measures the length of the window, not how roomy it feels — the
     * same reasoning already written into the planner's pace test.
     */
    const roominess = (day: typeof relaxed, returnTime: string) => {
      const available = toMinutes(returnTime) - toMinutes(day.load.departureTime);
      return day.load.freeTimeMinutes / Math.max(1, available);
    };
    expect(roominess(relaxed, relaxedBehaviour.preferredReturnTime!))
      .toBeGreaterThan(roominess(active, activeBehaviour.preferredReturnTime!));
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
  it('names somewhere to actually eat when the shortlist holds one', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    const lunch = day.slots.find((slot) => slot.kind === 'meal' && slot.label.startsWith('Lunch'));
    expect(lunch).toBeDefined();
    expect(day.load.mealMinutes).toBeGreaterThan(0);
    // The market is somewhere to eat, so lunch is a place rather than a gap.
    expect(lunch!.label).toContain('—');
    expect(lunch!.candidate).toBeDefined();
    expect(day.load.mealPlaces).toBeGreaterThan(0);
  });

  it('still reserves a flexible window when nothing suitable is open', () => {
    // A day must never simply lose its lunch. With no food on the shortlist the
    // block survives, and is labelled as the constraint it is.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      // A long visit that would otherwise run straight past the lunch window,
      // and nowhere on the shortlist to eat.
      candidates: [place({ id: 'gallery', categories: ['museum'], estimatedVisitMinutes: 300, openingHours: hours('08:00', '20:00') })],
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    const lunch = day.slots.find((slot) => slot.kind === 'meal' && slot.label === 'Lunch');
    expect(lunch).toBeDefined();
    expect(lunch!.candidate).toBeUndefined();
    expect(lunch!.reason).toContain('not a recommended attraction');
    expect(day.load.mealPlaces).toBe(0);
  });

  it('schedules breakfast only when the traveller says they need it', () => {
    const withBreakfast = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }, { meals: { breakfastRequired: true } }),
      origin: hotel,
    });
    const without = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: melbourneCandidates(),
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
    });
    expect(withBreakfast.slots.some((slot) => slot.label.startsWith('Breakfast'))).toBe(true);
    expect(without.slots.some((slot) => slot.label.startsWith('Breakfast'))).toBe(false);
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

describe('late arrival meals', () => {
  it('allows dinner after a 19:30 arrival without adding a main stop', () => {
    const restaurant = place({
      id: 'late-restaurant',
      name: 'Late restaurant',
      categories: ['food'],
      openingHours: hours('17:00', '23:30'),
    });
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [],
      mealCandidates: [restaurant],
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
      startTimeOverride: '21:30',
      returnTimeOverride: '23:59',
      maxMainOverride: 0,
    });

    expect(day.slots.filter((slot) => slot.kind === 'place')).toHaveLength(0);
    expect(day.slots.some((slot) => slot.kind === 'meal' && slot.candidate?.id === restaurant.id)).toBe(true);
  });

  it('does not invent a meal after the late-dinner cutoff', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [],
      behaviour: deriveTravelBehaviour({ moods: [], tripTypes: [] }),
      origin: hotel,
      startTimeOverride: '22:31',
      returnTimeOverride: '23:59',
      maxMainOverride: 0,
    });

    expect(day.slots.filter((slot) => slot.kind === 'meal')).toHaveLength(0);
    expect(day.warnings.join(' ')).toContain('intentionally empty');
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

  it('reads a weekday from a date without drifting with the local timezone', () => {
    // 2026-08-03 is a Monday. This must hold wherever the tests run.
    expect(weekdayOf('2026-08-03')).toBe(1);
    expect(weekdayOf('2026-08-09')).toBe(0);
    expect(weekdayOf(undefined)).toBeUndefined();
    expect(weekdayOf('not-a-date')).toBeUndefined();
  });
});

describe('choosing somewhere to eat', () => {
  const eatery = (id: string, overrides: Partial<PlaceCandidate> = {}) => place({
    id,
    categories: ['food'],
    estimatedVisitMinutes: 60,
    openingHours: hours('11:00', '22:00'),
    ...overrides,
  });

  const pick = (options: PlaceCandidate[], preferences: Parameters<typeof selectMealPlace>[1]['preferences'] = {}) =>
    selectMealPlace(options, {
      atMinutes: toMinutes('12:30'),
      resolveRoute: estimateLeg,
      queueTolerance: 40,
      queueEvidence: {},
      preferences,
      used: new Set<string>(),
    });

  it('will not seat a traveller somewhere that is shut', () => {
    const closed = eatery('closed-now', { openingHours: hours('18:00', '23:00') });
    expect(pick([closed])).toBeUndefined();
  });

  it('will not offer a place that is not somewhere to eat', () => {
    expect(pick([place({ id: 'museum', categories: ['museum'] })])).toBeUndefined();
  });

  it('honours a dietary need as a requirement, not a preference', () => {
    const unsuitable = eatery('steakhouse', { dietaryOptions: ['halal'] });
    const suitable = eatery('veg-place', { dietaryOptions: ['vegetarian', 'vegan'] });
    expect(pick([unsuitable, suitable], { dietaryNeeds: ['vegetarian'] })?.candidate.id).toBe('veg-place');
  });

  it('does not starve a traveller where nobody has tagged the restaurants', () => {
    // Unknown must not mean unsuitable, or a vegetarian gets no lunch at all
    // in cities with thin dietary tagging.
    const untagged = eatery('untagged');
    expect(pick([untagged], { dietaryNeeds: ['vegetarian'] })?.candidate.id).toBe('untagged');
  });

  it('avoids a place priced outside the traveller\'s budget', () => {
    const expensive = eatery('fine-dining', { priceLevel: 4 });
    const affordable = eatery('noodle-bar', { priceLevel: 1 });
    expect(pick([expensive, affordable], { budgetTier: 'budget' })?.candidate.id).toBe('noodle-bar');
  });

  it('prefers the food the traveller said they came for', () => {
    const generic = eatery('generic');
    const wanted = eatery('night-market', { experienceTags: ['street-food'] });
    expect(pick([generic, wanted], { preferredTags: ['street-food'] })?.candidate.id).toBe('night-market');
  });

  it('refuses a queue longer than the traveller will tolerate', () => {
    const queued = eatery('famous-ramen', { reservationStatus: 'unknown', categories: ['essential', 'food'] });
    const choice = selectMealPlace([queued], {
      atMinutes: toMinutes('12:30'),
      resolveRoute: estimateLeg,
      queueTolerance: 10,
      queueEvidence: { 'famous-ramen': 90 },
      preferences: {},
      used: new Set<string>(),
    });
    expect(choice).toBeUndefined();
  });

  it('will not send a traveller across the city for lunch', () => {
    const far = eatery('far-away', { coordinates: [-37.8677, 144.9740] });
    const near = eatery('round-the-corner', { coordinates: [-37.8140, 144.9635] });
    const from = place({ id: 'here', coordinates: [-37.8136, 144.9631] });
    const choice = selectMealPlace([far, near], {
      atMinutes: toMinutes('12:30'),
      from,
      resolveRoute: estimateLeg,
      queueTolerance: 40,
      queueEvidence: {},
      preferences: {},
      used: new Set<string>(),
    });
    expect(choice?.candidate.id).toBe('round-the-corner');
  });

  it('does not offer the same place twice', () => {
    const only = eatery('only-option');
    const choice = selectMealPlace([only], {
      atMinutes: toMinutes('12:30'),
      resolveRoute: estimateLeg,
      queueTolerance: 40,
      queueEvidence: {},
      preferences: {},
      used: new Set(['only-option']),
    });
    expect(choice).toBeUndefined();
  });
});

describe('weekly closures', () => {
  const behaviourFor = (moods: Parameters<typeof deriveTravelBehaviour>[0]['moods'] = []) =>
    deriveTravelBehaviour({ moods, styles: [], tripTypes: [], destinations: [{ city: 'Melbourne', countryCode: 'AU' }] } as never);

  /** A museum that shuts on Mondays, written the way OSM writes it. */
  const mondayClosedMuseum = place({
    id: 'museum',
    name: 'Closed Mondays Museum',
    openingHours: {
      periods: [{ daysOfWeek: [0, 2, 3, 4, 5, 6], opensAt: '10:00', closesAt: '18:00' }],
      sourceConfidence: 'low',
    },
  });

  it('never schedules a place on a weekday it is closed', () => {
    const monday = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [mondayClosedMuseum],
      behaviour: behaviourFor(),
      date: '2026-08-03',
    });
    expect(monday.slots.filter((slot) => slot.kind === 'place')).toHaveLength(0);
    expect(monday.rejections[0].reason).toBe('closed-on-this-day');
    expect(monday.rejections[0].detail).toContain('Monday');
  });

  it('schedules the same place on a day it is open', () => {
    const tuesday = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [mondayClosedMuseum],
      behaviour: behaviourFor(),
      date: '2026-08-04',
    });
    expect(tuesday.slots.filter((slot) => slot.kind === 'place')).toHaveLength(1);
  });

  it('picks the window belonging to the day, not the first one published', () => {
    const shortSaturday = place({
      id: 'market',
      openingHours: {
        periods: [
          { daysOfWeek: [1, 2, 3, 4, 5], opensAt: '09:00', closesAt: '17:00' },
          { daysOfWeek: [6], opensAt: '09:00', closesAt: '11:00' },
        ],
        sourceConfidence: 'low',
      },
      estimatedVisitMinutes: 180,
    });
    // Saturday 2026-08-08: the 3-hour visit cannot fit an 09:00–11:00 window.
    const saturday = simulateDay({
      dayNumber: 1, city: 'Melbourne', candidates: [shortSaturday], behaviour: behaviourFor(), date: '2026-08-08',
    });
    expect(saturday.rejections[0]?.reason).toBe('opening-hours-conflict');
  });

  it('falls back to the published window when the trip has no dates', () => {
    // An undated trip is a real case and must still produce a plan.
    const undated = simulateDay({
      dayNumber: 1, city: 'Melbourne', candidates: [mondayClosedMuseum], behaviour: behaviourFor(),
    });
    expect(undated.slots.filter((slot) => slot.kind === 'place')).toHaveLength(1);
  });

  it('still treats absent hours as unknown rather than closed', () => {
    const noHours = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [place({ id: 'unknown-hours' })],
      behaviour: behaviourFor(),
      date: '2026-08-03',
    });
    expect(noHours.slots.filter((slot) => slot.kind === 'place')).toHaveLength(1);
    expect(noHours.warnings.join(' ')).toContain('unverified opening hours');
  });
});

describe('pace limits that used to be declared but never enforced', () => {
  const behaviourFor = (moods: string[]) =>
    deriveTravelBehaviour({ moods, styles: [], tripTypes: [], destinations: [{ city: 'Melbourne', countryCode: 'AU' }] } as never);

  /**
   * A calm stop. Deliberately not `essential`: that category implies a
   * 20-minute wait, which alone exceeds a very-relaxed traveller's 15-minute
   * queue tolerance and would reject every candidate before the limit under
   * test was ever reached.
   */
  const calm = (id: string, visitMinutes: number, overrides: Partial<PlaceCandidate> = {}) => place({
    id,
    categories: ['park'],
    estimatedVisitMinutes: visitMinutes,
    openingHours: hours('08:00', '22:00'),
    ...overrides,
  });

  it('keeps a relaxed day from filling up to its return time', () => {
    // very-relaxed promises 150 unscheduled minutes on a 10:30–19:30 day.
    // Before this was enforced the number was reported and then ignored.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('long-1', 150), calm('long-2', 150)],
      behaviour: behaviourFor(['slow-living']),
    });
    expect(day.load.freeTimeMinutes).toBeGreaterThanOrEqual(150);
    expect(day.rejections.some((rejection) => rejection.reason === 'free-time-floor')).toBe(true);
  });

  it('does not apply the floor at a pace that does not promise one', () => {
    // intensive sets the floor to 0; the same day must fill up.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('long-1', 150), calm('long-2', 150)],
      behaviour: behaviourFor(['fast-paced']),
    });
    expect(day.rejections.some((rejection) => rejection.reason === 'free-time-floor')).toBe(false);
  });

  it('never leaves a day empty to satisfy the free-time floor', () => {
    // An empty day is not a relaxing day. The floor limits filling, not
    // starting — so a single stop that consumes the floor is still scheduled.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('all-day', 320)],
      behaviour: behaviourFor(['slow-living']),
    });
    expect(day.slots.filter((slot) => slot.kind === 'place')).toHaveLength(1);
    // Proves the guard did the work: this day genuinely breaches the floor.
    expect(day.load.freeTimeMinutes).toBeLessThan(150);
  });

  it('adds a breather after a single walk longer than the traveller tolerates', () => {
    // very-relaxed allows 15 continuous walking minutes. ~1 km apart is a
    // 19-minute walk — still a walk, but past what this traveller wants in one go.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [
        calm('start', 30, { coordinates: [-37.8136, 144.9631] }),
        calm('far', 30, { coordinates: [-37.8226, 144.9631] }),
      ],
      behaviour: behaviourFor(['slow-living']),
    });
    const breather = day.slots.find((slot) => slot.kind === 'rest' && slot.reason.includes('in one go'));
    expect(breather).toBeDefined();
    expect(day.slots.filter((slot) => slot.kind === 'place')).toHaveLength(2);
  });

  it('does not interrupt a walk the traveller is happy with', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('a', 30), calm('b', 30)],
      behaviour: behaviourFor(['slow-living']),
    });
    expect(day.slots.some((slot) => slot.kind === 'rest' && slot.reason.includes('in one go'))).toBe(false);
  });

  it('lets a short nearby stop join an already-full day, and counts it', () => {
    // very-relaxed holds 2 main stops plus 1 optional.
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('main-1', 60), calm('main-2', 60), calm('viewpoint', 30, { categories: ['view'] })],
      behaviour: behaviourFor(['slow-living']),
    });
    expect(day.load.mainActivities).toBe(2);
    expect(day.load.optionalActivities).toBe(1);
  });

  it('does not let a long stop sneak in as an optional extra', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [calm('main-1', 60), calm('main-2', 60), calm('another-museum', 120)],
      behaviour: behaviourFor(['slow-living']),
    });
    expect(day.load.optionalActivities).toBe(0);
    expect(day.rejections.some((rejection) => rejection.reason === 'daily-capacity-reached')).toBe(true);
  });

  it('keeps a relaxed day inside one city', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [
        calm('home', 60),
        calm('away', 60, { city: 'Geelong', coordinates: [-38.1499, 144.3617] }),
      ],
      behaviour: behaviourFor(['slow-living']),
    });
    const crossCity = day.rejections.find((rejection) => rejection.candidate.id === 'away');
    expect(crossCity?.reason).toBe('incompatible-location');
    expect(crossCity?.detail).toContain('Geelong');
  });

  it('allows a cross-city day at a pace that permits one', () => {
    const day = simulateDay({
      dayNumber: 1,
      city: 'Melbourne',
      candidates: [
        calm('home', 60),
        calm('away', 60, { city: 'Geelong', coordinates: [-38.1499, 144.3617] }),
      ],
      behaviour: behaviourFor(['fast-paced']),
    });
    expect(day.rejections.some((rejection) => rejection.reason === 'incompatible-location')).toBe(false);
  });
});

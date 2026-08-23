/**
 * Planning a route that returns to a city.
 *
 * Stage 4A taught the stay plan to hold `Osaka → Kyoto → Osaka` without
 * dropping the second Osaka. These tests are the other half: that the planner
 * actually builds it — three stays rather than two, a shared Osaka geography
 * rather than two half-decks, and a one-night airport return that stays one
 * night when the trip grows.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import { buildDestinationItinerary, rankDestinationCandidates } from './destinationPlanner';
import { orderedCities, shareByLegDays } from './cityLegs';
import { driftTargetIndex, fitCityStays, isTerminalReturnStay } from './cityStays';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import type { CandidateDecision, PlaceCandidate } from './destinationIntelligence';

/** Osaka 3 → Kyoto 3 → Osaka 1. Seven days, and Osaka twice on purpose. */
const RETURN_ROUTE = [
  { city: 'Osaka', days: 3 },
  { city: 'Kyoto', days: 3 },
  { city: 'Osaka', days: 1 },
];

const returnProfile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [
    manualDestination('Osaka', 'Japan'),
    manualDestination('Kyoto', 'Japan'),
    manualDestination('Kobe', 'Japan'),
  ],
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  dayCount: 7,
  cityStays: RETURN_ROUTE,
  cityStayDayCount: 7,
  styles: ['street-food', 'history', 'architecture'],
  transport: ['public-transport'],
  ...overrides,
});

const returnTrip = (dayCount = 7): Itinerary => ({
  id: 'osaka-kyoto-osaka',
  name: 'Kansai return',
  cities: ['Osaka', 'Kyoto', 'Kobe'],
  description: '',
  days: Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    date: `Oct ${index + 1}`,
    stayCity: '',
    activityCities: [],
    city: '',
    title: `Day ${index + 1}`,
    activities: [],
  })),
});

const acceptAll = (candidates: PlaceCandidate[]): Record<string, CandidateDecision> =>
  Object.fromEntries(candidates.map((candidate) => [candidate.id, 'interested' as const]));

const build = (profile = returnProfile(), itinerary = returnTrip()) => {
  const ranked = rankDestinationCandidates(OSAKA_PLACE_FIXTURE, profile);
  return buildDestinationItinerary(itinerary, profile, ranked, acceptAll(OSAKA_PLACE_FIXTURE));
};

describe('the acceptance route: Osaka 3, Kyoto 3, Osaka 1', () => {
  it('plans three stays, not two', () => {
    const { cityLegs } = build();
    expect(cityLegs.map((leg) => leg.legId)).toEqual(['osaka#1', 'kyoto#1', 'osaka#2']);
  });

  it('gives each stay its stated days', () => {
    const { cityLegs } = build();
    expect(cityLegs.map((leg) => [leg.city, leg.startDay, leg.endDay])).toEqual([
      ['Osaka', 1, 3],
      ['Kyoto', 4, 6],
      ['Osaka', 7, 7],
    ]);
  });

  it('stamps every day with the stay it belongs to', () => {
    const { days } = build();
    expect(days.map((day) => day.stayCity)).toEqual([
      'Osaka', 'Osaka', 'Osaka', 'Kyoto', 'Kyoto', 'Kyoto', 'Osaka',
    ]);
    // The alias can never disagree with the base it aliases.
    expect(days.every((day) => day.city === day.stayCity)).toBe(true);
  });

  it('follows the stated plan instead of inferring its own split', () => {
    // The original Stage 4 bug: the repeat made the plan look unfinished, so
    // the planner replaced the traveller's booking with a shortlist guess.
    const { warnings } = build();
    expect([...warnings].some((warning) => /Built to your stay plan/i.test(warning))).toBe(true);
    expect([...warnings].some((warning) => /following how many places you kept/i.test(warning)))
      .toBe(false);
  });

  it('counts a repeated city towards the plan being complete', () => {
    // 3 + 3 + 1 = 7. Summing a deduplicated plan would give 6 and read as
    // half-answered, which is exactly how the stated route used to be lost.
    const { warnings } = build();
    expect([...warnings].some((warning) => /longer than your stay plan|shorter than your stay plan/i.test(warning)))
      .toBe(false);
  });
});

describe('one city, two stays, one geography', () => {
  it('still reports a single Osaka among the trip cities', () => {
    expect(orderedCities(['Osaka', 'Kyoto', 'Osaka'])).toEqual(['Osaka', 'Kyoto']);
  });

  it('never schedules the same place in both Osaka stays', () => {
    // Both stays draw from one Osaka pool, so without a division the airport
    // day would be offered everything the first stay already used.
    const { days } = build();
    const scheduled = days.flatMap((day) => day.activities
      .filter((activity) => activity.kind === 'place')
      .map((activity) => activity.name));
    expect(new Set(scheduled).size).toBe(scheduled.length);
  });

  it('leaves the airport day something to do, but not a full stay of it', () => {
    const { days } = build();
    const firstStay = days.slice(0, 3).flatMap((day) => day.activities.filter((a) => a.kind === 'place'));
    const airportDay = days[6].activities.filter((a) => a.kind === 'place');
    expect(airportDay.length).toBeLessThanOrEqual(firstStay.length);
  });
});

describe('splitting a city between its stays', () => {
  it('divides in proportion to the days, not evenly', () => {
    // Twelve Osaka places, a three-day stay and a one-day return.
    expect(shareByLegDays(12, [3, 1])).toEqual([9, 3]);
  });

  it('always hands out exactly what it was given', () => {
    for (const total of [0, 1, 2, 5, 7, 10, 11, 12, 13, 100]) {
      for (const days of [[3, 1], [3, 3, 1], [1, 1], [5, 2, 2], [4]]) {
        const shares = shareByLegDays(total, days);
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
        expect(shares.every((share) => share >= 0)).toBe(true);
      }
    }
  });

  it('breaks a rounding tie towards the earlier stay', () => {
    // 10 across 3 and 1 is 7.5 / 2.5; both remainders are .5, and route order
    // decides so the answer never depends on sort stability.
    expect(shareByLegDays(10, [3, 1])).toEqual([8, 2]);
  });

  it('gives a city visited once everything it has', () => {
    expect(shareByLegDays(12, [4])).toEqual([12]);
  });

  it('copes with nothing to divide', () => {
    expect(shareByLegDays(0, [3, 1])).toEqual([0, 0]);
    expect(shareByLegDays(5, [])).toEqual([]);
    expect(shareByLegDays(5, [0, 0])).toEqual([0, 0]);
  });
});

describe('a one-night return is not somewhere to put spare days', () => {
  it('recognises the shape without looking for the word airport', () => {
    expect(isTerminalReturnStay(RETURN_ROUTE, 2)).toBe(true);
    // Not terminal.
    expect(isTerminalReturnStay(RETURN_ROUTE, 0)).toBe(false);
    // Terminal and one day, but a city the trip has not already stayed in.
    expect(isTerminalReturnStay(
      [{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }, { city: 'Kobe', days: 1 }],
      2,
    )).toBe(false);
    // Terminal and a repeat, but a real stay rather than a departure night.
    expect(isTerminalReturnStay(
      [{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }, { city: 'Osaka', days: 2 }],
      2,
    )).toBe(false);
  });

  it('sends spare days to the longest real stay instead', () => {
    expect(driftTargetIndex(RETURN_ROUTE)).toBe(0);
    expect(fitCityStays(RETURN_ROUTE, 9)).toEqual([
      { city: 'Osaka', days: 5 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]);
  });

  it('breaks a tie between equal stays by route order', () => {
    const route = [
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ];
    expect(fitCityStays(route, 8)[0].days).toBe(4);
    expect(fitCityStays(route, 8)[1].days).toBe(3);
  });

  it('still grows the last stay on a route that never doubles back', () => {
    // The ordinary case is unchanged: a trip that gains days gains them at the
    // end, which is where an extension usually lands.
    expect(fitCityStays([{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }], 8)).toEqual([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 5 },
    ]);
  });

  it('still grows the last stay when the final return is a real stay', () => {
    expect(fitCityStays(
      [{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }, { city: 'Osaka', days: 2 }],
      10,
    )).toEqual([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 4 },
    ]);
  });

  it('still takes days off the end when the trip shortens', () => {
    expect(fitCityStays(RETURN_ROUTE, 6)).toEqual([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
    ]);
  });

  it('tells the traveller which stay actually grew', () => {
    const { warnings } = build(returnProfile({
      endDate: '2026-10-09',
      dayCount: 9,
      cityStayDayCount: 7,
    }), returnTrip(9));
    const drift = [...warnings].find((warning) => /longer than your stay plan/i.test(warning));
    expect(drift).toBeDefined();
    // Osaka is both the grown stay and the departure city here, so the test
    // that matters is the arithmetic: the return stayed one day.
    expect(drift).toMatch(/added to Osaka/i);
  });

  it('keeps the airport night at one day when the trip grows', () => {
    const { cityLegs } = build(returnProfile({
      endDate: '2026-10-09',
      dayCount: 9,
      cityStayDayCount: 7,
    }), returnTrip(9));
    expect(cityLegs.map((leg) => [leg.legId, leg.days])).toEqual([
      ['osaka#1', 5],
      ['kyoto#1', 3],
      ['osaka#2', 1],
    ]);
  });
});

describe('a leg boundary is not by itself a transfer', () => {
  /**
   * A locked, timed transport row — the evidence a base move is real.
   * Same shape the Stage 2 fixtures use: `kind: 'transport'` is the signal.
   */
  const shinkansen = (day: number, name: string): Activity => ({
    id: `transport-${day}`,
    time: '09:00',
    name,
    description: 'Saved Shinkansen',
    type: 'travel',
    kind: 'transport',
    durationMinutes: 60,
    locked: true,
  });

  const tripWithTransport = (): Itinerary => {
    const trip = returnTrip();
    // Day 4 is the move to Kyoto; day 7 the return to Osaka.
    trip.days[3].activities = [shinkansen(4, 'Osaka to Kyoto')];
    trip.days[6].activities = [shinkansen(7, 'Kyoto to Osaka')];
    return trip;
  };

  it('plans the route correctly with no transfer at all', () => {
    // The stay plan is authority for where the traveller sleeps, and that is
    // enough to build three legs. It is not authority to claim they were
    // carried between cities, so no transfer is invented.
    const { days, cityLegs } = build();
    expect(cityLegs.map((leg) => leg.legId)).toEqual(['osaka#1', 'kyoto#1', 'osaka#2']);
    expect(days.map((day) => day.stayCity)).toEqual([
      'Osaka', 'Osaka', 'Osaka', 'Kyoto', 'Kyoto', 'Kyoto', 'Osaka',
    ]);
    expect(days.every((day) => day.transfer === undefined)).toBe(true);
  });

  it('derives the transfer when the day carries fixed transport', () => {
    const { days } = build(returnProfile(), tripWithTransport());
    expect(days[3]).toMatchObject({ stayCity: 'Kyoto', transfer: { from: 'Osaka', to: 'Kyoto' } });
    expect(days[6]).toMatchObject({ stayCity: 'Osaka', transfer: { from: 'Kyoto', to: 'Osaka' } });
  });

  it('leaves days inside a stay alone even when transport is present', () => {
    const trip = returnTrip();
    // Transport on a day that begins no leg cannot move a base that is not
    // moving. Day 2 is the middle of the Osaka stay.
    trip.days[1].activities = [shinkansen(2, 'Airport express')];
    const { days } = build(returnProfile(), trip);
    expect(days[1].transfer).toBeUndefined();
  });

  it('ignores transport this rebuild is about to discard', () => {
    const trip = returnTrip();
    // Unlocked, so the planner drops it from the saved day. A transfer whose
    // evidence does not survive would be a claim with nothing behind it.
    trip.days[3].activities = [{ ...shinkansen(4, 'Osaka to Kyoto'), locked: false }];
    const { days } = build(returnProfile(), trip);
    expect(days[3].stayCity).toBe('Kyoto');
    expect(days[3].transfer).toBeUndefined();
  });

  it('ignores an untimed transport row', () => {
    const trip = returnTrip();
    trip.days[3].activities = [{ ...shinkansen(4, 'Osaka to Kyoto'), durationMinutes: 0 }];
    const { days } = build(returnProfile(), trip);
    expect(days[3].transfer).toBeUndefined();
  });

  it('still preserves a transfer the day already carried', () => {
    const trip = returnTrip();
    trip.days[3].transfer = { from: 'Osaka', to: 'Kyoto' };
    const { days } = build(returnProfile(), trip);
    expect(days[3].transfer).toEqual({ from: 'Osaka', to: 'Kyoto' });
  });
});

describe('day trips are still activity travel, not stays', () => {
  it('creates no leg for a city the traveller only visits for a day', () => {
    const { cityLegs } = build();
    // Kobe is a chosen destination with no stay. It must never become one.
    expect(cityLegs.some((leg) => leg.city === 'Kobe')).toBe(false);
    expect(cityLegs).toHaveLength(3);
  });

  it('never turns an activity city into an overnight move', () => {
    const { days } = build();
    for (const day of days) {
      for (const city of day.activityCities) {
        if (city.toLowerCase() === day.stayCity.toLowerCase()) continue;
        // Being somewhere for the day is not sleeping there.
        expect(day.transfer?.to?.toLowerCase()).not.toBe(city.toLowerCase());
      }
    }
  });
});

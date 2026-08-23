/**
 * The traveller decides where they sleep. These tests hold that line: the
 * planner may propose a split, but nothing here silently changes one, balances
 * one, or completes one on their behalf.
 */
import { describe, expect, it } from 'vitest';
import {
  adjustCityStay,
  cityStayStatus,
  cityStayTotal,
  describeStayDates,
  legsFromCityStays,
  moveCityStay,
  proposeCityStays,
  reconcileCityStays,
  setCityStayDays,
} from './cityStays';

const KANSAI = ['Osaka', 'Nara', 'Kyoto', 'Kobe'];

describe('proposing a starting split', () => {
  it('divides evenly when it can', () => {
    expect(proposeCityStays(['Osaka', 'Kyoto'], 8)).toEqual([
      { city: 'Osaka', days: 4 },
      { city: 'Kyoto', days: 4 },
    ]);
  });

  it('gives the remainder to the earlier cities', () => {
    expect(proposeCityStays(KANSAI, 10).map((stay) => stay.days)).toEqual([3, 3, 2, 2]);
  });

  it('spends the whole trip whatever the numbers', () => {
    for (const dayCount of [1, 3, 7, 8, 11, 21]) {
      const stays = proposeCityStays(KANSAI, dayCount);
      expect(cityStayTotal(stays)).toBe(dayCount);
    }
  });

  it('shows a city it cannot fit rather than dropping it', () => {
    // Four cities, three days. The fourth is visible at zero so the traveller
    // can move a day to it, or remove the city deliberately.
    const stays = proposeCityStays(KANSAI, 3);
    expect(stays.map((stay) => stay.days)).toEqual([1, 1, 1, 0]);
    expect(stays.map((stay) => stay.city)).toEqual(KANSAI);
  });

  it('proposes nothing without cities or days', () => {
    expect(proposeCityStays([], 8)).toEqual([]);
    expect(proposeCityStays(KANSAI, 0)).toEqual([]);
  });
});

describe('keeping a plan in step with the trip', () => {
  it('keeps the order the traveller put the cities in', () => {
    const stays = [
      { city: 'Kyoto', days: 4 },
      { city: 'Osaka', days: 4 },
    ];
    // The profile lists Osaka first; the stay plan says Kyoto first, which is
    // the traveller reordering their route. The route wins.
    expect(reconcileCityStays(stays, ['Osaka', 'Kyoto']).map((stay) => stay.city))
      .toEqual(['Kyoto', 'Osaka']);
  });

  it('drops a city removed from the trip', () => {
    const stays = [{ city: 'Osaka', days: 4 }, { city: 'Kobe', days: 4 }];
    expect(reconcileCityStays(stays, ['Osaka'])).toEqual([{ city: 'Osaka', days: 4 }]);
  });

  it('appends a newly added city with no days, rather than reshuffling', () => {
    // Adding Kobe must not silently take days off Osaka; the traveller places
    // them, and until they do the plan is visibly incomplete.
    const stays = [{ city: 'Osaka', days: 8 }];
    expect(reconcileCityStays(stays, ['Osaka', 'Kobe'])).toEqual([
      { city: 'Osaka', days: 8 },
      { city: 'Kobe', days: 0 },
    ]);
  });

  it('starts a trip with no plan at zero for every city', () => {
    expect(reconcileCityStays(undefined, ['Osaka', 'Kyoto'])).toEqual([
      { city: 'Osaka', days: 0 },
      { city: 'Kyoto', days: 0 },
    ]);
  });
});

describe('what the traveller still has to decide', () => {
  const stays = [
    { city: 'Osaka', days: 3 },
    { city: 'Kyoto', days: 3 },
    { city: 'Nara', days: 0 },
  ];

  it('reports the days left to place', () => {
    const status = cityStayStatus(stays, 8);
    expect(status.remaining).toBe(2);
    expect(status.complete).toBe(false);
  });

  it('names the cities with nowhere to sleep', () => {
    expect(cityStayStatus(stays, 8).unplaced).toEqual(['Nara']);
  });

  it('reports an overspent plan as negative, not as complete', () => {
    const status = cityStayStatus([{ city: 'Osaka', days: 9 }], 8);
    expect(status.remaining).toBe(-1);
    expect(status.complete).toBe(false);
  });

  it('is complete only when every day is placed', () => {
    expect(cityStayStatus([{ city: 'Osaka', days: 5 }, { city: 'Kyoto', days: 3 }], 8).complete)
      .toBe(true);
  });
});

describe('editing the plan', () => {
  const stays = [{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }];

  it('adds a day from the unplaced pool', () => {
    expect(adjustCityStay(stays, 1, 1, 8)).toEqual([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 4 },
    ]);
  });

  it('never takes a day from another city to satisfy an increase', () => {
    // The pool is empty at 8 of 8. Adding to Kyoto must do nothing rather than
    // quietly shorten Osaka — that is the traveller's call, not ours.
    const full = [{ city: 'Osaka', days: 5 }, { city: 'Kyoto', days: 3 }];
    expect(adjustCityStay(full, 1, 1, 8)).toEqual(full);
  });

  it('returns a removed day to the pool', () => {
    const next = adjustCityStay(stays, 0, -1, 8);
    expect(next[0].days).toBe(2);
    expect(cityStayStatus(next, 8).remaining).toBe(3);
  });

  it('never goes below zero', () => {
    expect(adjustCityStay([{ city: 'Osaka', days: 0 }], 0, -1, 8)[0].days).toBe(0);
  });

  it('sets a typed day count without touching the other cities', () => {
    expect(setCityStayDays(stays, 0, 5, 8)).toEqual([
      { city: 'Osaka', days: 5 },
      { city: 'Kyoto', days: 3 },
    ]);
  });

  it('clamps a typed count to what the trip still has free', () => {
    // Osaka wants 10; Kyoto already holds 3 of 8, so Osaka can take at most 5.
    expect(setCityStayDays(stays, 0, 10, 8)[0].days).toBe(5);
  });

  it('treats a blank or nonsense typed value as zero', () => {
    expect(setCityStayDays(stays, 0, Number.NaN, 8)[0].days).toBe(0);
  });

  it('reorders the route', () => {
    expect(moveCityStay(stays, 1, -1).map((stay) => stay.city)).toEqual(['Kyoto', 'Osaka']);
  });

  it('ignores a move off either end', () => {
    expect(moveCityStay(stays, 0, -1)).toEqual(stays);
    expect(moveCityStay(stays, 1, 1)).toEqual(stays);
  });
});

describe('turning a plan into legs', () => {
  it('lays the stays out in order, back to back', () => {
    const legs = legsFromCityStays([
      { city: 'Osaka', days: 3 },
      { city: 'Nara', days: 1 },
      { city: 'Kyoto', days: 4 },
    ], 8);

    expect(legs).toEqual([
      { city: 'Osaka', startDay: 1, endDay: 3, days: 3, visitIndex: 1, legId: 'osaka#1' },
      { city: 'Nara', startDay: 4, endDay: 4, days: 1, visitIndex: 1, legId: 'nara#1' },
      { city: 'Kyoto', startDay: 5, endDay: 8, days: 4, visitIndex: 1, legId: 'kyoto#1' },
    ]);
  });

  it('skips a city given no days', () => {
    const legs = legsFromCityStays([
      { city: 'Osaka', days: 8 },
      { city: 'Kobe', days: 0 },
    ], 8);
    expect(legs.map((leg) => leg.city)).toEqual(['Osaka']);
  });

  it('refuses a plan that does not cover the trip', () => {
    // The caller falls back rather than building days from a half-answered
    // question.
    expect(legsFromCityStays([{ city: 'Osaka', days: 3 }], 8)).toEqual([]);
    expect(legsFromCityStays([{ city: 'Osaka', days: 9 }], 8)).toEqual([]);
  });
});

describe('a route that returns to a city', () => {
  /**
   * Osaka → Kyoto → Kobe day trip → Kyoto → Osaka airport, as a stay plan.
   * Seven days, and Osaka is two separate bookings rather than one six-day
   * block with a Kyoto interruption.
   */
  const RETURN_ROUTE = [
    { city: 'Osaka', days: 3 },
    { city: 'Kyoto', days: 3 },
    { city: 'Osaka', days: 1 },
  ];

  it('keeps the second stay instead of tidying it away', () => {
    // The bug this stage exists to fix: the repeat used to be dropped here,
    // which turned a complete 7-day plan into an unfinished 6-day one.
    const kept = reconcileCityStays(RETURN_ROUTE, ['Osaka', 'Kyoto']);
    expect(kept).toEqual(RETURN_ROUTE);
    expect(cityStayTotal(kept)).toBe(7);
  });

  it('reads as a finished plan, so the planner will follow it', () => {
    expect(cityStayStatus(reconcileCityStays(RETURN_ROUTE, ['Osaka', 'Kyoto']), 7).complete)
      .toBe(true);
  });

  it('still drops a repeated city that left the trip entirely', () => {
    // Membership is unchanged: repeats survive, cities that are no longer
    // destinations do not.
    expect(reconcileCityStays(RETURN_ROUTE, ['Kyoto'])).toEqual([{ city: 'Kyoto', days: 3 }]);
  });

  it('becomes two Osaka legs with their own identities', () => {
    expect(legsFromCityStays(RETURN_ROUTE, 7)).toEqual([
      { city: 'Osaka', startDay: 1, endDay: 3, days: 3, visitIndex: 1, legId: 'osaka#1' },
      { city: 'Kyoto', startDay: 4, endDay: 6, days: 3, visitIndex: 1, legId: 'kyoto#1' },
      { city: 'Osaka', startDay: 7, endDay: 7, days: 1, visitIndex: 2, legId: 'osaka#2' },
    ]);
  });

  it('edits one Osaka stay without touching the other', () => {
    // The reason these functions take a position rather than a city name. By
    // name, both Osaka rows would move together and the traveller would watch
    // their airport day grow every time they added a night at the start.
    expect(setCityStayDays(RETURN_ROUTE, 2, 2, 8).map((stay) => stay.days)).toEqual([3, 3, 2]);
    expect(adjustCityStay(RETURN_ROUTE, 0, 1, 8).map((stay) => stay.days)).toEqual([4, 3, 1]);
  });

  it('takes the pool from the whole plan, counting both stays', () => {
    // 7 of 7 placed, so there is nothing free and an increase must do nothing.
    expect(adjustCityStay(RETURN_ROUTE, 0, 1, 7)).toEqual(RETURN_ROUTE);
  });
});

describe('two stays in a row in the same city', () => {
  it('merges them into one, because there is no Osaka to Osaka move', () => {
    // Splitting these would invent a transfer day the traveller never makes,
    // and a second leg that never goes anywhere.
    expect(legsFromCityStays([{ city: 'Osaka', days: 2 }, { city: 'Osaka', days: 2 }], 4))
      .toEqual([
        { city: 'Osaka', startDay: 1, endDay: 4, days: 4, visitIndex: 1, legId: 'osaka#1' },
      ]);
  });

  it('merges across a stay given no days at all', () => {
    // Kyoto is on the list but unplaced, so Osaka is still adjacent to Osaka.
    const legs = legsFromCityStays([
      { city: 'Osaka', days: 2 },
      { city: 'Kyoto', days: 0 },
      { city: 'Osaka', days: 2 },
    ], 4);
    expect(legs.map((leg) => leg.legId)).toEqual(['osaka#1']);
    expect(legs[0].days).toBe(4);
  });

  it('does not merge two stays a real leg apart', () => {
    const legs = legsFromCityStays([
      { city: 'Osaka', days: 2 },
      { city: 'Kyoto', days: 1 },
      { city: 'Osaka', days: 1 },
    ], 4);
    expect(legs.map((leg) => leg.legId)).toEqual(['osaka#1', 'kyoto#1', 'osaka#2']);
  });
});

describe('describing a stay to the traveller', () => {
  it('gives real dates when the trip has them', () => {
    expect(describeStayDates({ startDay: 1, endDay: 3 }, '2027-04-02')).toBe('2 Apr – 4 Apr');
  });

  it('gives a single date for a one-day stay', () => {
    expect(describeStayDates({ startDay: 4, endDay: 4 }, '2027-04-02')).toBe('5 Apr');
  });

  it('falls back to day numbers when there are no dates yet', () => {
    expect(describeStayDates({ startDay: 1, endDay: 3 }, undefined)).toBe('Days 1–3');
    expect(describeStayDates({ startDay: 4, endDay: 4 }, undefined)).toBe('Day 4');
  });
});

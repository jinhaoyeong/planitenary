import { describe, expect, it } from 'vitest';
import {
  cityForDay,
  describeCityLegs,
  legForDay,
  orderedCities,
  planCityLegs,
  routeStops,
  withLegIdentity,
  type CityLeg,
} from './cityLegs';

/** The four fields a leg had before Stage 4 added identity to it. */
const shape = (legs: CityLeg[]) =>
  legs.map((leg) => [leg.city, leg.startDay, leg.endDay, leg.days]);

describe('ordering the cities', () => {
  it('keeps the traveller\'s own order, which is the travel order', () => {
    expect(orderedCities(['Osaka', 'Nara', 'Kyoto', 'Kobe'])).toEqual(['Osaka', 'Nara', 'Kyoto', 'Kobe']);
  });

  it('drops blanks and repeats without reordering what is left', () => {
    expect(orderedCities(['Osaka', '', '  ', 'osaka', 'Kyoto', undefined])).toEqual(['Osaka', 'Kyoto']);
  });
});

describe('dividing the days', () => {
  it('gives a single city the whole trip', () => {
    const { legs } = planCityLegs(['Osaka'], 8);
    expect(legs).toEqual([
      { city: 'Osaka', startDay: 1, endDay: 8, days: 8, visitIndex: 1, legId: 'osaka#1' },
    ]);
  });

  it('splits evenly when nothing has been shortlisted yet', () => {
    // No weights means no evidence. An even split is a starting point, and it
    // must not pretend to be a recommendation.
    const { legs } = planCityLegs(['Osaka', 'Kyoto'], 8);
    expect(legs.map((leg) => leg.days)).toEqual([4, 4]);
  });

  it('gives the city with more shortlisted places more days', () => {
    const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto', 'Kobe'], 8, {
      Osaka: 20, Nara: 4, Kyoto: 15, Kobe: 3,
    });

    expect(legs.map((leg) => [leg.city, leg.days])).toEqual([
      ['Osaka', 3],
      ['Nara', 1],
      ['Kyoto', 3],
      ['Kobe', 1],
    ]);
    expect(legs.reduce((total, leg) => total + leg.days, 0)).toBe(8);
  });

  it('never gives a chosen city zero days', () => {
    // One place shortlisted in Kobe is still a stated intention to go to Kobe.
    const { legs } = planCityLegs(['Osaka', 'Kobe'], 8, { Osaka: 40, Kobe: 1 });
    expect(legs.find((leg) => leg.city === 'Kobe')?.days).toBe(1);
  });

  it('lays the legs out back to back with no gap and no overlap', () => {
    const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto'], 7, { Osaka: 10, Nara: 2, Kyoto: 8 });

    legs.forEach((leg, index) => {
      if (index === 0) expect(leg.startDay).toBe(1);
      else expect(leg.startDay).toBe(legs[index - 1].endDay + 1);
      expect(leg.endDay).toBe(leg.startDay + leg.days - 1);
    });
    expect(legs.at(-1)?.endDay).toBe(7);
  });

  it('spends every day of the trip, whatever the weights', () => {
    for (const dayCount of [1, 2, 3, 5, 8, 13, 21]) {
      const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto', 'Kobe'], dayCount, {
        Osaka: 20, Nara: 4, Kyoto: 15, Kobe: 3,
      });
      const spent = legs.reduce((total, leg) => total + leg.days, 0);
      expect(spent).toBe(dayCount);
    }
  });
});

describe('more cities than days', () => {
  it('drops the least-supported cities rather than the last ones typed', () => {
    // Three days, four cities. Kobe has one shortlisted place; it is the one
    // the traveller cared least about, whatever order they entered them in.
    const { legs, dropped } = planCityLegs(['Kobe', 'Osaka', 'Kyoto', 'Nara'], 3, {
      Kobe: 1, Osaka: 20, Kyoto: 15, Nara: 4,
    });

    expect(dropped).toEqual(['Kobe']);
    expect(legs.map((leg) => leg.city)).toEqual(['Osaka', 'Kyoto', 'Nara']);
  });

  it('says which cities fell out rather than losing them quietly', () => {
    const { dropped } = planCityLegs(['Osaka', 'Kyoto', 'Nara', 'Kobe'], 2, {
      Osaka: 20, Kyoto: 15, Nara: 4, Kobe: 3,
    });
    expect(dropped).toEqual(['Nara', 'Kobe']);
  });

  it('keeps one day each when the trip is exactly as long as the city list', () => {
    const { legs, dropped } = planCityLegs(['Osaka', 'Kyoto', 'Nara'], 3, { Osaka: 30, Kyoto: 2, Nara: 1 });
    expect(dropped).toEqual([]);
    expect(legs.map((leg) => leg.days)).toEqual([1, 1, 1]);
  });
});

describe('reading a day back', () => {
  const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto', 'Kobe'], 8, {
    Osaka: 20, Nara: 4, Kyoto: 15, Kobe: 3,
  });

  it('answers which city each day belongs to', () => {
    expect(cityForDay(legs, 1)).toBe('Osaka');
    expect(cityForDay(legs, 4)).toBe('Nara');
    expect(cityForDay(legs, 5)).toBe('Kyoto');
    expect(cityForDay(legs, 8)).toBe('Kobe');
  });

  it('claims nothing for a day outside the trip', () => {
    expect(cityForDay(legs, 0)).toBe('');
    expect(cityForDay(legs, 99)).toBe('');
    expect(cityForDay([], 1)).toBe('');
  });

  it('describes the division in the traveller\'s terms', () => {
    expect(describeCityLegs(legs)).toBe('Osaka 3 days · Nara 1 day · Kyoto 3 days · Kobe 1 day');
  });
});

describe('degenerate input', () => {
  it('plans nothing for a trip with no days', () => {
    expect(planCityLegs(['Osaka'], 0)).toEqual({ legs: [], dropped: [] });
  });

  it('plans nothing for a trip with no cities', () => {
    expect(planCityLegs([], 8)).toEqual({ legs: [], dropped: [] });
  });
});

describe('stops on the route, as opposed to cities on the trip', () => {
  it('keeps a city the traveller returns to', () => {
    // The whole point of the pair. Osaka twice is a route, not a typo.
    expect(routeStops(['Osaka', 'Kyoto', 'Osaka'])).toEqual(['Osaka', 'Kyoto', 'Osaka']);
  });

  it('still drops blanks, because a blank is not a stop', () => {
    expect(routeStops(['Osaka', '', '  ', 'Kyoto', undefined, null])).toEqual(['Osaka', 'Kyoto']);
  });

  it('agrees with orderedCities on every route that never repeats', () => {
    // This is what makes Stage 4A inert: no saved trip has a repeated city,
    // so no saved trip can tell the two functions apart.
    for (const route of [
      ['Osaka'],
      ['Osaka', 'Kyoto'],
      ['Osaka', 'Nara', 'Kyoto', 'Kobe'],
      [],
    ]) {
      expect(routeStops(route)).toEqual(orderedCities(route));
    }
  });
});

describe('telling one stay from another', () => {
  it('numbers each visit to a city in travel order', () => {
    const legs = withLegIdentity([
      { city: 'Osaka', startDay: 1, endDay: 3, days: 3 },
      { city: 'Kyoto', startDay: 4, endDay: 6, days: 3 },
      { city: 'Osaka', startDay: 7, endDay: 7, days: 1 },
    ]);

    expect(legs.map((leg) => leg.legId)).toEqual(['osaka#1', 'kyoto#1', 'osaka#2']);
    expect(legs.map((leg) => leg.visitIndex)).toEqual([1, 1, 2]);
  });

  it('ignores case and padding when deciding two stays share a city', () => {
    const legs = withLegIdentity([
      { city: 'Osaka', startDay: 1, endDay: 2, days: 2 },
      { city: 'Kyoto', startDay: 3, endDay: 4, days: 2 },
      { city: ' osaka ', startDay: 5, endDay: 5, days: 1 },
    ]);
    expect(legs.map((leg) => leg.legId)).toEqual(['osaka#1', 'kyoto#1', 'osaka#2']);
  });

  it('gives a route with no repeats all first visits', () => {
    const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto'], 7, { Osaka: 10, Nara: 2, Kyoto: 8 });
    expect(legs.every((leg) => leg.visitIndex === 1)).toBe(true);
  });

  it('answers which stay a day belongs to, not just which city', () => {
    const legs = withLegIdentity([
      { city: 'Osaka', startDay: 1, endDay: 3, days: 3 },
      { city: 'Kyoto', startDay: 4, endDay: 6, days: 3 },
      { city: 'Osaka', startDay: 7, endDay: 7, days: 1 },
    ]);

    // cityForDay cannot tell these apart, and that is exactly why legForDay
    // exists: day 1 and day 7 are both Osaka, and they are different stays.
    expect(cityForDay(legs, 1)).toBe(cityForDay(legs, 7));
    expect(legForDay(legs, 1)?.legId).toBe('osaka#1');
    expect(legForDay(legs, 7)?.legId).toBe('osaka#2');
    expect(legForDay(legs, 99)).toBeUndefined();
  });

  it('describes a returned-to city once per stay, without the ids', () => {
    const legs = withLegIdentity([
      { city: 'Osaka', startDay: 1, endDay: 3, days: 3 },
      { city: 'Kyoto', startDay: 4, endDay: 6, days: 3 },
      { city: 'Osaka', startDay: 7, endDay: 7, days: 1 },
    ]);
    expect(describeCityLegs(legs)).toBe('Osaka 3 days · Kyoto 3 days · Osaka 1 day');
  });
});

describe('Stage 4A changes nothing for a trip that already exists', () => {
  /**
   * The gate on this stage. Every expectation below is the answer this
   * function gave at `eb21d9d`, before legs had identity. Identity is
   * additive; if any day number moves, this stage is not inert and must not
   * ship.
   */
  it('divides a weighted four-city trip exactly as it did before', () => {
    const { legs } = planCityLegs(['Osaka', 'Nara', 'Kyoto', 'Kobe'], 8, {
      Osaka: 20, Nara: 4, Kyoto: 15, Kobe: 3,
    });
    expect(shape(legs)).toEqual([
      ['Osaka', 1, 3, 3],
      ['Nara', 4, 4, 1],
      ['Kyoto', 5, 7, 3],
      ['Kobe', 8, 8, 1],
    ]);
  });

  it('splits an unweighted two-city trip exactly as it did before', () => {
    expect(shape(planCityLegs(['Osaka', 'Kyoto'], 8).legs)).toEqual([
      ['Osaka', 1, 4, 4],
      ['Kyoto', 5, 8, 4],
    ]);
  });

  it('gives a single-city trip the whole trip exactly as it did before', () => {
    expect(shape(planCityLegs(['Osaka'], 8).legs)).toEqual([['Osaka', 1, 8, 8]]);
  });

  it('drops the least-supported cities exactly as it did before', () => {
    const { legs, dropped } = planCityLegs(['Kobe', 'Osaka', 'Kyoto', 'Nara'], 3, {
      Kobe: 1, Osaka: 20, Kyoto: 15, Nara: 4,
    });
    expect(dropped).toEqual(['Kobe']);
    expect(shape(legs)).toEqual([
      ['Osaka', 1, 1, 1],
      ['Kyoto', 2, 2, 1],
      ['Nara', 3, 3, 1],
    ]);
  });
});

/**
 * The two things a day header lets a traveller change, and their limits.
 *
 * Both used to be free-text boxes. A trip to Tokyo and Osaka could acquire a
 * day in "Toyko"; a ten-day August trip could acquire a day in March; and
 * changing a date changed a label while the card stayed where it was, so "Day
 * 2" could sit after "Day 5" and be dated before it.
 *
 * The rules live in one module because the same constraints have to hold on
 * mobile and desktop alike — a rule that lives in a component is a rule the
 * next surface will not have.
 */
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import {
  isDateWithinTrip,
  moveDayToDate,
  tripCityOptions,
  tripDateOptions,
  tripDateRange,
  resolveDayDate,
  unconfiguredDayCity,
} from './itineraryEditing';
import { discoveryTarget } from './destinationPlanner';

const trip = (over: Partial<Itinerary> & { tripProfile?: unknown } = {}): Itinerary => ({
  id: 'trip-1',
  name: 'Japan',
  revision: 1,
  days: [
    { day: 1, date: '2026-08-12', city: 'Osaka', title: 'Arrival day', activities: [] },
    { day: 2, date: '2026-08-13', city: 'Osaka', title: 'Day 2', activities: [] },
    { day: 3, date: '2026-08-18', city: 'Tokyo', title: 'Day 3', activities: [] },
  ],
  tripProfile: {
    version: 1,
    dayCount: 11,
    startDate: '2026-08-12',
    endDate: '2026-08-22',
    destinations: [
      { id: 'osaka', city: 'Osaka', country: 'Japan', countryCode: 'JP' },
      { id: 'tokyo', city: 'Tokyo', country: 'Japan', countryCode: 'JP' },
    ],
  },
  ...over,
} as unknown as Itinerary);

describe('a day may only be in a city the trip is going to', () => {
  it('offers the configured destinations, in travel order', () => {
    expect(tripCityOptions(trip())).toEqual([
      { id: 'osaka', city: 'Osaka' },
      { id: 'tokyo', city: 'Tokyo' },
    ]);
  });

  it('offers no city the trip never configured', () => {
    const cities = tripCityOptions(trip()).map((option) => option.city);
    expect(cities).not.toContain('Kyoto');
    expect(cities).not.toContain('Toyko');
  });

  it('does not repeat a city that is both configured and on a day', () => {
    const cities = tripCityOptions(trip()).map((option) => option.city);
    expect(cities).toEqual([...new Set(cities)]);
  });
});

describe('a day may only fall inside the trip', () => {
  it('reads the range from the trip profile', () => {
    expect(tripDateRange(trip())).toEqual({ start: '2026-08-12', end: '2026-08-22' });
  });

  it('offers every date the trip covers and nothing either side', () => {
    const options = tripDateOptions(trip());
    expect(options).toHaveLength(11);
    expect(options[0]).toBe('2026-08-12');
    expect(options[options.length - 1]).toBe('2026-08-22');
    expect(options).not.toContain('2026-08-11');
    expect(options).not.toContain('2026-08-23');
  });

  it.each([
    ['2026-08-12', true],
    ['2026-08-22', true],
    ['2026-08-16', true],
    ['2026-08-11', false],
    ['2026-08-23', false],
    ['Aug 16', false],
  ])('%s within the trip: %s', (date, expected) => {
    expect(isDateWithinTrip(trip(), date)).toBe(expected);
  });

  it('falls back to the span the days occupy when the profile has no dates', () => {
    const noProfile = trip({ tripProfile: { version: 1, dayCount: 3, destinations: [] } });
    expect(tripDateRange(noProfile)).toEqual({ start: '2026-08-12', end: '2026-08-18' });
  });

  it('offers nothing to pick when no range can be established', () => {
    // A trip whose dates predate the ISO format keeps its free-text control
    // rather than being handed an empty dropdown.
    const legacy = trip({
      days: [{ day: 1, date: 'Aug 12', city: 'Osaka', title: 'Day 1', activities: [] }],
      tripProfile: { version: 1, dayCount: 1, destinations: [] },
    });
    expect(tripDateOptions(legacy)).toEqual([]);
  });
});

describe('moving a day moves the card, not just the label', () => {
  it('reorders and renumbers so date and day number agree', () => {
    // Day 1 (12 Aug) moves to the 20th, which is after both other days.
    const moved = moveDayToDate(trip(), 0, '2026-08-20');
    expect(moved.days.map((day) => [day.day, day.date, day.title])).toEqual([
      [1, '2026-08-13', 'Day 2'],
      [2, '2026-08-18', 'Day 3'],
      [3, '2026-08-20', 'Arrival day'],
    ]);
  });

  it('refuses a date outside the trip', () => {
    const unchanged = moveDayToDate(trip(), 0, '2026-08-23');
    expect(unchanged.days.map((day) => day.date)).toEqual(['2026-08-12', '2026-08-13', '2026-08-18']);
  });

  it('does nothing when the date has not changed', () => {
    const before = trip();
    expect(moveDayToDate(before, 0, '2026-08-12')).toBe(before);
  });

  it('keeps the existing order when two days share a date', () => {
    const moved = moveDayToDate(trip(), 2, '2026-08-13');
    // Day 2 was already the 13th and stays ahead of the day that just joined it.
    expect(moved.days.map((day) => day.title)).toEqual(['Arrival day', 'Day 2', 'Day 3']);
  });

  it('accepts the date but keeps the arrangement when days cannot be compared', () => {
    const legacy = trip({
      days: [
        { day: 1, date: 'Aug 12', city: 'Osaka', title: 'Arrival day', activities: [] },
        { day: 2, date: '2026-08-13', city: 'Osaka', title: 'Day 2', activities: [] },
      ],
    });
    const moved = moveDayToDate(legacy, 1, '2026-08-20');
    expect(moved.days.map((day) => day.date)).toEqual(['Aug 12', '2026-08-20']);
    // Sorting "Aug 12" against a real date would invent an order nobody chose.
    expect(moved.days.map((day) => day.title)).toEqual(['Arrival day', 'Day 2']);
  });

  it('leaves the activities on the day that moved', () => {
    const withActivity = trip({
      days: [
        { day: 1, date: '2026-08-12', city: 'Osaka', title: 'Arrival day', activities: [{ id: 'a', name: 'Ramen', time: '19:00', durationMinutes: 60, type: 'food' }] },
        { day: 2, date: '2026-08-13', city: 'Osaka', title: 'Day 2', activities: [] },
      ] as unknown as Itinerary['days'],
    });
    const moved = moveDayToDate(withActivity, 0, '2026-08-20');
    expect(moved.days[1].title).toBe('Arrival day');
    expect(moved.days[1].activities).toHaveLength(1);
  });
});

/**
 * How many places a traveller is asked to review.
 *
 * The deck was a flat sixty whatever the stay, because the client never told
 * the provider how long anybody was staying and the server default filled the
 * gap. Sixty places for a five-day city is a search directory wearing a
 * planner's clothes.
 */
describe('the deck is sized by the days spent in that city', () => {
  it.each([
    [4, 20],
    [5, 25],
    [6, 30],
    [8, 40],
  ])('%s days in a city offers about %s places', (days, expected) => {
    expect(discoveryTarget(days).visible).toBe(expected);
  });

  it('never offers so few that there is no real choice', () => {
    expect(discoveryTarget(1).visible).toBe(10);
    expect(discoveryTarget(0).visible).toBe(10);
  });

  it('stops growing long before decision fatigue returns', () => {
    // Twenty-one days does not mean a hundred and five cards.
    expect(discoveryTarget(21).visible).toBe(40);
    expect(discoveryTarget(60).visible).toBe(40);
  });

  it('asks the provider for headroom the traveller never sees', () => {
    const four = discoveryTarget(4);
    expect(four.fetch).toBeGreaterThan(four.visible);
    // Filtering losses are absorbed internally, not shown as a longer deck.
    expect(four.fetch).toBeLessThanOrEqual(60);
    expect(discoveryTarget(21).fetch).toBeLessThanOrEqual(60);
  });

  it('is per city, so two legs get two different decks', () => {
    // Four days in Tokyo and three in Osaka, not seven days of places twice.
    expect(discoveryTarget(4).visible).toBe(20);
    expect(discoveryTarget(3).visible).toBe(15);
  });
});

/**
 * The trip this was actually built for.
 *
 * Its days are stored as presentation labels — "AUG 12" — which an earlier
 * version of this module answered by handing the trip back its free-text box.
 * That was backwards: the plans most likely to hold a nonsense date were the
 * only ones still able to receive one.
 */
describe('an existing trip with AUG 12 style dates', () => {
  const legacy = () => trip({
    days: [
      { day: 1, date: 'AUG 12', city: 'Osaka', title: 'Arrival day', activities: [] },
      { day: 2, date: 'AUG 13', city: 'Osaka', title: 'Day 2', activities: [] },
      { day: 3, date: 'AUG 18', city: 'Tokyo', title: 'Day 3', activities: [] },
    ],
  });

  it('resolves the stored label to the real date inside the trip', () => {
    expect(resolveDayDate(legacy(), 0)).toBe('2026-08-12');
    expect(resolveDayDate(legacy(), 2)).toBe('2026-08-18');
  });

  it.each(['Aug 12', 'August 12', '12 Aug', 'aug 12'])('understands %s', (label) => {
    const written = trip({ days: [{ day: 1, date: label, city: 'Osaka', title: 'Day 1', activities: [] }] });
    expect(resolveDayDate(written, 0)).toBe('2026-08-12');
  });

  it('still offers the whole trip and nothing outside it', () => {
    const options = tripDateOptions(legacy());
    expect(options).toHaveLength(11);
    expect(options).not.toContain('2026-08-11');
    expect(options).not.toContain('2026-08-23');
    // The point of the fix: a legacy trip is not left with free text.
    expect(options.length).toBeGreaterThan(0);
  });

  it('falls back to position only when the label carries no date', () => {
    const unlabelled = trip({
      days: [
        { day: 1, date: 'Day 1', city: 'Osaka', title: 'Arrival day', activities: [] },
        { day: 2, date: 'Day 2', city: 'Osaka', title: 'Day 2', activities: [] },
      ],
    });
    expect(resolveDayDate(unlabelled, 0)).toBe('2026-08-12');
    expect(resolveDayDate(unlabelled, 1)).toBe('2026-08-13');
  });

  it('moves a legacy day and reorders the plan around it', () => {
    // AUG 12 -> 16 August puts the arrival day after both other days... except
    // Day 3 is the 18th, so it lands in the middle.
    const moved = moveDayToDate(legacy(), 0, '2026-08-16');
    expect(moved.days.map((day) => [day.day, day.title])).toEqual([
      [1, 'Day 2'],
      [2, 'Arrival day'],
      [3, 'Day 3'],
    ]);
    expect(moved.days[1].date).toBe('2026-08-16');
    // Untouched days keep exactly what they had; nothing is rewritten by a move.
    expect(moved.days[0].date).toBe('AUG 13');
  });

  it('refuses to move a legacy day outside the trip', () => {
    const unchanged = moveDayToDate(legacy(), 0, '2026-08-23');
    expect(unchanged.days.map((day) => day.date)).toEqual(['AUG 12', 'AUG 13', 'AUG 18']);
  });
});

describe('only configured destinations are selectable', () => {
  it('offers the trip cities and nothing else', () => {
    const withNara = trip({
      days: [{ day: 1, date: '2026-08-12', city: 'Nara', title: 'Day 1', activities: [] }],
    });
    // Nara is where the day currently is, but the trip was never set up for it.
    expect(tripCityOptions(withNara).map((o) => o.city)).toEqual(['Osaka', 'Tokyo']);
  });

  it('names an unconfigured current city so it can be shown, not chosen', () => {
    const withNara = trip({
      days: [{ day: 1, date: '2026-08-12', city: 'Nara', title: 'Day 1', activities: [] }],
    });
    expect(unconfiguredDayCity(withNara, 'Nara')).toBe('Nara');
    expect(unconfiguredDayCity(withNara, 'Tokyo')).toBeUndefined();
    expect(unconfiguredDayCity(withNara, undefined)).toBeUndefined();
  });

  it('carries the destination id so the name is only presentation', () => {
    expect(tripCityOptions(trip())).toEqual([
      { id: 'osaka', city: 'Osaka' },
      { id: 'tokyo', city: 'Tokyo' },
    ]);
  });
});

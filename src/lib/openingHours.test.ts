/**
 * The traveller-facing reading of opening hours.
 *
 * The bug these guard against: the details panel read `periods[0]` and appended
 * the raw confidence enum, so a museum published as `Tu-Su 10:00-18:00` was
 * shown as "09:00–17:00 · high confidence" — open every day, sourced by an
 * adjective. Both halves of that are tested here.
 *
 * `openingWindow` itself is covered by `humanScheduler.test.ts`, which passes
 * unmodified after the extraction; these are the summary's own rules.
 */
import { describe, expect, it } from 'vitest';
import type { DateAwareOpeningHours } from './destinationIntelligence';
import { describeOpeningHours, openingWindow } from './openingHours';

/** A museum shut on Mondays — the case that motivated all of this. */
const TUE_TO_SUN: DateAwareOpeningHours = {
  periods: [{ daysOfWeek: [2, 3, 4, 5, 6, 0], opensAt: '10:00', closesAt: '18:00' }],
  sourceConfidence: 'low',
};

/** A temple that shuts for lunch: two windows on the same day. */
const SPLIT_DAY: DateAwareOpeningHours = {
  periods: [
    { daysOfWeek: [1, 2, 3, 4, 5, 6, 0], opensAt: '09:00', closesAt: '12:00' },
    { daysOfWeek: [1, 2, 3, 4, 5, 6, 0], opensAt: '14:00', closesAt: '17:00' },
  ],
  sourceConfidence: 'high',
};

/** 2027-04-12 is a Monday; 2027-04-13 a Tuesday. */
const MONDAY = new Date('2027-04-12T11:00:00Z');

describe('weekly grouping', () => {
  it('collapses a contiguous run rather than listing seven days', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, { now: MONDAY });
    expect(summary.weekly).toHaveLength(1);
    expect(summary.weekly[0].label).toBe('Tue–Sun');
    expect(summary.weekly[0].windows).toEqual(['10:00–18:00']);
  });

  it('names the closed day instead of leaving the traveller to infer it', () => {
    expect(describeOpeningHours(TUE_TO_SUN, { now: MONDAY }).closedDays).toEqual(['Monday']);
  });

  it('keeps both windows on a day that shuts for lunch', () => {
    // `periods[0]` would have shown 09:00–12:00 and silently dropped the
    // afternoon, which is most of the visiting day.
    const summary = describeOpeningHours(SPLIT_DAY, { now: MONDAY });
    expect(summary.weekly[0].windows).toEqual(['09:00–12:00', '14:00–17:00']);
    expect(summary.closedDays).toEqual([]);
  });

  it('joins non-adjacent days that share hours into one line', () => {
    const shutWednesday: DateAwareOpeningHours = {
      periods: [{ daysOfWeek: [1, 2, 4, 5, 6, 0], opensAt: '10:00', closesAt: '18:00' }],
      sourceConfidence: 'medium',
    };
    const summary = describeOpeningHours(shutWednesday, { now: MONDAY });
    expect(summary.weekly).toHaveLength(1);
    expect(summary.weekly[0].label).toBe('Mon–Tue, Thu–Sun');
  });

  it('does not wrap Sunday into Monday when building a run', () => {
    // Display order is Mon..Sun, so Sunday is last. A naive adjacency check on
    // `getDay()` values would merge it with Monday, which reads as a week that
    // starts in the wrong place.
    const weekend: DateAwareOpeningHours = {
      periods: [{ daysOfWeek: [0, 6], opensAt: '11:00', closesAt: '16:00' }],
      sourceConfidence: 'medium',
    };
    expect(describeOpeningHours(weekend, { now: MONDAY }).weekly[0].label).toBe('Sat–Sun');
  });
});

describe('today', () => {
  it('says closed when today has no window', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, { now: MONDAY, timezone: 'UTC' });
    expect(summary.closedToday).toBe(true);
    expect(summary.todayLine).toBe('Closed today');
  });

  it('reads the clock in the destination, not in the browser', () => {
    // 23:00 UTC on Monday is already 08:00 Tuesday in Tokyo. A traveller
    // planning from the other side of the world is asking about the
    // destination's day.
    const lateMonday = new Date('2027-04-12T23:00:00Z');
    expect(describeOpeningHours(TUE_TO_SUN, { now: lateMonday, timezone: 'UTC' }).closedToday).toBe(true);
    expect(describeOpeningHours(TUE_TO_SUN, { now: lateMonday, timezone: 'Asia/Tokyo' }).closedToday).toBe(false);
  });

  it('distinguishes open now from not open yet', () => {
    const tuesdayMorning = new Date('2027-04-13T09:00:00Z');
    const tuesdayMidday = new Date('2027-04-13T12:00:00Z');
    expect(describeOpeningHours(TUE_TO_SUN, { now: tuesdayMorning, timezone: 'UTC' }).todayLine).toBe('Opens 10:00 today');
    expect(describeOpeningHours(TUE_TO_SUN, { now: tuesdayMidday, timezone: 'UTC' }).todayLine).toBe('Open now until 18:00');
  });

  it('answers about the day being planned when asked for a specific date', () => {
    // On an itinerary card the question is not "is it open now" but "will it be
    // open on the day I am there".
    const summary = describeOpeningHours(TUE_TO_SUN, { now: MONDAY, onDate: '2027-04-19' });
    expect(summary.todayLine).toBe('Closed that day');
    expect(describeOpeningHours(TUE_TO_SUN, { now: MONDAY, onDate: '2027-04-20' }).todayLine).toBe('Open 10:00–18:00');
  });

  it('falls back to the viewer’s clock on an unusable timezone rather than throwing', () => {
    expect(() => describeOpeningHours(TUE_TO_SUN, { now: MONDAY, timezone: 'Mars/Olympus' })).not.toThrow();
  });
});

describe('closures inside the traveller’s own trip', () => {
  it('names the trip days this place is shut', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, {
      now: MONDAY,
      tripStart: '2027-04-17',
      tripEnd: '2027-04-24',
    });
    expect(summary.closedTripDates.map((closure) => closure.label)).toEqual(['Monday 19 Apr']);
    expect(summary.closedTripDates[0].reason).toBe('weekday');
  });

  it('reports nothing when the trip misses the closed day entirely', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, {
      now: MONDAY,
      tripStart: '2027-04-13',
      tripEnd: '2027-04-16',
    });
    expect(summary.closedTripDates).toEqual([]);
  });

  it('caps the list so a long trip does not print every Monday', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, {
      now: MONDAY,
      tripStart: '2027-04-01',
      tripEnd: '2027-05-30',
      maxTripClosures: 2,
    });
    expect(summary.closedTripDates).toHaveLength(2);
  });

  it('asserts a dated closure, because a source supplied the date', () => {
    const withHoliday: DateAwareOpeningHours = {
      periods: [
        ...TUE_TO_SUN.periods,
        { date: '2027-04-20', closed: true },
      ],
      sourceConfidence: 'high',
    };
    const summary = describeOpeningHours(withHoliday, {
      now: MONDAY,
      tripStart: '2027-04-20',
      tripEnd: '2027-04-21',
    });
    expect(summary.closedTripDates).toEqual([
      { date: '2027-04-20', label: 'Tuesday 20 Apr', reason: 'dated' },
    ]);
  });

  it('never invents a holiday closure from a weekly pattern alone', () => {
    // 2027-01-01 is a Friday and the weekly pattern says open. Many venues
    // shut on New Year's Day, but nothing in this data says so, and guessing
    // would be the same class of error as showing Monday hours for a Tuesday.
    const summary = describeOpeningHours(TUE_TO_SUN, {
      now: MONDAY,
      tripStart: '2027-01-01',
      tripEnd: '2027-01-01',
    });
    expect(summary.closedTripDates).toEqual([]);
  });
});

describe('provenance and gaps', () => {
  it('names where the hours came from instead of printing a confidence enum', () => {
    const line = describeOpeningHours(SPLIT_DAY, { now: MONDAY }).provenanceLine;
    expect(line).toContain('venue’s own site');
    expect(line).not.toMatch(/confidence/i);
    expect(describeOpeningHours(TUE_TO_SUN, { now: MONDAY }).provenanceLine)
      .toContain('Community-maintained');
  });

  it('appends when the hours were last checked', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, { now: MONDAY, verifiedAt: '2026-08-04T00:00:00Z' });
    expect(summary.provenanceLine).toContain('checked 4 Aug 2026');
  });

  it('carries stated gaps through, de-duplicated', () => {
    const summary = describeOpeningHours(TUE_TO_SUN, {
      now: MONDAY,
      caveats: ['Holiday hours are not read here.', 'Holiday hours are not read here.'],
    });
    expect(summary.caveats).toEqual(['Holiday hours are not read here.']);
  });
});

describe('nothing published', () => {
  it('reports unknown rather than inventing a window', () => {
    expect(describeOpeningHours(undefined).unknown).toBe(true);
    expect(describeOpeningHours({ periods: [], sourceConfidence: 'low' }).unknown).toBe(true);
    // Periods that carry no usable times are the same as none at all.
    expect(describeOpeningHours({ periods: [{ daysOfWeek: [1] }], sourceConfidence: 'low' }).unknown).toBe(true);
  });

  it('still reports gaps when the hours themselves were unreadable', () => {
    // The reason there are no hours is exactly what the traveller needs.
    const summary = describeOpeningHours(undefined, { caveats: ['Opens relative to sunset.'] });
    expect(summary.unknown).toBe(true);
    expect(summary.caveats).toEqual(['Opens relative to sunset.']);
  });

  it('leaves the scheduler’s unknown window generous, not closed', () => {
    // A place with no published hours must stay schedulable; only a place with
    // hours that name no window for the day is closed.
    expect(openingWindow(undefined, 1)).toMatchObject({ known: false, closedToday: false });
    expect(openingWindow(TUE_TO_SUN, 1)).toMatchObject({ known: true, closedToday: true });
  });
});

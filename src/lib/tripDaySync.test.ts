/**
 * What happens when the trip's length changes after it has been built.
 *
 * Asked directly: *"What if user add one more day in the app after building and
 * setting up the trip — does the UI update?"* It did not. Day cards were built
 * once, at creation, and nothing rebuilt them: the hero badge moved to 9 while
 * the handbook still held eight days, so the ninth day existed nowhere the
 * traveller could open it, and the planner sized everything to eight.
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { createItineraryFromProfile, syncDaysWithDuration, syncDurationDependentFields } from './trips';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

const kyoto = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-09',
  ...overrides,
});

const activity = (name: string): Activity => ({
  id: `activity-${name}`,
  kind: 'place',
  name,
  time: '10:00',
  description: '',
  type: 'sight',
});

const withActivityOnLastDay = (itinerary: Itinerary): Itinerary => ({
  ...itinerary,
  days: itinerary.days.map((day, index) => (index === itinerary.days.length - 1
    ? { ...day, activities: [activity('Kiyomizu-dera')] }
    : day)),
});

describe('adding a day', () => {
  it('adds the day card, so the day exists somewhere the traveller can open it', () => {
    const built = createItineraryFromProfile(kyoto());
    expect(built.days).toHaveLength(8);

    const longer = { ...kyoto({ endDate: '2027-04-10' }), dayCount: 9 };
    const synced = syncDaysWithDuration(built, longer);

    expect(synced.days).toHaveLength(9);
    expect(synced.added).toBe(1);
    expect(synced.days[8].day).toBe(9);
  });

  it('dates the new day correctly', () => {
    const built = createItineraryFromProfile(kyoto());
    const synced = syncDaysWithDuration(built, { ...kyoto({ endDate: '2027-04-10' }), dayCount: 9 });
    expect(synced.days[8].date).toBe('Apr 10');
  });

  it('leaves the days already planned exactly as they were', () => {
    // The point of appending rather than regenerating: a ninth day is not a
    // reason to rebuild the eight the traveller has been working on.
    const built = withActivityOnLastDay(createItineraryFromProfile(kyoto()));
    const synced = syncDaysWithDuration(built, { ...kyoto({ endDate: '2027-04-10' }), dayCount: 9 });

    expect(synced.days[7].activities).toHaveLength(1);
    expect(synced.days[7].title).toBe(built.days[7].title);
  });

  it('reaches the handbook through the ordinary save path', () => {
    // `syncDurationDependentFields` is what every profile write goes through,
    // which is why the sync lives there rather than in a panel.
    const built = createItineraryFromProfile(kyoto());
    const saved = syncDurationDependentFields(built, { ...kyoto({ endDate: '2027-04-10' }), dayCount: 9 });

    expect(saved.days).toHaveLength(9);
    expect(saved.heroDayBadge).toBe('9');
  });
});

describe('moving the trip', () => {
  it('re-dates every day when the start moves', () => {
    const built = createItineraryFromProfile(kyoto());
    expect(built.days[0].date).toBe('Apr 2');

    const shifted = syncDaysWithDuration(
      built,
      kyoto({ startDate: '2027-05-02', endDate: '2027-05-09' }),
    );

    expect(shifted.days[0].date).toBe('May 2');
    expect(shifted.days[7].date).toBe('May 9');
    expect(shifted.added).toBe(0);
  });
});

describe('shortening a trip', () => {
  it('removes trailing days that hold nothing', () => {
    const built = createItineraryFromProfile(kyoto());
    const synced = syncDaysWithDuration(built, { ...kyoto({ endDate: '2027-04-07' }), dayCount: 6 });

    expect(synced.days).toHaveLength(6);
    expect(synced.removed).toBe(2);
    expect(synced.strandedDays).toEqual([]);
  });

  it('never deletes a day with something planned on it', () => {
    // A day with activities is work. Losing it to a date change would be the
    // app throwing away what the traveller did, so it is kept and reported.
    const built = withActivityOnLastDay(createItineraryFromProfile(kyoto()));
    const synced = syncDaysWithDuration(built, { ...kyoto({ endDate: '2027-04-07' }), dayCount: 6 });

    expect(synced.days).toHaveLength(8);
    expect(synced.removed).toBe(0);
    expect(synced.strandedDays).toEqual([7, 8]);
    expect(synced.days[7].activities).toHaveLength(1);
  });

  it('stops removing at the first day that holds something', () => {
    const built = createItineraryFromProfile(kyoto());
    const withMiddle: Itinerary = {
      ...built,
      days: built.days.map((day, index) => (index === 6 ? { ...day, activities: [activity('Nishiki')] } : day)),
    };

    const synced = syncDaysWithDuration(withMiddle, { ...kyoto({ endDate: '2027-04-06' }), dayCount: 5 });

    expect(synced.removed).toBe(1);
    expect(synced.days).toHaveLength(7);
    expect(synced.strandedDays).toEqual([6, 7]);
  });
});

describe('clearing the dates', () => {
  it('leaves the handbook alone rather than deleting the plan', () => {
    // Removing the dates is not an instruction to delete eight days of work.
    const built = withActivityOnLastDay(createItineraryFromProfile(kyoto()));
    const synced = syncDaysWithDuration(built, kyoto({ startDate: undefined, endDate: undefined, dayCount: 0 }));

    expect(synced.days).toEqual(built.days);
    expect(synced.added).toBe(0);
    expect(synced.removed).toBe(0);
  });
});

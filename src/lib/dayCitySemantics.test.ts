/**
 * What a day's city means.
 *
 * A day card carried one city, and that single field was asked two different
 * questions: where the traveller sleeps, and where the day's activities are.
 * Those answers diverge the moment anyone takes a day trip — the Osaka day
 * that goes to Nara is still an Osaka day — and every consumer that read the
 * one field got one of the two questions wrong.
 *
 * `stayCity` answers the first. `activityCities` answers the second, and
 * answers it as a list, because a day out is a day in more than one place.
 * `city` remains only as an alias of `stayCity` so nothing that still reads it
 * breaks mid-migration; these tests exist to keep that alias honest.
 */
import { describe, expect, it } from 'vitest';
import { emptyItinerary, sanitizeDay, sanitizeItinerary } from './itinerarySanitize';
import type { DayPlan } from '../data';

const read = (stored: unknown): DayPlan => sanitizeDay(stored, undefined, 0, 'trip-1');

const legacyDay = {
  day: 1,
  date: '2026-08-17',
  city: 'Osaka',
  title: 'Day one',
  activities: [],
};

describe('reading a day written before stay and activity cities existed', () => {
  it('reads the old city field as the place the traveller sleeps', () => {
    // The only meaning it ever had. A trip saved last month said "Osaka" on a
    // day card and meant "we are based in Osaka" — so that is what it becomes,
    // rather than an unset field that every consumer then has to guess at.
    const day = read(legacyDay);
    expect(day.stayCity).toBe('Osaka');
  });

  it('records no activity cities, because the old format never stored any', () => {
    // The migration's one job is to not invent. An empty list here means "we
    // do not know where this day's stops are", which is true, and is a
    // different claim from "they were all in Osaka", which is not known.
    expect(read(legacyDay).activityCities).toEqual([]);
  });

  it('leaves activity cities empty even when an activity is plainly elsewhere', () => {
    // Kinkaku-ji is in Kyoto and its coordinates say so, on a day based in
    // Osaka. Deriving `activityCities: ['Kyoto']` from that would be right
    // here and wrong the moment a place sits near a boundary or a saved
    // coordinate is stale — and it would write the guess into the traveller's
    // trip, where nothing distinguishes it from something they told us.
    // Stage 2 records this from the planner, which knows; migration does not.
    const day = read({
      ...legacyDay,
      activities: [{
        time: '10:00',
        name: 'Kinkaku-ji',
        description: 'Golden Pavilion.',
        type: 'sight',
        coordinates: [35.0394, 135.7292],
      }],
    });
    expect(day.stayCity).toBe('Osaka');
    expect(day.activityCities).toEqual([]);
  });

  it('survives a day that names no city at all', () => {
    const day = read({ day: 1, date: '2026-08-17', title: 'Day one', activities: [] });
    expect(day.stayCity).toBe('');
    expect(day.city).toBe('');
    expect(day.activityCities).toEqual([]);
  });
});

describe('the city alias cannot drift from the stay city', () => {
  it('mirrors a newly written stay city onto the alias', () => {
    // A day written by Stage 2 code sets `stayCity` and nothing else. Anything
    // still reading `city` — components, the agent, stored payloads — has to
    // see the same answer, or the migration breaks them silently.
    const day = read({ day: 1, date: '2026-08-17', stayCity: 'Fukuoka', title: 'Day one', activities: [] });
    expect(day.city).toBe('Fukuoka');
  });

  it('keeps both fields when a stored day already agrees with itself', () => {
    const day = read({ ...legacyDay, stayCity: 'Osaka' });
    expect(day.stayCity).toBe('Osaka');
    expect(day.city).toBe('Osaka');
  });

  it('resolves a stored day whose two fields disagree, rather than passing both on', () => {
    // However this arises — an older client writing `city` after a newer one
    // wrote `stayCity`, a hand-edited payload, a partial sync — a day must not
    // leave the read path making two claims. `stayCity` is the field with the
    // defined meaning, so it wins and the alias follows it.
    const day = read({ ...legacyDay, stayCity: 'Kyoto', city: 'Osaka' });
    expect(day.stayCity).toBe('Kyoto');
    expect(day.city).toBe('Kyoto');
  });

  it('trims both to the same value so a comparison of the two never fails on whitespace', () => {
    const day = read({ ...legacyDay, city: '  Osaka  ' });
    expect(day.stayCity).toBe('Osaka');
    expect(day.city).toBe('Osaka');
  });
});

describe('activity cities are re-derived, never trusted', () => {
  it('keeps a stored list, dropping blanks, non-strings and repeats', () => {
    const day = read({
      ...legacyDay,
      activityCities: ['Nara', '  ', 'nara', 42, 'Kyoto', null],
    });
    expect(day.activityCities).toEqual(['Nara', 'Kyoto']);
  });

  it('discards a value that is not a list at all', () => {
    // A malformed field costs the list and nothing else — the day still reads.
    const day = read({ ...legacyDay, activityCities: 'Nara' });
    expect(day.activityCities).toEqual([]);
    expect(day.stayCity).toBe('Osaka');
  });

  it('caps the list, because a day is not an itinerary', () => {
    const day = read({
      ...legacyDay,
      activityCities: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    });
    expect(day.activityCities).toHaveLength(6);
  });
});

describe('reading a trip twice changes nothing the second time', () => {
  it('is idempotent across the whole itinerary', () => {
    // Trips are sanitized on load and again on save, so a read that shifted
    // any of these fields would drift a stored trip on every round trip.
    const stored = { ...emptyItinerary, id: 'trip-1', days: [legacyDay] };
    const once = sanitizeItinerary(stored, emptyItinerary);
    const twice = sanitizeItinerary(once, emptyItinerary);
    expect(twice.days).toEqual(once.days);
    expect(once.days[0].stayCity).toBe('Osaka');
    expect(once.days[0].city).toBe('Osaka');
    expect(once.days[0].activityCities).toEqual([]);
  });
});

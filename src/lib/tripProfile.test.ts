import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
  existingDestinationFor,
  manualDestination,
  sanitizeClockTime,
  sanitizeTripProfile,
  type TripProfile,
} from './tripProfile';
import { shapeTripEdge } from './destinationPlanner';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from '../../supabase/functions/_shared/itineraryEdgeTiming';
import { toMinutes, toTime } from './humanScheduler';

const kyoto = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  startDate: '2026-04-01',
  endDate: '2026-04-05',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('flight times captured on the profile', () => {
  it('normalises what a browser time input can produce', () => {
    expect(sanitizeClockTime('09:15')).toBe('09:15');
    // Some browsers append seconds; nothing downstream reads them.
    expect(sanitizeClockTime('09:15:00')).toBe('09:15');
    // A single-digit hour must be padded, because shapeTripEdge parses HH:MM.
    expect(sanitizeClockTime('9:15')).toBe('09:15');
    expect(sanitizeClockTime(' 23:59 ')).toBe('23:59');
  });

  it('drops a time it cannot read instead of guessing at one', () => {
    // A half-read flight time is worse than none: it would shorten or lengthen
    // the wrong day while looking like the traveller asked for it.
    for (const bad of ['24:00', '12:60', '11', 'noon', '', '11:5', undefined, 42, null]) {
      expect(sanitizeClockTime(bad)).toBeUndefined();
    }
  });

  it('keeps flight times across a save and reload', () => {
    // sanitizeTripProfile is the gate every stored trip passes through, so a
    // field it does not carry is a field that silently disappears on reload.
    const saved = JSON.parse(JSON.stringify(kyoto({ arrivalTime: '11:00', departureTime: '20:00' })));
    const reloaded = sanitizeTripProfile(saved);
    expect(reloaded?.arrivalTime).toBe('11:00');
    expect(reloaded?.departureTime).toBe('20:00');
  });

  it('refuses a stored time that is not a real clock reading', () => {
    const reloaded = sanitizeTripProfile({ ...kyoto(), arrivalTime: '11pm', departureTime: 7 });
    expect(reloaded?.arrivalTime).toBeUndefined();
    expect(reloaded?.departureTime).toBeUndefined();
  });

  it('leaves a trip with no flight times untouched', () => {
    const reloaded = sanitizeTripProfile(kyoto());
    expect(reloaded?.arrivalTime).toBeUndefined();
    expect(reloaded?.departureTime).toBeUndefined();
  });

  it('hands the scheduler a format it actually acts on', () => {
    // The point of the capture: what survives sanitizing must reshape the day.
    // Seconds from the input element would otherwise reach toMinutes unparsed.
    const profile = sanitizeTripProfile({ ...kyoto(), arrivalTime: '11:00:00', departureTime: '20:00:00' });
    const firstDay = shapeTripEdge(0, 5, { arrivalTime: profile?.arrivalTime });
    const lastDay = shapeTripEdge(4, 5, { departureTime: profile?.departureTime });
    expect(firstDay.startTimeOverride).toBe(
      toTime(toMinutes(profile!.arrivalTime!) + ARRIVAL_SETTLING_MINUTES),
    );
    expect(lastDay.returnTimeOverride).toBe(
      toTime(toMinutes(profile!.departureTime!) - DEPARTURE_LEAD_MINUTES),
    );
  });
});

describe('a stay plan that returns to a city', () => {
  const kansai = (overrides: Partial<TripProfile> = {}): TripProfile => ({
    ...createEmptyProfile('MYR'),
    destinations: [manualDestination('Osaka', 'Japan'), manualDestination('Kyoto', 'Japan')],
    startDate: '2026-04-01',
    endDate: '2026-04-07',
    createdAt: '2026-01-01T00:00:00.000Z',
    cityStays: [
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ],
    cityStayDayCount: 7,
    ...overrides,
  });

  it('keeps both Osaka stays across a save and reload', () => {
    // sanitizeTripProfile used to drop the repeat, which is where a complete
    // seven-day plan quietly became an unfinished six-day one. The planner
    // then read it as abandoned and inferred its own split instead.
    const saved = JSON.parse(JSON.stringify(kansai()));
    expect(sanitizeTripProfile(saved)?.cityStays).toEqual([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]);
  });

  it('reloads a plan that still adds up to the trip', () => {
    const reloaded = sanitizeTripProfile(JSON.parse(JSON.stringify(kansai())));
    const total = (reloaded?.cityStays ?? []).reduce((sum, stay) => sum + stay.days, 0);
    expect(total).toBe(reloaded?.dayCount);
  });

  it('still refuses a stay in a city the trip does not have', () => {
    // Membership is the check that stayed. Repeats are a route; Kobe is not
    // on this trip at all.
    const reloaded = sanitizeTripProfile(JSON.parse(JSON.stringify(kansai({
      cityStays: [{ city: 'Osaka', days: 6 }, { city: 'Kobe', days: 1 }],
    }))));
    expect(reloaded?.cityStays).toEqual([{ city: 'Osaka', days: 6 }]);
  });

  it('leaves a plan with no repeats exactly as it was', () => {
    const reloaded = sanitizeTripProfile(JSON.parse(JSON.stringify(kansai({
      cityStays: [{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }],
    }))));
    expect(reloaded?.cityStays).toEqual([
      { city: 'Osaka', days: 4 },
      { city: 'Kyoto', days: 3 },
    ]);
  });
});

describe('destinations are a set of places, not a route', () => {
  const kansai = [manualDestination('Osaka', 'Japan'), manualDestination('Kyoto', 'Japan')];

  it('finds a city the trip already has, whatever id it arrives under', () => {
    // The same place reaches the app under different provider records. Matching
    // only on id would let a second Osaka through, and two Osaka destinations
    // mean two decks of Osaka places for a traveller who meant one Osaka.
    expect(existingDestinationFor(kansai, { id: 'somewhere-else', city: 'Osaka' })?.city).toBe('Osaka');
    expect(existingDestinationFor(kansai, { id: 'x', city: ' osaka ' })?.city).toBe('Osaka');
    expect(existingDestinationFor(kansai, { id: kansai[1].id, city: 'Kyoto' })?.city).toBe('Kyoto');
  });

  it('lets a genuinely new city through', () => {
    expect(existingDestinationFor(kansai, { id: 'kobe', city: 'Kobe' })).toBeUndefined();
    expect(existingDestinationFor([], { id: 'osaka', city: 'Osaka' })).toBeUndefined();
  });

  it('says nothing about the stay plan, which may name a city as often as it likes', () => {
    // The guard is about destinations only. Coming back to Osaka is a stay
    // decision, and this function has no opinion on it.
    const stays = [{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }, { city: 'Osaka', days: 1 }];
    expect(stays.filter((stay) => stay.city === 'Osaka')).toHaveLength(2);
    expect(existingDestinationFor(kansai, { city: 'Osaka' })).toBeDefined();
  });
});

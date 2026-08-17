import { describe, expect, it } from 'vitest';
import {
  createEmptyProfile,
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

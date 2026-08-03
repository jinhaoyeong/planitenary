import { describe, expect, it } from 'vitest';
import {
  MAX_GENERATED_DAYS,
  MAX_TRIP_DURATION_DAYS,
  TRIP_DURATION_TOO_LONG_MESSAGE,
  declaredTripDays,
  generatedDayCardCount,
  plannedBudgetDays,
  sanitizeDurationFields,
  validateTripDuration,
  withValidatedDuration,
} from './tripDuration';
import { createEmptyProfile, manualDestination, sanitizeTripProfile, type TripProfile } from './tripProfile';
import {
  buildDaysFromProfile,
  createItineraryFromProfile,
} from './trips';
import {
  generateInitialItinerary,
  optimiseTrip,
} from './tripIntelligence';
import type { Itinerary } from '../data';

const addDaysIso = (iso: string, offset: number) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const kyoto = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  tripTypes: ['food'],
  styles: ['cafes'],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const dated = (days: number, startDate = '2027-01-01') =>
  kyoto({
    startDate,
    endDate: addDaysIso(startDate, days - 1),
    dayCount: days,
  });

describe('validateTripDuration', () => {
  it('accepts a 1-day trip', () => {
    const result = validateTripDuration({ startDate: '2027-10-04', endDate: '2027-10-04' });
    expect(result).toMatchObject({ ok: true, days: 1, nights: 0, generatesPartialDays: false });
  });

  it('accepts a 90-day trip without partial generation', () => {
    const result = validateTripDuration(dated(90));
    expect(result).toMatchObject({ ok: true, days: 90, generatesPartialDays: false });
  });

  it('accepts a 91-day trip with partial generation', () => {
    const result = validateTripDuration(dated(91));
    expect(result).toMatchObject({ ok: true, days: 91, generatesPartialDays: true });
  });

  it('accepts a 365-day trip', () => {
    const result = validateTripDuration(dated(365));
    expect(result).toMatchObject({ ok: true, days: 365, generatesPartialDays: true });
  });

  it('rejects a 366-day trip with the shared message', () => {
    const result = validateTripDuration(dated(366));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_long');
      expect(result.days).toBe(366);
      expect(result.message).toBe(TRIP_DURATION_TOO_LONG_MESSAGE);
    }
  });

  it('rejects a 999-day trip', () => {
    const result = validateTripDuration(dated(999));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_long');
      expect(result.message).toBe(TRIP_DURATION_TOO_LONG_MESSAGE);
    }
  });

  it('rejects reversed dates without truncating', () => {
    const result = validateTripDuration({ startDate: '2027-10-11', endDate: '2027-10-04', dayCount: 8 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('reversed');
      expect(result.days).toBe(0);
    }
  });

  it('rejects a manual day count above the limit', () => {
    const result = validateTripDuration({ dayCount: 400 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_long');
      expect(result.message).toBe(TRIP_DURATION_TOO_LONG_MESSAGE);
    }
  });

  it('accepts a manual day count at the limit', () => {
    expect(validateTripDuration({ dayCount: MAX_TRIP_DURATION_DAYS })).toMatchObject({
      ok: true,
      days: MAX_TRIP_DURATION_DAYS,
      source: 'dayCount',
    });
  });
});

describe('sanitizeDurationFields / legacy profiles', () => {
  it('clears a legacy stored profile above the limit instead of truncating', () => {
    const sanitized = sanitizeDurationFields({
      startDate: '2027-01-01',
      endDate: addDaysIso('2027-01-01', 998),
      dayCount: 999,
    });
    expect(sanitized).toEqual({ startDate: undefined, endDate: undefined, dayCount: 0 });
  });

  it('clears a legacy manual dayCount above the limit', () => {
    expect(sanitizeDurationFields({ dayCount: 999 })).toEqual({
      startDate: undefined,
      endDate: undefined,
      dayCount: 0,
    });
  });

  it('keeps a valid 180-day range and syncs dayCount', () => {
    const startDate = '2027-01-01';
    const endDate = addDaysIso(startDate, 179);
    expect(sanitizeDurationFields({ startDate, endDate, dayCount: 0 })).toEqual({
      startDate,
      endDate,
      dayCount: 180,
    });
  });

  it('clears reversed dates without keeping a stale dayCount', () => {
    expect(sanitizeDurationFields({
      startDate: '2027-10-11',
      endDate: '2027-10-04',
      dayCount: 8,
    })).toEqual({ startDate: undefined, endDate: undefined, dayCount: 0 });
  });

  it('applies the same policy through sanitizeTripProfile', () => {
    const cleaned = sanitizeTripProfile(dated(999));
    expect(cleaned?.startDate).toBeUndefined();
    expect(cleaned?.endDate).toBeUndefined();
    expect(cleaned?.dayCount).toBe(0);
  });
});

describe('day-card generation vs declared duration', () => {
  it('creates one day card for a 1-day trip', () => {
    expect(buildDaysFromProfile(dated(1))).toHaveLength(1);
  });

  it('creates 90 day cards for a 90-day trip', () => {
    expect(buildDaysFromProfile(dated(90))).toHaveLength(90);
  });

  it('creates exactly 90 day cards for a 91-day trip while keeping 91 declared', () => {
    const profile = dated(91);
    expect(validateTripDuration(profile)).toMatchObject({ ok: true, days: 91 });
    expect(buildDaysFromProfile(profile)).toHaveLength(MAX_GENERATED_DAYS);
    expect(declaredTripDays(profile)).toBe(91);
  });

  it('creates exactly 90 day cards for a 180-day trip while retaining 180-day profile duration', () => {
    const profile = dated(180);
    const days = buildDaysFromProfile(profile);
    expect(days).toHaveLength(MAX_GENERATED_DAYS);
    expect(declaredTripDays(profile)).toBe(180);
    expect(plannedBudgetDays(profile, days.length)).toBe(180);

    const itinerary = createItineraryFromProfile(profile, 'trip-180');
    expect(itinerary.days).toHaveLength(MAX_GENERATED_DAYS);
    const savedProfile = itinerary.tripProfile as TripProfile;
    expect(savedProfile.dayCount).toBe(180);
    expect(itinerary.heroDayBadge).toBeTruthy();
    // Badge reflects real duration (weeks when divisible by 7).
    expect(Number(itinerary.heroDayBadge)).toBeGreaterThan(0);
    expect(declaredTripDays(savedProfile)).toBe(180);
  });

  it('creates 90 day cards for a 365-day trip', () => {
    expect(buildDaysFromProfile(dated(365))).toHaveLength(MAX_GENERATED_DAYS);
    expect(declaredTripDays(dated(365))).toBe(365);
  });

  it('creates no day cards for a 366-day or 999-day range', () => {
    expect(buildDaysFromProfile(dated(366))).toEqual([]);
    expect(buildDaysFromProfile(dated(999))).toEqual([]);
    expect(generatedDayCardCount(999)).toBe(MAX_GENERATED_DAYS); // raw helper still caps
  });

  it('refuses to create an itinerary that keeps an over-limit duration', () => {
    const itinerary = createItineraryFromProfile(dated(999), 'trip-too-long');
    expect(itinerary.days).toEqual([]);
    const savedProfile = itinerary.tripProfile as TripProfile | undefined;
    expect(savedProfile?.dayCount ?? 0).toBe(0);
    expect(savedProfile?.startDate).toBeUndefined();
    expect(resolveDisplayedAbsence(itinerary)).toBe(true);
  });
});

function resolveDisplayedAbsence(itinerary: Itinerary) {
  return !(itinerary.heroDayBadge ?? '').trim();
}

describe('budget uses declared duration', () => {
  it('divides by 180 for a 180-day trip even when only 90 cards exist', () => {
    const profile = dated(180);
    const cards = buildDaysFromProfile(profile).length;
    expect(cards).toBe(90);
    expect(plannedBudgetDays(profile, cards)).toBe(180);
  });

  it('falls back to itinerary day cards when duration is unset', () => {
    expect(plannedBudgetDays(kyoto({ dayCount: 0 }), 12)).toBe(12);
  });

  it('does not feed budget math from an over-limit legacy span', () => {
    expect(plannedBudgetDays(dated(999), 90)).toBe(90);
  });
});

describe('withValidatedDuration commit semantics', () => {
  it('does not mutate an invalid profile', () => {
    const profile = dated(999);
    const result = withValidatedDuration(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(TRIP_DURATION_TOO_LONG_MESSAGE);
    }
    expect(profile.dayCount).toBe(999);
    expect(profile.endDate).toBe(addDaysIso('2027-01-01', 998));
  });

  it('syncs dayCount on a valid dated range', () => {
    const profile = kyoto({ startDate: '2027-01-01', endDate: addDaysIso('2027-01-01', 179), dayCount: 0 });
    const result = withValidatedDuration(profile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.dayCount).toBe(180);
  });
});

describe('planner operates only on generated day cards', () => {
  it('optimises and generates against existing cards for a 180-day trip', () => {
    const profile = dated(180);
    const itinerary = createItineraryFromProfile(profile, 'trip-planner-180');
    expect(itinerary.days).toHaveLength(MAX_GENERATED_DAYS);

    const generated = generateInitialItinerary(itinerary, profile);
    expect(generated.afterDays).toHaveLength(MAX_GENERATED_DAYS);
    expect(generated.afterDays.every((day) => day.day <= MAX_GENERATED_DAYS)).toBe(true);
    expect(generated.warnings.some((warning) => warning.includes('daily pages already created'))).toBe(true);

    const optimised = optimiseTrip(itinerary, profile);
    expect(optimised.afterDays).toHaveLength(MAX_GENERATED_DAYS);
    expect(optimised.afterDays.map((day) => day.day)).toEqual(
      itinerary.days.map((day) => day.day),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_GENERATED_DAYS,
  buildDaysFromProfile,
  createItineraryFromProfile,
  resolveDisplayedDayBadge,
  syncDurationDependentFields,
} from './trips';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import { effectiveFieldSource } from './identityFields';

const kyoto = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Kyoto', 'Japan')],
  tripTypes: ['food'],
  styles: ['cafes'],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('generated days', () => {
  it('creates nothing for a trip with no dates', () => {
    expect(buildDaysFromProfile(kyoto())).toEqual([]);
  });

  it('creates a single dated day for a one-day trip', () => {
    const days = buildDaysFromProfile(kyoto({ startDate: '2027-10-04', endDate: '2027-10-04' }));
    expect(days).toHaveLength(1);
    expect(days[0].city).toBe('Kyoto');
    expect(days[0].date).not.toBe('Day 1');
    expect(days[0].activities).toEqual([]);
  });

  it('gives every generated day a date and a place to anchor it', () => {
    const days = buildDaysFromProfile(kyoto({ startDate: '2027-10-04', endDate: '2027-10-11' }));
    expect(days).toHaveLength(8);
    for (const day of days) {
      expect(day.date).toBeTruthy();
      expect(day.city).toBe('Kyoto');
      expect(day.title).toBeTruthy();
    }
  });

  it('spreads days across the cities of a multi-city trip', () => {
    const days = buildDaysFromProfile(
      kyoto({
        startDate: '2027-10-04',
        endDate: '2027-10-09',
        destinations: [manualDestination('Kyoto', 'Japan'), manualDestination('Osaka', 'Japan')],
      }),
    );
    expect(new Set(days.map((day) => day.city))).toEqual(new Set(['Kyoto', 'Osaka']));
  });

  it('stops short of creating a day card for every date of an absurd range', () => {
    const days = buildDaysFromProfile(kyoto({ startDate: '2027-01-01', endDate: '2030-01-01' }));
    expect(days).toHaveLength(MAX_GENERATED_DAYS);
  });
});

describe('createItineraryFromProfile', () => {
  it('leaves the day badge unset when the trip has no dates', () => {
    const itinerary = createItineraryFromProfile(kyoto(), 'trip-1');
    expect(itinerary.days).toEqual([]);
    expect(itinerary.heroDayBadge ?? '').toBe('');
    expect(itinerary.name).not.toMatch(/\b0\b/);
  });

  it('records the duration on a dated trip', () => {
    const itinerary = createItineraryFromProfile(
      kyoto({ startDate: '2027-10-04', endDate: '2027-10-11' }),
      'trip-2',
    );
    expect(itinerary.heroDayBadge).toBe('8');
    expect(itinerary.heroDayBadgeUnit).toBe('days');
    expect(itinerary.days).toHaveLength(8);
  });

  it('keeps the trip profile, so currency and destinations have one owner', () => {
    const profile = kyoto({ tripCurrency: 'JPY', homeCurrency: 'MYR' });
    const itinerary = createItineraryFromProfile(profile, 'trip-3');
    const saved = itinerary.tripProfile as TripProfile;
    expect(saved.tripCurrency).toBe('JPY');
    expect(saved.homeCurrency).toBe('MYR');
    expect(saved.destinations[0].id).toBe('place_kyoto_jp');
  });
});

describe('duration-dependent badge sync', () => {
  const dated = () => createItineraryFromProfile(
    kyoto({ startDate: '2027-10-04', endDate: '2027-10-11' }),
    'trip-dated',
  );

  it('clears the badge as soon as dates are removed', () => {
    const itinerary = dated();
    expect(itinerary.heroDayBadge).toBe('8');

    const undatedProfile = {
      ...(itinerary.tripProfile as TripProfile),
      startDate: undefined,
      endDate: undefined,
      dayCount: 0,
    };
    const synced = syncDurationDependentFields(itinerary, undatedProfile);

    expect(synced.heroDayBadge).toBe('');
    expect(synced.heroDayBadgeUnit).toBe('');
    expect(resolveDisplayedDayBadge(synced).visible).toBe(false);
  });

  it('keeps the badge absent after a round-trip through the saved profile', () => {
    const itinerary = dated();
    const undatedProfile = {
      ...(itinerary.tripProfile as TripProfile),
      startDate: undefined,
      endDate: undefined,
      dayCount: 0,
    };
    const saved = syncDurationDependentFields(itinerary, undatedProfile);
    // Simulate reload: the stored itinerary is what display reads.
    expect(resolveDisplayedDayBadge(saved).visible).toBe(false);
    expect(saved.heroDayBadge).toBe('');
  });

  it('restores a generated badge when valid dates return', () => {
    const itinerary = dated();
    const undatedProfile = {
      ...(itinerary.tripProfile as TripProfile),
      startDate: undefined,
      endDate: undefined,
      dayCount: 0,
    };
    const cleared = syncDurationDependentFields(itinerary, undatedProfile);
    const restoredProfile = {
      ...undatedProfile,
      startDate: '2027-10-04',
      endDate: '2027-10-11',
    };
    const restored = syncDurationDependentFields(cleared, restoredProfile);

    expect(restored.heroDayBadge).toBe('8');
    expect(restored.heroDayBadgeUnit).toBe('days');
    expect(resolveDisplayedDayBadge(restored)).toEqual({
      value: '8',
      unit: 'days',
      visible: true,
    });
  });

  it('never shows a stale badge for an invalid date range', () => {
    const itinerary = dated();
    const invalidProfile = {
      ...(itinerary.tripProfile as TripProfile),
      startDate: '2027-10-11',
      endDate: '2027-10-04',
    };
    const synced = syncDurationDependentFields(itinerary, invalidProfile);
    expect(synced.heroDayBadge).toBe('');
    expect(resolveDisplayedDayBadge(synced).visible).toBe(false);
  });

  it('preserves manual copy fields while clearing the badge', () => {
    const itinerary = dated();
    const withManual = {
      ...itinerary,
      description: 'My personal Kyoto food journey.',
      fieldSources: {
        ...itinerary.fieldSources,
        description: {
          source: 'manual' as const,
          generatedValue: itinerary.description,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    const undatedProfile = {
      ...(itinerary.tripProfile as TripProfile),
      startDate: undefined,
      endDate: undefined,
      dayCount: 0,
    };
    const synced = syncDurationDependentFields(withManual, undatedProfile);

    expect(synced.description).toBe('My personal Kyoto food journey.');
    expect(effectiveFieldSource(synced, 'description')).toBe('manual');
    expect(synced.heroDayBadge).toBe('');
    expect(synced.name).toBe(itinerary.name);
  });

  it('hides a leftover stored badge when the profile has no duration', () => {
    const leftover = {
      ...dated(),
      tripProfile: kyoto({ dayCount: 0 }),
      heroDayBadge: '8',
      heroDayBadgeUnit: 'days',
    };
    expect(resolveDisplayedDayBadge(leftover).visible).toBe(false);
  });
});

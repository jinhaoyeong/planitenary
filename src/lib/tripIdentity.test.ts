import { describe, expect, it } from 'vitest';
import { buildTripIdentity, copySimilarity } from './tripIdentity';
import { createEmptyProfile, type TravelStyle, type TripProfile } from './tripProfile';

const profile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [{ city: 'Kyoto', country: 'Japan', lat: 35.0116, lng: 135.7681 }],
  tripTypes: ['food'],
  styles: ['cafes', 'temples'],
  moods: ['slow-living'],
  budgetTier: 'mid-range',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const dated = (overrides: Partial<TripProfile> = {}) =>
  profile({ startDate: '2027-10-04', endDate: '2027-10-11', ...overrides });

describe('undated trips', () => {
  const identity = buildTripIdentity(profile());

  it('produces no day badge at all', () => {
    expect(identity.dayBadgeValue).toBe('');
    expect(identity.dayBadgeUnit).toBe('');
  });

  it('never emits "0" as user-facing copy', () => {
    const everything = [
      identity.heroTitle,
      identity.heroEyebrow,
      identity.heroDescription,
      identity.overviewEyebrow,
      identity.overviewDescription,
      identity.coverHeadline,
      identity.dayBadgeValue,
      ...identity.summaryChips,
    ];
    for (const line of everything) {
      expect(line).not.toMatch(/\b0\b/);
      expect(line.toLowerCase()).not.toContain('zero');
    }
  });

  it('avoids sentences that trail off where a number should be', () => {
    expect(identity.overviewDescription).not.toMatch(/^Days shaped/i);
    expect(identity.heroDescription).not.toMatch(/\bover\s*,/);
    for (const line of [identity.heroDescription, identity.overviewDescription, identity.heroEyebrow]) {
      expect(line).not.toMatch(/\s{2,}/);
      expect(line).not.toMatch(/\s+[.,]/);
      expect(line.endsWith('.')).toBe(true);
    }
  });

  it('says dates are missing where a duration would go, and invites setting them', () => {
    expect(identity.summaryChips).toContain('Dates not set');
    expect(identity.primaryButtonLabel).toBe('Add your dates');
  });
});

describe('dated trips', () => {
  it('reports the duration on a one-day trip in the singular', () => {
    const identity = buildTripIdentity(dated({ startDate: '2027-10-04', endDate: '2027-10-04' }));
    expect(identity.dayBadgeValue).toBe('1');
    expect(identity.dayBadgeUnit).toBe('day');
    expect(identity.summaryChips).toContain('1 day');
    expect(identity.heroDescription).not.toContain('1 days');
  });

  it('reports whole weeks for long trips', () => {
    const identity = buildTripIdentity(dated({ startDate: '2027-10-04', endDate: '2027-10-24' }));
    expect(identity.dayBadgeValue).toBe('3');
    expect(identity.dayBadgeUnit).toBe('weeks');
  });

  it('reports plain days for an eight-day trip', () => {
    const identity = buildTripIdentity(dated());
    expect(identity.dayBadgeValue).toBe('8');
    expect(identity.dayBadgeUnit).toBe('days');
    expect(identity.summaryChips).toContain('8 days');
  });

  it('offers to open the itinerary once days exist', () => {
    const identity = buildTripIdentity(dated(), { plannedDays: 8 });
    expect(identity.primaryButtonLabel).toBe('Start day 1');
  });
});

describe('copy variety', () => {
  const styleSets: TravelStyle[][] = [
    ['cafes', 'temples'],
    ['shopping', 'nightlife'],
    ['hiking', 'nature'],
    ['museums', 'architecture'],
    ['beaches'],
    [],
  ];

  it('keeps the hero and the itinerary overview from restating each other', () => {
    for (const styles of styleSets) {
      const identity = buildTripIdentity(dated({ styles }));
      const overlap = copySimilarity(identity.heroDescription, identity.overviewDescription);
      expect(
        overlap,
        `hero "${identity.heroDescription}" vs overview "${identity.overviewDescription}"`,
      ).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps the cover line distinct from the hero copy', () => {
    for (const styles of styleSets) {
      const identity = buildTripIdentity(dated({ styles }));
      expect(copySimilarity(identity.coverHeadline, identity.heroDescription)).toBeLessThanOrEqual(0.5);
    }
  });

  it('respects the character budget for every line', () => {
    for (const styles of styleSets) {
      const identity = buildTripIdentity(
        dated({ styles, destinations: [
          { city: 'Kyoto', country: 'Japan' },
          { city: 'Osaka', country: 'Japan' },
          { city: 'Kanazawa', country: 'Japan' },
        ] }),
      );
      expect(identity.brandTitle.length).toBeLessThanOrEqual(28);
      expect(identity.heroEyebrow.length).toBeLessThanOrEqual(90);
      expect(identity.heroDescription.length).toBeLessThanOrEqual(200);
      expect(identity.overviewDescription.length).toBeLessThanOrEqual(170);
      expect(identity.searchPlaceholder.length).toBeLessThanOrEqual(60);
    }
  });

  it('varies wording between trips created at different moments', () => {
    const first = buildTripIdentity(dated({ createdAt: '2026-01-01T00:00:00.000Z' }));
    const second = buildTripIdentity(dated({ createdAt: '2026-05-09T10:30:00.000Z' }));
    const third = buildTripIdentity(dated({ createdAt: '2026-09-21T18:45:00.000Z' }));
    const headlines = new Set([first.coverHeadline, second.coverHeadline, third.coverHeadline]);
    expect(headlines.size).toBeGreaterThan(1);
  });

  it('is deterministic for the same profile', () => {
    const once = buildTripIdentity(dated());
    const twice = buildTripIdentity(dated());
    expect(once).toEqual(twice);
  });

  it('falls back to safe copy when the profile has no destination', () => {
    const identity = buildTripIdentity(createEmptyProfile('MYR'));
    expect(identity.heroTitle).toBe('New Trip');
    expect(identity.heroDescription.length).toBeGreaterThan(0);
    expect(identity.dayBadgeValue).toBe('');
  });
});

describe('copySimilarity', () => {
  it('scores restated sentences high and different ones low', () => {
    expect(
      copySimilarity(
        'Discover quiet cafés and old temples across Kyoto over 8 days.',
        '8 days shaped around quiet cafés and old temples in Kyoto.',
      ),
    ).toBeGreaterThan(0.5);
    expect(
      copySimilarity(
        'Discover quiet cafés and old temples across Kyoto.',
        'Each day leans into slow coffee mornings and temple walks.',
      ),
    ).toBeLessThanOrEqual(0.5);
  });
});

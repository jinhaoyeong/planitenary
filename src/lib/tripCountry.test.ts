import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { resolveCountryIdentity, resolveTripCountry } from './tripCountry';

const itinerary = (destinations: Array<{ country: string; countryCode?: string }>): Itinerary => ({
  id: 'trip-country-test',
  name: 'Test trip',
  description: '',
  cities: destinations.map((_, index) => `City ${index + 1}`),
  days: [],
  tripProfile: {
    version: 1,
    destinations: destinations.map((destination, index) => ({
      id: `destination-${index}`,
      city: `City ${index + 1}`,
      ...destination,
    })),
    dayCount: 0,
    tripTypes: [],
    styles: [],
    moods: [],
    budgetTier: 'mid-range',
    transport: [],
    stays: [],
    hiddenGems: false,
    homeCurrency: 'USD',
    tripCurrency: 'USD',
    brandAfterDestination: false,
    applyVisualIdentity: true,
    createdAt: '2026-08-26T00:00:00.000Z',
  },
});

describe('trip country identity', () => {
  it('normalizes codes and country names through the picker catalog', () => {
    expect(resolveCountryIdentity('jp')).toEqual({ code: 'JP', name: 'Japan' });
    expect(resolveCountryIdentity(undefined, 'South Korea')).toEqual({ code: 'KR', name: 'South Korea' });
  });

  it('uses the first destination for a multi-country trip', () => {
    expect(resolveTripCountry(itinerary([
      { country: 'France', countryCode: 'FR' },
      { country: 'Italy', countryCode: 'IT' },
    ]))).toEqual({ code: 'FR', name: 'France' });
  });

  it('returns no country for an unknown legacy destination', () => {
    expect(resolveTripCountry(itinerary([{ country: 'Unknown place' }]))).toBeUndefined();
  });
});

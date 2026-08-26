import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { listCountries } from './destinations';
import {
  COUNTRY_ARTWORK_BY_CODE,
  countryArtworkForCountry,
  countryArtworkForItinerary,
  generalPlanningArtwork,
} from './countryArtwork';

describe('country artwork catalog', () => {
  it('has one explicitly named asset for every country in the picker', () => {
    const countries = listCountries();
    expect(Object.keys(COUNTRY_ARTWORK_BY_CODE)).toHaveLength(countries.length);
    countries.forEach((country) => {
      expect(COUNTRY_ARTWORK_BY_CODE[country.code]).toContain(`country-${country.code.toLowerCase()}-`);
    });
  });

  it('resolves an itinerary from its first destination country', () => {
    const itinerary = {
      id: 'japan-trip',
      name: 'Japan trip',
      description: '',
      cities: ['Tokyo'],
      days: [],
      tripProfile: {
        destinations: [{ id: 'tokyo', city: 'Tokyo', country: 'Japan', countryCode: 'JP' }],
      },
    } as Itinerary;
    const artwork = countryArtworkForItinerary(itinerary);
    expect(artwork.src).toContain('country-jp-japan');
    expect(artwork.alt).toContain('Japan');
  });

  it('uses the general planning image for unknown legacy trips', () => {
    expect(countryArtworkForCountry('ZZ').src).toBe(generalPlanningArtwork);
  });
});

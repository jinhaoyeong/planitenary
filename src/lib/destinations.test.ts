import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_PLACE_QUERY_LENGTH,
  countryCodeLabel,
  countryOptionLabel,
  countryTimezone,
  createDestinationId,
  offlinePlace,
  resetPlaceCache,
  resolveCountrySelection,
  searchCountries,
  searchPlaces,
} from './destinations';
import {
  countryBreakdown,
  destinationCurrencies,
  destinationFromPlace,
  isMultiCountry,
  manualDestination,
  primaryCountry,
  sanitizeTripProfile,
  createEmptyProfile,
} from './tripProfile';

describe('destination identity', () => {
  it('returns stable ISO country marks instead of emoji flags', () => {
    expect(countryCodeLabel('jp')).toBe('JP');
    expect(countryCodeLabel('KR')).toBe('KR');
    expect(countryCodeLabel('')).toBe('');
    expect(countryCodeLabel('JPN')).toBe('');
  });

  it('builds accessible country option labels', () => {
    const japan = searchCountries('japan', 1)[0];
    expect(countryOptionLabel(japan)).toBe('Japan, JPY');
  });

  it('searches countries by name, alias and ISO code', () => {
    expect(searchCountries('japan', 3).map((country) => country.code)).toContain('JP');
    expect(searchCountries('jp', 3).map((country) => country.code)).toContain('JP');
    expect(searchCountries('uae', 3).map((country) => country.code)).toContain('AE');
    expect(searchCountries('united arab', 3).map((country) => country.name)).toContain('United Arab Emirates');
  });

  it('resolves known and legacy country values for display', () => {
    const known = resolveCountrySelection('JP');
    expect(known.isKnown).toBe(true);
    expect(known.displayName).toBe('Japan');
    expect(known.displayCode).toBe('JP');
    expect(known.currency).toBe('JPY');

    const legacy = resolveCountrySelection('ZZ');
    expect(legacy.isKnown).toBe(false);
    expect(legacy.displayName).toBe('Saved country (ZZ)');
    expect(legacy.displayCode).toBe('ZZ');

    const empty = resolveCountrySelection('');
    expect(empty.displayName).toBe('');
  });

  it('keeps places with the same city name apart by country', () => {
    const malaysia = manualDestination('Georgetown', 'Malaysia');
    const guyana = createDestinationId({ city: 'Georgetown', countryCode: 'GY' });
    expect(malaysia.id).not.toBe(guyana);
    expect(malaysia.id).toContain('_my');
  });

  it('keeps the provider id when one is available', () => {
    const id = createDestinationId({ city: 'Kyoto', countryCode: 'JP', providerPlaceId: '123456' });
    expect(id).toBe('place_kyoto_jp_123456');
  });

  it('records a time zone only where the country has one', () => {
    expect(countryTimezone('JP')).toBe('Asia/Tokyo');
    expect(countryTimezone('CH')).toBe('Europe/Zurich');
    expect(countryTimezone('US')).toBeUndefined();
    expect(countryTimezone('AU')).toBeUndefined();
  });

  it('builds a full record from a search result', () => {
    const destination = destinationFromPlace({
      id: 'place_kyoto_jp_98765',
      city: 'Kyoto',
      region: 'Kyoto Prefecture',
      country: 'Japan',
      countryCode: 'JP',
      lat: 35.0116,
      lng: 135.7681,
      provider: 'nominatim',
      providerPlaceId: '98765',
      timezone: 'Asia/Tokyo',
      currencyCode: 'JPY',
    });

    expect(destination).toEqual({
      id: 'place_kyoto_jp_98765',
      city: 'Kyoto',
      region: 'Kyoto Prefecture',
      country: 'Japan',
      countryCode: 'JP',
      lat: 35.0116,
      lng: 135.7681,
      timezone: 'Asia/Tokyo',
      currencyCode: 'JPY',
      provider: 'nominatim',
      providerPlaceId: '98765',
    });
  });
});

describe('legacy destination records', () => {
  it('upgrades a bare city and country into a full record', () => {
    const profile = sanitizeTripProfile({
      ...createEmptyProfile('MYR'),
      destinations: [{ city: 'Kyoto', country: 'Japan' }],
    });

    const [destination] = profile!.destinations;
    expect(destination.id).toBe('place_kyoto_jp');
    expect(destination.countryCode).toBe('JP');
    expect(destination.currencyCode).toBe('JPY');
    expect(destination.timezone).toBe('Asia/Tokyo');
    expect(destination.lat).toBeCloseTo(35.0116, 2);
    expect(destination.provider).toBe('manual');
  });

  it('leaves an id that was already saved alone', () => {
    const profile = sanitizeTripProfile({
      ...createEmptyProfile('MYR'),
      destinations: [{ id: 'place_kyoto_jp_42', city: 'Kyoto', country: 'Japan' }],
    });
    expect(profile!.destinations[0].id).toBe('place_kyoto_jp_42');
  });
});

describe('multi-country trips', () => {
  const profile = {
    ...createEmptyProfile('MYR'),
    destinations: [
      manualDestination('Zurich', 'Switzerland'),
      manualDestination('Milan', 'Italy'),
      manualDestination('Florence', 'Italy'),
    ],
  };

  it('picks the country with the most stops rather than the first one added', () => {
    expect(primaryCountry(profile)).toBe('Italy');
    expect(isMultiCountry(profile)).toBe(true);
  });

  it('lists every currency the trip will spend in, primary first', () => {
    expect(destinationCurrencies(profile)).toEqual(['EUR', 'CHF']);
  });

  it('keeps ties in the order the stops were added', () => {
    const tie = {
      ...profile,
      destinations: [manualDestination('Zurich', 'Switzerland'), manualDestination('Milan', 'Italy')],
    };
    expect(primaryCountry(tie)).toBe('Switzerland');
    expect(countryBreakdown(tie).map((entry) => entry.country)).toEqual(['Switzerland', 'Italy']);
  });
});

describe('place search discipline', () => {
  beforeEach(() => {
    resetPlaceCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const nominatimResponse = (city: string) => ({
    ok: true,
    json: async () => [
      {
        place_id: 4242,
        lat: '35.0116',
        lon: '135.7681',
        display_name: `${city}, Japan`,
        address: { city, state: 'Kyoto Prefecture', country: 'Japan', country_code: 'jp' },
      },
    ],
  });

  it('does not call the provider for a query that is too short', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await searchPlaces('ky'.slice(0, MIN_PLACE_QUERY_LENGTH - 1), { countryCode: 'JP' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.source).toBe('offline');
  });

  it('serves a repeated query from cache instead of asking again', async () => {
    const fetchSpy = vi.fn(async () => nominatimResponse('Kyoto'));
    vi.stubGlobal('fetch', fetchSpy);

    const first = await searchPlaces('kyoto', { countryCode: 'JP' });
    const second = await searchPlaces('Kyoto ', { countryCode: 'JP' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.source).toBe('provider');
    expect(second.source).toBe('cache');
    expect(second.suggestions[0].id).toBe('place_kyoto_jp_4242');
    expect(second.suggestions[0].timezone).toBe('Asia/Tokyo');
  });

  it('leaves at least a second between provider calls', async () => {
    const fetchSpy = vi.fn(async () => nominatimResponse('Kyoto'));
    vi.stubGlobal('fetch', fetchSpy);

    await searchPlaces('kyoto', { countryCode: 'JP' });
    const pending = searchPlaces('osaka', { countryCode: 'JP' });

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(700);
    await pending;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to known cities when the provider is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => [] })));

    const result = await searchPlaces('kyoto', { countryCode: 'JP' });

    expect(result.unavailable).toBe(true);
    expect(result.source).toBe('offline');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].provider).toBe('offline');
  });

  it('propagates an abort so a newer keystroke wins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => nominatimResponse('Kyoto')));
    const controller = new AbortController();
    controller.abort();

    await expect(searchPlaces('kyoto', { countryCode: 'JP', signal: controller.signal }))
      .rejects.toThrow(/abort/i);
  });

  it('builds quick-pick chips without any network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const place = offlinePlace('Kyoto', 'JP');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(place.currencyCode).toBe('JPY');
    expect(place.lat).toBeCloseTo(35.0116, 2);
  });
});

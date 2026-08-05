import { describe, expect, it } from 'vitest';
import {
  canDiscover,
  describeCapability,
  EMPTY_PROVIDER_RUNTIME,
  hasLiveDiscovery,
  resolveDestinationCapability,
  userSharedEvidenceSources,
  type ProviderRuntime,
} from './destinationCapability';

const runtime = (overrides: Partial<ProviderRuntime> = {}): ProviderRuntime => ({
  ...EMPTY_PROVIDER_RUNTIME,
  googlePlaces: true,
  googleRoutes: true,
  googleReviews: true,
  youtube: true,
  officialSources: true,
  weather: true,
  ...overrides,
});

describe('destination capability resolution', () => {
  it('gives Melbourne live discovery without any fixture, purely from providers', () => {
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      runtime(),
      // No fixture for Melbourne — this must not matter.
      ['Osaka', 'Seoul', 'Rome'],
    );
    expect(capability.places).toEqual({ provider: 'google', status: 'live' });
    expect(capability.routes).toEqual({ provider: 'google-routes', status: 'live' });
    expect(capability.evidence.googleReviews).toBe('live');
    expect(capability.evidence.youtube).toBe('live');
    expect(hasLiveDiscovery(capability)).toBe(true);
  });

  it('routes mainland China onto regional providers instead of Google', () => {
    const capability = resolveDestinationCapability(
      { city: 'Beijing', countryCode: 'CN' },
      runtime({ amap: true }),
    );
    expect(capability.places).toEqual({ provider: 'amap', status: 'live' });
    expect(capability.routes).toEqual({ provider: 'amap', status: 'live' });
    // Google review coverage is not dependable there.
    expect(capability.evidence.googleReviews).toBe('unavailable');
    expect(hasLiveDiscovery(capability)).toBe(true);
  });

  it('keeps Hong Kong and Taiwan on Google while still favouring Chinese social', () => {
    const hk = resolveDestinationCapability({ city: 'Hong Kong', countryCode: 'HK' }, runtime());
    expect(hk.places.provider).toBe('google');
    expect(hk.evidence.googleReviews).toBe('live');
    expect(hk.evidence.rednote).toBe('user-shared-only');
  });

  it('treats social platforms as user-shared until partner access is approved', () => {
    const capability = resolveDestinationCapability({ city: 'Melbourne', countryCode: 'AU' }, runtime());
    expect(capability.evidence.tiktok).toBe('user-shared-only');
    expect(capability.evidence.douyin).toBe('user-shared-only');
    expect(capability.evidence.rednote).toBe('user-shared-only');
    expect(userSharedEvidenceSources(capability)).toEqual(
      expect.arrayContaining(['tiktok', 'douyin', 'rednote']),
    );

    const approved = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      runtime({ tiktokPartner: true }),
    );
    expect(approved.evidence.tiktok).toBe('live');
  });

  it('falls back to a labelled fixture only when the live provider is down', () => {
    const capability = resolveDestinationCapability(
      { city: 'Osaka', countryCode: 'JP' },
      { ...EMPTY_PROVIDER_RUNTIME, fixtures: true },
      ['Osaka'],
    );
    expect(capability.places).toEqual({ provider: 'fixture', status: 'fixture' });
    expect(hasLiveDiscovery(capability)).toBe(false);
    expect(canDiscover(capability)).toBe(true);
    expect(describeCapability(capability)).toContain('may be out of date');
  });

  it('reports unavailable only when neither a provider nor a fixture exists', () => {
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      EMPTY_PROVIDER_RUNTIME,
      ['Osaka'],
    );
    expect(capability.places.status).toBe('unavailable');
    expect(canDiscover(capability)).toBe(false);
    expect(describeCapability(capability)).toContain('Melbourne');
    expect(describeCapability(capability)).not.toContain('Osaka');
  });

  it('serves any city from OpenStreetMap when no paid provider is configured', () => {
    // The case that matters after the Google project was removed: discovery
    // must still be live, not a fixture, and not unavailable.
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      { ...EMPTY_PROVIDER_RUNTIME, osm: true },
      ['Osaka'],
    );
    expect(capability.places).toEqual({ provider: 'osm', status: 'live' });
    expect(hasLiveDiscovery(capability)).toBe(true);
    expect(describeCapability(capability)).not.toContain('may be out of date');
  });

  it('prefers a configured paid provider over the keyless one', () => {
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      runtime({ osm: true }),
    );
    expect(capability.places.provider).toBe('google');
  });

  it('keeps mainland China on regional providers even with OpenStreetMap available', () => {
    // OSM coverage exists in China but the regional providers are authoritative
    // there, and the regional split must not be quietly bypassed.
    const capability = resolveDestinationCapability(
      { city: 'Beijing', countryCode: 'CN' },
      { ...EMPTY_PROVIDER_RUNTIME, osm: true, amap: true },
    );
    expect(capability.places.provider).toBe('amap');
  });

  it('does not claim OpenStreetMap discovery before the server has reported in', () => {
    const capability = resolveDestinationCapability({ city: 'Melbourne', countryCode: 'AU' }, EMPTY_PROVIDER_RUNTIME);
    expect(capability.places.status).toBe('unavailable');
  });

  it('uses OpenRouteService for routing when Google Routes is absent', () => {
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      { ...EMPTY_PROVIDER_RUNTIME, osm: true, openRouteService: true },
    );
    expect(capability.routes).toEqual({ provider: 'openrouteservice', status: 'live' });
  });

  it('prefers Google Routes over OpenRouteService when both are configured', () => {
    const capability = resolveDestinationCapability(
      { city: 'Melbourne', countryCode: 'AU' },
      runtime({ openRouteService: true }),
    );
    expect(capability.routes.provider).toBe('google-routes');
  });

  it('always offers straight-line routing so a plan is never route-blind', () => {
    const capability = resolveDestinationCapability(
      { city: 'Reykjavik', countryCode: 'IS' },
      EMPTY_PROVIDER_RUNTIME,
    );
    expect(capability.routes).toEqual({ provider: 'offline', status: 'fixture' });
  });

  it('never names another city in the unavailable message', () => {
    for (const city of ['Melbourne', 'Beijing', 'Zurich']) {
      const message = describeCapability(
        resolveDestinationCapability({ city, countryCode: 'XX' }, EMPTY_PROVIDER_RUNTIME),
      );
      expect(message).toContain(city);
      expect(message).not.toMatch(/Osaka|fixture mode|vertical slice|provider not connected/i);
    }
  });
});

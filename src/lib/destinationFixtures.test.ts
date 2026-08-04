import { describe, expect, it, vi } from 'vitest';
import {
  FixturePlaceDiscoveryProvider,
  getDestinationCapability,
  OSAKA_KNOWLEDGE_FIXTURE,
  SUPPORTED_DISCOVERY_CITIES,
} from './destinationFixtures';

describe('fixture discovery provider', () => {
  it('loads real Osaka fixture records without a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = new FixturePlaceDiscoveryProvider();
    const candidates = await provider.search({
      city: 'Osaka',
      countryCode: 'JP',
      queries: OSAKA_KNOWLEDGE_FIXTURE.discoveryQueries,
      interests: ['food', 'history'],
      limit: 40,
    });
    expect(candidates.length).toBeGreaterThanOrEqual(25);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns an honest empty result for an unsupported destination', async () => {
    const provider = new FixturePlaceDiscoveryProvider();
    await expect(provider.search({ city: 'Zurich', queries: [], interests: [] })).resolves.toEqual([]);
  });

  it('fails clearly when fixture details are unavailable', async () => {
    const provider = new FixturePlaceDiscoveryProvider();
    await expect(provider.details('missing:place')).rejects.toThrow('was not found');
  });
});

describe('destination capability registry', () => {
  it('resolves supported cities to a capability, case- and whitespace-insensitive', () => {
    const osaka = getDestinationCapability('  osaka ');
    expect(osaka?.city).toBe('Osaka');
    expect(osaka?.places.length).toBeGreaterThan(0);
    expect(getDestinationCapability('Seoul')?.city).toBe('Seoul');
    expect(getDestinationCapability('ROME')?.city).toBe('Rome');
  });

  it('returns undefined for unsupported destinations so the UI can stay generic', () => {
    for (const city of ['Melbourne', 'Beijing', 'Zurich', '', undefined, null]) {
      expect(getDestinationCapability(city)).toBeUndefined();
    }
  });

  it('exposes the supported cities without leaking a single hardcoded default', () => {
    expect(SUPPORTED_DISCOVERY_CITIES).toEqual(['Osaka', 'Seoul', 'Rome']);
  });
});

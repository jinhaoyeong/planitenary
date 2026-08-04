import { describe, expect, it, vi } from 'vitest';
import { FixturePlaceDiscoveryProvider, OSAKA_KNOWLEDGE_FIXTURE } from './destinationFixtures';

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

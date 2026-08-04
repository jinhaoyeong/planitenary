import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROVIDER_RUNTIME, type ProviderRuntime } from './destinationCapability';
import {
  capabilityFor,
  discoverPlaces,
  loadProviderRuntime,
  resetProviderRuntimeCache,
} from './discoveryRuntime';

beforeEach(() => resetProviderRuntimeCache());

const liveRuntime = (overrides: Partial<ProviderRuntime> = {}): ProviderRuntime => ({
  ...EMPTY_PROVIDER_RUNTIME,
  googlePlaces: true,
  googleRoutes: true,
  ...overrides,
});

describe('provider runtime', () => {
  it('reports nothing connected when there is no backend to ask', async () => {
    expect(await loadProviderRuntime()).toEqual(EMPTY_PROVIDER_RUNTIME);
  });

  it('never throws when the backend fails — an honest empty beats a crash', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await loadProviderRuntime(invoke)).toEqual(EMPTY_PROVIDER_RUNTIME);
  });

  it('reads the connected providers the server reports', async () => {
    const invoke = vi.fn().mockResolvedValue({ googlePlaces: true, youtube: true, rubbish: true });
    const runtime = await loadProviderRuntime(invoke);
    expect(runtime.googlePlaces).toBe(true);
    expect(runtime.youtube).toBe(true);
    expect(runtime.amap).toBe(false);
    expect(runtime).not.toHaveProperty('rubbish');
  });

  it('memoises so every panel mount does not re-ask', async () => {
    const invoke = vi.fn().mockResolvedValue({ googlePlaces: true });
    await loadProviderRuntime(invoke);
    await loadProviderRuntime(invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('capability lookup through the fixture library', () => {
  it('keeps a fixture city usable when nothing is connected', () => {
    const capability = capabilityFor({ city: 'Osaka', countryCode: 'JP' });
    expect(capability.places.status).toBe('fixture');
  });

  it('reports an unsupported city honestly', () => {
    expect(capabilityFor({ city: 'Melbourne', countryCode: 'AU' }).places.status).toBe('unavailable');
  });

  it('prefers a live provider over the fixture once connected', () => {
    const capability = capabilityFor({ city: 'Osaka', countryCode: 'JP' }, liveRuntime());
    expect(capability.places).toEqual({ provider: 'google', status: 'live' });
  });
});

describe('discovering places', () => {
  it('uses the live provider when one answers', async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: 'live-1', name: 'Live place' }]);
    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' }, liveRuntime(), invoke);
    expect(outcome.usingFixture).toBe(false);
    expect(outcome.candidates).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('travel-discover', expect.objectContaining({ city: 'Melbourne' }));
  });

  it('falls back to the fixture when the live call fails, and says so', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('provider down'));
    const outcome = await discoverPlaces({ city: 'Osaka', countryCode: 'JP' }, liveRuntime(), invoke);
    expect(outcome.usingFixture).toBe(true);
    expect(outcome.candidates.length).toBeGreaterThan(0);
    // Must not keep claiming "live" while serving captured data.
    expect(outcome.capability.places.status).toBe('fixture');
  });

  it('gathers corroborated queue times to feed the scheduler', async () => {
    const invoke = vi.fn(async (name: string) => {
      if (name === 'travel-discover') return [{ id: 'p1', providerPlaceId: 'g1', name: 'Place' }];
      return {
        summaries: [
          { canonicalPlaceId: 'p1', typicalQueueMinutes: 45, sourceCount: 4 },
          // Single-source claims must not reshape a day.
          { canonicalPlaceId: 'p2', typicalQueueMinutes: 90, sourceCount: 1 },
          { canonicalPlaceId: 'p3', typicalQueueMinutes: Number.NaN, sourceCount: 5 },
        ],
      };
    });
    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' }, liveRuntime(), invoke);
    expect(outcome.queueEvidence).toEqual({ p1: 45 });
  });

  it('still returns places when evidence gathering fails', async () => {
    const invoke = vi.fn(async (name: string) => {
      if (name === 'travel-discover') return [{ id: 'p1', name: 'Place' }];
      throw new Error('evidence provider down');
    });
    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' }, liveRuntime(), invoke);
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.queueEvidence).toEqual({});
  });

  it('returns an honest empty result when there is no provider and no fixture', async () => {
    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' });
    expect(outcome.candidates).toEqual([]);
    expect(outcome.capability.places.status).toBe('unavailable');
  });

  it('serves the fixture offline without any network call', async () => {
    const outcome = await discoverPlaces({ city: 'Rome', countryCode: 'IT' });
    expect(outcome.usingFixture).toBe(true);
    expect(outcome.candidates.every((candidate) => candidate.city === 'Rome')).toBe(true);
  });
});

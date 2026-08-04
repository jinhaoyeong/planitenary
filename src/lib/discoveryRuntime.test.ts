import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PROVIDER_RUNTIME, type ProviderRuntime } from './destinationCapability';
import {
  capabilityFor,
  discoverPlaces,
  loadProviderRuntime,
  parseCurrentEvents,
  parseWeatherRisk,
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
  it('normalises current event facts without inventing missing dates', () => {
    expect(parseCurrentEvents({ events: [{ id: 'e1', name: 'Laneway Festival', dates: { start: { localDate: '2026-08-05', localTime: '19:00' }, end: { localTime: '22:00' } }, url: 'https://example.com/e1' }, { name: 'Untitled' }] })).toEqual([
      { id: 'e1', name: 'Laneway Festival', date: '2026-08-05', startTime: '19:00', endTime: '22:00', url: 'https://example.com/e1' },
      { id: 'Untitled', name: 'Untitled', date: undefined, url: undefined },
    ]);
  });
  it('turns live precipitation data into explicit indoor-first days', () => {
    expect(parseWeatherRisk({ payload: { daily: {
      time: ['2026-08-04', '2026-08-05'],
      precipitation_probability_max: [20, 80],
      precipitation_sum: [0, 1],
    } } })).toEqual([
      { date: '2026-08-04', precipitationProbability: 20, precipitationMillimetres: 0, indoorRecommended: false },
      { date: '2026-08-05', precipitationProbability: 80, precipitationMillimetres: 1, indoorRecommended: true },
    ]);
  });
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
    expect(invoke).toHaveBeenCalledWith('travel-discover-live', expect.objectContaining({ city: 'Melbourne' }));
  });

  it('falls back to the fixture when the live call fails, and says so', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('provider down'));
    const outcome = await discoverPlaces({ city: 'Osaka', countryCode: 'JP' }, liveRuntime(), invoke);
    expect(outcome.usingFixture).toBe(true);
    expect(outcome.candidates.length).toBeGreaterThan(0);
    // Must not keep claiming "live" while serving captured data.
    expect(outcome.capability.places.status).toBe('fixture');
  });

  /** One evidence document as the backend actually returns it. */
  const document = (placeId: string, queueMinutes?: number) => ({
    id: `e-${placeId}-${Math.random()}`,
    canonicalPlaceId: placeId,
    source: 'google-places',
    sourceUrl: 'https://maps.example/p',
    publishedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    retrievedAt: new Date().toISOString(),
    authorType: 'traveller',
    disclosure: 'organic',
    confidence: 0.7,
    claims: queueMinutes === undefined ? [] : [{
      type: 'queue-time',
      summary: `Reported wait of about ${queueMinutes} minutes`,
      value: queueMinutes,
      unit: 'minutes',
      strength: 0.7,
    }],
  });

  it('summarises corroborated queue times and keys them by candidate id', async () => {
    const invoke = vi.fn(async (name: string) => {
      if (name === 'travel-discover-live') {
        return [
          { id: 'cand-1', providerPlaceId: 'g1', name: 'Corroborated' },
          { id: 'cand-2', providerPlaceId: 'g2', name: 'Single mention' },
        ];
      }
      return {
        documents: [
          document('g1', 40), document('g1', 50), document('g1', 45),
          // One lone mention must not be allowed to reshape a day.
          document('g2', 120),
        ],
      };
    });

    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' }, liveRuntime(), invoke);
    // Keyed by candidate id, not the provider's place id.
    expect(outcome.queueEvidence).toEqual({ 'cand-1': 45 });
    expect(outcome.evidenceSummaries['cand-1'].sourceCount).toBe(3);
    expect(outcome.evidenceSummaries['cand-1'].canonicalPlaceId).toBe('cand-1');
  });

  it('derives trend strength from recent evidence when the backend omits it', async () => {
    const invoke = vi.fn(async (name: string) => {
      if (name === 'travel-discover-live') return [{ id: 'cand-1', providerPlaceId: 'g1', name: 'Place' }];
      return { documents: [document('g1'), document('g1'), document('g1')] };
    });
    const outcome = await discoverPlaces({ city: 'Melbourne', countryCode: 'AU' }, liveRuntime(), invoke);
    expect(outcome.trends['cand-1']).toBeGreaterThan(0);
  });

  it('still returns places when evidence gathering fails', async () => {
    const invoke = vi.fn(async (name: string) => {
      if (name === 'travel-discover-live') return [{ id: 'p1', name: 'Place' }];
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

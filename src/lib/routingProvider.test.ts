import { describe, expect, it } from 'vitest';
import {
  sameRoutingPoint,
  selectRoutingProvider,
} from '../../supabase/functions/_shared/routingProvider';

describe('deterministic routing provider selection', () => {
  const configured = { amap: true, openRouteService: true };

  it('selects Amap for a China trip', () => {
    expect(selectRoutingProvider(['CN', 'cn'], 'walking', configured)).toEqual({
      status: 'selected',
      provider: 'amap',
      requestedMode: 'walking',
      providerMode: 'walking',
    });
  });

  it.each([
    ['walking', 'foot-walking'],
    ['driving', 'driving-car'],
    ['cycling', 'cycling-regular'],
  ] as const)('maps non-China %s routing to the genuine ORS %s profile', (requestedMode, providerMode) => {
    expect(selectRoutingProvider(['JP', 'JP'], requestedMode, configured)).toEqual({
      status: 'selected',
      provider: 'openrouteservice',
      requestedMode,
      providerMode,
    });
    expect(selectRoutingProvider(['MY', 'SG'], requestedMode, configured)).toEqual({
      status: 'selected',
      provider: 'openrouteservice',
      requestedMode,
      providerMode,
    });
  });

  it('refuses hosted ORS public transport instead of relabelling another profile', () => {
    expect(selectRoutingProvider(['JP'], 'public-transport', configured)).toMatchObject({
      status: 'route-unavailable',
      reason: expect.stringContaining('does not support public-transport'),
    });
  });

  it.each(['driving', 'cycling', 'public-transport'] as const)(
    'refuses Amap %s because the current adapter implements walking only',
    (mode) => {
      expect(selectRoutingProvider(['CN'], mode, configured)).toMatchObject({
        status: 'route-unavailable',
        reason: expect.stringContaining(`does not support ${mode}`),
      });
    },
  );

  it('fails closed when the appropriate provider is absent or geography is unsafe', () => {
    expect(selectRoutingProvider(['JP'], 'walking', { amap: true, openRouteService: false }))
      .toMatchObject({ status: 'route-unavailable' });
    expect(selectRoutingProvider(['CN', 'JP'], 'walking', configured))
      .toMatchObject({ status: 'route-unavailable' });
    expect(selectRoutingProvider([undefined], 'walking', configured))
      .toMatchObject({ status: 'route-unavailable' });
  });
});

describe('logical route endpoint identity', () => {
  it('does not turn a different A -> B 1x1 request into a zero diagonal', () => {
    expect(sameRoutingPoint(
      { placeId: 'A', coordinates: [34.6873, 135.5262] },
      { placeId: 'B', coordinates: [34.6687, 135.5013] },
    )).toBe(false);
  });

  it('recognises A -> A by stable identity or tightly equal coordinates', () => {
    expect(sameRoutingPoint({ placeId: 'A' }, { placeId: 'A' })).toBe(true);
    expect(sameRoutingPoint(
      { placeId: 'provider-A', coordinates: [34.687300001, 135.526200001] },
      { placeId: 'provider-B', coordinates: [34.6873, 135.5262] },
    )).toBe(true);
  });
});

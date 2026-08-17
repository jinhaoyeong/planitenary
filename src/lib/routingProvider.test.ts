import { describe, expect, it } from 'vitest';
import {
  sameRoutingPoint,
  selectRoutingProvider,
} from '../../supabase/functions/_shared/routingProvider';

describe('deterministic routing provider selection', () => {
  const configured = { amap: true, openRouteService: true };

  it('selects Amap for a China trip', () => {
    expect(selectRoutingProvider(['CN', 'cn'], configured)).toEqual({
      status: 'selected',
      provider: 'amap',
    });
  });

  it('selects OpenRouteService for Japan and other known non-China trips', () => {
    expect(selectRoutingProvider(['JP', 'JP'], configured)).toEqual({
      status: 'selected',
      provider: 'openrouteservice',
    });
    expect(selectRoutingProvider(['MY', 'SG'], configured)).toEqual({
      status: 'selected',
      provider: 'openrouteservice',
    });
  });

  it('fails closed when the appropriate provider is absent or geography is unsafe', () => {
    expect(selectRoutingProvider(['JP'], { amap: true, openRouteService: false }))
      .toMatchObject({ status: 'route-unavailable' });
    expect(selectRoutingProvider(['CN', 'JP'], configured))
      .toMatchObject({ status: 'route-unavailable' });
    expect(selectRoutingProvider([undefined], configured))
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

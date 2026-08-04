import { describe, expect, it } from 'vitest';
import { parseAmapWalkingRoute, parseBaiduWalkingRoute } from '../../supabase/functions/_shared/regionalRoutes';

describe('regional route response parsing', () => {
  it('normalises an Amap walking path', () => {
    expect(parseAmapWalkingRoute({ status: '1', route: { paths: [{ distance: '1200', duration: '900' }] } })).toEqual({
      distanceMeters: 1200,
      durationMinutes: 15,
    });
  });

  it('normalises the Amap v5 nested cost shape', () => {
    expect(parseAmapWalkingRoute({
      status: '1',
      route: { paths: [{ cost: { distance: '1350', duration: '780' } }] },
    })).toEqual({
      distanceMeters: 1350,
      durationMinutes: 13,
    });
  });

  it('normalises a Baidu walking path', () => {
    expect(parseBaiduWalkingRoute({ status: 0, result: { routes: [{ distance: 800, duration: 600 }] } })).toEqual({
      distanceMeters: 800,
      durationMinutes: 10,
    });
  });

  it('keeps provider failures unknown instead of inventing a route', () => {
    expect(parseAmapWalkingRoute({ status: '0' })).toBeNull();
    expect(parseBaiduWalkingRoute({ status: 1 })).toBeNull();
  });
});

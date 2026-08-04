/**
 * Tests for the pure cache-key/freshness logic shared by the Edge Functions.
 * Imported straight from the Deno `_shared` module, which has no Deno-specific
 * APIs — the same precedent as `regionalRoutes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  coordinateKey,
  enumerateDates,
  isFresh,
  pairsNeedingProvider,
  routePairKey,
  routePointKey,
} from '../../supabase/functions/_shared/cacheKeys';

describe('coordinate keys', () => {
  it('rounds so the same venue produces one stable key despite float noise', () => {
    expect(coordinateKey([-37.8136, 144.9631])).toBe('-37.81360,144.96310');
    expect(coordinateKey([-37.81360001, 144.96309998])).toBe(coordinateKey([-37.8136, 144.9631]));
  });

  it('keeps genuinely different places apart', () => {
    expect(coordinateKey([-37.8136, 144.9631])).not.toBe(coordinateKey([-37.8677, 144.9740]));
  });
});

describe('route point keys', () => {
  it('prefers a provider place id over coordinates', () => {
    expect(routePointKey({ placeId: 'ChIJ_x', coordinates: [1, 2] })).toBe('pid:ChIJ_x');
  });

  it('falls back to coordinates', () => {
    expect(routePointKey({ coordinates: [-37.8136, 144.9631] })).toBe('ll:-37.81360,144.96310');
  });

  it('returns null for an un-cacheable point rather than a bad key', () => {
    expect(routePointKey({})).toBeNull();
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-08-04T00:00:00.000Z');
  it('is fresh strictly before expiry', () => {
    expect(isFresh('2026-08-04T00:01:00.000Z', now)).toBe(true);
    expect(isFresh('2026-08-03T23:59:00.000Z', now)).toBe(false);
  });
  it('treats missing or invalid expiry as stale', () => {
    expect(isFresh(null, now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh('not a date', now)).toBe(false);
  });
});

describe('date enumeration', () => {
  it('lists an inclusive range', () => {
    expect(enumerateDates('2026-08-04', '2026-08-06')).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);
  });
  it('handles a single day', () => {
    expect(enumerateDates('2026-08-04', '2026-08-04')).toEqual(['2026-08-04']);
  });
  it('caps a hostile range instead of returning thousands of dates', () => {
    expect(enumerateDates('2000-01-01', '2100-01-01', 32)).toHaveLength(32);
  });
  it('returns empty for an inverted or invalid range', () => {
    expect(enumerateDates('2026-08-06', '2026-08-04')).toEqual([]);
    expect(enumerateDates('nonsense', '2026-08-04')).toEqual([]);
  });
});

describe('pairsNeedingProvider — the cost gate', () => {
  const A = 'll:0,0';
  const B = 'll:1,1';
  const C = 'll:2,2';

  it('skips the provider entirely when every pair is cached (repeat preview)', () => {
    const cached = new Set([
      routePairKey(A, B), routePairKey(A, C),
      routePairKey(B, A), routePairKey(B, C),
      routePairKey(C, A), routePairKey(C, B),
    ]);
    const { complete, missing } = pairsNeedingProvider([A, B, C], [A, B, C], cached);
    expect(complete).toBe(true);
    expect(missing).toEqual([]);
  });

  it('never counts a place-to-itself pair as needing a provider', () => {
    const { complete } = pairsNeedingProvider([A], [A], new Set());
    expect(complete).toBe(true);
  });

  it('is complete once both cross pairs are cached (diagonals are free)', () => {
    const cached = new Set([routePairKey(A, B), routePairKey(B, A)]);
    const { missing, complete } = pairsNeedingProvider([A, B], [A, B], cached);
    expect(complete).toBe(true); // A|B and B|A cached; A|A and B|B are self-pairs
    expect(missing).toEqual([]);
  });

  it('flags an added place as a miss so the next preview caches it', () => {
    const cached = new Set([routePairKey(A, B), routePairKey(B, A)]);
    const { missing, complete } = pairsNeedingProvider([A, B, C], [A, B, C], cached);
    expect(complete).toBe(false);
    // Every pair touching C is missing; A|B and B|A are still covered.
    expect(missing).toEqual(expect.arrayContaining([{ i: 0, j: 2 }, { i: 2, j: 0 }, { i: 1, j: 2 }, { i: 2, j: 1 }]));
    expect(missing).not.toContainEqual({ i: 0, j: 1 });
  });

  it('treats an un-cacheable (null-key) endpoint as always missing', () => {
    const { missing, complete } = pairsNeedingProvider([A, null], [A, null], new Set([routePairKey(A, A)]));
    expect(complete).toBe(false);
    expect(missing.length).toBeGreaterThan(0);
  });
});

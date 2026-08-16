/**
 * Tests for the pure cache-key/freshness logic shared by the Edge Functions.
 * Imported straight from the Deno `_shared` module, which has no Deno-specific
 * APIs — the same precedent as `regionalRoutes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  coordinateKey,
  discoveryCityKey,
  enumerateDates,
  evidenceSourceUrl,
  isFresh,
  pairsNeedingProvider,
  parseAppliesTo,
  probeKey,
  reviewItemKey,
  routePairKey,
  routePointKey,
  shouldFetchEvidence,
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

describe('discovery city keys', () => {
  it('does not split the cache on case or stray whitespace', () => {
    expect(discoveryCityKey(' Osaka ', 'jp')).toBe(discoveryCityKey('osaka', 'JP'));
  });

  it('keeps the two Georgetowns apart', () => {
    expect(discoveryCityKey('Georgetown', 'MY')).not.toBe(discoveryCityKey('Georgetown', 'GY'));
  });

  it('tolerates a missing country code rather than throwing', () => {
    // The version is matched loosely on purpose: this test is about the empty
    // country segment, and pinning the schema version here made an unrelated
    // assertion fail every time a field was added to discovery.
    expect(discoveryCityKey('Osaka')).toMatch(/^v\d+\|osaka\|$/);
  });

  it('carries a schema version, so rows written before a new field expire at deploy', () => {
    // `discovery_cache` holds candidates verbatim for 30 days. Without a
    // version in the key, adding a field to discovery means a month of rows
    // that silently lack it.
    expect(discoveryCityKey('Osaka', 'JP')).toMatch(/^v\d+\|/);
  });
});

describe('claim scope round trip', () => {
  it('reads back a best-time window', () => {
    expect(parseAppliesTo({ start: '08:00', end: '10:00' })).toEqual({
      start: '08:00',
      end: '10:00',
      daysOfWeek: undefined,
      currency: undefined,
      audience: undefined,
    });
  });

  it('treats a scope with nothing valid in it as no scope at all', () => {
    // Returning `{}` would read as "scoped to nothing", which is not what an
    // unparseable column means.
    expect(parseAppliesTo({ start: 'morning', end: 42 })).toBeUndefined();
    expect(parseAppliesTo({})).toBeUndefined();
    expect(parseAppliesTo(null)).toBeUndefined();
    expect(parseAppliesTo('08:00-10:00')).toBeUndefined();
    expect(parseAppliesTo([{ start: '08:00' }])).toBeUndefined();
  });

  it('drops a malformed half rather than the whole scope', () => {
    expect(parseAppliesTo({ start: '08:00', end: 'noon' })?.start).toBe('08:00');
    expect(parseAppliesTo({ start: '08:00', end: 'noon' })?.end).toBeUndefined();
  });

  it('keeps only real weekday numbers', () => {
    expect(parseAppliesTo({ daysOfWeek: [1, 9, 'Tue', 3.5, 6] })?.daysOfWeek).toEqual([1, 6]);
    expect(parseAppliesTo({ daysOfWeek: [] })).toBeUndefined();
  });
});

describe('evidence keys', () => {
  it('identifies a review by publication and author, not by position', () => {
    const review = { publishTime: '2026-07-01T00:00:00Z', author: 'Aiko' };
    // Providers order reviews by relevance, so the same review moves between
    // fetches. An index-based key would rewrite every row on every refresh.
    expect(reviewItemKey('g1', review, 0)).toBe(reviewItemKey('g1', review, 4));
  });

  it('falls back to position only when there is nothing stable to use', () => {
    expect(reviewItemKey('g1', {}, 2)).toBe('g1:i2');
  });

  it('keeps two reviews of one place on separate cache rows', () => {
    // source_documents is unique on (source, source_url) and every review of a
    // place shares that place's page URL — without a fragment, four of five
    // reviews are silently lost.
    const page = 'https://maps.google/place/x';
    expect(evidenceSourceUrl(page, 'g1:a')).not.toBe(evidenceSourceUrl(page, 'g1:b'));
    expect(evidenceSourceUrl(page, 'g1:a').startsWith(page)).toBe(true);
  });

  it('leaves a URL alone when there is no item key', () => {
    expect(evidenceSourceUrl('https://maps.google/place/x')).toBe('https://maps.google/place/x');
  });

  it('does not let one fresh source suppress another', () => {
    expect(probeKey('place-1', 'youtube')).not.toBe(probeKey('place-1', 'google-places'));
  });
});

describe('deciding whether to pay a provider', () => {
  const fetchFor = (input: Partial<Parameters<typeof shouldFetchEvidence>[0]> = {}) =>
    shouldFetchEvidence({
      configured: true,
      canonicalPlaceId: 'place-1',
      source: 'google-places',
      freshProbes: new Set<string>(),
      ...input,
    });

  it('fetches when nothing has been asked recently', () => {
    expect(fetchFor()).toBe(true);
  });

  it('does not re-ask a source probed within its freshness window', () => {
    expect(fetchFor({ freshProbes: new Set([probeKey('place-1', 'google-places')]) })).toBe(false);
  });

  it('treats "asked and got nothing" as an answer', () => {
    // The whole point of the probe log: an empty result is cacheable, and a
    // place with no reviews must not be re-bought on every discovery run.
    const freshProbes = new Set([probeKey('place-1', 'google-places')]);
    expect(fetchFor({ freshProbes })).toBe(false);
  });

  it('lets a fresh probe for one source not suppress another', () => {
    const freshProbes = new Set([probeKey('place-1', 'youtube')]);
    expect(fetchFor({ freshProbes, source: 'google-places' })).toBe(true);
  });

  it('never calls an unconfigured provider', () => {
    expect(fetchFor({ configured: false })).toBe(false);
  });

  it('does not let an unconfigured provider look probed', () => {
    // If an absent key recorded a probe, adding that key later would be ignored
    // until the probe expired — days of silently missing evidence.
    const freshProbes = new Set<string>();
    shouldFetchEvidence({
      configured: false, canonicalPlaceId: 'place-1', source: 'google-places', freshProbes,
    });
    expect(freshProbes.size).toBe(0);
  });

  it('still fetches for a place that has no canonical identity to cache under', () => {
    expect(fetchFor({ canonicalPlaceId: undefined })).toBe(true);
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

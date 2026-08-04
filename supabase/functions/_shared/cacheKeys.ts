/**
 * Pure cache-key and freshness helpers.
 *
 * This module has NO imports on purpose: it is loaded both by the Deno Edge
 * Functions and by the Node/vitest test suite (see `src/lib/cacheKeys.test.ts`).
 * Anything that needs the Supabase client or `Deno.env` lives in `cache.ts`,
 * which is Deno-only.
 */

export interface CachePoint {
  placeId?: string;
  coordinates?: [number, number];
}

/**
 * Round coordinates to ~1 metre and format them stably. Two requests for the
 * same venue must produce the same key, or the cache never hits; five decimals
 * (~1.1 m) is tight enough to avoid collapsing distinct places yet loose enough
 * to survive floating-point noise between requests.
 */
export function coordinateKey(coordinates: [number, number]): string {
  return `${coordinates[0].toFixed(5)},${coordinates[1].toFixed(5)}`;
}

/**
 * A stable cache key for one routing endpoint. A provider place id is the most
 * durable identity; coordinates are the fallback. Returns null when the point
 * carries neither, so the caller treats it as an un-cacheable miss rather than
 * inventing a key.
 */
export function routePointKey(point: CachePoint): string | null {
  if (point.placeId) return `pid:${point.placeId}`;
  if (point.coordinates) return `ll:${coordinateKey(point.coordinates)}`;
  return null;
}

export function routePairKey(originKey: string, destinationKey: string): string {
  return `${originKey}|${destinationKey}`;
}

/** Location key for weather, one venue's rounded coordinates. */
export function weatherLocationKey(coordinates: [number, number]): string {
  return coordinateKey(coordinates);
}

/** True while `expiresAt` is still in the future. Absent/invalid → stale. */
export function isFresh(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time > now;
}

/**
 * Inclusive list of `YYYY-MM-DD` dates from start to end, capped so a malformed
 * or hostile range cannot ask for thousands of rows. Invalid input yields an
 * empty list rather than throwing.
 */
export function enumerateDates(start: string, end: string, maxDays = 32): string[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const dates: string[] = [];
  for (let day = startMs; day <= endMs && dates.length < maxDays; day += 86_400_000) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

export interface RouteCell {
  status: 'ok' | 'unknown';
  source: 'provider' | 'cache';
  durationMinutes?: number;
  distanceMeters?: number;
  transfers?: number;
}

/**
 * Decide, from a set of cached pairs, which origin→destination pairs still need
 * a provider call. Same-key pairs (a place to itself) are free and never need
 * one. Returns the missing pairs plus a `complete` flag the caller uses to skip
 * the provider entirely.
 */
export function pairsNeedingProvider(
  originKeys: Array<string | null>,
  destinationKeys: Array<string | null>,
  cached: Set<string>,
): { missing: Array<{ i: number; j: number }>; complete: boolean } {
  const missing: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < originKeys.length; i += 1) {
    for (let j = 0; j < destinationKeys.length; j += 1) {
      const oKey = originKeys[i];
      const dKey = destinationKeys[j];
      if (oKey && dKey && oKey === dKey) continue; // self pair, distance 0
      if (oKey && dKey && cached.has(routePairKey(oKey, dKey))) continue;
      missing.push({ i, j });
    }
  }
  return { missing, complete: missing.length === 0 };
}

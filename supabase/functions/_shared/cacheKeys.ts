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

/**
 * The shape of a cached `PlaceCandidate`, as a number.
 *
 * `discovery_cache` stores candidates verbatim with a 30-day TTL, so a field
 * added to the candidate is simply *absent* from every row written before it
 * existed — and stays absent for a month, on the one path that is meant to make
 * the app feel fast. Bumping this retires those rows at deploy time instead of
 * letting them decay, which trades one round of provider calls for a month of
 * silently missing data.
 *
 * Bump this whenever a field is added to what discovery returns.
 *
 * - v2: `admission` (structured entry cost, replacing the `priceLevel`-only view)
 * - v3: `imageLeads` (where a real photograph of this place might be found)
 */
const DISCOVERY_SCHEMA_VERSION = 3;

/**
 * Cache key for one city's discovery results. Case and surrounding whitespace
 * must not split the cache — "osaka" and "Osaka " are the same search — but the
 * country code stays, because city names repeat across the world.
 */
export function discoveryCityKey(city: string, countryCode?: string): string {
  return `v${DISCOVERY_SCHEMA_VERSION}|${city.trim().toLowerCase()}|${(countryCode || '').trim().toUpperCase()}`;
}

/**
 * A stable identity for one review inside a place.
 *
 * Index position is *not* stable: providers order reviews by relevance, so the
 * same review moves between fetches and an index-based key would rewrite every
 * row on every refresh. Publication time plus author survives reordering, and
 * falls back to the index only when neither is present.
 */
export function reviewItemKey(
  placeId: string,
  review: { publishTime?: string; author?: string },
  index: number,
): string {
  const stable = [review.publishTime, review.author].filter(Boolean).join('~');
  return `${placeId}:${stable || `i${index}`}`;
}

/** Set key for "was this place asked of this source recently". */
export function probeKey(canonicalPlaceId: string, source: string): string {
  return `${canonicalPlaceId}|${source}`;
}

/**
 * Read a claim's `applies_to` back out of jsonb.
 *
 * This lives here rather than beside `CachedClaim` in `cache.ts` for one
 * reason: `cache.ts` imports the Supabase client and so cannot be loaded by
 * vitest, and the bug this function fixes was a *silent shape loss* on the
 * cache path. A round trip that nothing can test is how it went unnoticed in
 * the first place.
 *
 * Every field is validated rather than cast. The column is jsonb, so it can
 * hold anything an older or newer writer put there, and a malformed scope must
 * degrade to "unscoped" instead of poisoning a window with `NaN`.
 */
export function parseAppliesTo(value: unknown): {
  start?: string;
  end?: string;
  daysOfWeek?: number[];
  currency?: string;
  audience?: string;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const time = (field: unknown) => (typeof field === 'string' && /^\d{2}:\d{2}$/.test(field) ? field : undefined);
  const text = (field: unknown) => (typeof field === 'string' && field.trim() ? field.trim() : undefined);
  const days = Array.isArray(raw.daysOfWeek)
    ? raw.daysOfWeek.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
    : undefined;

  const parsed = {
    start: time(raw.start),
    end: time(raw.end),
    daysOfWeek: days && days.length > 0 ? days : undefined,
    currency: text(raw.currency),
    audience: text(raw.audience),
  };
  // An object whose every field failed validation is not a scope, and returning
  // `{}` would make callers think the claim was scoped to nothing at all.
  return Object.values(parsed).some((field) => field !== undefined) ? parsed : undefined;
}

/**
 * Whether one place's one evidence source is worth paying for right now.
 *
 * This is the decision that spends money, so it lives here as a pure function
 * with its own tests rather than as a condition buried in a request handler.
 *
 * - An unconfigured provider is never called, and — importantly — is never
 *   recorded as probed, or adding the key later would be ignored until the
 *   probe expired.
 * - A place with no canonical identity cannot be cached at all, so it is always
 *   fetched. That is the honest trade: correct data, uncached.
 * - A fresh probe means we asked recently. That answer stands even when the
 *   provider returned nothing, which is the case a document cache cannot record.
 *
 * The photograph lookup in `travel-images` passes its own probe set through
 * here too. The decision is identical — was this place asked of this source
 * recently — and the reason it matters is stronger there, because most OSM
 * places carry no image tag at all, so "nothing found" is the *common* answer
 * rather than the exceptional one.
 */
export function shouldFetchEvidence(input: {
  configured: boolean;
  canonicalPlaceId?: string;
  source: string;
  freshProbes: ReadonlySet<string>;
}): boolean {
  if (!input.configured) return false;
  if (!input.canonicalPlaceId) return true;
  return !input.freshProbes.has(probeKey(input.canonicalPlaceId, input.source));
}

/**
 * `source_documents` is unique on (source, source_url), but every review of one
 * place shares that place's page URL. Without a distinguishing fragment all five
 * reviews collapse onto a single row and four are silently lost.
 *
 * The fragment keeps the URL pointing at the same page a traveller would open,
 * while making each review its own cache row.
 */
export function evidenceSourceUrl(pageUrl: string, itemKey?: string): string {
  if (!itemKey) return pageUrl;
  const [base] = pageUrl.split('#');
  return `${base}#${encodeURIComponent(itemKey)}`;
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

/**
 * Key for one cached model answer.
 *
 * Lives here rather than beside the table access in `cache.ts` for the same
 * reason `parseAppliesTo` does: `cache.ts` reaches for `Deno` and the Supabase
 * client, so importing it from a client-side test drags both into the browser
 * type program. A key helper nothing can load is a key helper nothing can
 * test, which is precisely how the `applies_to` round trip broke unnoticed.
 *
 * The delimiter is a printable space. All three parts are internal
 * identifiers that never contain one, and a non-printing separator would
 * quietly make this file read as binary to `grep` and `file`.
 */
export const aiBriefKey = (
  canonicalPlaceId: string,
  operation: string,
  evidenceRevision: string,
): string => `${canonicalPlaceId} ${operation} ${evidenceRevision}`;

/**
 * Look one cached model answer up.
 *
 * Returns `undefined` for a miss and `null` for "we asked about exactly this
 * evidence and nothing survived validation". Those are different facts and
 * callers must branch on presence, not truthiness: treating the cached empty
 * answer as a miss would re-ask the metered provider about every silent place,
 * every day, forever — the waste this cache exists to prevent.
 */
export function lookupAiBrief(
  hits: Map<string, unknown | null>,
  canonicalPlaceId: string,
  operation: string,
  evidenceRevision: string,
): unknown | null | undefined {
  const key = aiBriefKey(canonicalPlaceId, operation, evidenceRevision);
  return hits.has(key) ? hits.get(key) : undefined;
}

/**
 * Read-through / write-through cache for billed provider calls.
 *
 * Every helper here is best-effort: a cache failure must never break the
 * function. If the cache cannot be read we fall through to the live provider;
 * if it cannot be written we still return the fresh result. The whole point is
 * to *reduce* provider spend, so a broken cache degrades to today's behaviour,
 * never to an error.
 *
 * Writes use the service-role key because the reference tables are readable by
 * any signed-in user but writable only by the service role (see the RLS policy
 * in the evidence-cache migration).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aiBriefKey, parseAppliesTo, probeKey, routePairKey } from './cacheKeys.ts';

let cachedClient: SupabaseClient | null | undefined;

/** The service-role client, or null when the cache is not configured. */
export function serviceClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  cachedClient = url && key
    ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Route cache
// ---------------------------------------------------------------------------

export interface CachedRoute {
  durationMinutes: number;
  distanceMeters: number;
  transfers?: number;
}

/**
 * Fresh, `ok` route legs for the requested endpoints, keyed by
 * `routePairKey(origin, destination)`. Over-fetches the cross product of the
 * two key sets (Postgres cannot express "these specific pairs" cheaply), which
 * is harmless — the caller only reads the pairs it asked for.
 */
export async function readRouteCache(
  client: SupabaseClient,
  originKeys: string[],
  destinationKeys: string[],
  mode: string,
): Promise<Map<string, CachedRoute>> {
  const result = new Map<string, CachedRoute>();
  const origins = [...new Set(originKeys)];
  const destinations = [...new Set(destinationKeys)];
  if (origins.length === 0 || destinations.length === 0) return result;

  try {
    const { data, error } = await client
      .from('route_cache')
      .select('origin_key, destination_key, duration_minutes, distance_meters, transfers')
      .eq('mode', mode)
      .eq('status', 'ok')
      .gt('expires_at', new Date().toISOString())
      .in('origin_key', origins)
      .in('destination_key', destinations);
    if (error || !data) return result;
    for (const row of data) {
      if (typeof row.duration_minutes !== 'number' || typeof row.distance_meters !== 'number') continue;
      result.set(routePairKey(row.origin_key, row.destination_key), {
        durationMinutes: row.duration_minutes,
        distanceMeters: row.distance_meters,
        transfers: row.transfers ?? undefined,
      });
    }
  } catch {
    // Best-effort: fall through to the live provider.
  }
  return result;
}

export interface RouteCacheRow {
  origin_key: string;
  destination_key: string;
  mode: string;
  duration_minutes: number;
  distance_meters: number;
  transfers?: number;
  expires_at: string;
}

export async function writeRouteCache(client: SupabaseClient, rows: RouteCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await client
      .from('route_cache')
      .upsert(
        rows.map((row) => ({ ...row, status: 'ok', retrieved_at: new Date().toISOString() })),
        { onConflict: 'origin_key,destination_key,mode' },
      );
  } catch {
    // A failed write just means the next request re-fetches; never fatal.
  }
}

// ---------------------------------------------------------------------------
// Weather cache
// ---------------------------------------------------------------------------

/** Per-day weather payloads for a location, keyed by `YYYY-MM-DD`. */
export async function readWeatherCache(
  client: SupabaseClient,
  locationKey: string,
  dates: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (dates.length === 0) return result;
  try {
    const { data, error } = await client
      .from('weather_cache')
      .select('forecast_date, payload')
      .eq('location_key', locationKey)
      .gt('expires_at', new Date().toISOString())
      .in('forecast_date', dates);
    if (error || !data) return result;
    for (const row of data) {
      if (row.payload && typeof row.payload === 'object') {
        result.set(String(row.forecast_date), row.payload as Record<string, unknown>);
      }
    }
  } catch {
    // Best-effort.
  }
  return result;
}

export interface WeatherCacheRow {
  location_key: string;
  forecast_date: string;
  payload: Record<string, unknown>;
  expires_at: string;
}

export async function writeWeatherCache(client: SupabaseClient, rows: WeatherCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await client
      .from('weather_cache')
      .upsert(
        rows.map((row) => ({ ...row, retrieved_at: new Date().toISOString() })),
        { onConflict: 'location_key,forecast_date' },
      );
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Discovery cache
// ---------------------------------------------------------------------------

/**
 * The cached candidate list for one city and provider, or null on a miss. The
 * payload is returned verbatim: it is exactly what the function would have
 * produced live, so the caller needs no separate cached/live code path.
 */
export async function readDiscoveryCache(
  client: SupabaseClient,
  cityKey: string,
  provider: string,
): Promise<unknown[] | null> {
  try {
    const { data, error } = await client
      .from('discovery_cache')
      .select('payload')
      .eq('city_key', cityKey)
      .eq('provider', provider)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data || !Array.isArray(data.payload)) return null;
    return data.payload as unknown[];
  } catch {
    return null;
  }
}

export async function writeDiscoveryCache(
  client: SupabaseClient,
  cityKey: string,
  provider: string,
  payload: unknown[],
  expiresAt: string,
): Promise<void> {
  if (payload.length === 0) return;
  try {
    await client
      .from('discovery_cache')
      .upsert(
        { city_key: cityKey, provider, payload, expires_at: expiresAt, retrieved_at: new Date().toISOString() },
        { onConflict: 'city_key,provider' },
      );
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Canonical place identity
// ---------------------------------------------------------------------------

/** The minimum a candidate must carry to become a canonical place row. */
export interface CanonicalPlaceInput {
  providerPlaceId: string;
  name: string;
  city: string;
  countryCode: string;
  coordinates: [number, number];
  region?: string;
  neighbourhood?: string;
  address?: string;
  website?: string;
  phone?: string;
}

/** Provider place id → canonical place uuid, for ids already linked. */
export async function readCanonicalPlaceIds(
  client: SupabaseClient,
  provider: string,
  providerPlaceIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = [...new Set(providerPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('place_provider_links')
      .select('provider_place_id, canonical_place_id')
      .eq('provider', provider)
      .in('provider_place_id', ids);
    if (error || !data) return result;
    for (const row of data) {
      if (row.provider_place_id && row.canonical_place_id) {
        result.set(String(row.provider_place_id), String(row.canonical_place_id));
      }
    }
  } catch {
    // Best-effort: an unresolved id simply misses the cache.
  }
  return result;
}

/**
 * Ensure every candidate has a canonical place and a provider link, and return
 * the full provider-id → canonical-id map.
 *
 * Identity resolution across providers (the same museum found by both Google and
 * Amap) is deliberately *not* attempted here. Collapsing two providers onto one
 * canonical place is a matching problem with real false-positive cost, and
 * `place_provider_links.match_confidence` exists to record that judgement when
 * it is made. Until then one provider id maps to one canonical place, which is
 * always correct if sometimes redundant.
 */
export async function linkCanonicalPlaces(
  client: SupabaseClient,
  provider: string,
  places: CanonicalPlaceInput[],
): Promise<Map<string, string>> {
  const known = await readCanonicalPlaceIds(client, provider, places.map((place) => place.providerPlaceId));
  const missing = places.filter((place) => !known.has(place.providerPlaceId));
  if (missing.length === 0) return known;

  try {
    // Ids are generated here rather than read back from `RETURNING`, so the
    // place → id mapping never depends on the database preserving insert order.
    const rows = missing.map((place) => ({
      id: crypto.randomUUID(),
      providerPlaceId: place.providerPlaceId,
      primary_name: place.name,
      city: place.city,
      region: place.region ?? null,
      country_code: place.countryCode || 'ZZ',
      neighbourhood: place.neighbourhood ?? null,
      latitude: place.coordinates[0],
      longitude: place.coordinates[1],
      address: place.address ?? null,
      website: place.website ?? null,
      phone: place.phone ?? null,
    }));

    const { error } = await client
      .from('canonical_places')
      .insert(rows.map(({ providerPlaceId: _ignored, ...row }) => row));
    if (error) return known;

    const links = rows.map((row) => ({
      provider,
      provider_place_id: row.providerPlaceId,
      canonical_place_id: row.id,
      match_confidence: 1,
      matched_by: ['provider-id'],
    }));
    const { error: linkError } = await client
      .from('place_provider_links')
      .upsert(links, { onConflict: 'provider,provider_place_id' });
    if (linkError) return known;

    for (const link of links) known.set(link.provider_place_id, link.canonical_place_id);
  } catch {
    // Best-effort: unlinked places still work, they just are not cached.
  }
  return known;
}

// ---------------------------------------------------------------------------
// Opening hours published by the operator
// ---------------------------------------------------------------------------

export interface OpeningRuleRow {
  daysOfWeek: number[];
  opensAt: string;
  closesAt: string;
}

/**
 * Hours read from a place's own website, by canonical place id.
 *
 * These have to persist, not merely be returned. The nightly refresh marks the
 * official probe fresh, which makes the next live request *skip* the fetch —
 * so without a stored copy the hours would be read overnight and then thrown
 * away, and the traveller would keep seeing the community-maintained ones.
 */
export async function readOpeningHours(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Map<string, OpeningRuleRow[]>> {
  const result = new Map<string, OpeningRuleRow[]>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('opening_hours_snapshots')
      .select('canonical_place_id, payload, captured_for')
      .in('canonical_place_id', ids)
      .gt('expires_at', new Date().toISOString())
      .order('captured_for', { ascending: false });
    if (error || !data) return result;
    for (const row of data) {
      const placeId = String(row.canonical_place_id);
      // Ordered newest first, so the first row for a place is the current one.
      if (result.has(placeId)) continue;
      const payload = row.payload as { rules?: OpeningRuleRow[] } | null;
      if (Array.isArray(payload?.rules) && payload.rules.length > 0) result.set(placeId, payload.rules);
    }
  } catch {
    // Best-effort: without them the caller falls back to provider hours.
  }
  return result;
}

export async function writeOpeningHours(
  client: SupabaseClient,
  rows: Array<{ canonicalPlaceId: string; rules: OpeningRuleRow[] }>,
  expiresAt: string,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const capturedFor = new Date().toISOString().slice(0, 10);
    await client
      .from('opening_hours_snapshots')
      .upsert(
        rows.map((row) => ({
          canonical_place_id: row.canonicalPlaceId,
          captured_for: capturedFor,
          payload: { rules: row.rules },
          // The operator is the authority on their own hours.
          source_confidence: 'high',
          retrieved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })),
        { onConflict: 'canonical_place_id,captured_for' },
      );
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Evidence cache
// ---------------------------------------------------------------------------

export interface CachedClaim {
  type: string;
  summary: string;
  value?: number;
  unit?: string;
  /**
   * What the claim is scoped to — the part of the day for `best-time`, the
   * currency and ticket audience for `price`.
   *
   * This was written to the database and never read back, so a `best-time`
   * claim survived a cache hit with its window stripped and
   * `summarisePlaceEvidence` stopped producing a best-time window for any place
   * whose evidence was cached. The claim looked present; only its meaning was
   * gone.
   */
  appliesTo?: { start?: string; end?: string; daysOfWeek?: number[]; currency?: string; audience?: string };
  strength: number;
  excerpt?: string;
}

export interface CachedEvidence {
  canonicalPlaceId: string;
  source: string;
  sourceUrl: string;
  sourceItemId?: string;
  publishedAt?: string;
  retrievedAt: string;
  authorType: string;
  disclosure: string;
  confidence: number;
  claims: CachedClaim[];
}

/**
 * Every live evidence document for the given canonical places, with its claims,
 * grouped by canonical place id. Expired rows are excluded rather than returned
 * and relabelled: this is the cost cache, and a stale row here means we pay the
 * provider again, which is the correct trade.
 */
export async function readEvidenceCache(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Map<string, CachedEvidence[]>> {
  const result = new Map<string, CachedEvidence[]>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;

  try {
    // Documents and claims are read separately rather than as one embedded
    // select. PostgREST resolves the embed happily at runtime, but without
    // generated database types supabase-js cannot infer the nested shape and
    // the whole row degrades to an error type. Two flat queries stay typed.
    // One string literal, never a concatenation: supabase-js infers the row
    // shape from the *literal type* of this argument, and a built-up string
    // collapses every column to an error type.
    const { data: documentRows, error } = await client
      .from('source_documents')
      .select('id, canonical_place_id, source, source_url, source_item_id, published_at, retrieved_at, author_type, disclosure, confidence')
      .in('canonical_place_id', ids)
      .gt('expires_at', new Date().toISOString());
    if (error || !documentRows || documentRows.length === 0) return result;

    const documentIds = documentRows.map((row) => String(row.id));
    const claimsByDocument = new Map<string, CachedClaim[]>();
    const { data: claimRows } = await client
      .from('travel_claims')
      .select('source_document_id, claim_type, summary, value, unit, applies_to, strength, excerpt')
      .in('source_document_id', documentIds);

    for (const claim of claimRows || []) {
      const documentId = String(claim.source_document_id);
      const parsed: CachedClaim = {
        type: String(claim.claim_type),
        summary: String(claim.summary),
        // Postgres `numeric` arrives as a string; a claim's value is what makes
        // a queue schedulable, so it must survive the round trip as a number.
        value: claim.value != null && Number.isFinite(Number(claim.value)) ? Number(claim.value) : undefined,
        unit: claim.unit ? String(claim.unit) : undefined,
        appliesTo: parseAppliesTo(claim.applies_to),
        strength: Number.isFinite(Number(claim.strength)) ? Number(claim.strength) : 0.5,
        excerpt: claim.excerpt ? String(claim.excerpt) : undefined,
      };
      const bucket = claimsByDocument.get(documentId);
      if (bucket) bucket.push(parsed);
      else claimsByDocument.set(documentId, [parsed]);
    }

    for (const row of documentRows) {
      const placeId = row.canonical_place_id ? String(row.canonical_place_id) : '';
      if (!placeId) continue;
      const entry: CachedEvidence = {
        canonicalPlaceId: placeId,
        source: String(row.source),
        sourceUrl: String(row.source_url),
        sourceItemId: row.source_item_id ? String(row.source_item_id) : undefined,
        publishedAt: row.published_at ? String(row.published_at) : undefined,
        retrievedAt: String(row.retrieved_at),
        authorType: String(row.author_type),
        disclosure: String(row.disclosure),
        confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.5,
        claims: claimsByDocument.get(String(row.id)) || [],
      };
      const bucket = result.get(placeId);
      if (bucket) bucket.push(entry);
      else result.set(placeId, [entry]);
    }
  } catch {
    // Best-effort: a read failure just means we fetch live.
  }
  return result;
}

/**
 * Which (place, source) pairs were asked recently enough that asking again
 * would be waste, as a set of `probeKey` strings.
 *
 * This is what makes "this place has no reviews" a cacheable answer. Without it
 * an empty result is indistinguishable from a cache miss and the provider is
 * called again on every run.
 */
export async function readEvidenceProbes(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Set<string>> {
  const fresh = new Set<string>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return fresh;
  try {
    const { data, error } = await client
      .from('evidence_probes')
      .select('canonical_place_id, source')
      .in('canonical_place_id', ids)
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return fresh;
    for (const row of data) {
      fresh.add(probeKey(String(row.canonical_place_id), String(row.source)));
    }
  } catch {
    // Best-effort: an unreadable probe log just means we re-ask.
  }
  return fresh;
}

export async function writeEvidenceProbes(
  client: SupabaseClient,
  probes: Array<{ canonicalPlaceId: string; source: string }>,
  expiresAt: string,
): Promise<void> {
  if (probes.length === 0) return;
  try {
    await client
      .from('evidence_probes')
      .upsert(
        probes.map((probe) => ({
          canonical_place_id: probe.canonicalPlaceId,
          source: probe.source,
          retrieved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })),
        { onConflict: 'canonical_place_id,source' },
      );
  } catch {
    // Best-effort.
  }
}

/**
 * A cached model answer, where "we asked and got nothing" is itself an answer.
 *
 * `brief` is null for a place the model had nothing usable to say about. The
 * row existing is the cache hit; the payload being null is the result. Callers
 * must check presence, not truthiness — treating a null payload as a miss
 * would re-ask, on the metered provider, forever, which is the entire thing
 * this cache exists to prevent.
 */
export interface CachedAiBrief {
  canonicalPlaceId: string;
  operation: string;
  evidenceRevision: string;
  brief: unknown | null;
}


/**
 * Read cached model answers. Returns a map whose *keys* are the hits, so a
 * null value stays distinguishable from an absent one.
 */
export async function readAiBriefs(
  client: SupabaseClient,
  wanted: Array<{ canonicalPlaceId: string; operation: string; evidenceRevision: string }>,
): Promise<Map<string, unknown | null>> {
  const hits = new Map<string, unknown | null>();
  const ids = [...new Set(wanted.map((item) => item.canonicalPlaceId))].filter(Boolean);
  if (ids.length === 0) return hits;
  try {
    const { data, error } = await client
      .from('ai_place_briefs')
      .select('canonical_place_id, operation, evidence_revision, brief')
      .in('canonical_place_id', ids)
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return hits;
    for (const row of data) {
      hits.set(
        aiBriefKey(String(row.canonical_place_id), String(row.operation), String(row.evidence_revision)),
        row.brief ?? null,
      );
    }
  } catch {
    // Best-effort: an unreadable cache costs a call, never a wrong answer.
  }
  return hits;
}


/** Persist a model answer, including the empty one. */
export async function writeAiBriefs(
  client: SupabaseClient,
  entries: CachedAiBrief[],
  expiresAt: string,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await client
      .from('ai_place_briefs')
      .upsert(
        entries.map((entry) => ({
          canonical_place_id: entry.canonicalPlaceId,
          operation: entry.operation,
          evidence_revision: entry.evidenceRevision,
          brief: entry.brief ?? null,
          retrieved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })),
        { onConflict: 'canonical_place_id,operation,evidence_revision' },
      );
  } catch {
    // Best-effort.
  }
}

/**
 * Persist freshly fetched evidence and its claims.
 *
 * Documents upsert on (source, source_url), so a refreshed review updates in
 * place. Claims are deleted and reinserted for the affected documents rather
 * than merged — re-extraction can legitimately *remove* a claim, and a merge
 * would leave the retracted one behind forever.
 */
export async function writeEvidenceCache(
  client: SupabaseClient,
  documents: CachedEvidence[],
  expiresAt: string,
): Promise<void> {
  if (documents.length === 0) return;
  try {
    const { data, error } = await client
      .from('source_documents')
      .upsert(
        documents.map((document) => ({
          canonical_place_id: document.canonicalPlaceId,
          source: document.source,
          source_url: document.sourceUrl,
          source_item_id: document.sourceItemId ?? null,
          published_at: document.publishedAt ?? null,
          retrieved_at: document.retrievedAt,
          author_type: document.authorType,
          disclosure: document.disclosure,
          confidence: document.confidence,
          expires_at: expiresAt,
        })),
        { onConflict: 'source,source_url' },
      )
      .select('id, source_url');
    if (error || !data) return;

    const idByUrl = new Map(data.map((row) => [String(row.source_url), String(row.id)]));
    const documentIds = [...idByUrl.values()];
    if (documentIds.length > 0) {
      await client.from('travel_claims').delete().in('source_document_id', documentIds);
    }

    const claimRows = documents.flatMap((document) => {
      const documentId = idByUrl.get(document.sourceUrl);
      if (!documentId) return [];
      return document.claims.map((claim) => ({
        source_document_id: documentId,
        canonical_place_id: document.canonicalPlaceId,
        claim_type: claim.type,
        summary: claim.summary,
        value: claim.value ?? null,
        unit: claim.unit ?? null,
        // Without this the column is always null, so `readEvidenceCache` has
        // nothing to read back and a cached `best-time` claim loses the window
        // that gave it meaning.
        applies_to: claim.appliesTo ?? null,
        strength: claim.strength,
        excerpt: claim.excerpt ?? null,
      }));
    });
    if (claimRows.length > 0) await client.from('travel_claims').insert(claimRows);
  } catch {
    // Best-effort: a failed write means the next request re-fetches.
  }
}

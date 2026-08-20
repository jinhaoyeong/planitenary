/**
 * Read-through / write-through cache for billed provider calls.
 *
 * Most helpers here are best-effort: a cache failure must never break the
 * function. If the cache cannot be read we fall through to the live provider;
 * if it cannot be written we still return the fresh result. The whole point is
 * to *reduce* provider spend, so a broken cache degrades to today's behaviour,
 * never to an error.
 *
 * **Candidate intelligence is the exception, because there the provider sends a
 * bill.** Falling through on a failed read spends money on answers we may
 * already hold, at the moment the database is least healthy, so that read
 * reports failure as its own outcome and the caller fails closed. See
 * `candidateIntelligenceCache.ts`.
 *
 * Writes use the service-role key because the reference tables are readable by
 * any signed-in user but writable only by the service role (see the RLS policy
 * in the evidence-cache migration).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aiBriefKey, parseAppliesTo, probeKey, routePairKey } from './cacheKeys.ts';
import {
  parsePlaceImage,
  rankPlaceImages,
  PLACE_IMAGE_VALIDATION_VERSION,
  type PlaceImage,
} from './placeImages.ts';
import { summarizeAiSpendRows, type AiSpendSnapshotRow } from './meteredModel.ts';
import { usableCachedItineraryProposal } from './itineraryProposalCache.ts';
import type { TripItineraryProposal } from './itineraryProposal.ts';

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
// Exact-material itinerary proposal cache
// ---------------------------------------------------------------------------

export async function readItineraryProposalCache(
  client: SupabaseClient | null,
  tripId: string,
  materialRevision: string,
): Promise<TripItineraryProposal | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('itinerary_proposal_cache')
      .select('proposal')
      .eq('trip_id', tripId)
      .eq('material_revision', materialRevision)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data?.proposal || typeof data.proposal !== 'object') return null;
    return usableCachedItineraryProposal(data.proposal, tripId, materialRevision);
  } catch {
    return null;
  }
}

export async function writeItineraryProposalCache(
  client: SupabaseClient | null,
  proposal: TripItineraryProposal,
): Promise<void> {
  if (!client || proposal.applied !== false) return;
  try {
    await client.from('itinerary_proposal_cache').upsert({
      trip_id: proposal.tripId,
      material_revision: proposal.materialRevision,
      proposal,
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'trip_id,material_revision' });
  } catch {
    // Best-effort. A failed preview-cache write never changes the itinerary.
  }
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
      .insert(rows.map((row) => {
        const { providerPlaceId, ...insertRow } = row;
        void providerPlaceId;
        return insertRow;
      }));
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
// Place photographs
// ---------------------------------------------------------------------------

/**
 * Every live photograph for these places, keyed by canonical place id and
 * already ranked best-first.
 *
 * Rows are re-validated through `parsePlaceImage` rather than cast. The
 * columns are ordinary text and can hold whatever an older writer put there,
 * and a row that lost its licence — or whose URL no longer points at a
 * Wikimedia host — must degrade to no photograph rather than to an `<img>`
 * loading from wherever the row said.
 */
export async function readPlaceImages(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Map<string, PlaceImage[]>> {
  const result = new Map<string, PlaceImage[]>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('place_images')
      .select('canonical_place_id, image_url, thumbnail_url, width, height, source_page, author, licence, licence_url, lead')
      .in('canonical_place_id', ids)
      /**
       * A row accepted under an older identity policy is a cache miss, not a
       * cheaper answer. Returning it first and revalidating afterwards would
       * let a known-wrong photograph render at least once more, which is the
       * whole failure this filter exists to end.
       */
      .eq('validation_version', PLACE_IMAGE_VALIDATION_VERSION)
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return result;
    for (const row of data) {
      const image = parsePlaceImage({
        url: row.image_url,
        thumbnailUrl: row.thumbnail_url,
        width: row.width,
        height: row.height,
        sourcePage: row.source_page,
        author: row.author,
        licence: row.licence,
        licenceUrl: row.licence_url,
        lead: row.lead,
      });
      if (!image) continue;
      const placeId = String(row.canonical_place_id);
      result.set(placeId, [...(result.get(placeId) || []), image]);
    }
    // Ranked on the way out, so a cache hit orders identically to a fresh
    // fetch. Postgres returns rows in no guaranteed order, and a hero image
    // that changes between a cached and an uncached render is the kind of
    // difference nobody attributes to the cache.
    for (const [placeId, images] of result) result.set(placeId, rankPlaceImages(images));
  } catch {
    // Best-effort: an unreadable cache just means we ask Commons again.
  }
  return result;
}

/**
 * Replace a place's photographs with what was just fetched.
 *
 * Wholesale replacement, not an upsert of the new rows alongside the old: a
 * file deleted from Commons, or one whose licence changed to something this
 * app may not display, has to be able to *disappear*. An upsert-only write
 * would leave it rendering until its own row expired, which is precisely the
 * window in which showing it is the problem.
 */
export async function writePlaceImages(
  client: SupabaseClient,
  entries: Array<{ canonicalPlaceId: string; images: PlaceImage[] }>,
  expiresAt: string,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const placeIds = [...new Set(entries.map((entry) => entry.canonicalPlaceId))];
    await client.from('place_images').delete().in('canonical_place_id', placeIds);

    const rows = entries.flatMap((entry) => entry.images.map((image) => ({
      canonical_place_id: entry.canonicalPlaceId,
      image_url: image.url,
      thumbnail_url: image.thumbnailUrl ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      source: image.source,
      source_page: image.sourcePage,
      author: image.author ?? null,
      licence: image.licence,
      licence_url: image.licenceUrl ?? null,
      lead: image.lead,
      validation_version: PLACE_IMAGE_VALIDATION_VERSION,
      retrieved_at: new Date().toISOString(),
      expires_at: expiresAt,
    })));
    if (rows.length === 0) return;
    await client
      .from('place_images')
      .upsert(rows, { onConflict: 'canonical_place_id,image_url' });
  } catch {
    // Best-effort.
  }
}

/** Places whose photograph lookup ran recently, whatever it found. */
export async function readImageProbes(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Set<string>> {
  const fresh = new Set<string>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return fresh;
  try {
    const { data, error } = await client
      .from('place_image_probes')
      .select('canonical_place_id, source')
      .in('canonical_place_id', ids)
      /**
       * A probe recorded under an older policy answers a question we are no
       * longer asking. Left unfiltered it would suppress the very re-resolution
       * a tightened rule requires, and the wrong image would simply persist as
       * "we already looked".
       */
      .eq('validation_version', PLACE_IMAGE_VALIDATION_VERSION)
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return fresh;
    for (const row of data) {
      fresh.add(probeKey(String(row.canonical_place_id), String(row.source)));
    }
  } catch {
    // Best-effort: an unreadable probe log just means we look again.
  }
  return fresh;
}

export async function writeImageProbes(
  client: SupabaseClient,
  probes: Array<{ canonicalPlaceId: string; source: string }>,
  expiresAt: string,
): Promise<void> {
  if (probes.length === 0) return;
  try {
    await client
      .from('place_image_probes')
      .upsert(
        probes.map((probe) => ({
          canonical_place_id: probe.canonicalPlaceId,
          source: probe.source,
          validation_version: PLACE_IMAGE_VALIDATION_VERSION,
          retrieved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })),
        { onConflict: 'canonical_place_id,source' },
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

/**
 * Append spending records.
 *
 * Best-effort like every other cache write here — but the failure means
 * something different, and the difference matters. A lost evidence row costs a
 * re-fetch; a lost ledger row means money was spent that the ceiling will
 * never see. `readSpendToDate` is what closes that gap: it fails closed, so an
 * unwritable or unreadable ledger stops the tier rather than letting it run
 * uncounted.
 */
/**
 * Read durable spending inside the configured budget window, in USD.
 *
 * Returns `null` for "could not be read", which callers must treat as a
 * refusal rather than as zero — the same distinction `usageToday` draws
 * between an unused counter and an unreachable one.
 *
 * Resolved known rows contribute their actual cost. Resolved unknown rows are
 * terminal bounded-unknown attempts: they contribute their full conservative
 * reservation without poisoning the tier. Only reserved or legacy unresolved
 * rows increment the unknown-event count, because those accounting boundaries
 * are genuinely still open.
 */
export async function readSpendToDate(
  client: SupabaseClient | null,
  sinceIso?: string,
): Promise<{ knownUsd: number; unknownEvents: number; reservedUsd: number } | null> {
  if (!client) return null;
  try {
    /**
     * No epoch means count everything ever recorded, which is the correct
     * default for a prepaid budget: money already spent does not become
     * unspent because time passed. An epoch narrows the window only when
     * somebody has deliberately declared a new budget after topping up.
     */
    const base = client
      .from('ai_spend_ledger')
      .select('estimated_cost_usd, cost_status, attempt_status, reserved_cost_usd');
    const { data, error } = await (sinceIso ? base.gte('created_at', sinceIso) : base);
    if (error || !data) return null;
    return summarizeAiSpendRows(data as AiSpendSnapshotRow[]);
  } catch {
    return null;
  }
}

/** Finalise the durable row created before a provider attempt. */
export async function finalizeAiSpendAttempt(
  client: SupabaseClient | null,
  attemptId: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  if (!client) return false;
  try {
    const { data, error } = await client.rpc('finalize_ai_spend_attempt', {
      p_attempt_id: attemptId,
      p_provider_request_id: row.provider_request_id ?? null,
      p_model_resolved: row.model_resolved ?? null,
      p_input_tokens: row.input_tokens ?? null,
      p_cached_input_tokens: row.cached_input_tokens ?? null,
      p_output_tokens: row.output_tokens ?? null,
      p_reasoning_tokens: row.reasoning_tokens ?? null,
      p_total_tokens: row.total_tokens ?? null,
      p_estimated_cost_usd: row.estimated_cost_usd ?? null,
      p_cost_status: row.cost_status ?? 'unknown',
      p_request_status: row.request_status ?? null,
      p_error_code: row.error_code ?? null,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function claimCandidateIntelligence(
  client: SupabaseClient | null,
  input: { claimKey: string; userId: string; tripId: string; expiresAt: string },
): Promise<boolean> {
  if (!client) return false;
  try {
    const { data, error } = await client.rpc('claim_candidate_intelligence', {
      p_claim_key: input.claimKey,
      p_user_id: input.userId,
      p_trip_id: input.tripId,
      p_expires_at: input.expiresAt,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function releaseCandidateIntelligence(
  client: SupabaseClient | null,
  claimKey: string,
): Promise<void> {
  if (!client) return;
  try {
    await client.rpc('release_candidate_intelligence', { p_claim_key: claimKey });
  } catch {
    // Expiry is the recovery path if release itself is unavailable.
  }
}

/**
 * Reading the candidate-intelligence cache lives in its own module.
 *
 * This file builds its service client from `Deno.env`, so nothing that imports
 * it can be loaded by vitest or by the app typecheck — and that lookup is where
 * a bug quietly costs money on every deck open. Re-exported here so the cache
 * surface stays in one place for callers.
 */
export {
  readCandidateIntelligence,
  type CandidateIntelligenceRead,
} from './candidateIntelligenceCache.ts';

/**
 * Persist candidate intelligence, one row per candidate.
 *
 * Per candidate even when fifteen of them shared a single provider request:
 * batching is a transport optimisation, and filing them together would mean one
 * candidate's data changing invalidates fourteen neighbours whose answers were
 * still correct.
 *
 * **Only ever called with answers the model actually produced.** A refusal — a
 * spent budget, an exhausted quota, a provider failure — must never reach this
 * function, because a row here is indistinguishable from a genuine empty answer
 * once written, and one bad afternoon would permanently mark those cards as
 * having no personalisation. `IntelligenceOutcome` carries that distinction in
 * its type so the wrong thing cannot be passed in.
 */
export async function writeCandidateIntelligence(
  client: SupabaseClient | null,
  entries: Array<{
    tripId: string;
    cacheKey: string;
    candidateId: string;
    candidateRevision: string;
    tripMaterialRevision: string;
    plannerRevision: string;
    schemaVersion: string;
    model: string;
    intelligence: unknown | null;
  }>,
  expiresAt: string,
): Promise<void> {
  if (!client || entries.length === 0) return;
  try {
    await client
      .from('ai_candidate_intelligence')
      .upsert(
        entries.map((entry) => ({
          cache_key: entry.cacheKey,
          trip_id: entry.tripId,
          candidate_id: entry.candidateId,
          candidate_revision: entry.candidateRevision,
          profile_revision: entry.tripMaterialRevision,
          planner_context_revision: entry.plannerRevision,
          schema_version: entry.schemaVersion,
          model: entry.model,
          intelligence: entry.intelligence ?? null,
          expires_at: expiresAt,
        })),
        { onConflict: 'cache_key' },
      );
  } catch {
    // Best-effort: a failed write costs a re-ask, never an error.
  }
}

/**
 * Resolve provider place ids to canonical places **without being told which
 * provider they belong to**.
 *
 * {@link readCanonicalPlaceIds} is the right call whenever the caller knows
 * the link provider, and every image path does. A place *card* does not: the
 * reference it is built from may have come from a saved activity, whose
 * `provider` field records where the listing came from ('wikivoyage') rather
 * than which run linked it ('osm'). Asking under the wrong label returns
 * nothing, silently, and the card would simply lose its photograph with no
 * error anywhere — the exact shape of failure this project has now fixed
 * twice.
 *
 * Ambiguity is refused rather than resolved. If one provider place id is
 * linked to more than one canonical place across providers, no reference is
 * produced: provider ids are already namespaced ('n123', 'wv:Name'), so a
 * collision means something is wrong, and the safe answer to "which place is
 * this?" being unclear is no card at all.
 */
export async function readPlaceProviderLinks(
  client: SupabaseClient,
  providerPlaceIds: string[],
): Promise<Map<string, { canonicalPlaceId: string; provider: string }>> {
  const result = new Map<string, { canonicalPlaceId: string; provider: string }>();
  const ids = [...new Set(providerPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('place_provider_links')
      .select('provider, provider_place_id, canonical_place_id')
      .in('provider_place_id', ids);
    if (error || !data) return result;
    const ambiguous = new Set<string>();
    for (const row of data) {
      const providerPlaceId = String(row.provider_place_id || '');
      const canonicalPlaceId = String(row.canonical_place_id || '');
      const provider = String(row.provider || '');
      if (!providerPlaceId || !canonicalPlaceId || !provider) continue;
      const held = result.get(providerPlaceId);
      if (held && held.canonicalPlaceId !== canonicalPlaceId) {
        ambiguous.add(providerPlaceId);
        continue;
      }
      if (!held) result.set(providerPlaceId, { canonicalPlaceId, provider });
    }
    for (const id of ambiguous) result.delete(id);
  } catch {
    // Best-effort: an unresolved id simply produces no reference.
  }
  return result;
}

/**
 * The canonical record behind a place, for presentation.
 *
 * This is where a card's name, city and area come from — not from the model,
 * and not from whatever a candidate happened to be called on the run that
 * found it. A corrected spelling here shows on every surface at once.
 */
export async function readCanonicalPlaceRecords(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Map<string, {
  name: string;
  city?: string;
  area?: string;
  coordinates?: [number, number];
}>> {
  const result = new Map<string, { name: string; city?: string; area?: string; coordinates?: [number, number] }>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('canonical_places')
      .select('id, primary_name, city, neighbourhood, latitude, longitude')
      .in('id', ids);
    if (error || !data) return result;
    for (const row of data) {
      const name = typeof row.primary_name === 'string' ? row.primary_name.trim() : '';
      if (!row.id || !name) continue;
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      result.set(String(row.id), {
        name,
        city: typeof row.city === 'string' && row.city.trim() ? row.city.trim() : undefined,
        area: typeof row.neighbourhood === 'string' && row.neighbourhood.trim()
          ? row.neighbourhood.trim()
          : undefined,
        coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined,
      });
    }
  } catch {
    // Best-effort: without a record there is no card to render.
  }
  return result;
}

/**
 * Canonical coordinates for places already linked, keyed by canonical id.
 *
 * Image validation compares a Wikidata entity's location against the place it
 * claims to depict, and that comparison has to be made against a coordinate the
 * server trusts. Taking it from the request body would let a caller approve any
 * photograph for any place simply by sending coordinates that agree with it.
 */
export async function readCanonicalPlaceCoordinates(
  client: SupabaseClient,
  canonicalPlaceIds: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>();
  const ids = [...new Set(canonicalPlaceIds)].filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const { data, error } = await client
      .from('canonical_places')
      .select('id, latitude, longitude')
      .in('id', ids);
    if (error || !data) return result;
    for (const row of data) {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      if (row.id && Number.isFinite(lat) && Number.isFinite(lng)) {
        result.set(String(row.id), { lat, lng });
      }
    }
  } catch {
    // Best effort: without a coordinate the entity check falls back to type.
  }
  return result;
}

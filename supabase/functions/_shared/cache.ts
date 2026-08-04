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
import { routePairKey } from './cacheKeys.ts';

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

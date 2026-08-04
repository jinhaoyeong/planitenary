import { json, preflight, ProviderError, fetchJson, expiryFor } from '../_shared/providers.ts';
import { readWeatherCache, serviceClient, type WeatherCacheRow, writeWeatherCache } from '../_shared/cache.ts';
import { enumerateDates, weatherLocationKey } from '../_shared/cacheKeys.ts';

interface WeatherBody {
  latitude?: number;
  longitude?: number;
  startDate?: string;
  endDate?: string;
  travelStartsInDays?: number;
}

/** Daily fields we request and cache. `time` is handled separately as the key. */
const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
] as const;

type DailyRecord = Record<string, unknown[]> & { time?: unknown[] };

/** Reassemble the Open-Meteo response shape the client expects from per-day rows. */
function reassemble(dates: string[], byDate: Map<string, Record<string, unknown>>) {
  const daily: Record<string, unknown[]> = { time: [...dates] };
  for (const field of DAILY_FIELDS) daily[field] = dates.map((date) => byDate.get(date)?.[field] ?? null);
  return { provider: 'open-meteo', payload: { daily }, cached: true };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = (await request.json().catch(() => ({}))) as WeatherBody;
  if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
    return json({ error: 'Latitude and longitude are required.' }, 400);
  }
  const startDate = body.startDate || new Date().toISOString().slice(0, 10);
  const endDate = body.endDate || startDate;
  const locationKey = weatherLocationKey([body.latitude as number, body.longitude as number]);
  const dates = enumerateDates(startDate, endDate);
  const cache = serviceClient();
  const expiresAt = expiryFor('weather', body.travelStartsInDays);

  // Read-through: if every requested day is cached and fresh, skip the provider.
  if (cache && dates.length > 0) {
    const cachedDays = await readWeatherCache(cache, locationKey, dates);
    if (dates.every((date) => cachedDays.has(date))) {
      return json({ ...reassemble(dates, cachedDays), expiresAt });
    }
  }

  try {
    const params = new URLSearchParams({
      latitude: String(body.latitude),
      longitude: String(body.longitude),
      timezone: 'auto',
      start_date: startDate,
      end_date: endDate,
      daily: DAILY_FIELDS.join(','),
    });
    const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`) as { daily?: DailyRecord };

    // Write-through: split the daily arrays into one cache row per date.
    const daily = payload?.daily;
    if (cache && daily && Array.isArray(daily.time)) {
      const rows: WeatherCacheRow[] = daily.time
        .map((date, index) => ({
          location_key: locationKey,
          forecast_date: String(date),
          payload: Object.fromEntries(DAILY_FIELDS.map((field) => [field, daily[field]?.[index] ?? null])),
          expires_at: expiresAt,
        }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.forecast_date));
      await writeWeatherCache(cache, rows);
    }

    return json({ provider: 'open-meteo', payload, cached: false, expiresAt });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Weather request failed.' }, status);
  }
});

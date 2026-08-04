import { json, preflight, ProviderError, fetchJson, expiryFor } from '../_shared/providers.ts';

interface WeatherBody {
  latitude?: number;
  longitude?: number;
  startDate?: string;
  endDate?: string;
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
  try {
    const params = new URLSearchParams({
      latitude: String(body.latitude),
      longitude: String(body.longitude),
      timezone: 'auto',
      start_date: startDate,
      end_date: endDate,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    });
    const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    return json({ provider: 'open-meteo', payload, expiresAt: expiryFor('weather', 7) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Weather request failed.' }, status);
  }
});

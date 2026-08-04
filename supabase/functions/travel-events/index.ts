import { expiryFor, fetchJson, json, preflight, ProviderError } from '../_shared/providers.ts';

interface EventsBody {
  city?: string;
  countryCode?: string;
  startDate?: string;
  endDate?: string;
  latitude?: number;
  longitude?: number;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = (await request.json().catch(() => ({}))) as EventsBody;
  if (!body.city) return json({ error: 'A city is required.' }, 400);
  const key = Deno.env.get('TICKETMASTER_API_KEY')?.trim();
  if (!key) return json({ error: 'Events are not configured.' }, 503);
  try {
    const params = new URLSearchParams({
      apikey: key,
      city: body.city,
      size: '50',
      sort: 'date,asc',
      startDateTime: `${body.startDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`,
      endDateTime: `${body.endDate || body.startDate || new Date().toISOString().slice(0, 10)}T23:59:59Z`,
    });
    const payload = await fetchJson(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
    return json({ provider: 'ticketmaster', events: (payload as { _embedded?: { events?: unknown[] } })._embedded?.events || [], expiresAt: expiryFor('events', 7) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Events request failed.' }, status);
  }
});

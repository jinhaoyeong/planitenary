/**
 * Real travel times between shortlisted places.
 *
 * Called only after a shortlist exists — a full matrix over every discovered
 * candidate would be both slow and expensive. When the provider cannot answer,
 * this returns `status: 'unknown'` rather than a guess, so the client falls
 * back to a clearly-labelled straight-line estimate instead of silently
 * presenting an invented duration as routing.
 */
import { expiryFor, fetchJson, json, preflight, ProviderError, secrets } from '../_shared/providers.ts';

interface Point { placeId?: string; coordinates?: [number, number] }

interface MatrixBody {
  origins?: Point[];
  destinations?: Point[];
  mode?: 'walking' | 'public-transport' | 'driving' | 'cycling';
  departureTime?: string;
  travelStartsInDays?: number;
}

const TRAVEL_MODES: Record<string, string> = {
  walking: 'WALK',
  'public-transport': 'TRANSIT',
  driving: 'DRIVE',
  cycling: 'BICYCLE',
};

const waypoint = (point: Point) => {
  if (point.placeId) return { waypoint: { placeId: point.placeId } };
  if (point.coordinates) {
    return {
      waypoint: {
        location: { latLng: { latitude: point.coordinates[0], longitude: point.coordinates[1] } },
      },
    };
  }
  throw new ProviderError('Each point needs a placeId or coordinates.', 400);
};

interface MatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await request.json().catch(() => ({}))) as MatrixBody;
  const origins = body.origins || [];
  const destinations = body.destinations || [];
  if (origins.length === 0 || destinations.length === 0) {
    return json({ error: 'Origins and destinations are required.' }, 400);
  }
  // Guard the cost envelope: this is a billed, quadratic call.
  if (origins.length * destinations.length > 625) {
    return json({ error: 'Shortlist the places before requesting a matrix.' }, 400);
  }

  const key = secrets.google();
  if (!key) return json({ error: 'Routing is not configured.' }, 503);

  const mode = TRAVEL_MODES[body.mode || 'public-transport'] || 'TRANSIT';

  try {
    const payload = await fetchJson('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: origins.map(waypoint),
        destinations: destinations.map(waypoint),
        travelMode: mode,
        ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
        ...(body.departureTime ? { departureTime: body.departureTime } : {}),
      }),
    }, 15_000);

    // Start from "unknown" everywhere, then fill in what the provider answered.
    // A missing element must stay unknown rather than defaulting to zero.
    const matrix = origins.map(() => destinations.map(() => ({
      status: 'unknown' as const,
      source: 'provider' as const,
    })));

    for (const element of (payload as MatrixElement[]) || []) {
      const { originIndex: i, destinationIndex: j } = element;
      if (i === undefined || j === undefined || !matrix[i]?.[j]) continue;
      if (element.condition !== 'ROUTE_EXISTS' || !element.duration) continue;
      const seconds = Number.parseInt(element.duration.replace('s', ''), 10);
      if (!Number.isFinite(seconds)) continue;
      matrix[i][j] = {
        status: 'ok',
        source: 'provider',
        durationMinutes: Math.round(seconds / 60),
        distanceMeters: element.distanceMeters,
      } as never;
    }

    return json({ matrix, expiresAt: expiryFor('routeMatrix', body.travelStartsInDays) });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Routing failed.' }, status);
  }
});

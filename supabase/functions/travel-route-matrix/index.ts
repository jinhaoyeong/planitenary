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
import { parseAmapWalkingRoute, parseBaiduWalkingRoute } from '../_shared/regionalRoutes.ts';
import { readRouteCache, type RouteCacheRow, serviceClient, writeRouteCache } from '../_shared/cache.ts';
import { pairsNeedingProvider, routePairKey, routePointKey } from '../_shared/cacheKeys.ts';
import { providerModeFor, sameRoutingPoint } from '../_shared/routingProvider.ts';

interface Point { placeId?: string; coordinates?: [number, number] }

interface MatrixBody {
  origins?: Point[];
  destinations?: Point[];
  mode?: 'walking' | 'public-transport' | 'driving' | 'cycling';
  departureTime?: string;
  travelStartsInDays?: number;
  provider?: 'google' | 'openrouteservice' | 'amap' | 'baidu';
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

const coordinate = (point: Point, provider: 'amap' | 'baidu') => {
  if (!point.coordinates) throw new ProviderError('Regional routes require coordinates.', 400);
  const [latitude, longitude] = point.coordinates;
  return provider === 'amap' ? `${longitude},${latitude}` : `${latitude},${longitude}`;
};

async function regionalRoute(origin: Point, destination: Point, provider: 'amap' | 'baidu') {
  if (provider === 'amap') {
    const key = secrets.amap();
    if (!key) throw new ProviderError('Amap routing is not configured.', 503);
    const params = new URLSearchParams({
      key,
      origin: coordinate(origin, provider),
      destination: coordinate(destination, provider),
      output: 'JSON',
    });
    const payload = await fetchJson(`https://restapi.amap.com/v5/direction/walking?${params}`, {}, 8000);
    return parseAmapWalkingRoute(payload);
  }

  const key = secrets.baidu();
  if (!key) throw new ProviderError('Baidu routing is not configured.', 503);
  const params = new URLSearchParams({
    ak: key,
    origin: coordinate(origin, provider),
    destination: coordinate(destination, provider),
  });
  const payload = await fetchJson(`https://api.map.baidu.com/directionlite/v1/walking?${params}`, {}, 8000);
  return parseBaiduWalkingRoute(payload);
}

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
  const requestedMode = body.mode || 'public-transport';
  const mode = TRAVEL_MODES[requestedMode] || 'TRANSIT';
  // Google permits up to 625 elements for ordinary matrices, but transit
  // matrices are limited to 100 origin/destination combinations.
  const maxElements = mode === 'TRANSIT' ? 100 : 625;
  if (origins.length * destinations.length > maxElements) {
    return json({
      error: mode === 'TRANSIT'
        ? 'Transit route matrices are limited to 100 elements; shortlist no more than 10 places.'
        : 'Shortlist the places before requesting a matrix.',
    }, 400);
  }

  const regionalProvider = body.provider === 'amap' || body.provider === 'baidu' ? body.provider : undefined;
  const requestedOpenRouteService = body.provider === 'openrouteservice';
  const requestedGoogle = body.provider === 'google';

  if (regionalProvider && requestedMode !== 'walking') {
    return json({
      error: 'route-unavailable',
      code: 'route-unavailable',
      provider: regionalProvider,
      requestedMode,
      providerMode: null,
      detail: 'Regional providers currently support walking routes only in Planitenary.',
    }, 422);
  }

  const key = secrets.google();
  const orsKey = secrets.openRouteService();
  if (requestedOpenRouteService && !orsKey) {
    return json({ error: 'OpenRouteService routing is not configured.' }, 503);
  }
  if (requestedGoogle && !key) return json({ error: 'Google routing is not configured.' }, 503);
  if (!regionalProvider && !requestedOpenRouteService && !requestedGoogle && !key && !orsKey) {
    return json({ error: 'Routing is not configured.' }, 503);
  }
  const useOpenRouteService = requestedOpenRouteService || (!requestedGoogle && !key && Boolean(orsKey));
  const orsProfile = providerModeFor('openrouteservice', requestedMode);
  if (useOpenRouteService && !orsProfile) {
    return json({
      error: 'route-unavailable',
      code: 'route-unavailable',
      provider: 'openrouteservice',
      requestedMode,
      providerMode: null,
      detail: `Hosted OpenRouteService does not support ${requestedMode} in Planitenary.`,
    }, 422);
  }
  const selectedProvider = regionalProvider ?? (useOpenRouteService ? 'openrouteservice' : 'google');
  const providerMode = regionalProvider === 'amap' || regionalProvider === 'baidu'
    ? 'walking'
    : useOpenRouteService
      ? orsProfile
      : mode;

  // Cache identity for every endpoint. Points without a placeId or coordinates
  // cannot be cached, so they read as permanent misses rather than a bad key.
  const cache = serviceClient();
  const cacheMode = regionalProvider ? 'walking' : mode;
  const originKeys = origins.map(routePointKey);
  const destinationKeys = destinations.map(routePointKey);
  const cacheExpiry = expiryFor('routeMatrix', body.travelStartsInDays);

  try {
    if (regionalProvider) {
      // Amap/Baidu expose point-to-point directions rather than Google-style
      // matrices. Keep the cost bounded and leave the rest explicitly unknown.
      const matrix = origins.map(() => destinations.map(() => ({ status: 'unknown' as const, source: regionalProvider as 'provider' })));
      const maxRegionalPairs = 100;

      // Read-through: prefill from cache and only fetch the pairs still missing.
      const cached = cache
        ? await readRouteCache(
          cache,
          originKeys.filter((entry): entry is string => Boolean(entry)),
          destinationKeys.filter((entry): entry is string => Boolean(entry)),
          cacheMode,
        )
        : new Map();

      const pairs: Array<{ originIndex: number; destinationIndex: number }> = [];
      for (let originIndex = 0; originIndex < origins.length; originIndex += 1) {
        for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex += 1) {
          if (sameRoutingPoint(origins[originIndex], destinations[destinationIndex])) {
            matrix[originIndex][destinationIndex] = { status: 'ok', source: regionalProvider, durationMinutes: 0, distanceMeters: 0 } as never;
            continue;
          }
          const oKey = originKeys[originIndex];
          const dKey = destinationKeys[destinationIndex];
          const hit = oKey && dKey ? cached.get(routePairKey(oKey, dKey)) : undefined;
          if (hit) {
            matrix[originIndex][destinationIndex] = { status: 'ok', source: 'cache', ...hit } as never;
            continue;
          }
          if (pairs.length < maxRegionalPairs) pairs.push({ originIndex, destinationIndex });
        }
      }

      let failedPairs = 0;
      const freshRows: RouteCacheRow[] = [];
      for (let offset = 0; offset < pairs.length; offset += 8) {
        const batch = pairs.slice(offset, offset + 8);
        const results = await Promise.all(batch.map(async ({ originIndex, destinationIndex }) => {
          try {
            return { originIndex, destinationIndex, route: await regionalRoute(origins[originIndex], destinations[destinationIndex], regionalProvider) };
          } catch {
            failedPairs += 1;
            return { originIndex, destinationIndex, route: null };
          }
        }));
        results.forEach(({ originIndex, destinationIndex, route }) => {
          if (!route) return;
          matrix[originIndex][destinationIndex] = { status: 'ok', source: 'provider', ...route } as never;
          const oKey = originKeys[originIndex];
          const dKey = destinationKeys[destinationIndex];
          if (oKey && dKey) {
            freshRows.push({ origin_key: oKey, destination_key: dKey, mode: cacheMode, duration_minutes: route.durationMinutes, distance_meters: route.distanceMeters, expires_at: cacheExpiry });
          }
        });
      }
      if (cache) await writeRouteCache(cache, freshRows);

      return json({ matrix, provider: regionalProvider, requestedMode, providerMode, cached: pairs.length === 0, partial: origins.length * destinations.length > maxRegionalPairs, failedPairs, expiresAt: cacheExpiry });
    }

    // Read-through: build the matrix from cache first. If every needed pair is
    // already cached (the common "preview the same shortlist again" case), the
    // billed Google matrix call is skipped entirely.
    const cachedRoutes = cache
      ? await readRouteCache(
        cache,
        originKeys.filter((entry): entry is string => Boolean(entry)),
        destinationKeys.filter((entry): entry is string => Boolean(entry)),
        cacheMode,
      )
      : new Map();

    const matrix = origins.map(() => destinations.map(() => ({
      status: 'unknown' as const,
      source: 'provider' as const,
    })));
    origins.forEach((_, i) => destinations.forEach((__, j) => {
      const oKey = originKeys[i];
      const dKey = destinationKeys[j];
      if (sameRoutingPoint(origins[i], destinations[j])) {
        matrix[i][j] = { status: 'ok', source: 'cache', durationMinutes: 0, distanceMeters: 0 } as never;
        return;
      }
      const hit = oKey && dKey ? cachedRoutes.get(routePairKey(oKey, dKey)) : undefined;
      if (hit) matrix[i][j] = { status: 'ok', source: 'cache', ...hit } as never;
    }));

    const cachedSet = new Set(cachedRoutes.keys());
    const { complete } = pairsNeedingProvider(
      originKeys,
      destinationKeys,
      cachedSet,
      (originIndex, destinationIndex) => sameRoutingPoint(origins[originIndex], destinations[destinationIndex]),
    );
    if (complete) {
      return json({ matrix, cached: true, provider: selectedProvider, requestedMode, providerMode, expiresAt: cacheExpiry });
    }

    // OpenRouteService: the keyless-adjacent path. Free tier, hard-capped, and
    // it returns 429 rather than an invoice when the cap is reached.
    if (useOpenRouteService && orsKey) {
      // ORS routes coordinates only — it has no notion of a provider place id.
      const points = [...origins, ...destinations];
      if (points.some((point) => !point.coordinates)) {
        return json({ error: 'OpenRouteService routing requires coordinates for every point.' }, 400);
      }
      // One flat location list, indexed into by sources and destinations.
      const locations = points.map((point) => [point.coordinates![1], point.coordinates![0]]);
      const sourceIndices = origins.map((_, index) => index);
      const destinationIndices = destinations.map((_, index) => origins.length + index);

      const orsPayload = await fetchJson(`https://api.heigit.org/openrouteservice/v2/matrix/${orsProfile}`, {
        method: 'POST',
        headers: { Authorization: orsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations,
          sources: sourceIndices,
          destinations: destinationIndices,
          metrics: ['duration', 'distance'],
        }),
      }, 15_000) as { durations?: Array<Array<number | null>>; distances?: Array<Array<number | null>> } | null;

      const durations = orsPayload?.durations || [];
      const distances = orsPayload?.distances || [];
      const orsRows: RouteCacheRow[] = [];
      origins.forEach((_, i) => destinations.forEach((__, j) => {
        const seconds = durations[i]?.[j];
        const metres = distances[i]?.[j];
        // A null cell means no route exists — that is unknown, never zero.
        if (typeof seconds !== 'number' || typeof metres !== 'number') return;
        const durationMinutes = Math.round(seconds / 60);
        const distanceMeters = Math.round(metres);
        matrix[i][j] = { status: 'ok', source: 'provider', durationMinutes, distanceMeters } as never;
        const oKey = originKeys[i];
        const dKey = destinationKeys[j];
        if (oKey && dKey && oKey !== dKey) {
          orsRows.push({ origin_key: oKey, destination_key: dKey, mode: cacheMode, duration_minutes: durationMinutes, distance_meters: distanceMeters, expires_at: cacheExpiry });
        }
      }));
      if (cache) await writeRouteCache(cache, orsRows);

      return json({ matrix, cached: false, provider: 'openrouteservice', requestedMode, providerMode: orsProfile, expiresAt: cacheExpiry });
    }

    // Reaching here means Google is the chosen provider: the regional and ORS
    // paths have both returned, and the no-provider case was rejected up front.
    // Stated explicitly so the invariant survives the next branch added above.
    if (!key) return json({ error: 'Routing is not configured.' }, 503);

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

    // Fill in what the provider answered, overwriting the cache prefill where a
    // fresh answer exists. A missing element stays whatever the cache had (or
    // "unknown"), never defaulting to zero.
    const freshRows: RouteCacheRow[] = [];
    for (const element of (payload as MatrixElement[]) || []) {
      const { originIndex: i, destinationIndex: j } = element;
      if (i === undefined || j === undefined || !matrix[i]?.[j]) continue;
      if (element.condition !== 'ROUTE_EXISTS' || !element.duration) continue;
      const seconds = Number.parseInt(element.duration.replace('s', ''), 10);
      if (!Number.isFinite(seconds) || typeof element.distanceMeters !== 'number') continue;
      const durationMinutes = Math.round(seconds / 60);
      matrix[i][j] = { status: 'ok', source: 'provider', durationMinutes, distanceMeters: element.distanceMeters } as never;
      const oKey = originKeys[i];
      const dKey = destinationKeys[j];
      if (oKey && dKey && oKey !== dKey) {
        freshRows.push({ origin_key: oKey, destination_key: dKey, mode: cacheMode, duration_minutes: durationMinutes, distance_meters: element.distanceMeters, expires_at: cacheExpiry });
      }
    }
    if (cache) await writeRouteCache(cache, freshRows);

    return json({ matrix, cached: false, provider: 'google', requestedMode, providerMode: mode, expiresAt: cacheExpiry });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return json({ error: error instanceof Error ? error.message : 'Routing failed.' }, status);
  }
});

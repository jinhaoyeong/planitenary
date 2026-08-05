/**
 * Shared provider plumbing for the travel intelligence functions.
 *
 * Every external key is read from Deno.env here and never leaves the server.
 * The browser learns only *which* providers are connected — never their
 * credentials — via `travel-capabilities`.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Routes API computeRouteMatrix returns one JSON RouteMatrixElement per line
 * when the response contains multiple origin/destination pairs. Accept both
 * that newline-delimited stream and ordinary JSON responses used by the other
 * providers.
 */
const parseJsonResponse = (responseText: string): unknown => {
  try {
    return JSON.parse(responseText);
  } catch (singleDocumentError) {
    const lines = responseText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) throw singleDocumentError;
    try {
      return lines.map((line) => JSON.parse(line));
    } catch {
      throw singleDocumentError;
    }
  }
};

export const preflight = (request: Request) =>
  request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;

const env = (name: string): string | undefined => {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : undefined;
};

/** Secrets, resolved once. Absent secret means that provider is simply off. */
export const secrets = {
  google: () => env('GOOGLE_MAPS_API_KEY'),
  // Google Cloud uses one API key for the enabled Places, Routes,
  // Geocoding and YouTube Data APIs. Keep provider access server-side and
  // avoid requiring a second YouTube-specific secret.
  youtube: () => env('GOOGLE_MAPS_API_KEY'),
  tripadvisor: () => env('TRIPADVISOR_API_KEY'),
  amap: () => env('AMAP_API_KEY'),
  baidu: () => env('BAIDU_API_KEY'),
  weather: () => env('WEATHER_API_KEY'),
  ticketmaster: () => env('TICKETMASTER_API_KEY'),
  tiktokPartner: () => env('TIKTOK_PARTNER_TOKEN'),
  douyinPartner: () => env('DOUYIN_PARTNER_TOKEN'),
  rednotePartner: () => env('REDNOTE_PARTNER_TOKEN'),
  gemini: () => env('GEMINI_API_KEY'),
};

/**
 * What the client is allowed to know. Booleans only — this response is the
 * single place the capability model gets its truth, and it must never carry a
 * key, a quota or an endpoint.
 */
export function capabilitySnapshot() {
  const google = Boolean(secrets.google());
  return {
    googlePlaces: google,
    // Routes is verified separately by the capability endpoint. A key being
    // present is not proof that the Routes API is enabled or billable.
    googleRoutes: false,
    googleReviews: google,
    youtube: Boolean(secrets.youtube()),
    tripadvisor: Boolean(secrets.tripadvisor()),
    // Official-source fetching needs no third-party key.
    officialSources: true,
    // Weather uses the public Open-Meteo API; no key is required.
    weather: true,
    events: Boolean(secrets.ticketmaster()),
    amap: Boolean(secrets.amap()),
    baidu: Boolean(secrets.baidu()),
    tiktokPartner: Boolean(secrets.tiktokPartner()),
    douyinPartner: Boolean(secrets.douyinPartner()),
    rednotePartner: Boolean(secrets.rednotePartner()),
    aiReasoning: Boolean(secrets.gemini()),
  };
}

/** Fail fast and loudly rather than returning a plausible-looking guess. */
export class ProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Fetch with a hard timeout, so one slow provider cannot hang a request. */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const responseText = await response.text();
    if (!response.ok) {
      let detail = '';
      try {
        const payload = JSON.parse(responseText) as { error?: { message?: string } | string };
        const providerMessage = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        if (providerMessage) detail = `: ${providerMessage.slice(0, 240)}`;
      } catch {
        const plain = responseText.trim().replace(/\s+/g, ' ');
        if (plain) detail = `: ${plain.slice(0, 240)}`;
      }
      throw new ProviderError(`Provider responded ${response.status}${detail}`, response.status === 429 ? 429 : 502);
    }
    return responseText ? parseJsonResponse(responseText) : null;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(error instanceof Error ? error.message : 'Provider request failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the Routes API is enabled is a deployment fact, not a per-request one:
 * it changes when someone edits the Cloud console, not between page loads. The
 * probe is a real, billable Routes call, so re-running it for every capability
 * request means paying repeatedly to re-learn the same answer.
 *
 * Held in module scope, which an Edge Function instance reuses across requests.
 * A cold start re-probes, which is the correct trade: at most one call per
 * instance per hour rather than one per capability request.
 */
let routesProbe: { value: boolean; checkedAt: number } | null = null;
const ROUTES_PROBE_TTL_MS = 60 * 60 * 1000;

/** Test seam: drop the memoised probe result. */
export const resetGoogleRoutesProbe = () => { routesProbe = null; };

/**
 * Verify Routes with fixed public coordinates, never user-supplied locations.
 * This prevents a configured-but-disabled Routes API from being presented as
 * live while keeping health checks free of private trip data.
 */
export async function probeGoogleRoutes(): Promise<boolean> {
  const key = secrets.google();
  if (!key) return false;
  if (routesProbe && Date.now() - routesProbe.checkedAt < ROUTES_PROBE_TTL_MS) return routesProbe.value;
  try {
    await fetchJson('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: -37.8179789, longitude: 144.9690576 } } } }],
        destinations: [{ waypoint: { location: { latLng: { latitude: -37.8136, longitude: 144.9631 } } } }],
        travelMode: 'WALK',
      }),
    }, 5000);
    routesProbe = { value: true, checkedAt: Date.now() };
    return true;
  } catch {
    // A negative result is cached too. Without that, a deployment with Routes
    // disabled retries the failing (still billable) call on every request.
    routesProbe = { value: false, checkedAt: Date.now() };
    return false;
  }
}

/**
 * Cache lifetimes, in seconds. Travel data rots at very different rates, and
 * everything gets shorter as departure approaches.
 */
export const FRESHNESS_SECONDS = {
  placeIdentity: { normal: 30 * 86_400, nearTravel: 7 * 86_400 },
  reviewSummary: { normal: 7 * 86_400, nearTravel: 86_400 },
  trend: { normal: 86_400, nearTravel: 6 * 3600 },
  openingHours: { normal: 7 * 86_400, nearTravel: 86_400 },
  closures: { normal: 86_400, nearTravel: 3600 },
  routeMatrix: { normal: 86_400, nearTravel: 1800 },
  weather: { normal: 6 * 3600, nearTravel: 1800 },
  events: { normal: 86_400, nearTravel: 6 * 3600 },
} as const;

export type FreshnessKind = keyof typeof FRESHNESS_SECONDS;

/** Within a week of travel we refresh far more aggressively. */
export function expiryFor(kind: FreshnessKind, travelStartsInDays?: number): string {
  const window = FRESHNESS_SECONDS[kind];
  const nearTravel = typeof travelStartsInDays === 'number' && travelStartsInDays <= 7;
  const seconds = nearTravel ? window.nearTravel : window.normal;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

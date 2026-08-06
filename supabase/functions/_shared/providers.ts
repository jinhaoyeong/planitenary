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
  /**
   * YouTube Data API v3, on its own key.
   *
   * Previously this aliased the Maps key, which tied video evidence to a
   * project that could be billed. YouTube's 10,000 unit/day quota needs no
   * payment method at all, so its key belongs to a Cloud project with **no
   * billing account attached** — which makes it structurally incapable of
   * charging, rather than merely unlikely to.
   *
   * The Maps key remains a fallback so an existing deployment keeps working.
   */
  youtube: () => env('YOUTUBE_API_KEY') || env('GOOGLE_MAPS_API_KEY'),
  /**
   * Reddit, via an app-only OAuth client (a free "script" app).
   *
   * The unauthenticated `.json` endpoints are not usable here: Reddit rate
   * limits and increasingly blocks anonymous requests from cloud IPs, which is
   * exactly where Edge Functions run. Credentials are free and the quota is
   * generous; absent them, Reddit simply reports as unavailable.
   */
  redditClientId: () => env('REDDIT_CLIENT_ID'),
  redditClientSecret: () => env('REDDIT_CLIENT_SECRET'),
  tripadvisor: () => env('TRIPADVISOR_API_KEY'),
  openRouteService: () => env('OPENROUTESERVICE_API_KEY'),
  /**
   * Overpass needs no key, but the endpoint is overridable: the public
   * instances are a shared community resource, and any deployment doing real
   * volume should point at its own.
   */
  overpassEndpoint: () => env('OVERPASS_ENDPOINT') || 'https://overpass-api.de/api/interpreter',
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
    // OpenStreetMap and Wikivoyage need no credentials and have no billing
    // path at all, so this deployment can always offer them.
    osm: true,
    openRouteService: Boolean(secrets.openRouteService()),
    youtube: Boolean(secrets.youtube()),
    reddit: Boolean(secrets.redditClientId() && secrets.redditClientSecret()),
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
 * Fetch a page as text, with a hard timeout and a hard size cap.
 *
 * Used for official venue websites, whose addresses come from community-edited
 * map data. A page there can be any size at all, so the read is capped rather
 * than trusted: without it, one enormous or endless response would exhaust the
 * function. Only HTML is accepted, so a link to a large binary is dropped
 * before any of it is read.
 */
export async function fetchText(
  url: string,
  timeoutMs = 10_000,
  maxBytes = 512_000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Planitenary/1.0 (travel itinerary planner)' },
    });
    if (!response.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; }
    }
    // Stop the transfer rather than draining a page that overruns the cap.
    await reader.cancel().catch(() => {});

    const merged = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= merged.length) break;
      merged.set(chunk.subarray(0, merged.length - offset), offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reddit requires a descriptive User-Agent naming the app and will throttle or
 * block traffic that does not identify itself.
 */
export const REDDIT_USER_AGENT = 'web:planitenary:1.0 (travel itinerary planner)';

/**
 * App-only OAuth token, memoised for its lifetime.
 *
 * Reddit issues these for ~24 hours. Fetching one per evidence request would
 * spend a request on authentication for every request of substance, so the
 * token is held in module scope — which an Edge Function instance reuses —
 * and refreshed a little early to avoid racing its own expiry.
 */
let redditToken: { value: string; expiresAt: number } | null = null;

/** Test seam: drop the memoised Reddit token. */
export const resetRedditToken = () => { redditToken = null; };

export async function redditAccessToken(): Promise<string | null> {
  const id = secrets.redditClientId();
  const secret = secrets.redditClientSecret();
  if (!id || !secret) return null;
  if (redditToken && redditToken.expiresAt > Date.now()) return redditToken.value;

  try {
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) return null;
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;
    const lifetimeSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    redditToken = {
      value: payload.access_token,
      // Refreshed five minutes early so a long request cannot outlive its token.
      expiresAt: Date.now() + Math.max(60, lifetimeSeconds - 300) * 1000,
    };
    return redditToken.value;
  } catch {
    // Evidence is optional; a failed sign-in must not break discovery.
    return null;
  }
}

/**
 * YouTube's `search.list` allowance.
 *
 * The Data API grants 10,000 quota units a day *and* 100 search queries a day.
 * A search costs 100 units, so the two run out together — but the search count
 * is the one worth reasoning about, because it maps directly to places: 100
 * searches is 100 places.
 *
 * The default sits below 100 on purpose. The margin covers the calls already in
 * flight when the cap is reached, and leaves room to test without locking the
 * app out for the rest of the day. Override with `YOUTUBE_DAILY_SEARCH_LIMIT`.
 */
export const youtubeSearchLimit = (): number => {
  const configured = Number(env('YOUTUBE_DAILY_SEARCH_LIMIT'));
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 90;
};

/** Google resets Data API quotas at midnight Pacific, not UTC. */
export const YOUTUBE_QUOTA_TIMEZONE = 'America/Los_Angeles';
/** One `search.list` call. Published cost, used for reporting only. */
export const YOUTUBE_SEARCH_UNITS = 100;

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

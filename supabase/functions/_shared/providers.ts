/**
 * Shared provider plumbing for the travel intelligence functions.
 *
 * Every external key is read from Deno.env here and never leaves the server.
 * The browser learns only *which* providers are connected — never their
 * credentials — via `travel-capabilities`.
 */

import { DEFAULT_SPEND_CEILING_USD } from './aiCost.ts';
import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_MAX_OUTPUT_TOKENS,
  openaiModelRefusal,
  type ReasoningOperation,
} from './reasoning.ts';

export {
  isReasoningOperation,
  REASONING_OPERATIONS,
  type ReasoningOperation,
} from './reasoning.ts';

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
  openai: () => env('OPENAI_API_KEY'),
};

/**
 * Which model provider the reasoning tier calls. Chosen explicitly, never
 * inferred from which key happens to be present.
 *
 * The inference version is the dangerous one. Two keys configured and a
 * provider picked by availability means an OpenAI outage — or an exhausted
 * OpenAI budget — silently starts spending on Gemini instead, which is the
 * *invisible spend* failure this project already paid for once. A provider
 * that is not selected is off, whatever credentials exist beside it.
 *
 * So there is deliberately no fallback path. `travel-reasoning` fails closed
 * and the card keeps its deterministic rationale.
 */
export type ReasoningProvider = 'openai' | 'gemini';

export const reasoningProvider = (): ReasoningProvider =>
  env('TRAVEL_REASONING_PROVIDER')?.toLowerCase() === 'gemini' ? 'gemini' : 'openai';

/**
 * The model, pinned by env so a rollout is a config change.
 *
 * Default `gpt-5-nano`: the cheapest model OpenAI publishes ($0.05/1M input,
 * $0.40/1M output) and comfortably capable of the two jobs asked of it here —
 * quoting a sentence out of supplied text, and reading a fare off a page.
 * Neither benefits from a stronger model; both are extraction, not judgement.
 */
export const openaiModel = (): string => env('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL;



/**
 * Reasoning effort, and why the default is not `none`.
 *
 * `none` is the cheapest setting and the obvious choice, but it is **not
 * accepted by every model**: `gpt-5-nano` takes `minimal | low | medium |
 * high` and rejects `none` outright, while `gpt-5.4-nano` takes `none` and
 * defaults to it. Hardcoding either one breaks the moment `OPENAI_MODEL`
 * changes, and the failure arrives as an opaque 400 from the provider rather
 * than as anything this code could explain.
 *
 * `minimal` is therefore the default: valid on the default model, and the
 * cheapest setting that is. Override with `OPENAI_REASONING_EFFORT` when
 * pinning a model that accepts `none`.
 */
export const openaiReasoningEffort = (): string => env('OPENAI_REASONING_EFFORT') || 'minimal';

/**
 * The day's allowance for the reasoning tier, shared by whichever provider is
 * selected — the cap is on *spending*, and both of them bill.
 *
 * Kept separate from the discovery counters on purpose: a busy day of
 * searching must not be able to exhaust the model budget, and a runaway model
 * loop must not be able to starve discovery. The default is low enough that a
 * misconfiguration is cheap to discover rather than expensive.
 */
export const reasoningCallLimit = (): number => {
  const configured = Number(env('AI_DAILY_CALL_LIMIT') || env('GEMINI_DAILY_CALL_LIMIT'));
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 50;
};

/**
 * The credential for the *selected* provider, or undefined.
 *
 * Reads only the one provider's key on purpose. Asking "is any model key
 * present" is how a deployment ends up calling the provider it did not choose.
 */
export const reasoningKey = (): string | undefined =>
  reasoningProvider() === 'gemini' ? secrets.gemini() : secrets.openai();

/**
 * The counter both providers share.
 *
 * Named for the tier rather than for Gemini, which the previous name tied it
 * to: the cap exists because *a model bills*, and that is true whichever one
 * is selected. Two counters would also let a provider switch quietly reset the
 * day's spending to zero.
 */
export const REASONING_QUOTA_PROVIDER = 'ai-reasoning';

/** Billing is accounted in UTC, and nothing here needs to match a reset. */
export const REASONING_QUOTA_TIMEZONE = 'UTC';

/**
 * The spending ceiling for the current prepaid budget, in USD.
 *
 * Deliberately below the balance actually loaded: a provider's prepaid cutoff
 * is not instantaneous, and the gap is what separates "the AI stopped" from
 * "the account is empty and everything else paid stopped too".
 */
export const aiBudgetUsd = (): number => {
  const configured = Number(env('AI_BUDGET_USD'));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SPEND_CEILING_USD;
};

/**
 * When the current budget started counting. Unset means "everything ever".
 *
 * Explicitly *not* a rolling window. Summing only the last N days lets old
 * spending age out, so the ceiling refills itself and a prepaid $5 can be
 * spent more than once. Starting a new budget is a deliberate act taken after
 * topping the balance up — never something the calendar does unattended.
 */
export const aiBudgetEpoch = (): string | undefined => env('AI_BUDGET_STARTED_AT');

/**
 * Everything the reasoning tier needs to make one call, resolved in one place.
 *
 * Assembled here rather than at each call site because the provider, its key,
 * its model and its effort setting have to agree with each other — an OpenAI
 * key sent with a Gemini model name is a 400, and picking the three
 * separately at three call sites is how they drift apart.
 *
 * Returns `undefined` when the selected provider has no key, so a caller
 * cannot accidentally call with an empty credential.
 */
export interface ResolvedReasoning {
  apiKey: string;
  provider: ReasoningProvider;
  model: string;
  reasoningEffort?: string;
  maxOutputTokens: number;
}

/**
 * Three outcomes, deliberately not two.
 *
 * "No model configured" and "a model is configured wrongly" are different
 * facts and must not share a value: the first is an ordinary deployment where
 * cards keep their deterministic copy, the second is somebody's mistake that
 * nobody will find if it renders identically. This is the same distinction
 * `usageToday` draws between an unused counter and an unreachable one, and it
 * exists for the same reason.
 */
export type ReasoningResolution =
  | { status: 'ready'; options: ResolvedReasoning }
  | { status: 'unconfigured' }
  | { status: 'misconfigured'; error: string };

export function resolveReasoning(operation: ReasoningOperation): ReasoningResolution {
  const apiKey = reasoningKey();
  if (!apiKey) return { status: 'unconfigured' };

  const provider = reasoningProvider();
  const maxOutputTokens = OPENAI_MAX_OUTPUT_TOKENS[operation];

  if (provider === 'gemini') {
    // The OpenAI allowlist governs OPENAI_MODEL and nothing else; selecting
    // Gemini must not be blocked by a setting that does not apply to it.
    return { status: 'ready', options: { apiKey, provider, model: geminiModel(), maxOutputTokens } };
  }

  const refusal = openaiModelRefusal(operation, openaiModel());
  if (refusal) return { status: 'misconfigured', error: refusal };

  return {
    status: 'ready',
    options: {
      apiKey,
      provider,
      model: openaiModel(),
      reasoningEffort: openaiReasoningEffort(),
      maxOutputTokens,
    },
  };
}

/** The options, or undefined for either "off" reason. Callers wanting to
 *  report *why* should use `resolveReasoning` directly. */
export function reasoningOptions(operation: ReasoningOperation): ResolvedReasoning | undefined {
  const resolution = resolveReasoning(operation);
  return resolution.status === 'ready' ? resolution.options : undefined;
}

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
    // The selected provider's key, not "any model key". A deployment that set
    // GEMINI_API_KEY but selected OpenAI has no reasoning tier, and saying it
    // does would leave every empty brief looking like a model failure.
    aiReasoning: Boolean(reasoningKey()),
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
 * The day's allowance for the one provider that sends a bill.
 *
 * Deliberately small and deliberately separate from the discovery counters:
 * a busy day of searching must not be able to spend the model budget, and a
 * runaway model loop must not be able to starve discovery. The default is low
 * enough that a misconfiguration is cheap to discover. Override with
 * `GEMINI_DAILY_CALL_LIMIT`.
 */
export const geminiCallLimit = (): number => {
  const configured = Number(env('GEMINI_DAILY_CALL_LIMIT'));
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 50;
};

/** Billing is accounted in UTC, and nothing here needs to match a reset. */
export const GEMINI_QUOTA_TIMEZONE = 'UTC';

/** The model to call. Pinned by env so a rollout is a config change. */
export const geminiModel = (): string => env('GEMINI_MODEL') || 'gemini-2.5-flash';

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

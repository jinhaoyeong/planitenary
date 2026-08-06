/**
 * Runtime bridge between the UI and whatever discovery backend is reachable.
 *
 * The client never holds provider keys — those live in Supabase function
 * secrets. It asks the server which providers are connected, and falls back to
 * the captured fixtures (clearly labelled) when the server is unreachable or
 * nothing is configured yet.
 */

import {
  EMPTY_PROVIDER_RUNTIME,
  resolveDestinationCapability,
  type DestinationCapability,
  type ProviderRuntime,
} from './destinationCapability';
import {
  FixturePlaceDiscoveryProvider,
  getDestinationCapability as getFixtureLibrary,
  SUPPORTED_DISCOVERY_CITIES,
} from './destinationFixtures';
import type { DateAwareOpeningHours, PlaceCandidate } from './destinationIntelligence';
import {
  summarisePlaceEvidence,
  trendStrength,
  type PlaceEvidenceSummary,
  type SourceEvidence,
} from './travelEvidence';
import type { TripDestination } from './tripProfile';

/** Cached so every panel mount does not re-ask the server. */
let runtimeCache: { value: ProviderRuntime; fetchedAt: number } | null = null;
const RUNTIME_TTL_MS = 5 * 60 * 1000;

const asBoolean = (value: unknown): boolean => value === true;

function parseRuntime(payload: unknown): ProviderRuntime {
  if (!payload || typeof payload !== 'object') return EMPTY_PROVIDER_RUNTIME;
  const source = payload as Record<string, unknown>;
  return {
    googlePlaces: asBoolean(source.googlePlaces),
    googleRoutes: asBoolean(source.googleRoutes),
    googleReviews: asBoolean(source.googleReviews),
    osm: asBoolean(source.osm),
    openRouteService: asBoolean(source.openRouteService),
    reddit: asBoolean(source.reddit),
    youtube: asBoolean(source.youtube),
    tripadvisor: asBoolean(source.tripadvisor),
    officialSources: asBoolean(source.officialSources),
    weather: asBoolean(source.weather),
    events: asBoolean(source.events),
    amap: asBoolean(source.amap),
    baidu: asBoolean(source.baidu),
    tiktokPartner: asBoolean(source.tiktokPartner),
    douyinPartner: asBoolean(source.douyinPartner),
    rednotePartner: asBoolean(source.rednotePartner),
    // Fixtures ship with the client, so they are always available as a fallback.
    fixtures: true,
  };
}

/**
 * Ask the backend which providers are live. Any failure resolves to "nothing
 * connected" rather than throwing — a discovery panel must still render, and
 * an honest "not available" beats a crash.
 */
export async function loadProviderRuntime(
  invoke?: (name: string) => Promise<unknown>,
  forceRefresh = false,
): Promise<ProviderRuntime> {
  const now = Date.now();
  if (!forceRefresh && runtimeCache && now - runtimeCache.fetchedAt < RUNTIME_TTL_MS) return runtimeCache.value;
  if (!invoke) return EMPTY_PROVIDER_RUNTIME;

  try {
    const value = parseRuntime(await invoke('travel-capabilities'));
    runtimeCache = { value, fetchedAt: now };
    return value;
  } catch {
    return EMPTY_PROVIDER_RUNTIME;
  }
}

/** Test seam: drop the memoised runtime. */
export const resetProviderRuntimeCache = () => { runtimeCache = null; };

/** Resolve capability for a destination against the current runtime. */
export function capabilityFor(
  destination: Pick<TripDestination, 'city' | 'region' | 'countryCode'>,
  runtime: ProviderRuntime = EMPTY_PROVIDER_RUNTIME,
): DestinationCapability {
  return resolveDestinationCapability(destination, runtime, SUPPORTED_DISCOVERY_CITIES);
}

export interface DiscoveryOutcome {
  candidates: PlaceCandidate[];
  capability: DestinationCapability;
  /** True when the results came from a captured fixture rather than a provider. */
  usingFixture: boolean;
  /**
   * Reported wait times by candidate id, summarised from evidence. Feeds the
   * scheduler so a place with a long queue costs the day what it really costs.
   */
  queueEvidence: Record<string, number>;
  /** Per-place evidence summaries, feeding the multi-dimensional ranker. */
  evidenceSummaries: Record<string, PlaceEvidenceSummary>;
  /** Trend strength 0–1 by candidate id. */
  trends: Record<string, number>;
  /**
   * Opening hours read from the operator's own site, by candidate id. These
   * supersede whatever the map provider held: community-maintained hours go
   * stale, and an official page is the thing that can correct them.
   */
  officialHours: Record<string, DateAwareOpeningHours>;
  /**
   * When sources agree a place is best visited, by candidate id. The scheduler
   * treats this as a preference strong enough to decline a placement, so it is
   * only ever set from corroborated evidence.
   */
  bestTimeWindows: Record<string, Array<{ start: string; end: string }>>;
  /** Provider failure retained for UI diagnostics when no fallback exists. */
  providerError?: string;
}

export interface WeatherRiskDay {
  date: string;
  precipitationProbability: number;
  precipitationMillimetres: number;
  indoorRecommended: boolean;
}

export interface CurrentEventSummary {
  id: string;
  name: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  url?: string;
}

/** Normalise the provider response once; the planner only receives deterministic risk flags. */
export function parseWeatherRisk(payload: unknown): WeatherRiskDay[] {
  if (!payload || typeof payload !== 'object') return [];
  const daily = (payload as { payload?: { daily?: Record<string, unknown> } }).payload?.daily;
  if (!daily || !Array.isArray(daily.time)) return [];
  const probability = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max : [];
  const precipitation = Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum : [];
  return daily.time.map((date, index) => ({
    date: String(date),
    precipitationProbability: Number(probability[index] ?? 0),
    precipitationMillimetres: Number(precipitation[index] ?? 0),
    indoorRecommended: Number(probability[index] ?? 0) >= 60 || Number(precipitation[index] ?? 0) >= 5,
  }));
}

/** Keep event data factual and small at the planner boundary. */
export function parseCurrentEvents(payload: unknown): CurrentEventSummary[] {
  if (!payload || typeof payload !== 'object') return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event): CurrentEventSummary[] => {
    if (!event || typeof event !== 'object') return [];
    const item = event as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name : '';
    const id = typeof item.id === 'string' ? item.id : name;
    if (!name || !id) return [];
    const dates = item.dates as {
      start?: { localDate?: string; localTime?: string };
      end?: { localDate?: string; localTime?: string };
    } | undefined;
    const url = typeof item.url === 'string' ? item.url : undefined;
    return [{
      id,
      name,
      date: dates?.start?.localDate,
      startTime: dates?.start?.localTime,
      endTime: dates?.end?.localTime,
      url,
    }];
  });
}


/**
 * Fold the raw evidence documents the backend returned into per-place
 * summaries, queue times and trend scores — all keyed by *candidate id*.
 *
 * The backend keys evidence by provider place id, because that is what it
 * queried with. Everything downstream keys by candidate id, so the mapping
 * happens here, once.
 */
function digestEvidence(
  payload: unknown,
  candidates: PlaceCandidate[],
): EvidenceDigest {
  const empty = { queueEvidence: {}, evidenceSummaries: {}, trends: {}, officialHours: {}, bestTimeWindows: {} };
  if (!payload || typeof payload !== 'object') return empty;

  const documents = (payload as { documents?: unknown }).documents;
  const rawTrends = (payload as { trends?: unknown }).trends;
  const rawHours = (payload as { openingHours?: unknown }).openingHours;
  if (!Array.isArray(documents)) return empty;

  const byProviderId = new Map(
    candidates
      .filter((candidate) => candidate.providerPlaceId)
      .map((candidate) => [candidate.providerPlaceId!, candidate.id]),
  );

  const evidence = documents.filter(
    (document): document is SourceEvidence =>
      Boolean(document)
      && typeof document === 'object'
      && typeof (document as SourceEvidence).canonicalPlaceId === 'string',
  );

  const queueEvidence: Record<string, number> = {};
  const evidenceSummaries: Record<string, PlaceEvidenceSummary> = {};
  const trends: Record<string, number> = {};
  const officialHours: Record<string, DateAwareOpeningHours> = {};
  const bestTimeWindows: Record<string, Array<{ start: string; end: string }>> = {};

  for (const [providerId, candidateId] of byProviderId) {
    // Hours are read even when a place produced no documents: an operator's
    // page routinely publishes hours without saying anything claim-worthy.
    const periods = (rawHours as Record<string, unknown> | undefined)?.[providerId];
    if (Array.isArray(periods) && periods.length > 0) {
      officialHours[candidateId] = {
        periods: periods as DateAwareOpeningHours['periods'],
        // The operator is the authority on their own hours.
        sourceConfidence: 'high',
      };
    }

    const summary = summarisePlaceEvidence(providerId, evidence);
    if (summary.sourceCount === 0) continue;
    evidenceSummaries[candidateId] = { ...summary, canonicalPlaceId: candidateId };

    // Require corroboration before a queue claim is allowed to reshape a day.
    if (summary.typicalQueueMinutes !== undefined && summary.sourceCount >= 2) {
      queueEvidence[candidateId] = Math.max(0, Math.round(summary.typicalQueueMinutes));
    }

    // `summarisePlaceEvidence` already demands agreement before it will name a
    // window, so anything that reaches here is corroborated.
    if (summary.bestTimeWindow) bestTimeWindows[candidateId] = [summary.bestTimeWindow];

    const trend = (rawTrends as Record<string, unknown> | undefined)?.[providerId];
    if (typeof trend === 'number' && Number.isFinite(trend)) {
      trends[candidateId] = Math.max(0, Math.min(1, trend));
    } else {
      trends[candidateId] = trendStrength(evidence.filter((item) => item.canonicalPlaceId === providerId));
    }
  }

  return { queueEvidence, evidenceSummaries, trends, officialHours, bestTimeWindows };
}

/** The empty digest, used whenever evidence is unavailable or not yet fetched. */
export const EMPTY_EVIDENCE_DIGEST: EvidenceDigest = {
  queueEvidence: {},
  evidenceSummaries: {},
  trends: {},
  officialHours: {},
  bestTimeWindows: {},
};

export type EvidenceDigest = Pick<
  DiscoveryOutcome,
  'queueEvidence' | 'evidenceSummaries' | 'trends' | 'officialHours' | 'bestTimeWindows'
>;

/**
 * Gather evidence for a specific handful of candidates.
 *
 * Deliberately *not* called for the whole shortlist at discovery time. Reviews
 * are the most expensive data the app buys and each place also costs YouTube
 * quota, so evidence is fetched for the places a traveller is actually looking
 * at. A sixty-place shortlist that the traveller abandons after four cards must
 * not cost sixty places' worth of provider calls.
 *
 * Never throws: a plan built from real places is still worth having even when
 * review gathering is down.
 */
export async function fetchPlaceEvidence(
  destination: Pick<TripDestination, 'city' | 'countryCode'>,
  candidates: PlaceCandidate[],
  invoke?: (name: string, body: unknown) => Promise<unknown>,
  options?: { provider?: string; travelStartsInDays?: number },
): Promise<EvidenceDigest> {
  const withProviderId = candidates.filter((candidate) => candidate.providerPlaceId);
  if (!invoke || withProviderId.length === 0) return EMPTY_EVIDENCE_DIGEST;

  try {
    const payload = await invoke('travel-evidence', {
      city: destination.city,
      placeIds: withProviderId.map((candidate) => candidate.providerPlaceId),
      placeNames: withProviderId.map((candidate) => candidate.name),
      placeWebsites: withProviderId.map((candidate) => candidate.website),
      provider: options?.provider,
      travelStartsInDays: options?.travelStartsInDays,
    });
    return digestEvidence(payload, withProviderId);
  } catch {
    return EMPTY_EVIDENCE_DIGEST;
  }
}

/**
 * Fetch place candidates for a destination through whichever path is available.
 * Live provider first; captured fixture second; honest empty result last.
 *
 * Returns no evidence: that is a separate, lazy call. See
 * {@link fetchPlaceEvidence}.
 */
export async function discoverPlaces(
  destination: Pick<TripDestination, 'city' | 'region' | 'countryCode' | 'lat' | 'lng'>,
  runtime: ProviderRuntime = EMPTY_PROVIDER_RUNTIME,
  invoke?: (name: string, body: unknown) => Promise<unknown>,
): Promise<DiscoveryOutcome> {
  const capability = capabilityFor(destination, runtime);
  let providerError: string | undefined;

  if (capability.places.status === 'live' && invoke) {
    try {
      const payload = await invoke('travel-discover', {
        city: destination.city,
        countryCode: destination.countryCode,
        provider: capability.places.provider,
        // Saves the server a geocoding round trip whenever the destination was
        // chosen from search rather than typed by hand.
        lat: destination.lat,
        lng: destination.lng,
      });
      const candidates = Array.isArray(payload) ? (payload as PlaceCandidate[]) : [];
      if (candidates.length > 0) {
        return {
          candidates,
          capability,
          usingFixture: false,
          ...EMPTY_EVIDENCE_DIGEST,
        };
      }
    } catch (error) {
      // Fall through to a labelled fixture rather than failing the whole panel,
      // but retain the provider reason when no fixture exists for this city.
      providerError = error instanceof Error ? error.message : 'Live discovery failed.';
    }
  }

  const library = getFixtureLibrary(destination.city);
  if (library) {
    const provider = new FixturePlaceDiscoveryProvider();
    const candidates = await provider.search({
      city: library.city,
      countryCode: library.countryCode,
      queries: library.knowledge?.discoveryQueries ?? [],
      interests: [],
      limit: 60,
    });
    return {
      candidates,
      // Report the fixture honestly even if the provider was nominally "live".
      capability: { ...capability, places: { provider: 'fixture', status: 'fixture' } },
      usingFixture: true,
      ...EMPTY_EVIDENCE_DIGEST,
      providerError,
    };
  }

  return {
    candidates: [],
    capability: { ...capability, places: { ...capability.places, status: 'unavailable' } },
    usingFixture: false,
    ...EMPTY_EVIDENCE_DIGEST,
    providerError,
  };
}

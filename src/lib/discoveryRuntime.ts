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
import type { PlaceCandidate } from './destinationIntelligence';
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
): Promise<ProviderRuntime> {
  const now = Date.now();
  if (runtimeCache && now - runtimeCache.fetchedAt < RUNTIME_TTL_MS) return runtimeCache.value;
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
}

export interface WeatherRiskDay {
  date: string;
  precipitationProbability: number;
  precipitationMillimetres: number;
  indoorRecommended: boolean;
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
): Pick<DiscoveryOutcome, 'queueEvidence' | 'evidenceSummaries' | 'trends'> {
  const empty = { queueEvidence: {}, evidenceSummaries: {}, trends: {} };
  if (!payload || typeof payload !== 'object') return empty;

  const documents = (payload as { documents?: unknown }).documents;
  const rawTrends = (payload as { trends?: unknown }).trends;
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

  for (const [providerId, candidateId] of byProviderId) {
    const summary = summarisePlaceEvidence(providerId, evidence);
    if (summary.sourceCount === 0) continue;
    evidenceSummaries[candidateId] = { ...summary, canonicalPlaceId: candidateId };

    // Require corroboration before a queue claim is allowed to reshape a day.
    if (summary.typicalQueueMinutes !== undefined && summary.sourceCount >= 2) {
      queueEvidence[candidateId] = Math.max(0, Math.round(summary.typicalQueueMinutes));
    }

    const trend = (rawTrends as Record<string, unknown> | undefined)?.[providerId];
    if (typeof trend === 'number' && Number.isFinite(trend)) {
      trends[candidateId] = Math.max(0, Math.min(1, trend));
    } else {
      trends[candidateId] = trendStrength(evidence.filter((item) => item.canonicalPlaceId === providerId));
    }
  }

  return { queueEvidence, evidenceSummaries, trends };
}

/**
 * Fetch place candidates for a destination through whichever path is available.
 * Live provider first; captured fixture second; honest empty result last.
 */
export async function discoverPlaces(
  destination: Pick<TripDestination, 'city' | 'region' | 'countryCode'>,
  runtime: ProviderRuntime = EMPTY_PROVIDER_RUNTIME,
  invoke?: (name: string, body: unknown) => Promise<unknown>,
): Promise<DiscoveryOutcome> {
  const capability = capabilityFor(destination, runtime);

  if (capability.places.status === 'live' && invoke) {
    try {
      const payload = await invoke('travel-discover', {
        city: destination.city,
        countryCode: destination.countryCode,
        provider: capability.places.provider,
      });
      const candidates = Array.isArray(payload) ? (payload as PlaceCandidate[]) : [];
      if (candidates.length > 0) {
        // Evidence is a separate, optional call: a plan built from real places
        // is still worth having even if review gathering is unavailable.
        let evidencePayload: unknown = null;
        try {
          evidencePayload = await invoke('travel-evidence', {
            city: destination.city,
            placeIds: candidates.map((candidate) => candidate.providerPlaceId).filter(Boolean),
            placeNames: candidates.map((candidate) => candidate.name),
          });
        } catch {
          evidencePayload = null;
        }
        return {
          candidates,
          capability,
          usingFixture: false,
          ...digestEvidence(evidencePayload, candidates),
        };
      }
    } catch {
      // Fall through to the fixture rather than failing the whole panel.
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
      queueEvidence: {},
      evidenceSummaries: {},
      trends: {},
    };
  }

  return {
    candidates: [],
    capability: { ...capability, places: { ...capability.places, status: 'unavailable' } },
    usingFixture: false,
    queueEvidence: {},
    evidenceSummaries: {},
    trends: {},
  };
}

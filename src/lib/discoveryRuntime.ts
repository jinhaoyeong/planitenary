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
}

/**
 * Pull reported queue times out of an evidence payload, keyed by candidate id.
 * Only claims backed by a summary median are used — a single offhand mention
 * should not reshape a day.
 */
function queueEvidenceFrom(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== 'object') return {};
  const summaries = (payload as { summaries?: unknown }).summaries;
  if (!Array.isArray(summaries)) return {};

  const queues: Record<string, number> = {};
  for (const entry of summaries) {
    if (!entry || typeof entry !== 'object') continue;
    const { canonicalPlaceId, typicalQueueMinutes, sourceCount } = entry as {
      canonicalPlaceId?: unknown;
      typicalQueueMinutes?: unknown;
      sourceCount?: unknown;
    };
    if (typeof canonicalPlaceId !== 'string') continue;
    if (typeof typicalQueueMinutes !== 'number' || !Number.isFinite(typicalQueueMinutes)) continue;
    // Require corroboration before letting a queue claim move the schedule.
    if (typeof sourceCount === 'number' && sourceCount < 2) continue;
    queues[canonicalPlaceId] = Math.max(0, Math.round(typicalQueueMinutes));
  }
  return queues;
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
        let queueEvidence: Record<string, number> = {};
        try {
          queueEvidence = queueEvidenceFrom(await invoke('travel-evidence', {
            city: destination.city,
            placeIds: candidates.map((candidate) => candidate.providerPlaceId).filter(Boolean),
          }));
        } catch {
          queueEvidence = {};
        }
        return { candidates, capability, usingFixture: false, queueEvidence };
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
    };
  }

  return {
    candidates: [],
    capability: { ...capability, places: { ...capability.places, status: 'unavailable' } },
    usingFixture: false,
    queueEvidence: {},
  };
}

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
  type PlaceBriefSummary,
  type PlaceEvidenceSummary,
  type SourceEvidence,
} from './travelEvidence';
import type { TripDestination } from './tripProfile';
import { isPlaceAdmission, type PlaceAdmission } from '../../supabase/functions/_shared/placeCost';
import { parsePlaceImage } from '../../supabase/functions/_shared/placeImages';

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
    aiReasoning: asBoolean(source.aiReasoning),
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
  /** Admission facts from an operator's own site, keyed by candidate id. */
  officialAdmissions: Record<string, PlaceAdmission>;
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
/**
 * Re-validate a brief that has crossed the network.
 *
 * The server already dropped every sentence that could not quote its source,
 * so this is not a second grounding check — it cannot be, since the source
 * text is not here. It only refuses a malformed shape, so a bad payload
 * degrades to no description rather than to a card that throws. A sentence
 * missing its `sourceUrl` is dropped: the label promises every sentence is
 * quoted from a source, and one that cannot name its own would make that
 * promise false.
 */
function parseBrief(value: unknown): PlaceBriefSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { sentences?: unknown };
  if (!Array.isArray(raw.sentences)) return undefined;

  const sentences = raw.sentences.flatMap((entry) => {
    const item = entry as { text?: unknown; sourceUrl?: unknown; excerpt?: unknown };
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    const sourceUrl = typeof item?.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
    const excerpt = typeof item?.excerpt === 'string' ? item.excerpt.trim() : '';
    return text && sourceUrl && excerpt ? [{ text, sourceUrl, excerpt }] : [];
  });

  if (sentences.length === 0) return undefined;
  return { sentences, sourceCount: new Set(sentences.map((s) => s.sourceUrl)).size };
}

function digestEvidence(
  payload: unknown,
  candidates: PlaceCandidate[],
): EvidenceDigest {
  const empty = { queueEvidence: {}, evidenceSummaries: {}, trends: {}, officialHours: {}, officialAdmissions: {}, bestTimeWindows: {} };
  if (!payload || typeof payload !== 'object') return empty;

  // Hours and admission are valid responses even when a page produced no
  // evidence document. Do not let an empty `documents` field erase them.
  const documents = (payload as { documents?: unknown }).documents;
  const evidenceDocuments = Array.isArray(documents) ? documents : [];
  const rawTrends = (payload as { trends?: unknown }).trends;
  const rawHours = (payload as { openingHours?: unknown }).openingHours;
  const rawAdmissions = (payload as { admissions?: unknown }).admissions;
  const rawBriefs = (payload as { briefs?: unknown }).briefs;

  const byProviderId = new Map(
    candidates
      .filter((candidate) => candidate.providerPlaceId)
      .map((candidate) => [candidate.providerPlaceId!, candidate.id]),
  );

  const evidence = evidenceDocuments.filter(
    (document): document is SourceEvidence =>
      Boolean(document)
      && typeof document === 'object'
      && typeof (document as SourceEvidence).canonicalPlaceId === 'string',
  );

  const queueEvidence: Record<string, number> = {};
  const evidenceSummaries: Record<string, PlaceEvidenceSummary> = {};
  const trends: Record<string, number> = {};
  const officialHours: Record<string, DateAwareOpeningHours> = {};
  const officialAdmissions: Record<string, PlaceAdmission> = {};
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

    const admission = (rawAdmissions as Record<string, unknown> | undefined)?.[providerId];
    if (isPlaceAdmission(admission) && admission.source === 'official-website') {
      officialAdmissions[candidateId] = admission;
    }

    const summary = summarisePlaceEvidence(providerId, evidence);
    if (summary.sourceCount === 0) continue;
    /**
     * The brief rides along on the summary rather than becoming its own map,
     * because it is only ever shown beside the rest of a place's evidence and
     * a separate map would be one more thing to keep in step. Validation
     * already happened server-side; this re-checks the shape because the
     * payload crosses a network boundary and a malformed brief must degrade to
     * no brief rather than to a broken card.
     */
    const brief = parseBrief((rawBriefs as Record<string, unknown> | undefined)?.[providerId]);
    evidenceSummaries[candidateId] = { ...summary, canonicalPlaceId: candidateId, brief };

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

  return { queueEvidence, evidenceSummaries, trends, officialHours, officialAdmissions, bestTimeWindows };
}

/** The empty digest, used whenever evidence is unavailable or not yet fetched. */
export const EMPTY_EVIDENCE_DIGEST: EvidenceDigest = {
  queueEvidence: {},
  evidenceSummaries: {},
  trends: {},
  officialHours: {},
  officialAdmissions: {},
  bestTimeWindows: {},
};

export type EvidenceDigest = Pick<
  DiscoveryOutcome,
  'queueEvidence' | 'evidenceSummaries' | 'trends' | 'officialHours' | 'officialAdmissions' | 'bestTimeWindows'
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
      placeCountryCodes: withProviderId.map((candidate) => candidate.countryCode),
      // Only places with no prose of their own are worth a metered call. The
      // server cannot work this out: a description arrives with a matched
      // Wikivoyage listing, which happened back on the discovery path.
      placeNeedsDescription: withProviderId.map((candidate) => !candidate.description?.trim()),
      provider: options?.provider,
      travelStartsInDays: options?.travelStartsInDays,
    });
    return digestEvidence(payload, withProviderId);
  } catch {
    return EMPTY_EVIDENCE_DIGEST;
  }
}

/**
 * The photograph a card should show, and the credit it must carry with it.
 *
 * Keyed by candidate id, like everything else downstream of a fetch — the
 * server answers by provider place id, because that is what it was asked with.
 */
export interface PlacePhoto {
  url: string;
  attribution: string;
  /** The Commons file page, carrying the full licence and author text. */
  sourcePage: string;
  /**
   * A small rendition of the same photograph, when the service produced one.
   *
   * `travel-images` has always returned this and the client threw it away, so
   * a browse card the size of a postage stamp was loading the full 1280px
   * original. Same image, same identity, same credit — just the size the slot
   * actually needs.
   */
  thumbnailUrl?: string;
}

/**
 * Re-validate a photograph that has crossed the network.
 *
 * This is not a second licence check — the licence text is not here. It is a
 * host and shape check, so a malformed or hostile payload degrades to no
 * photograph rather than to an `<img>` loading from wherever the payload said.
 * `parsePlaceImage` owns the host rule, and it is deliberately the same
 * function the server writes and reads its cache through: a picture allowed on
 * screen by one rule and into the database by another is a rule with a gap.
 */
function parsePhotos(payload: unknown, candidates: PlaceCandidate[]): Record<string, PlacePhoto> {
  const photos: Record<string, PlacePhoto> = {};
  if (!payload || typeof payload !== 'object') return photos;
  const byProviderId = new Map(
    candidates
      .filter((candidate) => candidate.providerPlaceId)
      .map((candidate) => [candidate.providerPlaceId!, candidate.id]),
  );

  const raw = (payload as { images?: unknown }).images;
  if (!raw || typeof raw !== 'object') return photos;

  for (const [providerId, candidateId] of byProviderId) {
    const list = (raw as Record<string, unknown>)[providerId];
    if (!Array.isArray(list)) continue;
    // Already ranked best-first by the server; the first one that survives
    // validation is the hero. A rejected leader falls through to the next
    // rather than costing the place its picture.
    for (const entry of list) {
      const image = parsePlaceImage(entry);
      if (!image) continue;
      photos[candidateId] = {
        url: image.url,
        attribution: image.attribution,
        sourcePage: image.sourcePage,
        thumbnailUrl: image.thumbnailUrl,
      };
      break;
    }
  }

  return photos;
}

/**
 * Fetch real photographs for a specific handful of candidates.
 *
 * Deliberately *not* called for the whole shortlist, for the reason
 * {@link fetchPlaceEvidence} is not: a sixty-place list abandoned after four
 * cards must cost four places' worth of lookups. Wikimedia cannot bill, so the
 * restraint here is about being a good citizen of a donation-funded API rather
 * than about a budget — but the shape of the rule is the same one.
 *
 * Never throws. A plan built from real places is still worth having when the
 * pictures are missing; a card with no photograph shows its neighbourhood
 * placard instead, which is honest.
 */
export async function fetchPlacePhotos(
  candidates: PlaceCandidate[],
  invoke?: (name: string, body: unknown) => Promise<unknown>,
  options?: { provider?: string; travelStartsInDays?: number },
): Promise<Record<string, PlacePhoto>> {
  /**
   * Only places that carry a pointer are worth asking about. A place with no
   * `imageLeads` has no `wikimedia_commons` tag, no Wikidata item and no
   * article — there is nothing to look up, and sending it would spend a slot
   * in the batch to be told so.
   */
  const withLeads = candidates.filter(
    (candidate) => candidate.providerPlaceId && (candidate.imageLeads?.length ?? 0) > 0,
  );
  if (!invoke || withLeads.length === 0) return {};

  try {
    const payload = await invoke('travel-images', {
      placeIds: withLeads.map((candidate) => candidate.providerPlaceId),
      placeLeads: withLeads.map((candidate) => candidate.imageLeads ?? []),
      provider: options?.provider,
      travelStartsInDays: options?.travelStartsInDays,
    });
    return parsePhotos(payload, withLeads);
  } catch {
    return {};
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
  /**
   * How many places to ask for. Omitted, the provider applies its own default,
   * which is a flat sixty regardless of how long anybody is staying — the
   * reason a five-day city arrived with sixty places to review.
   */
  options?: {
    limit?: number;
    /** Exact Trip Setup style ids; sent to the server as query-plan input. */
    interests?: readonly string[];
    hiddenGems?: boolean;
  },
): Promise<DiscoveryOutcome> {
  const capability = capabilityFor(destination, runtime);
  let providerError: string | undefined;

  if (capability.places.status === 'live' && invoke) {
    try {
      const payload = await invoke('travel-discover', {
        city: destination.city,
        countryCode: destination.countryCode,
        provider: capability.places.provider,
        interests: options?.interests,
        hiddenGems: options?.hiddenGems,
        // Asked for explicitly so the deck is sized by the stay rather than by
        // a server default. `travel-discover` already over-fetches from the
        // provider and trims to this number with its own category balance, so
        // the filtering headroom lives there rather than being padded here.
        limit: options?.limit,
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
      interests: [
        ...(options?.interests || []),
        ...(options?.hiddenGems ? ['hidden-gems'] : []),
      ],
      limit: options?.limit ?? 60,
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

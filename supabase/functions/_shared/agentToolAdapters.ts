/**
 * Where the agent's tools actually get their answers.
 *
 * Every factual tool here resolves to either the trip the server already
 * loaded, or a **call to the existing production function** that owns that
 * fact — `travel-route-matrix` for travel times, `travel-weather` for the
 * forecast, `travel-events`, `travel-discover`, `travel-images`. None of it is
 * reimplemented.
 *
 * That is a deliberate choice with a cost. Calling a sibling function is
 * slower than importing its internals would be, and it means the agent's
 * answers arrive through an HTTP hop. What it buys is that there is exactly
 * one implementation of "how long does it take to get from here to there",
 * with one cache, one quota counter and one set of provider credentials. Two
 * implementations would drift, and the one that drifted would be the one
 * nobody watches — the reasoning `evidenceSources.ts` is shared between live
 * traffic and the nightly refresh, one layer up.
 *
 * ## The model never supplies a fact
 *
 * Nothing in this file takes a value from the model and passes it on as
 * truth. The model chooses *which* place to ask about; the coordinates come
 * from the trip, the duration comes from the routing provider, the forecast
 * comes from Open-Meteo. `validateAgentAnswer` then holds the finished answer
 * to what these adapters actually returned.
 *
 * ## Read-only, structurally
 *
 * There is no write path here at all — no insert, no update, no delete, and no
 * function call that performs one. The dispatch table is
 * `AGENT_TOOLS`, which contains no mutating tool, so a write is not something
 * this executor declines to do; it is something it cannot express.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchJson, secrets } from './providers.ts';
import { AGENT_TOOLS, type AgentToolCall, type AgentToolName } from './agentContract.ts';
import type { ToolOutcome } from './agentRuntime.ts';
import {
  selectRoutingProvider,
  type RoutingProviderAvailability,
} from './routingProvider.ts';

/** A place the trip already knows about, indexed for the tools to resolve. */
interface KnownPlace {
  id: string;
  name: string;
  city?: string;
  countryCode?: string;
  coordinates?: [number, number];
  provider?: string;
  providerPlaceId?: string;
  type?: string;
  location?: string;
  day?: number;
  time?: string;
  durationMinutes?: number;
  admission?: unknown;
  openingHoursWeek?: unknown;
  imageLeads?: unknown;
}

const registerPlace = (index: Map<string, KnownPlace>, place: KnownPlace): void => {
  for (const key of [place.id, place.providerPlaceId, place.name.toLowerCase()]) {
    if (key && !index.has(key)) index.set(key, place);
  }
};

export interface AgentToolContext {
  /** The caller's own bearer token, forwarded to sibling functions. */
  authHeader: string;
  /** `${SUPABASE_URL}/functions/v1`. */
  functionsBaseUrl: string;
  cache: SupabaseClient | null;
  tripId: string;
  userId: string;
  /** `itineraries.data` for the trip whose ownership was already proven. */
  itinerary: Record<string, unknown> | null;
  /** Injected in tests; production resolves only server-side provider secrets. */
  routingProviders?: RoutingProviderAvailability;
}

/** Ceiling on any single tool result, so one lookup cannot fill the context. */
const MAX_RESULT_ITEMS = 20;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const coordinatesOf = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [lat, lng] = value;
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    ? [lat, lng]
    : undefined;
};

const minutesFromTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined;
};

/**
 * Every place the trip knows about, from the saved plan.
 *
 * This is the agent's whole notion of "a place the traveller has". Built once
 * per request so a place id the model uses resolves to real coordinates rather
 * than to whatever the model believed they were — the substitution that
 * `get_route` exists to make impossible.
 *
 * Indexed by activity id, by provider place id and by lowercased name, because
 * a model referring to "Osaka Castle" is being more natural than one repeating
 * an opaque id, and refusing the natural form would push it toward inventing
 * the id instead.
 */
export function buildPlaceIndex(itinerary: Record<string, unknown> | null): Map<string, KnownPlace> {
  const index = new Map<string, KnownPlace>();
  if (!itinerary) return index;

  const profile = asRecord(itinerary.tripProfile);
  const destinations = asArray(profile?.destinations).map(asRecord).filter(Boolean);
  const countriesByCity = new Map<string, string>();
  const tripCountries = new Set<string>();
  for (const destination of destinations) {
    const city = typeof destination.city === 'string' ? destination.city.trim().toLowerCase() : '';
    const code = typeof destination.countryCode === 'string' ? destination.countryCode.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(code)) continue;
    tripCountries.add(code);
    if (city) countriesByCity.set(city, code);
  }
  const soleTripCountry = tripCountries.size === 1 ? [...tripCountries][0] : undefined;

  const consider = (raw: unknown, day?: number, city?: string) => {
    const activity = asRecord(raw);
    if (!activity) return;
    const name = typeof activity.name === 'string' ? activity.name.trim() : '';
    if (!name) return;
    const id = typeof activity.id === 'string' && activity.id
      ? activity.id
      : `${day ?? 0}:${name.toLowerCase()}`;
    const resolvedCity = typeof activity.city === 'string' ? activity.city : city;
    const explicitCountry = typeof activity.countryCode === 'string'
      ? activity.countryCode.trim().toUpperCase()
      : undefined;
    const resolvedCountry = explicitCountry && /^[A-Z]{2}$/.test(explicitCountry)
      ? explicitCountry
      : resolvedCity ? countriesByCity.get(resolvedCity.trim().toLowerCase()) ?? soleTripCountry : soleTripCountry;
    registerPlace(index, {
      id,
      name,
      city: resolvedCity,
      countryCode: resolvedCountry,
      coordinates: coordinatesOf(activity.coordinates),
      provider: typeof activity.provider === 'string' ? activity.provider : undefined,
      providerPlaceId: typeof activity.providerPlaceId === 'string' ? activity.providerPlaceId : undefined,
      type: typeof activity.type === 'string' ? activity.type : undefined,
      location: typeof activity.location === 'string' ? activity.location : undefined,
      day,
      time: typeof activity.time === 'string' ? activity.time : undefined,
      durationMinutes: typeof activity.durationMinutes === 'number' ? activity.durationMinutes : undefined,
      admission: activity.admission,
      openingHoursWeek: activity.openingHoursWeek,
      imageLeads: activity.imageLeads,
    });
  };

  for (const rawDay of asArray(itinerary.days)) {
    const day = asRecord(rawDay);
    if (!day) continue;
    const number = typeof day.day === 'number' ? day.day : undefined;
    const city = typeof day.city === 'string' ? day.city : undefined;
    for (const activity of asArray(day.activities)) consider(activity, number, city);
  }
  for (const activity of asArray(itinerary.unassignedActivities)) consider(activity);

  return index;
}

/** The trip's first known coordinates, used where a tool needs a location. */
const tripAnchor = (index: Map<string, KnownPlace>): [number, number] | undefined => {
  for (const place of index.values()) if (place.coordinates) return place.coordinates;
  return undefined;
};

const tripCountryCode = (itinerary: Record<string, unknown> | null): string | undefined => {
  const profile = asRecord(itinerary?.tripProfile);
  const destination = asRecord(asArray(profile?.destinations)[0]);
  return typeof destination?.countryCode === 'string' ? destination.countryCode : undefined;
};

// ---------------------------------------------------------------------------
// Web research
// ---------------------------------------------------------------------------

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: 'brave' | 'wikimedia';
}

interface WebSearchResult {
  results: WebResult[];
  provider: 'brave' | 'wikimedia';
  caveat?: string;
  cached?: boolean;
}

const webQueryKey = async (query: string): Promise<string> => {
  const normalised = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readWebCache = async (
  cache: SupabaseClient | null,
  key: string,
): Promise<WebSearchResult | undefined> => {
  if (!cache) return undefined;
  try {
    const { data, error } = await cache
      .from('agent_web_cache')
      .select('provider,results,caveat')
      .eq('query_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data || !Array.isArray(data.results)) return undefined;
    const provider = data.provider === 'brave' ? 'brave' : data.provider === 'wikimedia' ? 'wikimedia' : undefined;
    if (!provider) return undefined;
    return {
      provider,
      results: data.results as unknown as WebResult[],
      caveat: typeof data.caveat === 'string' ? data.caveat : undefined,
      cached: true,
    };
  } catch {
    return undefined;
  }
};

const writeWebCache = async (
  cache: SupabaseClient | null,
  key: string,
  result: WebSearchResult,
): Promise<void> => {
  if (!cache) return;
  try {
    await cache.from('agent_web_cache').upsert({
      query_key: key,
      provider: result.provider,
      results: result.results,
      caveat: result.caveat ?? null,
      retrieved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString(),
    }, { onConflict: 'query_key' });
  } catch {
    // Best-effort. An unreadable cache costs a search, never a fabricated fact.
  }
};

/**
 * Current information from the open web.
 *
 * Two providers, and which one answers is a deployment fact the response
 * states rather than hides:
 *
 * - **Brave Search**, when `BRAVE_SEARCH_API_KEY` is set. The only one of the
 *   two that can answer "is this closed right now" or "what opened this year".
 * - **MediaWiki full-text search** across Wikivoyage and Wikipedia otherwise.
 *   Keyless, free, and genuinely useful for "what is this place" — but it is
 *   an encyclopedia, so it cannot speak to anything current, and the result
 *   says so rather than letting a stale answer pass as a live one.
 *
 * Neither result is ever treated as established fact. Snippets travel with
 * their URL and are labelled as what a page said; `collectEvidence` records
 * the URLs as citable and nothing else, so a search snippet can be quoted and
 * attributed but can never become a travel time, an opening hour or a price —
 * those have their own pipelines and their own authority rules.
 */
export async function searchWeb(query: string, cache: SupabaseClient | null = null): Promise<WebSearchResult> {
  const key = await webQueryKey(query);
  const cached = await readWebCache(cache, key);
  if (cached) return cached;

  const braveKey = secrets.braveSearch();
  if (braveKey) {
    const params = new URLSearchParams({ q: query, count: '6', safesearch: 'moderate' });
    const payload = await fetchJson(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      { headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' } },
      10_000,
    ).catch(() => null);
    const web = asArray((asRecord(asRecord(payload)?.web))?.results);
    const results = web.slice(0, 6).flatMap((raw): WebResult[] => {
      const item = asRecord(raw);
      const url = typeof item?.url === 'string' ? item.url : '';
      const title = typeof item?.title === 'string' ? item.title : '';
      if (!/^https?:\/\//i.test(url) || !title) return [];
      return [{
        title,
        url,
        snippet: typeof item?.description === 'string' ? item.description.slice(0, 400) : '',
        source: 'brave',
      }];
    });
    if (results.length > 0) {
      const result: WebSearchResult = { results, provider: 'brave' };
      await writeWebCache(cache, key, result);
      return result;
    }
  }

  /**
   * The keyless fallback. Wikivoyage first because it is written for
   * travellers; Wikipedia second for the places Wikivoyage has no page for.
   */
  const results: WebResult[] = [];
  for (const site of ['en.wikivoyage.org', 'en.wikipedia.org']) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      list: 'search', srsearch: query, srlimit: '4', srprop: 'snippet',
    });
    const payload = await fetchJson(
      `https://${site}/w/api.php?${params}`,
      { headers: { 'User-Agent': 'Planitenary/1.0 (travel itinerary planner)', Accept: 'application/json' } },
      10_000,
    ).catch(() => null);
    for (const raw of asArray(asRecord(asRecord(payload)?.query)?.search)) {
      const item = asRecord(raw);
      const title = typeof item?.title === 'string' ? item.title : '';
      if (!title) continue;
      results.push({
        title,
        url: `https://${site}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        // MediaWiki snippets are HTML with match highlighting.
        snippet: typeof item?.snippet === 'string'
          ? item.snippet.replace(/<[^>]*>/g, '').slice(0, 400)
          : '',
        source: 'wikimedia',
      });
    }
  }

  const result: WebSearchResult = {
    results: results.slice(0, 6),
    provider: 'wikimedia',
    caveat: 'No live web search is configured, so these are encyclopedia articles. '
      + 'They cannot establish anything current — a closure, a temporary exhibition or this season\'s hours.',
  };
  await writeWebCache(cache, key, result);
  return result;
}

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

/**
 * Dispatch one validated tool call.
 *
 * Returns a refusal rather than throwing on every failure path. A tool that
 * cannot answer is a fact the model can work with — and often the honest
 * answer to the traveller is "the routing provider is not configured", which
 * is only sayable if the failure survives as information instead of becoming
 * an exception.
 */
export function createToolExecutor(context: AgentToolContext): (call: AgentToolCall) => Promise<ToolOutcome> {
  const index = buildPlaceIndex(context.itinerary);
  const routingProviders = context.routingProviders ?? {
    amap: Boolean(secrets.amap()),
    openRouteService: Boolean(secrets.openRouteService()),
  };

  const callFunction = async (name: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${context.functionsBaseUrl}/${name}`, {
      method: 'POST',
      headers: {
        Authorization: context.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${name} responded ${response.status}`);
    return response.json();
  };

  const resolvePlaces = (ids: string[]): { found: KnownPlace[]; missing: string[] } => {
    const found: KnownPlace[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const place = index.get(id) || index.get(id.toLowerCase());
      if (place) found.push(place); else missing.push(id);
    }
    return { found, missing };
  };

  const routeFor = async (places: KnownPlace[], mode: string, matrix: boolean): Promise<ToolOutcome> => {
    const routedPlaces = places.filter((place) => place.coordinates);
    const points = routedPlaces
      .map((place) => ({ placeId: place.providerPlaceId, coordinates: place.coordinates }));
    if (points.length < 2) {
      return {
        ok: false,
        detail: 'Those places have no coordinates on this trip, so no real route can be measured. '
          + 'Do not estimate one.',
      };
    }
    const selection = selectRoutingProvider(
      routedPlaces.map((place) => place.countryCode),
      routingProviders,
    );
    if (selection.status === 'route-unavailable') {
      return { ok: false, detail: `route-unavailable: ${selection.reason}` };
    }
    /**
     * `walking` is the app's own vocabulary; the matrix function speaks
     * Google's. Transit is passed through even though OpenRouteService has no
     * transit matrix on the free tier — the function answers `unknown` for
     * those elements rather than silently routing them as walking, and an
     * admitted gap is what the model should see.
     */
    const matrixMode = mode === 'transit' ? 'public-transport' : mode;
    try {
      const payload = await callFunction('travel-route-matrix', {
        origins: matrix ? points : [points[0]],
        destinations: matrix ? points : [points[1]],
        mode: matrixMode,
        provider: selection.provider,
      });
      return {
        ok: true,
        result: {
          mode: matrixMode,
          placeIds: routedPlaces.map((place) => place.id),
          places: routedPlaces.map((place) => place.name),
          matrix: payload,
        },
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'The routing provider did not answer.' };
    }
  };

  const handlers: Record<AgentToolName, (args: Record<string, unknown>) => Promise<ToolOutcome>> = {
    get_trip: async () => ({
      ok: true,
      result: {
        id: context.tripId,
        name: context.itinerary?.name,
        cities: context.itinerary?.cities,
        dayCount: asArray(context.itinerary?.days).length,
        days: asArray(context.itinerary?.days).slice(0, MAX_RESULT_ITEMS).map((raw) => {
          const day = asRecord(raw);
          return {
            day: day?.day,
            date: day?.date,
            city: day?.city,
            title: day?.title,
            activityCount: asArray(day?.activities).length,
          };
        }),
      },
    }),

    get_trip_profile: async () => ({
      ok: true,
      result: context.itinerary?.tripProfile ?? { note: 'This trip has no saved profile.' },
    }),

    get_current_itinerary: async () => ({
      ok: true,
      result: asArray(context.itinerary?.days).slice(0, MAX_RESULT_ITEMS).map((raw) => {
        const day = asRecord(raw);
        return {
          day: day?.day,
          date: day?.date,
          city: day?.city,
          title: day?.title,
          activities: asArray(day?.activities).slice(0, MAX_RESULT_ITEMS).map((entry) => {
            const activity = asRecord(entry);
            return {
              name: activity?.name,
              time: activity?.time,
              durationMinutes: activity?.durationMinutes,
              type: activity?.type,
              location: activity?.location,
            };
          }),
        };
      }),
    }),

    get_saved_places: async () => ({
      ok: true,
      result: [...new Set([...index.values()])].slice(0, MAX_RESULT_ITEMS).map((place) => ({
        id: place.id,
        name: place.name,
        city: place.city,
        type: place.type,
        day: place.day,
        scheduled: place.day !== undefined,
      })),
    }),

    get_candidate_decisions: async () => {
      const discovery = asRecord(context.itinerary?.discoveryState);
      return {
        ok: true,
        result: {
          city: discovery?.city,
          decisions: discovery?.decisions ?? {},
          unscheduled: asArray(discovery?.unscheduledCandidates).slice(0, MAX_RESULT_ITEMS),
        },
      };
    },

    search_places: async (args) => {
      try {
        const payload = await callFunction('travel-discover', {
          city: args.city,
          countryCode: tripCountryCode(context.itinerary),
          interests: [args.query, ...asArray(args.categories)].filter(Boolean),
          limit: args.limit,
        });
        const candidates = asArray(payload).slice(0, Number(args.limit) || 10);
        for (const raw of candidates) {
          const candidate = asRecord(raw);
          const id = typeof candidate?.id === 'string'
            ? candidate.id
            : typeof candidate?.providerPlaceId === 'string' ? candidate.providerPlaceId : '';
          const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
          if (!id || !name) continue;
          registerPlace(index, {
            id,
            name,
            city: typeof candidate?.city === 'string' ? candidate.city : String(args.city),
            countryCode: typeof candidate?.countryCode === 'string'
              ? candidate.countryCode
              : tripCountryCode(context.itinerary),
            coordinates: coordinatesOf(candidate?.coordinates),
            provider: typeof candidate?.provider === 'string' ? candidate.provider : undefined,
            providerPlaceId: typeof candidate?.providerPlaceId === 'string' ? candidate.providerPlaceId : undefined,
            type: typeof asArray(candidate?.categories)[0] === 'string'
              ? String(asArray(candidate?.categories)[0])
              : undefined,
            location: typeof candidate?.neighbourhood === 'string' ? candidate.neighbourhood : undefined,
            admission: candidate?.admission,
            openingHoursWeek: candidate?.openingHoursWeek,
            imageLeads: candidate?.imageLeads,
          });
        }
        return {
          ok: true,
          result: candidates.map((raw) => {
            const candidate = asRecord(raw);
            return {
              id: candidate?.id,
              provider: candidate?.provider,
              providerPlaceId: candidate?.providerPlaceId,
              name: candidate?.name,
              categories: candidate?.categories,
              neighbourhood: candidate?.neighbourhood,
              coordinates: candidate?.coordinates,
              description: typeof candidate?.description === 'string'
                ? candidate.description.slice(0, 300)
                : undefined,
              website: candidate?.website,
              admission: candidate?.admission,
              openingHoursWeek: candidate?.openingHoursWeek,
              imageLeads: candidate?.imageLeads,
            };
          }),
        };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Place search failed.' };
      }
    },

    search_web: async (args) => {
      try {
        return { ok: true, result: await searchWeb(String(args.query), context.cache) };
      } catch {
        return { ok: false, detail: 'Web search failed.' };
      }
    },

    get_place_details: async (args) => {
      const { found, missing } = resolvePlaces(args.placeIds as string[]);
      return {
        ok: true,
        result: {
          places: found.map((place) => ({
            id: place.id,
            name: place.name,
            city: place.city,
            type: place.type,
            location: place.location,
            coordinates: place.coordinates,
            admission: place.admission,
            day: place.day,
            time: place.time,
            durationMinutes: place.durationMinutes,
          })),
          // Named rather than dropped: a place this trip has never heard of is
          // something the model needs to know it got wrong.
          unknown: missing,
        },
      };
    },

    get_opening_hours: async (args) => {
      const { found, missing } = resolvePlaces(args.placeIds as string[]);
      return {
        ok: true,
        result: {
          date: args.date,
          places: found.map((place) => ({
            name: place.name,
            openingHoursWeek: place.openingHoursWeek ?? null,
            note: place.openingHoursWeek ? undefined : 'No source published hours for this place.',
          })),
          unknown: missing,
        },
      };
    },

    get_events: async (args) => {
      try {
        const anchor = tripAnchor(index);
        const payload = await callFunction('travel-events', {
          city: args.city,
          startDate: args.startDate,
          endDate: args.endDate,
          latitude: anchor?.[0],
          longitude: anchor?.[1],
        });
        return { ok: true, result: payload };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Events are not available.' };
      }
    },

    get_weather: async (args) => {
      const anchor = tripAnchor(index);
      if (!anchor) return { ok: false, detail: 'This trip has no coordinates, so no forecast can be fetched.' };
      try {
        const payload = await callFunction('travel-weather', {
          latitude: anchor[0],
          longitude: anchor[1],
          startDate: args.startDate,
          endDate: args.endDate,
        });
        return { ok: true, result: payload };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'The forecast is not available.' };
      }
    },

    get_place_images: async (args) => {
      const { found, missing } = resolvePlaces(args.placeIds as string[]);
      const withLeads = found.filter((place) => place.providerPlaceId && Array.isArray(place.imageLeads));
      if (withLeads.length === 0) {
        return { ok: true, result: { images: {}, unknown: missing, note: 'No photograph pointers are held for these places.' } };
      }
      try {
        const payload = await callFunction('travel-images', {
          placeIds: withLeads.map((place) => place.providerPlaceId),
          placeLeads: withLeads.map((place) => place.imageLeads),
          provider: withLeads[0]?.provider,
        });
        return { ok: true, result: { ...asRecord(payload), unknown: missing } };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : 'Photographs are not available.' };
      }
    },

    get_route: async (args) => {
      const { found, missing } = resolvePlaces([args.fromPlaceId as string, args.toPlaceId as string]);
      if (missing.length > 0) {
        return { ok: false, detail: `Unknown place(s) on this trip: ${missing.join(', ')}.` };
      }
      return routeFor(found, String(args.mode), false);
    },

    get_route_matrix: async (args) => {
      const { found, missing } = resolvePlaces(args.placeIds as string[]);
      if (found.length < 2) {
        return { ok: false, detail: `Too few known places to route between. Unknown: ${missing.join(', ')}.` };
      }
      return routeFor(found, String(args.mode), true);
    },

    /**
     * Planning support reads what the deterministic planner already decided.
     * It does not re-plan, and it certainly does not save: these three exist so
     * the model can *check* an idea against the real schedule before proposing
     * it, which is the difference between a suggestion and a guess.
     */
    validate_schedule: async (args) => {
      const day = asArray(context.itinerary?.days).map(asRecord)
        .find((entry) => entry?.day === args.day);
      if (!day) return { ok: false, detail: `Day ${args.day} is not in this trip.` };
      const activities = asArray(day.activities).map(asRecord);
      const timed = activities.flatMap((activity) => {
        const start = minutesFromTime(activity?.time);
        if (start === undefined || typeof activity?.durationMinutes !== 'number') return [];
        return [{ name: String(activity.name || 'Untitled activity'), start, end: start + activity.durationMinutes }];
      }).sort((left, right) => left.start - right.start);
      const overlaps = timed.slice(1).flatMap((current, index) => {
        const previous = timed[index];
        return previous && current.start < previous.end
          ? [{ first: previous.name, second: current.name, overlapMinutes: previous.end - current.start }]
          : [];
      });
      return {
        ok: true,
        result: {
          day: day.day,
          date: day.date,
          activityCount: activities.length,
          overlaps,
          missingTimes: activities
            .filter((activity) => minutesFromTime(activity?.time) === undefined)
            .map((activity) => activity?.name),
          hoursNotHeld: activities
            .filter((activity) => !Array.isArray(activity?.openingHoursWeek))
            .map((activity) => activity?.name),
          note: 'This checks saved activity windows only. Route time and live hours require their own tools. Nothing is re-planned or saved.',
          activities: activities.map((activity) => ({
            name: activity?.name,
            time: activity?.time,
            durationMinutes: activity?.durationMinutes,
          })),
        },
      };
    },

    calculate_day_timing: async (args) => {
      const day = asArray(context.itinerary?.days).map(asRecord)
        .find((entry) => entry?.day === args.day);
      if (!day) return { ok: false, detail: `Day ${args.day} is not in this trip.` };
      const activities = asArray(day.activities).map(asRecord);
      const times = activities
        .map((activity) => (typeof activity?.time === 'string' ? activity.time : ''))
        .filter((time) => /^\d{2}:\d{2}$/.test(time))
        .sort();
      const totalMinutes = activities.reduce(
        (sum, activity) => sum + (typeof activity?.durationMinutes === 'number' ? activity.durationMinutes : 0),
        0,
      );
      return {
        ok: true,
        result: {
          day: day.day,
          date: day.date,
          firstActivityAt: times[0],
          lastActivityAt: times[times.length - 1],
          scheduledMinutes: totalMinutes,
          activityCount: activities.length,
        },
      };
    },

    find_schedule_conflicts: async () => {
      const discovery = asRecord(context.itinerary?.discoveryState);
      return {
        ok: true,
        result: {
          unscheduled: asArray(discovery?.unscheduledCandidates).slice(0, MAX_RESULT_ITEMS),
          note: 'These are the places the deterministic planner declined to schedule, with its reasons.',
        },
      };
    },
  };

  return async (call: AgentToolCall): Promise<ToolOutcome> => {
    const handler = handlers[call.tool];
    // Unreachable through `parseAgentTurn`, which only admits names in
    // `AGENT_TOOLS` — kept because "the dispatch table and the catalogue agree"
    // is the property that makes the read-only guarantee structural.
    if (!handler || !(call.tool in AGENT_TOOLS)) {
      return { ok: false, detail: `Unknown tool: ${call.tool}.` };
    }
    try {
      return await handler(call.args);
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'The tool failed.' };
    }
  };
}

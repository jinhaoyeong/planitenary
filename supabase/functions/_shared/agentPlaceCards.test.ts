import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolExecutor } from './agentToolAdapters';
import { collectEvidence, emptyEvidence, validateAgentAnswer } from './agentContract';
import type { AgentToolCall } from './agentContract';

/**
 * Structured place cards, and the identity rules that decide whether one may
 * exist at all.
 *
 * A card is the first surface outside the deck to assert a photograph, a
 * location and a decision about a place in one object. Everything here asks
 * the question the image work spent several rounds answering: is this the
 * place we think it is?
 */

const ACROS_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/9/93/Acrosfukuoka02.jpg';

/** A cache stub over the two tables a card is resolved through. */
const cacheFor = (options: {
  links?: Array<{ provider: string; provider_place_id: string; canonical_place_id: string }>;
  places?: Array<{
    id: string;
    primary_name: string;
    city?: string;
    neighbourhood?: string;
    latitude?: number;
    longitude?: number;
  }>;
}) => ({
  from: (table: string) => {
    const rows = table === 'place_provider_links' ? options.links ?? [] : options.places ?? [];
    const chain = {
      select: () => chain,
      in: async () => ({ data: rows, error: null }),
    };
    return chain;
  },
});

const itinerary = {
  tripProfile: { destinations: [{ city: 'Fukuoka', countryCode: 'JP' }] },
  days: [],
  discoveryState: {
    city: 'Fukuoka',
    decisions: { 'wikivoyage-ACROS%20rooftop%20garden': 'interested' },
  },
};

const discoveredAcros = {
  id: 'wikivoyage-ACROS%20rooftop%20garden',
  provider: 'wikivoyage',
  providerPlaceId: 'wv:ACROS rooftop garden',
  name: 'ACROS rooftop garden',
  city: 'Fukuoka',
  neighbourhood: 'Tenjin',
  coordinates: [33.591595, 130.402349],
  categories: ['park'],
  imageLeads: [{ kind: 'commons-file', value: 'File:Acrosfukuoka02.jpg', origin: 'wikivoyage-listing' }],
};

const imagePayload = (providerPlaceId: string) => ({
  images: {
    [providerPlaceId]: [{
      url: ACROS_IMAGE,
      thumbnailUrl: ACROS_IMAGE,
      width: 1200,
      height: 800,
      source: 'wikimedia-commons',
      sourcePage: 'https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg',
      author: 'Pontafon',
      licence: 'CC BY-SA 3.0',
      lead: 'commons-file',
    }],
  },
});

interface RecordedRequest { name: string; body: Record<string, unknown> }

const sessionWith = (cache: unknown, requests: RecordedRequest[]) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body?: string }) => {
    const name = String(url).split('/').pop() ?? '';
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    requests.push({ name, body });
    if (name === 'travel-discover') {
      return new Response(JSON.stringify([discoveredAcros]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (name === 'travel-images') {
      const first = (body.placeIds as string[])[0];
      return new Response(JSON.stringify(imagePayload(first)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return createToolExecutor({
    authHeader: 'Bearer user-jwt',
    functionsBaseUrl: 'https://project.supabase.co/functions/v1',
    cache: cache as never,
    tripId: 'trip-1',
    userId: 'user-1',
    itinerary,
    routingProviders: { amap: true, openRouteService: true },
  });
};

/** The same session, with a place carried over from a previous answer. */
const sessionWithSeed = (cache: unknown, requests: RecordedRequest[]) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body?: string }) => {
    const name = String(url).split('/').pop() ?? '';
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    requests.push({ name, body });
    if (name === 'travel-images') {
      const first = (body.placeIds as string[])[0];
      return new Response(JSON.stringify(imagePayload(first)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return createToolExecutor({
    authHeader: 'Bearer user-jwt',
    functionsBaseUrl: 'https://project.supabase.co/functions/v1',
    cache: cache as never,
    tripId: 'trip-1',
    userId: 'user-1',
    itinerary,
    routingProviders: { amap: true, openRouteService: true },
    seedTrustedPlaces: [{
      alias: 'recent-place-1',
      name: 'ACROS Fukuoka',
      provider: 'osm',
      providerPlaceId: 'wv:ACROS rooftop garden',
      city: 'Fukuoka',
      coordinates: [33.5916, 130.4023],
    }],
  });
};

const linkedAcros = () => cacheFor({
  links: [{ provider: 'osm', provider_place_id: 'wv:ACROS rooftop garden', canonical_place_id: 'canon-acros' }],
  places: [{
    id: 'canon-acros',
    primary_name: 'ACROS Fukuoka',
    city: 'Fukuoka',
    neighbourhood: 'Tenjin',
    latitude: 33.5916,
    longitude: 130.4023,
  }],
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('a card may only be built on an identity the server issued', () => {
  it('resolves a discovered place into a card with its photograph and existing decision', async () => {
    const requests: RecordedRequest[] = [];
    const session = sessionWith(linkedAcros(), requests);

    await session.execute({ tool: 'search_places', args: { city: 'Fukuoka', limit: 5 } } as AgentToolCall);
    const cards = await session.resolvePlaceCards(['wikivoyage-ACROS%20rooftop%20garden']);

    expect(cards).toHaveLength(1);
    expect(cards[0].ref).toEqual({
      canonicalPlaceId: 'canon-acros',
      // The link table's provider, never the candidate's own 'wikivoyage'.
      provider: 'osm',
      providerPlaceId: 'wv:ACROS rooftop garden',
    });
    // Presentation comes from the canonical record, not from the candidate.
    expect(cards[0].name).toBe('ACROS Fukuoka');
    expect(cards[0].image?.url).toBe(ACROS_IMAGE);
    expect(cards[0].image?.attribution).toContain('CC BY-SA 3.0');
    // The one decision store, read rather than duplicated.
    expect(cards[0].decision).toBe('interested');
  });

  it('asks the image service by canonical identity alone, so a card buys no lookup', async () => {
    const requests: RecordedRequest[] = [];
    const session = sessionWith(linkedAcros(), requests);

    await session.execute({ tool: 'search_places', args: { city: 'Fukuoka', limit: 5 } } as AgentToolCall);
    await session.resolvePlaceCards(['wikivoyage-ACROS%20rooftop%20garden']);

    const images = requests.filter((request) => request.name === 'travel-images');
    expect(images).toHaveLength(1);
    // No leads: with nothing to look up, the service answers out of the
    // validated cache and makes zero provider calls.
    expect(images[0].body.placeLeads).toBeUndefined();
    expect(images[0].body.provider).toBe('osm');
  });

  it('refuses to build a card from a place name', async () => {
    const requests: RecordedRequest[] = [];
    const session = sessionWith(linkedAcros(), requests);

    await session.execute({ tool: 'search_places', args: { city: 'Fukuoka', limit: 5 } } as AgentToolCall);
    // The index files every place under its lowercased name so a routing call
    // can say "from ACROS rooftop garden". A card must not inherit that.
    const cards = await session.resolvePlaceCards(['acros rooftop garden']);

    expect(cards).toEqual([]);
    expect(requests.some((request) => request.name === 'travel-images')).toBe(false);
  });

  it('produces no card when the place has no canonical record', async () => {
    const requests: RecordedRequest[] = [];
    const session = sessionWith(cacheFor({ links: [], places: [] }), requests);

    await session.execute({ tool: 'search_places', args: { city: 'Fukuoka', limit: 5 } } as AgentToolCall);
    expect(await session.resolvePlaceCards(['wikivoyage-ACROS%20rooftop%20garden'])).toEqual([]);
  });

  it('cannot inherit another place image when two places share a name', async () => {
    const requests: RecordedRequest[] = [];
    // Two links, one canonical place each. Only the id that was issued to the
    // model resolves; the identically-named other place is unreachable.
    const cache = cacheFor({
      links: [
        { provider: 'osm', provider_place_id: 'wv:ACROS rooftop garden', canonical_place_id: 'canon-acros' },
        { provider: 'osm', provider_place_id: 'n999', canonical_place_id: 'canon-other' },
      ],
      places: [
        { id: 'canon-acros', primary_name: 'ACROS Fukuoka' },
        { id: 'canon-other', primary_name: 'ACROS rooftop garden' },
      ],
    });
    const session = sessionWith(cache, requests);

    await session.execute({ tool: 'search_places', args: { city: 'Fukuoka', limit: 5 } } as AgentToolCall);
    const cards = await session.resolvePlaceCards(['wikivoyage-ACROS%20rooftop%20garden']);

    expect(cards).toHaveLength(1);
    expect(cards[0].ref.canonicalPlaceId).toBe('canon-acros');
  });
});

describe('the answer contract holds place references to what the tools returned', () => {
  const answerWith = (placeIds: string[]) => ({ answer: 'Worth a look.', citations: [], placeIds });
  const placeEvidence = () =>
    collectEvidence(emptyEvidence(), 'search_places', [{ id: 'osm-n1', name: 'Fire Museum' }]);

  it('keeps an id a place tool returned', () => {
    const validated = validateAgentAnswer(answerWith(['osm-n1']), placeEvidence());
    expect(validated.placeIds).toEqual(['osm-n1']);
    expect(validated.rejected).toEqual([]);
  });

  it('rejects an id no tool returned, and says so', () => {
    const validated = validateAgentAnswer(answerWith(['osm-n999']), placeEvidence());
    expect(validated.placeIds).toEqual([]);
    expect(validated.rejected).toEqual([{ value: 'osm-n999', reason: 'unreferenced-place-id' }]);
  });

  it('never lets a name become a reference, even when the name is known', () => {
    const evidence = placeEvidence();
    expect(evidence.knownPlaceNames.has('fire museum')).toBe(true);
    expect(validateAgentAnswer(answerWith(['Fire Museum']), evidence).placeIds).toEqual([]);
  });

  it('does not make an id from a non-place tool referenceable', () => {
    const evidence = collectEvidence(emptyEvidence(), 'search_web', [{ id: 'result-1', name: 'A Fukuoka blog' }]);
    expect(validateAgentAnswer(answerWith(['result-1']), evidence).placeIds).toEqual([]);
  });

  it('de-duplicates so one place cannot produce two cards', () => {
    const validated = validateAgentAnswer(answerWith(['osm-n1', 'osm-n1']), placeEvidence());
    expect(validated.placeIds).toEqual(['osm-n1']);
  });

  it('leaves an answer with no place references untouched', () => {
    const validated = validateAgentAnswer({ answer: 'Your budget is fine.', citations: [] }, placeEvidence());
    expect(validated.placeIds).toEqual([]);
    expect(validated.rejected).toEqual([]);
  });
});

/**
 * Places carried across turns, seeded by the server after it re-established
 * them. The rule `strictlyKnown` enforces is unchanged — "the id must be one
 * the server put in this turn's index" — and this is the server putting one
 * there, rather than a second and weaker way to be trusted.
 */
describe('a place carried over from a previous answer', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('cards a seeded place by its alias, without any tool having run', async () => {
    const requests: RecordedRequest[] = [];
    const session = sessionWithSeed(linkedAcros(), requests);

    const cards = await session.resolvePlaceCards(['recent-place-1']);

    expect(cards).toHaveLength(1);
    expect(cards[0].ref.canonicalPlaceId).toBe('canon-acros');
    // The name comes from the canonical record, not from the seed.
    expect(cards[0].name).toBe('ACROS Fukuoka');
    expect(requests.some((request) => request.name === 'travel-discover')).toBe(false);
  });

  it('also accepts the real provider place id the server seeded', async () => {
    const session = sessionWithSeed(linkedAcros(), []);
    const cards = await session.resolvePlaceCards(['wv:ACROS rooftop garden']);
    expect(cards).toHaveLength(1);
  });

  /**
   * `registerPlace` files every place under its lowercased name too. That key
   * is a trapdoor `strictlyKnown` has always refused, and seeding must not
   * quietly open it.
   */
  it('still refuses a hit that came through the name key', async () => {
    const session = sessionWithSeed(linkedAcros(), []);
    expect(await session.resolvePlaceCards(['acros fukuoka'])).toEqual([]);
    expect(await session.resolvePlaceCards(['ACROS Fukuoka'])).toEqual([]);
  });

  it('refuses an alias the server did not seed', async () => {
    const session = sessionWithSeed(linkedAcros(), []);
    expect(await session.resolvePlaceCards(['recent-place-2'])).toEqual([]);
    expect(await session.resolvePlaceCards(['recent-place-99'])).toEqual([]);
  });

  it('cards nothing at all when the server seeded nothing', async () => {
    const session = sessionWith(linkedAcros(), []);
    expect(await session.resolvePlaceCards(['recent-place-1'])).toEqual([]);
  });
});

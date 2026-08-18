// Kept beside the Deno adapter so the browser TypeScript project does not
// follow its provider imports and attempt to typecheck Deno globals.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolExecutor } from './agentToolAdapters';
import type { AgentToolCall } from './agentContract';

const itinerary = {
  name: 'Osaka nights',
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }] },
  days: [{
    day: 1,
    city: 'Osaka',
    activities: [
      { id: 'hotel', name: 'Hotel', coordinates: [34.69, 135.5], provider: 'osm', providerPlaceId: 'node/1' },
      { id: 'castle', name: 'Osaka Castle', coordinates: [34.6873, 135.5262], provider: 'osm', providerPlaceId: 'way/2' },
    ],
  }],
};

const executor = (
  source: Record<string, unknown> = itinerary,
  routingProviders = { amap: true, openRouteService: true },
) => createToolExecutor({
  authHeader: 'Bearer user-jwt',
  functionsBaseUrl: 'https://project.supabase.co/functions/v1',
  cache: null,
  tripId: 'trip-1',
  userId: 'user-1',
  itinerary: source,
  routingProviders,
});

afterEach(() => vi.unstubAllGlobals());

describe('real agent tool adapters', () => {
  it('asks the routing function for one point-to-point pair, not a full matrix', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.origins).toHaveLength(1);
      expect(body.destinations).toHaveLength(1);
      expect(body.origins[0].placeId).toBe('node/1');
      expect(body.destinations[0].placeId).toBe('way/2');
      expect(body.provider).toBe('openrouteservice');
      expect(body.mode).toBe('walking');
      return new Response(JSON.stringify({ matrix: [[{ status: 'ok', durationMinutes: 27 }]] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executor()({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'walking' },
    } as AgentToolCall);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      result: {
        mode: 'walking',
        requestedMode: 'walking',
        providerMode: 'foot-walking',
        provider: 'openrouteservice',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('selects Amap for China using owned trip geography, not model input', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.provider).toBe('amap');
      return new Response(JSON.stringify({ matrix: [[{ status: 'ok', durationMinutes: 30 }]] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const chinaTrip = {
      ...itinerary,
      tripProfile: { destinations: [{ city: 'Beijing', countryCode: 'CN' }] },
      days: [{ ...itinerary.days[0], city: 'Beijing' }],
    };

    const result = await executor(chinaTrip)({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'walking' },
    } as AgentToolCall);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with route-unavailable before fetching when non-China ORS is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await executor(itinerary, { amap: true, openRouteService: false })({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'walking' },
    } as AgentToolCall);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      detail: expect.stringContaining('route-unavailable'),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses ORS public transport before fetching instead of mislabelling a walking route', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await executor()({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'transit' },
    } as AgentToolCall);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      detail: expect.stringContaining('route-unavailable'),
    }));
    expect(result).toEqual(expect.objectContaining({
      detail: expect.stringContaining('does not support public-transport'),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses unsupported Amap modes before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const chinaTrip = {
      ...itinerary,
      tripProfile: { destinations: [{ city: 'Beijing', countryCode: 'CN' }] },
      days: [{ ...itinerary.days[0], city: 'Beijing' }],
    };

    const result = await executor(chinaTrip)({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'driving' },
    } as AgentToolCall);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      detail: expect.stringContaining('route-unavailable'),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Phase 2A routing as one square batched matrix', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.provider).toBe('openrouteservice');
      expect(body.origins).toEqual(body.destinations);
      expect(body.origins).toHaveLength(2);
      return new Response(JSON.stringify({ matrix: [
        [{ status: 'ok', durationMinutes: 0 }, { status: 'ok', durationMinutes: 27 }],
        [{ status: 'ok', durationMinutes: 29 }, { status: 'ok', durationMinutes: 0 }],
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executor()({
      tool: 'get_route_matrix',
      args: { placeIds: ['hotel', 'castle'], mode: 'walking' },
    } as AgentToolCall);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registers discovered places so later route tools use provider coordinates', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/travel-discover')) {
        const body = JSON.parse(String(init?.body));
        expect(body.countryCode).toBe('JP');
        return new Response(JSON.stringify([{
          id: 'night-market',
          name: 'Night Market',
          city: 'Osaka',
          provider: 'osm',
          providerPlaceId: 'node/9',
          coordinates: [34.7, 135.51],
          categories: ['food'],
          imageLeads: [{ kind: 'wikidata', value: 'Q1' }],
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.destinations[0]).toEqual({ placeId: 'node/9', coordinates: [34.7, 135.51] });
      return new Response(JSON.stringify({ matrix: [[{ status: 'ok', durationMinutes: 12 }]] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const execute = executor();

    await execute({ tool: 'search_places', args: { city: 'Osaka', query: 'night market', limit: 5 } } as AgentToolCall);
    const routed = await execute({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'night-market', mode: 'walking' },
    } as AgentToolCall);

    expect(routed.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forwards the user JWT to every owned-trip tool function', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-jwt');
      return new Response(JSON.stringify({ matrix: [[{ status: 'ok', durationMinutes: 27 }]] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await executor()({
      tool: 'get_route',
      args: { fromPlaceId: 'hotel', toPlaceId: 'castle', mode: 'walking' },
    } as AgentToolCall);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat a missing proposal cache as the current plan', async () => {
    const result = await executor()({ tool: 'get_current_proposal', args: {} } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ present: false });
    expect(JSON.stringify(result.result)).not.toMatch(/revision|sha-256|hash/i);
  });

  it('returns Skip and Visited as persisted decisions, not recommendations', async () => {
    const result = await executor({
      ...itinerary,
      discoveryState: {
        decisions: { castle: 'must-do', skipped: 'skip', seen: 'visited' },
      },
    })({ tool: 'get_candidate_decisions', args: {} } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      byDecision: {
        skip: ['skipped'],
        visited: ['seen'],
        'must-do': ['castle'],
      },
    });
  });

  it('fits a place after an activity using remaining window, not a model estimate', async () => {
    const execute = createToolExecutor({
      authHeader: 'Bearer user-jwt',
      functionsBaseUrl: 'https://project.supabase.co/functions/v1',
      cache: null,
      tripId: 'trip-1',
      userId: 'user-1',
      itinerary: {
        days: [{
          day: 1,
          activities: [
            { id: 'lunch', name: 'Lunch', time: '12:00', durationMinutes: 60 },
            { id: 'flight', name: 'HAN → FUK', type: 'flight', time: '18:00', durationMinutes: 120 },
          ],
        }],
      },
      routingProviders: { amap: true, openRouteService: true },
    });
    const result = await execute({
      tool: 'check_schedule_fit',
      args: { afterActivityId: 'lunch', visitMinutes: 90 },
    } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      fitsWithoutTravel: true,
      remainingMinutes: 90,
      windowEndsAt: '14:30',
    });
  });

  it('does not fit a visit that would run into a flight departure lead', async () => {
    const execute = createToolExecutor({
      authHeader: 'Bearer user-jwt',
      functionsBaseUrl: 'https://project.supabase.co/functions/v1',
      cache: null,
      tripId: 'trip-1',
      userId: 'user-1',
      itinerary: {
        days: [{
          day: 1,
          activities: [
            { id: 'lunch', name: 'Lunch', time: '12:00', durationMinutes: 60 },
            { id: 'flight', name: 'HAN → FUK', type: 'flight', time: '18:00', durationMinutes: 120 },
          ],
        }],
      },
      routingProviders: { amap: true, openRouteService: true },
    });
    const result = await execute({
      tool: 'check_schedule_fit',
      args: { afterActivityId: 'lunch', visitMinutes: 120 },
    } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ fitsWithoutTravel: false, remainingMinutes: 90 });
  });

  it('starts sightseeing after the arrival settling window, not at landing', async () => {
    const execute = createToolExecutor({
      authHeader: 'Bearer user-jwt',
      functionsBaseUrl: 'https://project.supabase.co/functions/v1',
      cache: null,
      tripId: 'trip-1',
      userId: 'user-1',
      itinerary: {
        days: [{
          day: 1,
          activities: [
            { id: 'flight', name: 'HAN → FUK', type: 'flight', time: '10:00', durationMinutes: 120 },
          ],
        }],
      },
      routingProviders: { amap: true, openRouteService: true },
      uiFocus: {
        surface: 'itinerary',
        dayNumber: 1,
        selectedActivity: { id: 'flight', name: 'HAN → FUK', time: '10:00', durationMinutes: 120, type: 'flight', day: 1 },
        note: '',
      },
    });
    const result = await execute({
      tool: 'check_schedule_fit',
      args: { afterActivityId: 'flight', visitMinutes: 90 },
    } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      after: { id: 'flight', endsAt: '12:00' },
      remainingMinutes: 450,
      windowEndsAt: '21:30',
      fitsWithoutTravel: true,
    });
  });

  it('reports document metadata without pretending extraction exists', async () => {
    const result = await executor()({ tool: 'get_document_facts', args: {} } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ extraction: 'unavailable', documents: [] });
  });

  it('reports a missing budget as missing, not as an estimate', async () => {
    const result = await executor()({ tool: 'get_budget_summary', args: {} } as AgentToolCall);
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ present: false });
    expect(String((result.result as { note?: string }).note)).toMatch(/not estimated/i);
  });
});

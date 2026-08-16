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

const executor = () => createToolExecutor({
  authHeader: 'Bearer user-jwt',
  functionsBaseUrl: 'https://project.supabase.co/functions/v1',
  cache: null,
  tripId: 'trip-1',
  userId: 'user-1',
  itinerary,
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
});

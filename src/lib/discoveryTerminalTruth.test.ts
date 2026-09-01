// @vitest-environment node

/**
 * What the server is entitled to say when it stops early.
 *
 * "No places were returned for Osaka" is a claim about Osaka. A run that spent
 * its budget on two empty rounds and never reached the fallback has established
 * nothing about the city, and may only report that it ran out of time. Both
 * facts shared one representation, so an exhausted clock was published as an
 * empty destination.
 *
 * The handler is a Deno module, so it is driven here rather than reasoned
 * about: `Deno.serve` is captured, `fetch` is stubbed, and the clock is moved
 * by each source as it answers. The timings are the ones an independent review
 * measured against the shipped code.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let handler: (request: Request) => Promise<Response>;

/** Virtual now, advanced by the sources rather than by waiting. */
let now = 0;

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (fn: (request: Request) => Promise<Response>) => { handler = fn; },
    // No Supabase credentials: serviceClient() returns null, so the cache path
    // is skipped and this exercises the source phase alone.
    env: { get: () => '' },
  });
  /*
   * Loaded through a computed specifier on purpose.
   *
   * The handler is a Deno module: it reads `Deno.env` and its transitive
   * imports use globals the browser tsconfig does not carry. A literal import
   * would pull all of that into the typecheck program and break `tsc -b`,
   * which is why the other suites read this file as text instead. Resolving
   * the path at runtime keeps it out of the program while still executing the
   * real handler, so this stays a behavioural test rather than a string match.
   */
  const handlerModule = ['..', '..', 'supabase', 'functions', 'travel-discover', 'index.ts'].join('/');
  await import(/* @vite-ignore */ handlerModule);
});

beforeEach(() => {
  now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => vi.restoreAllMocks());

const discover = (body: Record<string, unknown>) => handler(new Request('https://edge.test/travel-discover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}));

/** Osaka, planning mode, coordinates supplied so geocoding is skipped. */
const osakaPlanning = {
  city: 'Osaka',
  countryCode: 'JP',
  provider: 'osm',
  mode: 'planning',
  lat: 34.6937,
  lng: 135.5023,
  limit: 60,
  // A preferred round exists only when styles were chosen; without one the
  // fallback is the first round and the decision point is never budget-bound.
  interests: ['museums', 'temples'],
};

describe('a request that runs out of time says so', () => {
  /**
   * The measured shape: Wikivoyage empty at 12.0s, Overpass empty at 21.6s.
   * That leaves 7.4s of the 41s source budget — below the 8s an Overpass round
   * needs — so the fallback is correctly skipped. The question is what the
   * response then claims.
   */
  it('does not report an empty city when the fallback was skipped for budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('wikivoyage.org')) {
        now = 12_000;
        return json({ query: { pages: {} } });
      }
      // The sights and food queries run concurrently, so they land together
      // rather than one after the other.
      now = 33_600;
      return json({ elements: [] });
    }));

    const response = await discover(osakaPlanning);
    const payload = await response.json() as { error?: string; code?: string; sourceReport?: Record<string, boolean> };

    expect(response.status).not.toBe(404);
    expect(payload.error).not.toContain('No places were returned');

    expect(response.status).toBe(503);
    expect(payload.code).toBe('discovery-sources-unavailable');
    expect(payload.sourceReport?.deadlineExceeded).toBe(true);
  });

  /**
   * The other cause keeps its own meaning. Overpass failing is evidence about
   * the source, not about the clock, and must not be relabelled as a timeout
   * when the request still had budget to spend.
   */
  it('does not call a source failure a deadline when time remained', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('wikivoyage.org')) {
        now = 500;
        return json({ query: { pages: {} } });
      }
      now = 1_000;
      throw new Error('Overpass is down');
    }));

    const response = await discover(osakaPlanning);
    const payload = await response.json() as { code?: string; sourceReport?: Record<string, boolean> };

    expect(response.status).toBe(503);
    expect(payload.code).toBe('discovery-sources-unavailable');
    expect(payload.sourceReport?.overpassFailed).toBe(true);
    expect(payload.sourceReport?.deadlineExceeded).toBe(false);
  });

  /**
   * And a source that genuinely answers "nothing here" while the request still
   * has time is still allowed to say so — the 404 must not become unreachable.
   */
  it('still reports an empty city when the sources actually answered in time', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('wikivoyage.org')) {
        now = 400;
        return json({ query: { pages: {} } });
      }
      now = 600;
      return json({ elements: [] });
    }));

    const response = await discover(osakaPlanning);
    const payload = await response.json() as { error?: string; sourceReport?: Record<string, boolean> };

    expect(response.status).toBe(404);
    expect(payload.error).toContain('No places were returned');
  });
});

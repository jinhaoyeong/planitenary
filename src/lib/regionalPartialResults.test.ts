// @vitest-environment node

/**
 * What survives when a later provider query fails.
 *
 * Amap and Baidu awaited their fetch bare inside the batch loop, so one slow
 * third query rejected out of the whole search and threw away the places the
 * first two had already returned. Clamping each call to the remaining request
 * budget — the previous release — makes that timeout more likely near the
 * deadline, not less, so the loss became a live path for the configured
 * regional provider.
 *
 * The handler is a Deno module, so it is driven rather than reasoned about:
 * `Deno.serve` is captured and `fetch` answers each successive query from a
 * script. The specifier is computed so TypeScript does not pull Deno globals
 * into the app's typecheck program.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let handler: (request: Request) => Promise<Response>;
let now = 0;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

/** An Amap POI shaped enough to survive candidate construction. */
const poi = (id: string, name: string) => ({
  id,
  name,
  location: '135.5023,34.6937',
  address: `${name} address`,
  type: 'Park',
  // A general query only admits a strong candidate, and regionalCandidate
  // derives notability from a rating of 4.5 or better.
  biz_ext: { rating: '4.8' },
});

/** The Baidu equivalent. */
const baiduPoi = (uid: string, name: string) => ({
  uid,
  name,
  location: { lat: 34.6937, lng: 135.5023 },
  address: `${name} address`,
  detail_info: { tag: 'Park', overall_rating: '4.8' },
});

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (fn: (request: Request) => Promise<Response>) => { handler = fn; },
    env: {
      get: (name: string) => (name === 'AMAP_API_KEY' || name === 'BAIDU_API_KEY' ? 'test-key' : ''),
    },
  });
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

const amapRequest = {
  city: 'Shanghai',
  countryCode: 'CN',
  provider: 'amap',
  mode: 'planning',
  limit: 60,
  interests: [],
};

/** Answer each successive provider query from a queued script. */
const scriptedFetch = (steps: Array<() => Response>) => {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    now += 1_000;
    return step();
  }));
};

const namesOf = (body: unknown) => (body as Array<{ name: string }>).map((entry) => entry.name);

describe('Amap keeps what earlier queries already found', () => {
  it('A. survives a timeout on a later query', async () => {
    scriptedFetch([
      () => json({ status: '1', pois: [poi('a1', 'Yu Garden'), poi('a2', 'Bund Museum')] }),
      () => json({ status: '1', pois: [poi('a3', 'Jade Temple')] }),
      () => { throw new Error('The signal has been aborted'); },
    ]);

    const response = await discover(amapRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(namesOf(body)).toEqual(expect.arrayContaining(['Yu Garden', 'Bund Museum', 'Jade Temple']));
  });

  it('B. survives an outright network rejection after one good query', async () => {
    scriptedFetch([
      () => json({ status: '1', pois: [poi('a1', 'Yu Garden')] }),
      () => { throw new TypeError('network error'); },
    ]);

    const response = await discover(amapRequest);

    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toContain('Yu Garden');
  });

  it('C. still reports the outage when nothing was collected at all', async () => {
    scriptedFetch([() => { throw new Error('Provider responded 429'); }]);

    const response = await discover(amapRequest);
    const body = await response.json() as { error?: string };

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain('No places were returned');
  });

  it('D. leaves a genuinely empty city genuinely empty', async () => {
    scriptedFetch([() => json({ status: '1', pois: [] })]);

    const response = await discover(amapRequest);
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('No places were returned');
  });

  it('E. keeps candidates when the deadline expires after they were collected', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      if (call === 1) {
        now += 1_000;
        return json({ status: '1', pois: [poi('a1', 'Yu Garden')] });
      }
      now = 44_500; // past the source clock, still inside the request budget
      return json({ status: '1', pois: [] });
    }));

    const response = await discover(amapRequest);

    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toContain('Yu Garden');
  });

  it('F. reports sources-unavailable when the deadline expires before anything useful', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      now = 44_500;
      return json({ status: '1', pois: [] });
    }));

    const response = await discover(amapRequest);
    const body = await response.json() as { code?: string; sourceReport?: Record<string, boolean> };

    expect(response.status).toBe(503);
    expect(body.code).toBe('discovery-sources-unavailable');
    expect(body.sourceReport?.deadlineExceeded).toBe(true);
  });

  it('G. does not duplicate a place returned by two successful queries', async () => {
    scriptedFetch([
      () => json({ status: '1', pois: [poi('a1', 'Yu Garden')] }),
      () => json({ status: '1', pois: [poi('a1', 'Yu Garden')] }),
    ]);

    const response = await discover(amapRequest);
    const body = await response.json() as Array<{ name: string }>;

    expect(body.filter((entry) => entry.name === 'Yu Garden')).toHaveLength(1);
  });

  /** A failure costs its own query and no more: it must not buy a second attempt. */
  it('does not retry a failed query', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(new URL(url).searchParams.get('keywords') || '');
      now += 1_000;
      if (seen.length === 2) throw new Error('boom');
      return json({ status: '1', pois: [poi(`a${seen.length}`, `Place ${seen.length}`)] });
    }));

    await discover(amapRequest);

    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('Baidu carries the same guard', () => {
  it('keeps earlier candidates when a later query fails', async () => {
    scriptedFetch([
      () => json({ status: 0, results: [baiduPoi('b1', 'West Lake')] }),
      () => { throw new Error('The signal has been aborted'); },
    ]);

    const response = await discover({ ...amapRequest, provider: 'baidu' });

    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toContain('West Lake');
  });
});

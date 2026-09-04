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
 * A failure also ends the batch. The plan is seven queries, so carrying on
 * after the first ProviderError would turn one failed call into seven during
 * an outage or a rate limit. Preserving what was already collected does not
 * require asking a provider that has just failed for the rest of the plan.
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

/**
 * A POI that parses into a candidate and is then filtered out.
 *
 * Identical but for the rating, which is what the general-query admission gate
 * reads. It is the shape that separates how many places were parsed from how
 * many places can be answered with, and only the second is an answer.
 */
const unratedPoi = (id: string, name: string) => ({
  id,
  name,
  location: '135.5023,34.6937',
  address: `${name} address`,
  type: 'Park',
});

/** The Baidu equivalent. */
const baiduPoi = (uid: string, name: string) => ({
  uid,
  name,
  location: { lat: 34.6937, lng: 135.5023 },
  address: `${name} address`,
  detail_info: { tag: 'Park', overall_rating: '4.8' },
});

/** The Baidu parsed-but-unadmitted equivalent. */
const unratedBaiduPoi = (uid: string, name: string) => ({
  uid,
  name,
  location: { lat: 34.6937, lng: 135.5023 },
  address: `${name} address`,
  detail_info: { tag: 'Park' },
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

/**
 * Answer each successive provider query from a queued script.
 *
 * The last step repeats, so a script ending in a failure keeps failing. That
 * is what makes the returned call count meaningful: nothing but the handler
 * decides when to stop asking.
 */
const scriptedFetch = (steps: Array<() => Response>) => {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    now += 1_000;
    return step();
  }));
  return { get count() { return call; } };
};

/** Record the query text of every call the handler actually makes. */
const queryLog = (answer: (call: number) => Response) => {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.searchParams.get('keywords') || url.searchParams.get('query') || '');
    now += 1_000;
    return answer(asked.length);
  }));
  return asked;
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

  /**
   * H. The success test is the admitted records, not the parsed entries.
   *
   * A general query admits only a strong candidate, so an unrated POI parses
   * and is then filtered out. Judging the outage by the raw entries sees one
   * entry, suppresses the failure, and answers with the no-places message - a
   * factual claim about the city, made during a provider outage.
   */
  it('H. reports the outage when every parsed place was filtered out', async () => {
    scriptedFetch([
      () => json({ status: '1', pois: [unratedPoi('a1', 'Unrated Lane')] }),
      () => { throw new Error('Provider responded 503'); },
    ]);

    const response = await discover(amapRequest);
    const body = await response.json() as { error?: string };

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain('No places were returned');
  });

  /**
   * I. An outage costs one call, not the whole plan.
   *
   * Preserving earlier results is the point of this change; continuing to
   * query a provider that has just failed is not. The batch is seven queries,
   * so carrying on multiplies an outage or a rate limit sevenfold.
   */
  it('I. attempts exactly one query during a total outage', async () => {
    const script = scriptedFetch([() => { throw new Error('Provider responded 429'); }]);

    await discover(amapRequest);

    expect(script.count).toBe(1);
  });

  /** J. A partial run stops at the query that failed, keeping what came before. */
  it('J. stops at the failed query and keeps the places before it', async () => {
    const asked = queryLog((call) => {
      if (call === 2) throw new Error('boom');
      return json({ status: '1', pois: [poi(`a${call}`, `Place ${call}`)] });
    });

    const response = await discover(amapRequest);

    expect(asked).toHaveLength(2);
    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toContain('Place 1');
  });

  /**
   * K. A clamped call aborting near the deadline is the expected way this
   * batch ends. It keeps what it has and stops, rather than spending the rest
   * of the budget rediscovering that the provider is unreachable.
   */
  it('K. keeps its places and stops when a clamped call aborts', async () => {
    const asked = queryLog((call) => {
      if (call === 3) throw new Error('The signal has been aborted');
      return json({ status: '1', pois: [poi(`a${call}`, `Place ${call}`)] });
    });

    const response = await discover(amapRequest);

    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toEqual(expect.arrayContaining(['Place 1', 'Place 2']));
    expect(asked).toHaveLength(3);
  });

  /**
   * L. The plan the failures above stop short of.
   *
   * Without this, "exactly one call" and "exactly two calls" would pass just
   * as well against a handler that only ever made one query.
   */
  it('L. asks the whole plan when nothing fails', async () => {
    const asked = queryLog(() => json({ status: '1', pois: [] }));

    await discover(amapRequest);

    expect(asked.length).toBeGreaterThan(3);
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

  it('reports the outage when every parsed place was filtered out', async () => {
    scriptedFetch([
      () => json({ status: 0, results: [unratedBaiduPoi('b1', 'Unrated Lane')] }),
      () => { throw new Error('Provider responded 503'); },
    ]);

    const response = await discover({ ...amapRequest, provider: 'baidu' });
    const body = await response.json() as { error?: string };

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain('No places were returned');
  });

  it('attempts exactly one query during a total outage', async () => {
    const script = scriptedFetch([() => { throw new Error('Provider responded 429'); }]);

    await discover({ ...amapRequest, provider: 'baidu' });

    expect(script.count).toBe(1);
  });

  it('stops at the failed query and keeps the places before it', async () => {
    const asked = queryLog((call) => {
      if (call === 2) throw new Error('boom');
      return json({ status: 0, results: [baiduPoi(`b${call}`, `Place ${call}`)] });
    });

    const response = await discover({ ...amapRequest, provider: 'baidu' });

    expect(asked).toHaveLength(2);
    expect(response.status).toBe(200);
    expect(namesOf(await response.json())).toContain('Place 1');
  });
});

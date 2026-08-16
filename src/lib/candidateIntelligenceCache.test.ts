/**
 * Reading the candidate-intelligence cache.
 *
 * This suite exists because of a production failure that cost real money and
 * announced nothing: a paid answer was written, an identical replay looked for
 * it, and the row was invisible. Everything above the cache behaved perfectly —
 * the key was right, the row was there, the request was byte-identical — and
 * the lookup silently matched nothing.
 *
 * The cause was the filter, not the key. `.in('cache_key', keys)` builds
 * PostgREST's quoted-CSV list grammar, and postgrest-js quotes a value
 * containing `[,()]` without escaping the quotes already inside it. Every cache
 * key here is a `JSON.stringify`'d array, so every key is full of quotes: the
 * value closed its own quoting early and the list parsed into tokens matching
 * nothing. No error, no row, indistinguishable from a genuine miss.
 *
 * So the tests below fix three things in place: exact keys survive the round
 * trip whatever punctuation they carry, a stored NULL is a hit rather than an
 * absence, and a failed read is its own outcome rather than a miss.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readCandidateIntelligence } from '../../supabase/functions/_shared/candidateIntelligenceCache';
import { intelligenceCacheKey } from '../../supabase/functions/_shared/candidateIntelligence';
import { resolveCandidateIntelligence } from '../../supabase/functions/_shared/intelligenceService';
import type {
  IntelligenceCandidate,
  IntelligenceTripContext,
} from '../../supabase/functions/_shared/candidateIntelligence';

interface Row {
  cache_key: string;
  trip_id: string;
  intelligence: unknown;
  expires_at: string;
}

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

/**
 * A Postgrest-shaped double that answers only exact equality.
 *
 * Deliberately strict: it matches on the literal string it was given, so a key
 * that arrives mangled by a filter grammar finds nothing here exactly as it
 * found nothing in production.
 */
function fakeClient(rows: Row[], options: { failEveryRead?: boolean; failKey?: string; throwOnRead?: boolean } = {}) {
  const seenFilters: Array<Record<string, string>> = [];
  const client = {
    from: () => ({
      select: () => {
        const filters: Record<string, string> = {};
        const builder = {
          eq(column: string, value: string) { filters[column] = value; return builder; },
          async maybeSingle() {
            seenFilters.push({ ...filters });
            if (options.throwOnRead) throw new Error('connection reset');
            if (options.failEveryRead || (options.failKey && filters.cache_key === options.failKey)) {
              return { data: null, error: { message: 'read failed', code: '57P01' } };
            }
            const found = rows.find(
              (row) => row.cache_key === filters.cache_key && row.trip_id === filters.trip_id,
            );
            return { data: found ?? null, error: null };
          },
        };
        return builder;
      },
    }),
  };
  return { client: client as never, seenFilters };
}

const keyFor = (over: Partial<Parameters<typeof intelligenceCacheKey>[0]> = {}) => intelligenceCacheKey({
  tripId: 'trip-1',
  candidateId: 'osm:node:123',
  candidateRevision: 'ci-candidate-v1:{"durationRangeMinutes":null,"indoorOutdoor":null,"matchedStyleTags":["food","temples"]}',
  plannerRevision: 'ci-planner-v1:{"clusterId":null,"pairableCandidateIds":[]}',
  tripMaterialRevision: 'ci-trip-v1:{"pace":"relaxed","styles":["temples"]}',
  model: 'gpt-5-nano',
  ...over,
});

describe('the cache key survives the lookup that reads it', () => {
  /**
   * The regression that would have caught the production failure. A key
   * carrying the punctuation these keys always carry must come back.
   */
  it('finds a row whose key contains commas, quotes, brackets and JSON', async () => {
    const key = keyFor();
    expect(key).toContain('"');
    expect(key).toContain(',');
    expect(key).toContain('[');

    const { client } = fakeClient([
      { cache_key: key, trip_id: 'trip-1', intelligence: { candidateId: 'osm:node:123' }, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [key]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(key)).toBe(true);
    expect(read.entries.get(key)).toMatchObject({ candidateId: 'osm:node:123' });
  });

  /**
   * The exact production shape: the model ran, nothing survived validation, and
   * that emptiness was stored. Reading it back as "no entry" would buy the same
   * answer again every single time — which is what a truthiness check does.
   */
  it('treats a stored NULL as a hit, not an absence', async () => {
    const key = keyFor();
    const { client } = fakeClient([
      { cache_key: key, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [key]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // Presence, not truthiness. Both assertions matter: the second alone would
    // pass for a key that was never stored at all.
    expect(read.entries.has(key)).toBe(true);
    expect(read.entries.get(key)).toBeNull();
  });

  it('returns both answers when two keys are stored', async () => {
    const first = keyFor({ candidateId: 'osm:node:1' });
    const second = keyFor({ candidateId: 'osm:way:2' });
    const { client } = fakeClient([
      { cache_key: first, trip_id: 'trip-1', intelligence: { candidateId: 'osm:node:1' }, expires_at: future() },
      { cache_key: second, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [first, second]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.size).toBe(2);
    expect(read.entries.get(first)).toMatchObject({ candidateId: 'osm:node:1' });
    expect(read.entries.get(second)).toBeNull();
  });

  it('separates a hit from a genuine miss in the same read', async () => {
    const stored = keyFor({ candidateId: 'osm:node:1' });
    const absent = keyFor({ candidateId: 'osm:node:missing' });
    const { client } = fakeClient([
      { cache_key: stored, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [stored, absent]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(stored)).toBe(true);
    // A miss is an absent key, which is what the service reads as `undefined`.
    expect(read.entries.has(absent)).toBe(false);
    expect(read.entries.get(absent)).toBeUndefined();
  });

  it('skips a row whose expiry has passed', async () => {
    const key = keyFor();
    const { client } = fakeClient([
      { cache_key: key, trip_id: 'trip-1', intelligence: null, expires_at: past() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [key]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(key)).toBe(false);
  });
});

/**
 * Identity is what makes a cached answer safe to serve. These prove the fix
 * did not widen it — an exact-equality lookup must stay exact.
 */
describe('cache identity is not weakened by the exact lookup', () => {
  it('misses when the candidate revision differs', async () => {
    const stored = keyFor();
    const changed = keyFor({ candidateRevision: 'ci-candidate-v1:{"matchedStyleTags":["food"]}' });
    const { client } = fakeClient([
      { cache_key: stored, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [changed]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(changed)).toBe(false);
  });

  it('misses when the trip material revision differs', async () => {
    const stored = keyFor();
    const changed = keyFor({ tripMaterialRevision: 'ci-trip-v1:{"pace":"active","styles":["temples"]}' });
    const { client } = fakeClient([
      { cache_key: stored, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [changed]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(changed)).toBe(false);
  });

  it('never reuses another trip’s answer', async () => {
    // Same candidate, same material, different trip: both the key and the
    // trip_id filter have to keep these apart.
    const otherTripKey = keyFor({ tripId: 'trip-2' });
    const { client } = fakeClient([
      { cache_key: otherTripKey, trip_id: 'trip-2', intelligence: { candidateId: 'osm:node:123' }, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [keyFor()]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.size).toBe(0);
  });

  it('scopes every lookup to the requested trip', async () => {
    const key = keyFor();
    const { client, seenFilters } = fakeClient([]);

    await readCandidateIntelligence(client, 'trip-1', [key]);

    expect(seenFilters).toHaveLength(1);
    expect(seenFilters[0].trip_id).toBe('trip-1');
    // The key reaches the database exactly as it was built.
    expect(seenFilters[0].cache_key).toBe(key);
  });

  it('misses when the model differs', async () => {
    const stored = keyFor();
    const changed = keyFor({ model: 'gpt-5-mini' });
    const { client } = fakeClient([
      { cache_key: stored, trip_id: 'trip-1', intelligence: null, expires_at: future() },
    ]);

    const read = await readCandidateIntelligence(client, 'trip-1', [changed]);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.has(changed)).toBe(false);
  });
});

describe('a failed read is its own outcome', () => {
  it('reports a database error rather than an empty result', async () => {
    const key = keyFor();
    const { client } = fakeClient([], { failEveryRead: true });

    const read = await readCandidateIntelligence(client, 'trip-1', [key]);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('cache-read-failed');
  });

  it('fails the whole read when only one key errors', async () => {
    // Otherwise the healthy keys look like hits and the broken one looks like a
    // miss — and the miss is the one that spends money.
    const good = keyFor({ candidateId: 'osm:node:1' });
    const bad = keyFor({ candidateId: 'osm:node:2' });
    const { client } = fakeClient(
      [{ cache_key: good, trip_id: 'trip-1', intelligence: null, expires_at: future() }],
      { failKey: bad },
    );

    const read = await readCandidateIntelligence(client, 'trip-1', [good, bad]);

    expect(read.ok).toBe(false);
  });

  it('reports a thrown transport error as a failed read', async () => {
    const { client } = fakeClient([], { throwOnRead: true });
    const read = await readCandidateIntelligence(client, 'trip-1', [keyFor()]);
    expect(read.ok).toBe(false);
  });

  it('reports an unconfigured cache rather than pretending it is empty', async () => {
    const read = await readCandidateIntelligence(null, 'trip-1', [keyFor()]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('cache-unconfigured');
  });

  it('succeeds trivially when nothing was asked for', async () => {
    const { client } = fakeClient([], { failEveryRead: true });
    const read = await readCandidateIntelligence(client, 'trip-1', []);
    expect(read.ok).toBe(true);
  });
});

/**
 * Why this is not `.in()`.
 *
 * Built offline from the real client, so it asserts what postgrest-js would
 * actually put on the wire. If someone reintroduces the list filter for these
 * keys, this fails and says why rather than leaving a silent cache miss to be
 * discovered by a bill.
 */
describe('the PostgREST filter these keys require', () => {
  const client = createClient('https://example.supabase.co', 'anon-key-placeholder');
  const key = keyFor();

  it('mangles a JSON cache key inside an in.() list', () => {
    const builder = client.from('ai_candidate_intelligence').select('cache_key').in('cache_key', [key]);
    const filter = decodeURIComponent((builder as unknown as { url: URL }).url.searchParams.get('cache_key')!);
    const list = filter.replace(/^in\.\(/, '').replace(/\)$/, '');

    // The value is wrapped in quotes it also contains, unescaped, so the
    // quoted token ends inside the key instead of at its end.
    expect(list.startsWith('"')).toBe(true);
    expect(list.slice(1, -1)).toContain('"');
    expect(filter).not.toContain(`in.("${key.replace(/"/g, '\\"')}")`);
  });

  it('carries a JSON cache key through eq. untouched', () => {
    const builder = client.from('ai_candidate_intelligence').select('cache_key').eq('cache_key', key);
    const filter = decodeURIComponent((builder as unknown as { url: URL }).url.searchParams.get('cache_key')!);

    // No list grammar to misparse: the argument runs to the end of the filter.
    expect(filter).toBe(`eq.${key}`);
  });
});

/**
 * The production acceptance shape, end to end over the injected service.
 *
 * First request: cache miss, one metered call, a null answer stored. Replay of
 * the identical request: cache hit, no provider call at all. This is the exact
 * sequence that failed in production.
 */
describe('the production replay that failed', () => {
  const trip: IntelligenceTripContext = {
    tripMaterialRevision: 'ci-trip-v1:{"pace":"relaxed","styles":["temples"]}',
    styles: ['temples'],
    pace: 'relaxed',
  };
  const candidate: IntelligenceCandidate = {
    candidateId: 'phase-a:probe:1',
    candidateRevision: 'ci-candidate-v1:{"durationRangeMinutes":null,"indoorOutdoor":null,"matchedStyleTags":[]}',
    plannerRevision: 'ci-planner-v1:{"clusterId":null,"pairableCandidateIds":[]}',
    name: 'Probe',
    category: '',
    matchedStyleTags: [],
    pairableCandidateIds: [],
  };

  it('replays from cache without reaching the provider', async () => {
    // One store shared by both requests, read and written through the real
    // cache implementation over the Postgrest double.
    const rows: Row[] = [];
    const { client } = fakeClient(rows);
    const callMetered = vi.fn(async () => ({
      ok: true as const,
      // Nothing survives validation for this candidate: it carries no matched
      // style tags, so the answer is a real, storable emptiness.
      result: { candidates: { 'phase-a:probe:1': { candidateRevision: candidate.candidateRevision, reasonAtoms: [], cautionAtoms: [] } } },
    }));
    const deps = {
      model: 'gpt-5-nano',
      tripId: 'trip-1',
      maxSerialisedChars: 30_000,
      readCache: (keys: string[]) => readCandidateIntelligence(client, 'trip-1', keys) as never,
      writeCache: async (entries: Array<{ cacheKey: string; intelligence: unknown }>) => {
        for (const entry of entries) {
          rows.push({
            cache_key: entry.cacheKey, trip_id: 'trip-1', intelligence: entry.intelligence, expires_at: future(),
          });
        }
      },
      callMetered,
    };

    const first = await resolveCandidateIntelligence(trip, [candidate], deps);
    expect(first.diagnostics).toMatchObject({ cacheHits: 0, cacheMisses: 1, meteredRequests: 1 });
    expect(first.results[0]).toMatchObject({ intelligence: null, status: 'deterministic-only' });
    expect(rows).toHaveLength(1);
    expect(rows[0].intelligence).toBeNull();

    const replay = await resolveCandidateIntelligence(trip, [candidate], deps);

    expect(replay.diagnostics).toMatchObject({ cacheHits: 1, cacheMisses: 0, meteredRequests: 0, batches: 0 });
    expect(replay.results[0]).toMatchObject({ intelligence: null, status: 'deterministic-only' });
    // The whole point: the second request cost nothing.
    expect(callMetered).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider when the replay cache read fails', async () => {
    const { client } = fakeClient([], { failEveryRead: true });
    const callMetered = vi.fn(async () => ({ ok: true as const, result: { candidates: {} } }));
    const deps = {
      model: 'gpt-5-nano',
      tripId: 'trip-1',
      maxSerialisedChars: 30_000,
      readCache: (keys: string[]) => readCandidateIntelligence(client, 'trip-1', keys) as never,
      writeCache: vi.fn(async () => {}),
      callMetered,
    };

    const { results, diagnostics } = await resolveCandidateIntelligence(trip, [candidate], deps);

    expect(callMetered).not.toHaveBeenCalled();
    expect(diagnostics.meteredRequests).toBe(0);
    expect(diagnostics.blockedReason).toBe('cache-read-failed');
    expect(results[0]).toMatchObject({ intelligence: null, status: 'unavailable' });
    expect(deps.writeCache).not.toHaveBeenCalled();
  });
});

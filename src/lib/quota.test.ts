/**
 * Tests for the application-side quota cap, imported straight from the Deno
 * `_shared` module — it holds no Deno APIs and only a type-level import of the
 * Supabase client, so it loads here exactly as it does in the function.
 */
import { describe, expect, it, vi } from 'vitest';
import { reserveQuota, usageToday } from '../../supabase/functions/_shared/quota';

type Client = Parameters<typeof reserveQuota>[0];

const rpcClient = (result: { data?: unknown; error?: unknown } | (() => never)) => ({
  rpc: typeof result === 'function' ? vi.fn(result) : vi.fn().mockResolvedValue(result),
}) as unknown as Client;

const request = {
  provider: 'youtube-search',
  calls: 1,
  units: 100,
  callLimit: 90,
  resetTimezone: 'America/Los_Angeles',
};

describe('reserving quota before a call', () => {
  it('allows a call the counter accepted', async () => {
    expect(await reserveQuota(rpcClient({ data: true }), request)).toBe(true);
  });

  it('refuses a call once the day is spent', async () => {
    expect(await reserveQuota(rpcClient({ data: false }), request)).toBe(false);
  });

  it('passes the provider its own reset timezone', async () => {
    // YouTube resets at midnight Pacific. Counting in UTC would misalign the
    // reset by up to eight hours, locking the app out early or freeing it late.
    const client = rpcClient({ data: true });
    await reserveQuota(client, request);
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'consume_provider_quota',
      expect.objectContaining({ p_reset_timezone: 'America/Los_Angeles', p_call_limit: 90 }),
    );
  });

  it('allows the call when there is no counter configured', async () => {
    expect(await reserveQuota(null, request)).toBe(true);
  });

  it('fails open when the counter cannot be reached', async () => {
    // Exceeding a YouTube quota costs nothing but an error response — there is
    // no bill on the other side of it. Failing closed would turn a brief
    // database problem into a total loss of evidence, which is the worse of
    // the two outcomes.
    expect(await reserveQuota(rpcClient({ error: { message: 'unavailable' } }), request)).toBe(true);
    expect(await reserveQuota(rpcClient(() => { throw new Error('network'); }), request)).toBe(true);
  });
});

describe('reporting the day’s usage', () => {
  const tableClient = (result: { data?: unknown; error?: unknown }) => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(result) }),
        }),
      }),
    }),
  }) as unknown as Client;

  it('reports what has been used today', async () => {
    expect(await usageToday(tableClient({ data: { calls: 42, units: 4200 } }), 'youtube-search', 'UTC'))
      .toEqual({ calls: 42, units: 4200 });
  });

  it('reports zero rather than nothing before the first call of the day', async () => {
    expect(await usageToday(tableClient({ data: null }), 'youtube-search', 'UTC'))
      .toEqual({ calls: 0, units: 0 });
  });

  it('reports unknown when there is no counter', async () => {
    expect(await usageToday(null, 'youtube-search', 'UTC')).toBeNull();
  });
});

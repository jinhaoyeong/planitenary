/**
 * Tests for the application-side quota cap, imported straight from the Deno
 * `_shared` module — it holds no Deno APIs and only a type-level import of the
 * Supabase client, so it loads here exactly as it does in the function.
 */
import { describe, expect, it, vi } from 'vitest';
import { reserveAiReasoningAttempt, reserveQuota, usageToday } from '../../supabase/functions/_shared/quota';

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

  it('reports unknown rather than zero when the counter cannot be read', async () => {
    // The state right after deploying the function but before the migration:
    // the table does not exist. Reporting zero would claim the day's allowance
    // is untouched, which is a guess dressed as a measurement.
    expect(await usageToday(tableClient({ error: { message: 'relation does not exist' } }), 'youtube-search', 'UTC'))
      .toBeNull();
  });
});

describe('reserving a metered AI attempt', () => {
  const reservation = {
    userId: '11111111-1111-1111-1111-111111111111',
    tripId: 'trip-a68e884d-fc5a-4b13-8c37-45f33e197fc3',
    provider: 'openai',
    model: 'gpt-5-nano',
    operation: 'agent-build-itinerary',
    reservedUsd: 0.01,
    budgetUsd: 4.25,
    globalLimit: 10,
    userLimit: 8,
  };

  it('records the trip id while omitting a blocking trip cap', async () => {
    const client = rpcClient({ data: { allowed: true, attempt_id: 10 } });
    const result = await reserveAiReasoningAttempt(client, reservation);
    expect(result).toEqual({ ok: true, attemptId: '10' });
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'reserve_ai_reasoning_attempt',
      expect.objectContaining({
        p_trip_id: reservation.tripId,
        p_global_limit: 10,
        p_user_limit: 8,
        p_trip_limit: null,
        p_budget_usd: 4.25,
      }),
    );
  });

  it('still maps a global or user quota refusal', async () => {
    expect(await reserveAiReasoningAttempt(rpcClient({ data: { allowed: false, reason: 'quota-exhausted' } }), reservation))
      .toMatchObject({ ok: false, refusal: 'quota-exhausted' });
  });

  it('still maps a budget refusal without changing accounting semantics', async () => {
    expect(await reserveAiReasoningAttempt(rpcClient({ data: { allowed: false, reason: 'budget-reached' } }), reservation))
      .toMatchObject({ ok: false, refusal: 'budget-reached' });
  });
});


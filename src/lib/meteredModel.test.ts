import { describe, expect, it, vi } from 'vitest';
import {
  SpendSession,
  meteredModelCall,
  type MeteredDeps,
} from '../../supabase/functions/_shared/meteredModel';
import { DEFAULT_SPEND_CEILING_USD, budgetWindowStart } from '../../supabase/functions/_shared/aiCost';

const usage = (over: Partial<Record<string, unknown>> = {}) => ({
  inputTokens: 5_000,
  outputTokens: 1_000,
  model: 'gpt-5-nano',
  ...over,
});

const CALL_USD = 5_000 * 0.05 / 1e6 + 1_000 * 0.4 / 1e6;
const RESERVED_USD = 0.01;

function harness(
  over: Partial<MeteredDeps> = {},
  spent = 0,
  reservedUsd = RESERVED_USD,
  events: string[] = [],
) {
  const written: Array<Record<string, unknown>> = [];
  const reservations: Array<Record<string, unknown>> = [];
  const call = vi.fn().mockResolvedValue({ result: { ok: true }, usage: usage(), status: 'success' as const });
  call.mockImplementation(async () => {
    events.push('provider');
    return { result: { ok: true }, usage: usage(), status: 'success' as const };
  });
  const deps: MeteredDeps = {
    reserveAttempt: vi.fn().mockImplementation(async (row) => {
      events.push('reserve');
      reservations.push(row);
      return { ok: true as const, attemptId: `attempt-${reservations.length}` };
    }),
    finalizeAttempt: vi.fn().mockImplementation(async (_attemptId, row) => {
      events.push('finalize');
      written.push(row);
      return true;
    }),
    readSpend: vi.fn().mockResolvedValue({ knownUsd: spent, unknownEvents: 0, reservedUsd: 0 }),
    call,
    ...over,
  };
  const session = new SpendSession({ readSpend: deps.readSpend }, DEFAULT_SPEND_CEILING_USD);
  const run = () => meteredModelCall(
    {
      operation: 'candidate-intelligence',
      provider: 'openai',
      requestedModel: 'gpt-5-nano',
      accounting: { userId: 'user-1', tripId: 'trip-1', materialKey: 'batch-1', reservedUsd },
    },
    session,
    deps,
  );
  return {
    deps,
    session,
    run,
    written,
    reservations,
    call: deps.call as ReturnType<typeof vi.fn>,
  };
}

describe('the durable metered boundary', () => {
  it('creates accounting before the provider and finalises the real cost', async () => {
    const order: string[] = [];
    const { run, written, reservations, call } = harness({}, 0, RESERVED_USD, order);
    const outcome = await run();

    expect(outcome.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(reservations[0]).toMatchObject({ user_id: 'user-1', trip_id: 'trip-1', material_key: 'batch-1' });
    expect(written[0]).toMatchObject({ cost_status: 'known', request_status: 'success' });
    expect(Number(written[0].estimated_cost_usd)).toBeCloseTo(CALL_USD, 12);
    expect(order).toEqual(['reserve', 'provider', 'finalize']);
  });

  it('never reaches the provider once the budget is spent', async () => {
    const { run, call, deps } = harness({}, DEFAULT_SPEND_CEILING_USD);
    expect(await run()).toMatchObject({ ok: false, refusal: 'budget-reached' });
    expect(call).not.toHaveBeenCalled();
    expect(deps.reserveAttempt).not.toHaveBeenCalled();
  });

  it('never reaches the provider when spending cannot be read', async () => {
    const { run, call } = harness({ readSpend: vi.fn().mockResolvedValue(null) });
    expect(await run()).toMatchObject({ ok: false, refusal: 'spend-unknown' });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses while an unresolved or reserved spend remains', async () => {
    const { run, call } = harness({
      readSpend: vi.fn().mockResolvedValue({ knownUsd: 0.01, unknownEvents: 1, reservedUsd: 0.02 }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'spend-unknown' });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a model the allowlist rejected before accounting', async () => {
    const { deps, session, call } = harness();
    const outcome = await meteredModelCall(
      {
        operation: 'candidate-intelligence',
        provider: 'openai',
        requestedModel: 'gpt-5.6-sol',
        modelRefusal: 'not approved',
        accounting: { userId: 'user-1', reservedUsd: RESERVED_USD },
      },
      session,
      deps,
    );
    expect(outcome).toMatchObject({ ok: false, refusal: 'model-not-approved' });
    expect(call).not.toHaveBeenCalled();
    expect(deps.readSpend).not.toHaveBeenCalled();
  });

  it('does not call the provider when the atomic reservation rejects quota', async () => {
    const { run, call } = harness({
      reserveAttempt: vi.fn().mockResolvedValue({
        ok: false,
        refusal: 'quota-exhausted',
        detail: 'limit',
      }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'quota-exhausted' });
    expect(call).not.toHaveBeenCalled();
  });

  it('does not call the provider when creating the reservation fails', async () => {
    const { run, call } = harness({
      reserveAttempt: vi.fn().mockResolvedValue({
        ok: false,
        refusal: 'accounting-failed',
        detail: 'database unavailable',
      }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).not.toHaveBeenCalled();
  });

  it('does not call the provider when the reservation boundary throws', async () => {
    const { run, call } = harness({
      reserveAttempt: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('spending across several calls in one invocation', () => {
  it('counts each finalised call against the next one, not a stale total', async () => {
    const { run, call } = harness({}, DEFAULT_SPEND_CEILING_USD - CALL_USD * 0.5, CALL_USD);
    expect((await run()).ok).toBe(true);
    expect(await run()).toMatchObject({ ok: false, refusal: 'budget-reached' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('reads the persisted total once, then keeps it current itself', async () => {
    const { run, deps } = harness();
    await run();
    await run();
    expect(deps.readSpend).toHaveBeenCalledTimes(1);
  });

  it('returns no success when finalisation fails and blocks the same session', async () => {
    const { run, call, deps } = harness({ finalizeAttempt: vi.fn().mockResolvedValue(false) });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(deps.finalizeAttempt).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown finalisation boundary as an unresolved attempt', async () => {
    const { run, call } = harness({
      finalizeAttempt: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('keeps missing usage unresolved and refuses later paid work', async () => {
    const { run, call, written, session } = harness({
      call: vi.fn().mockResolvedValue({ result: { ok: true }, usage: undefined, status: 'success' as const }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(written[0]).toMatchObject({ request_status: 'usage_missing', cost_status: 'unknown' });
    expect((await session.report()).reservedUsd).toBe(RESERVED_USD);
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('what the ledger records about an attempt', () => {
  it('records a real cost for a reply that could not be parsed', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: undefined, usage: usage(), status: 'invalid_output' as const }),
    });
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(written[0].request_status).toBe('invalid_output');
    expect(written[0].cost_status).toBe('known');
    expect(Number(written[0].estimated_cost_usd)).toBeCloseTo(CALL_USD, 12);
  });

  it('records a provider failure with no invented tokens as unresolved', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: undefined, usage: undefined, status: 'provider_error' as const }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(written[0]).toMatchObject({ request_status: 'provider_error', input_tokens: null, estimated_cost_usd: null, cost_status: 'unknown' });
  });

  it('keeps requested and resolved models separate', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: {}, usage: usage({ model: 'gpt-5-nano-2025-08-07' }), status: 'success' as const }),
    });
    await run();
    expect(written[0].model_requested).toBe('gpt-5-nano');
    expect(written[0].model_resolved).toBe('gpt-5-nano-2025-08-07');
  });
});

describe('the budget epoch', () => {
  it('counts everything ever recorded when no epoch is declared', () => {
    expect(budgetWindowStart(undefined)).toBeUndefined();
    expect(budgetWindowStart('')).toBeUndefined();
    expect(budgetWindowStart('   ')).toBeUndefined();
  });

  it('counts only from an explicitly declared epoch', () => {
    expect(budgetWindowStart('2026-08-11T00:00:00Z')).toBe('2026-08-11T00:00:00.000Z');
  });

  it('falls back to counting everything when the epoch is unreadable', () => {
    expect(budgetWindowStart('not-a-date')).toBeUndefined();
  });
});

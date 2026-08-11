/**
 * The single door every paid model call goes through.
 *
 * The rules here are all about what must *not* happen: no provider request
 * once the budget is reached, no second request after a spending record was
 * lost, no reuse of a stale "allowed" across a batch loop. Each of those
 * failures is silent by nature — the feature keeps working, and only the bill
 * knows — which is why they are asserted rather than reasoned about.
 *
 * Dependencies are injected, so nothing here touches a network or a database.
 */
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

/** One request of the size these operations actually send: about $0.00065. */
const CALL_USD = 5_000 * 0.05 / 1e6 + 1_000 * 0.4 / 1e6;

function harness(over: Partial<MeteredDeps> = {}, spent = 0) {
  const written: Array<Record<string, unknown>> = [];
  const call = vi.fn().mockResolvedValue({ result: { ok: true }, usage: usage(), status: 'success' });
  const deps: MeteredDeps = {
    reserveQuota: vi.fn().mockResolvedValue(true),
    readSpend: vi.fn().mockResolvedValue({ knownUsd: spent, unknownEvents: 0 }),
    writeLedger: vi.fn().mockImplementation(async (row) => { written.push(row); return true; }),
    call,
    ...over,
  };
  const session = new SpendSession(deps, DEFAULT_SPEND_CEILING_USD);
  const run = () => meteredModelCall(
    { operation: 'candidate-intelligence', provider: 'openai', requestedModel: 'gpt-5-nano' },
    session,
    deps,
  );
  // `deps.call`, not the local default — an overridden spy must be the one
  // the assertions inspect, or a test can watch a spy nothing ever invokes.
  return { deps, session, run, written, call: deps.call as ReturnType<typeof vi.fn> };
}

describe('the metered boundary', () => {
  it('makes the call and records what it cost', async () => {
    const { run, written, call } = harness();
    const outcome = await run();

    expect(outcome.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(Number(written[0].estimated_cost_usd)).toBeCloseTo(CALL_USD, 12);
    expect(written[0].cost_status).toBe('known');
  });

  /**
   * The whole reason this module exists. Any operation reaching the provider
   * without consulting the ceiling makes the ceiling advisory.
   */
  it('never reaches the provider once the budget is spent', async () => {
    const { run, call, deps } = harness({}, DEFAULT_SPEND_CEILING_USD);
    const outcome = await run();

    expect(outcome).toMatchObject({ ok: false, refusal: 'budget-reached' });
    expect(call).not.toHaveBeenCalled();
    // And no quota unit was burned on a call the budget was going to refuse.
    expect(deps.reserveQuota).not.toHaveBeenCalled();
  });

  it('never reaches the provider when spending cannot be read', async () => {
    const { run, call } = harness({ readSpend: vi.fn().mockResolvedValue(null) });
    expect(await run()).toMatchObject({ ok: false, refusal: 'spend-unknown' });
    expect(call).not.toHaveBeenCalled();
  });

  /**
   * Unknown-cost events are missing from the known total, so it is a floor
   * rather than the truth. Spending against a number known to be incomplete is
   * how a ceiling is quietly passed.
   */
  it('refuses while any past call remains uncosted', async () => {
    const { run, call } = harness({
      readSpend: vi.fn().mockResolvedValue({ knownUsd: 0.01, unknownEvents: 1 }),
    });
    expect(await run()).toMatchObject({ ok: false, refusal: 'spend-unknown' });
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a model the allowlist rejected, before anything else', async () => {
    const { deps, session, call } = harness();
    const outcome = await meteredModelCall(
      {
        operation: 'candidate-intelligence', provider: 'openai',
        requestedModel: 'gpt-5.6-sol', modelRefusal: 'not approved',
      },
      session,
      deps,
    );
    expect(outcome).toMatchObject({ ok: false, refusal: 'model-not-approved' });
    expect(call).not.toHaveBeenCalled();
    expect(deps.readSpend).not.toHaveBeenCalled();
  });

  it('refuses when the daily request quota is exhausted', async () => {
    const { run, call } = harness({ reserveQuota: vi.fn().mockResolvedValue(false) });
    expect(await run()).toMatchObject({ ok: false, refusal: 'quota-exhausted' });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('spending across several calls in one invocation', () => {
  /**
   * The bug this class was written for. Reading the persisted total once and
   * reusing that verdict means every call in a batch loop consults the same
   * stale "allowed" and they sail past the ceiling together.
   */
  it('counts each call against the next one, not against a stale total', async () => {
    /**
     * Poised so that one call crosses the line: the persisted total is still
     * under the ceiling, and adding this call's own cost puts it over. Only a
     * session that folds in what it just spent can see that.
     */
    const { run, call } = harness({}, DEFAULT_SPEND_CEILING_USD - CALL_USD * 0.5);

    expect((await run()).ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);

    expect(await run()).toMatchObject({ ok: false, refusal: 'budget-reached' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('reads the persisted total once, then keeps it current itself', async () => {
    const { run, deps } = harness();
    await run();
    await run();
    expect(deps.readSpend).toHaveBeenCalledTimes(1);
  });

  /**
   * A lost ledger row means money was spent that the total will never include.
   * Continuing would spend against a figure already known to be wrong.
   */
  it('stops making paid calls after a spending record fails to write', async () => {
    const { run, call } = harness({ writeLedger: vi.fn().mockResolvedValue(false) });

    expect((await run()).ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);

    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  /** A call that could not be costed poisons the total in the same way. */
  it('stops making paid calls after one whose cost could not be determined', async () => {
    const { run, call } = harness({
      call: vi.fn().mockResolvedValue({
        result: {}, usage: usage({ model: 'gpt-5-nano-2099-12-31' }), status: 'success',
      }),
    });

    await run();
    expect(call).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ ok: false, refusal: 'accounting-failed' });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('what the ledger records about an attempt', () => {
  /**
   * Billed, and useless. Defining success as "usage was reported" would file
   * this as a success and hide the one pattern most worth seeing: money spent
   * for a result the app could not use.
   */
  it('records a real cost for a reply that could not be parsed', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: undefined, usage: usage(), status: 'invalid_output' }),
    });

    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(written[0].request_status).toBe('invalid_output');
    expect(written[0].cost_status).toBe('known');
    expect(Number(written[0].estimated_cost_usd)).toBeCloseTo(CALL_USD, 12);
  });

  it('records a provider failure with no invented tokens', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: undefined, usage: undefined, status: 'provider_error' }),
    });

    await run();
    expect(written[0].request_status).toBe('provider_error');
    expect(written[0].input_tokens).toBeNull();
    expect(written[0].estimated_cost_usd).toBeNull();
    expect(written[0].cost_status).toBe('unknown');
  });

  it('distinguishes an answer that reported no usage at all', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({ result: { ok: true }, usage: undefined, status: 'success' }),
    });
    await run();
    expect(written[0].request_status).toBe('usage_missing');
  });

  /** Requested and resolved are different facts; cost follows the resolved one. */
  it('keeps the requested alias and the resolved snapshot apart', async () => {
    const { run, written } = harness({
      call: vi.fn().mockResolvedValue({
        result: {}, usage: usage({ model: 'gpt-5-nano-2025-08-07' }), status: 'success',
      }),
    });
    await run();
    expect(written[0].model_requested).toBe('gpt-5-nano');
    expect(written[0].model_resolved).toBe('gpt-5-nano-2025-08-07');
  });

  it('writes nothing at all for an attempt refused before the provider', async () => {
    const { run, written } = harness({}, DEFAULT_SPEND_CEILING_USD);
    await run();
    // Nothing was spent, so there is nothing to record.
    expect(written).toHaveLength(0);
  });
});

describe('the budget epoch', () => {
  /**
   * The failure this replaced: a rolling window lets old spending age out, so
   * a ceiling refills itself over time and a prepaid $5 can be spent twice.
   * Resetting the budget must be a deliberate act after topping up, never
   * something the calendar does unattended.
   */
  it('counts everything ever recorded when no epoch is declared', () => {
    expect(budgetWindowStart(undefined)).toBeUndefined();
    expect(budgetWindowStart('')).toBeUndefined();
    expect(budgetWindowStart('   ')).toBeUndefined();
  });

  it('counts only from an explicitly declared epoch', () => {
    expect(budgetWindowStart('2026-08-11T00:00:00Z')).toBe('2026-08-11T00:00:00.000Z');
  });

  /** A broken setting must widen the window, never narrow it. */
  it('falls back to counting everything when the epoch is unreadable', () => {
    expect(budgetWindowStart('not-a-date')).toBeUndefined();
  });
});

/**
 * What a call cost, and what happens when that cannot be known.
 *
 * The interesting cases here are all the unknown ones. Costing a normal
 * response is arithmetic; the rules worth testing are the ones that decide
 * what to do when the provider reported nothing, named a model we do not
 * price, or failed outright — because the tempting answer in every one of
 * those is `0`, and `0` is how a budget drains while the ledger insists
 * nothing happened.
 *
 * Nothing here touches the network or a database.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEND_CEILING_USD,
  MODEL_PRICING,
  estimateCost,
  parseOpenAiUsage,
  spendEvent,
  spendGate,
  spendLedgerRow,
} from '../../supabase/functions/_shared/aiCost';

const usageBlock = (over: Record<string, unknown> = {}) => ({
  model: 'gpt-5-nano',
  usage: {
    prompt_tokens: 5_000,
    completion_tokens: 1_000,
    total_tokens: 6_000,
    ...over,
  },
});

describe('reading usage off a provider response', () => {
  it('reads the token counts OpenAI reports', () => {
    const usage = parseOpenAiUsage(usageBlock());
    expect(usage).toMatchObject({ inputTokens: 5_000, outputTokens: 1_000, model: 'gpt-5-nano' });
  });

  it('reads cached input and reasoning tokens when they are broken out', () => {
    const usage = parseOpenAiUsage(usageBlock({
      prompt_tokens_details: { cached_tokens: 2_000 },
      completion_tokens_details: { reasoning_tokens: 300 },
    }));
    expect(usage?.cachedInputTokens).toBe(2_000);
    expect(usage?.reasoningTokens).toBe(300);
  });

  /**
   * Half a usage block cannot produce a cost, and a partial figure is worse
   * than none: it looks authoritative and is wrong by an unknown amount.
   */
  it('reports nothing usable when either token count is missing', () => {
    expect(parseOpenAiUsage({ usage: { prompt_tokens: 5_000 } })).toBeUndefined();
    expect(parseOpenAiUsage({ usage: { completion_tokens: 100 } })).toBeUndefined();
    expect(parseOpenAiUsage({})).toBeUndefined();
    expect(parseOpenAiUsage(null)).toBeUndefined();
  });

  it('ignores nonsense values rather than trusting them', () => {
    expect(parseOpenAiUsage({ usage: { prompt_tokens: -5, completion_tokens: 10 } })).toBeUndefined();
    expect(parseOpenAiUsage({ usage: { prompt_tokens: 'lots', completion_tokens: 10 } })).toBeUndefined();
  });
});

describe('costing a request', () => {
  it('costs a known model from its reported usage', () => {
    // 5,000 input at $0.05/1M + 1,000 output at $0.40/1M.
    const { usd } = estimateCost(parseOpenAiUsage(usageBlock()), 'gpt-5-nano');
    expect(usd).toBeCloseTo(0.00025 + 0.0004, 10);
  });

  /**
   * The single most important property in this file. Every one of these is a
   * situation where returning `0` would be easy, would look fine, and would
   * mean the spend ceiling never fires.
   */
  it('never reports a cost of zero for something it cannot cost', () => {
    expect(estimateCost(undefined, 'gpt-5-nano')).toEqual({ usd: null, unknownReason: 'no-usage' });
    // No model named in the response, and the requested one has no price.
    const unnamed = parseOpenAiUsage({ usage: usageBlock().usage });
    expect(estimateCost(unnamed, 'a-model-we-do-not-price'))
      .toMatchObject({ usd: null, unknownReason: 'unpriced-model' });
    // Neither side names a model at all.
    expect(estimateCost(unnamed, undefined)).toMatchObject({ usd: null, unknownReason: 'unpriced-model' });
  });

  /**
   * An alias can resolve to a snapshot. Cost has to follow what actually ran,
   * so an unpriced resolved model reads as unknown instead of borrowing the
   * price of the alias that was requested.
   */
  it('follows the model the provider says answered, not the one requested', () => {
    const usage = parseOpenAiUsage({ ...usageBlock(), model: 'gpt-5-nano-2099-12-31' });
    expect(estimateCost(usage, 'gpt-5-nano').usd).toBeNull();
  });

  /** GPT-5 nano's cached rate is confirmed at a tenth of ordinary input. */
  it('bills cached input at the confirmed cached rate', () => {
    expect(MODEL_PRICING['gpt-5-nano'].cachedInput).toBe(0.005);
    const allCached = estimateCost(parseOpenAiUsage(usageBlock({
      prompt_tokens_details: { cached_tokens: 5_000 },
    })), 'gpt-5-nano').usd!;
    // 5,000 cached input at $0.005/1M + 1,000 output at $0.40/1M.
    expect(allCached).toBeCloseTo(5_000 * 0.005 / 1e6 + 1_000 * 0.40 / 1e6, 12);
    // Strictly cheaper than the same request served entirely uncached.
    expect(allCached).toBeLessThan(estimateCost(parseOpenAiUsage(usageBlock()), 'gpt-5-nano').usd!);
  });

  /**
   * A model whose discount has not been verified is billed as if it had none.
   * Guessing a discount low makes the spend guard permissive in exactly the
   * situation it exists for.
   */
  it('bills cached input at the full rate when no cached price is confirmed', () => {
    MODEL_PRICING['temp-unconfirmed'] = { input: 0.05, output: 0.40 };
    try {
      const usage = { inputTokens: 5_000, cachedInputTokens: 5_000, outputTokens: 0, model: 'temp-unconfirmed' };
      expect(estimateCost(usage, undefined).usd).toBeCloseTo(5_000 * 0.05 / 1e6, 12);
    } finally {
      delete MODEL_PRICING['temp-unconfirmed'];
    }
  });

  /**
   * Ask for the alias, be told the snapshot. Without an explicit entry for the
   * resolved name every call would cost as unknown and the spend gate would
   * fail closed after the first — a self-inflicted outage.
   */
  it('prices the dated snapshot the alias resolves to', () => {
    const usage = parseOpenAiUsage({ ...usageBlock(), model: 'gpt-5-nano-2025-08-07' });
    expect(estimateCost(usage, 'gpt-5-nano').usd)
      .toBeCloseTo(estimateCost(parseOpenAiUsage(usageBlock()), 'gpt-5-nano').usd!, 12);
  });

  /**
   * But only names that were actually reviewed. Prefix matching would apply
   * today's price to next year's snapshot, which is the stale-price failure
   * the table exists to prevent.
   */
  it('leaves an unreviewed nano-shaped snapshot unpriced', () => {
    const usage = parseOpenAiUsage({ ...usageBlock(), model: 'gpt-5-nano-2099-12-31' });
    expect(estimateCost(usage, 'gpt-5-nano')).toMatchObject({ usd: null, unknownReason: 'unpriced-model' });
  });

  /**
   * Cached tokens are a subset of input, so they can never exceed it. A
   * provider over-reporting them must not push the uncached remainder
   * negative, which would produce a *negative cost* and credit the budget for
   * a call that spent money.
   *
   * This has to be checked against a model with a distinct cached rate. Where
   * the two rates are equal the clamp is invisible — the negative uncached
   * term and the inflated cached term cancel exactly — so testing it on the
   * default model asserts nothing at all.
   */
  it('never lets cached tokens exceed the input they are part of', () => {
    MODEL_PRICING['temp-clamp'] = { input: 0.05, output: 0.40, cachedInput: 0.005 };
    try {
      const usd = estimateCost(
        { inputTokens: 100, cachedInputTokens: 9_999, outputTokens: 0, model: 'temp-clamp' },
        undefined,
      ).usd!;
      expect(usd).toBeCloseTo(100 * 0.005 / 1_000_000, 15);
      expect(usd).toBeGreaterThan(0);
    } finally {
      delete MODEL_PRICING['temp-clamp'];
    }
  });

  /**
   * Reasoning tokens are already inside `completion_tokens`; adding them again
   * would charge for them twice.
   */
  it('does not double-charge reasoning tokens', () => {
    const withReasoning = estimateCost(parseOpenAiUsage(usageBlock({
      completion_tokens_details: { reasoning_tokens: 800 },
    })), 'gpt-5-nano');
    expect(withReasoning.usd).toBeCloseTo(estimateCost(parseOpenAiUsage(usageBlock()), 'gpt-5-nano').usd!, 12);
  });
});

describe('the ledger row', () => {
  it('records a successful call with its cost', () => {
    const event = spendEvent({
      provider: 'openai', requestedModel: 'gpt-5-nano', operation: 'place-brief',
      usage: parseOpenAiUsage(usageBlock()), status: 'success' as const,
    });
    expect(event).toMatchObject({ status: 'success', inputTokens: 5_000, outputTokens: 1_000 });
    expect(event.estimatedUsd).toBeGreaterThan(0);
  });

  /**
   * Nulls, not zeros. Zeros would average into "our calls are getting cheaper"
   * when what actually happened is that they stopped working.
   */
  it('records a failure with unknown tokens rather than zero tokens', () => {
    const event = spendEvent({
      provider: 'openai', requestedModel: 'gpt-5-nano', operation: 'place-brief', status: 'provider_error' as const,
    });
    expect(event.status).toBe('provider_error');
    expect(event.inputTokens).toBeNull();
    expect(event.outputTokens).toBeNull();
    expect(event.estimatedUsd).toBeNull();
    expect(event.unknownReason).toBe('no-usage');
  });

  it('carries no prompt, source text or credential', () => {
    const event = spendEvent({
      provider: 'openai', requestedModel: 'gpt-5-nano', operation: 'place-brief',
      usage: parseOpenAiUsage(usageBlock()), status: 'success' as const,
    });
    const serialised = JSON.stringify(event);
    for (const forbidden of ['sk-', 'prompt', 'excerpt', 'sourceUrl', 'text']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('the spend ceiling', () => {
  it('allows a call below the ceiling', () => {
    expect(spendGate(1.20)).toEqual({ allowed: true });
  });

  it('refuses once the ceiling is reached', () => {
    expect(spendGate(DEFAULT_SPEND_CEILING_USD)).toMatchObject({ allowed: false, reason: 'ceiling-reached' });
    expect(spendGate(9.99)).toMatchObject({ allowed: false, reason: 'ceiling-reached' });
  });

  /**
   * The same reasoning as `reserveQuota`'s `failClosed`: an unreadable counter
   * means we do not know what has been spent, and "spend money because we
   * cannot tell" is not a defensible default for a provider that bills.
   */
  it('refuses when spending to date cannot be read', () => {
    expect(spendGate(null)).toMatchObject({ allowed: false, reason: 'spend-unknown' });
  });

  it('keeps a reserve below the prepaid balance', () => {
    // $5.00 loaded, $4.25 ceiling — the gap absorbs a provider cutoff that is
    // not instantaneous, so the AI stops before the account does.
    expect(DEFAULT_SPEND_CEILING_USD).toBeLessThan(5);
    expect(5 - DEFAULT_SPEND_CEILING_USD).toBeCloseTo(0.75, 10);
  });

  it('honours a ceiling passed explicitly', () => {
    expect(spendGate(0.5, 0.25)).toMatchObject({ allowed: false });
    expect(spendGate(0.1, 0.25)).toEqual({ allowed: true });
  });
});

describe('the ledger row', () => {
  const row = (succeeded: boolean, usage?: ReturnType<typeof parseOpenAiUsage>) =>
    spendLedgerRow(spendEvent({
      provider: 'openai', requestedModel: 'gpt-5-nano', operation: 'place-brief', usage,
      status: succeeded ? 'success' : 'provider_error',
    }));

  it('marks a costed call known and a uncostable one unknown', () => {
    expect(row(true, parseOpenAiUsage(usageBlock())).cost_status).toBe('known');
    expect(row(false).cost_status).toBe('unknown');
  });

  /**
   * The rule the whole ledger exists for. Zeros here would let a budget drain
   * while the accounting insisted nothing had happened.
   */
  it('writes nulls, never zeros, for a call it could not cost', () => {
    const failed = row(false);
    for (const column of ['input_tokens', 'output_tokens', 'cached_input_tokens', 'estimated_cost_usd']) {
      expect(failed[column], column).toBeNull();
    }
  });

  it('reserves attribution columns without inventing values for them', () => {
    const written = row(true, parseOpenAiUsage(usageBlock()));
    expect(written.trip_id).toBeNull();
    expect(written.user_id).toBeNull();
  });

  it('records a request status the table will accept', () => {
    expect(['success', 'provider_error', 'timeout', 'invalid_output'])
      .toContain(row(true, parseOpenAiUsage(usageBlock())).request_status);
    expect(['success', 'provider_error', 'timeout', 'invalid_output'])
      .toContain(row(false).request_status);
  });
});

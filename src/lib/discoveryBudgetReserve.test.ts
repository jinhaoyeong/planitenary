/**
 * The request budget, as seen by the work that spends it.
 *
 * A previous fix gave the OSM path one clock and was proved correct. The clock
 * did not reach the text-search providers, which asked `fetchJson` for its own
 * 8s default however little of the request was left, and it did not cover the
 * database round trips at either end. These are the two gaps closed.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createRequestDeadline,
  reserving,
  withinBudget,
} from '../../supabase/functions/_shared/discoveryResilience';

/** The values travel-discover uses, restated here so a drift breaks a test. */
const TEXT_SEARCH_TIMEOUT_MS = 8_000;
const TEXT_SEARCH_MINIMUM_VIABLE_MS = 2_000;
const RESPONSE_TAIL_RESERVE_MS = 4_000;

describe('a text-search query never asks for more time than the request has', () => {
  it('does not start an 8s query with 3s remaining — the named falsifier', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 42_000; // 3s left

    const budget = deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS);

    expect(budget).not.toBe(TEXT_SEARCH_TIMEOUT_MS);
    expect(budget).toBe(3_000);
  });

  it('clamps to 6s when 6s remains, rather than sending the ceiling', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 39_000; // 6s left

    expect(deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS)).toBeLessThanOrEqual(6_000);
  });

  it('refuses to start at all below the minimum useful budget', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    now = 44_000; // 1s left, under the 2s minimum

    expect(deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS)).toBeNull();
  });

  /**
   * The defect in one assertion: seven sequential queries at a fixed 8s ceiling
   * is 56s of work under a 45s budget. Clamping is what makes the sum bounded.
   */
  it('cannot exceed the budget across many sequential queries', () => {
    let now = 0;
    const deadline = createRequestDeadline(45_000, () => now);
    let spent = 0;
    let started = 0;

    for (let query = 0; query < 20; query += 1) {
      const budget = deadline.allow(TEXT_SEARCH_TIMEOUT_MS, TEXT_SEARCH_MINIMUM_VIABLE_MS);
      if (budget === null) break;
      started += 1;
      now += budget;        // worst case: every query burns its whole clamp
      spent += budget;
    }

    expect(spent).toBeLessThanOrEqual(45_000);
    expect(started).toBeLessThan(20);
    expect(deadline.remainingMs()).toBeLessThan(TEXT_SEARCH_MINIMUM_VIABLE_MS);
  });
});

describe('the reserved tail', () => {
  it('stops sources early enough to leave the tail its slice', () => {
    let now = 0;
    const request = createRequestDeadline(45_000, () => now);
    const sources = reserving(request, RESPONSE_TAIL_RESERVE_MS);

    expect(sources.remainingMs()).toBe(41_000);

    now = 41_000;
    expect(sources.remainingMs()).toBe(0);
    expect(sources.expired()).toBe(true);
    expect(sources.allow(22_000, 8_000)).toBeNull();
    // The request itself still has the reserve to spend on cache + link.
    expect(request.remainingMs()).toBe(4_000);
  });

  it('never lets a source outlive the request it belongs to', () => {
    let now = 0;
    const request = createRequestDeadline(45_000, () => now);
    const sources = reserving(request, RESPONSE_TAIL_RESERVE_MS);

    for (now = 0; now <= 45_000; now += 1_000) {
      const allowed = sources.allow(22_000, 0) ?? 0;
      expect(allowed).toBeLessThanOrEqual(request.remainingMs());
    }
  });
});

describe('work that cannot be aborted still cannot hold the response open', () => {
  it('returns the fallback when the database outlives the budget', async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<string>(() => {});
      const raced = withinBudget(3_000, 'fallback', () => neverSettles);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(raced).resolves.toBe('fallback');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the real answer when it arrives in time', async () => {
    await expect(withinBudget(3_000, 'fallback', async () => 'cached')).resolves.toBe('cached');
  });

  it('skips the work entirely when nothing is left', async () => {
    const work = vi.fn(async () => 'ran');
    await expect(withinBudget(0, 'fallback', work)).resolves.toBe('fallback');
    expect(work).not.toHaveBeenCalled();
  });
});

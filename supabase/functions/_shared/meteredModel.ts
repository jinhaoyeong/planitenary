/**
 * The one door every paid model call goes through.
 *
 * Before this existed, the spending guard lived inside `travel-evidence`,
 * which meant it protected exactly the operations that happened to be written
 * there. `travel-reasoning` — the generic endpoint the next two features were
 * about to use — had a request quota and no dollar ceiling at all. A budget
 * that only some callers respect is not a budget, and the way that fails is
 * quiet: the new feature works, nothing errors, and the ceiling is simply
 * absent from a path nobody remembered it had to cover.
 *
 * So the ordering, the accounting and the refusals are collected here, once,
 * and both endpoints call it. Adding a paid operation now means calling this
 * function; there is no shorter path to the provider that also happens to skip
 * the guard.
 *
 * Dependencies are injected rather than imported. `providers.ts`, `cache.ts`
 * and `quota.ts` all reach for `Deno` or the Supabase client and cannot be
 * loaded under vitest — and a spending guard nothing can test is a spending
 * guard nobody knows has stopped working. Every rule below is exercised
 * directly with fakes.
 */

import {
  estimateCost,
  spendEvent,
  spendGate,
  spendLedgerRow,
  type AiRequestStatus,
  type AiSpendEvent,
  type ModelUsage,
} from './aiCost.ts';

/** Known spend, and how much of the picture is missing from it. */
export interface SpendSnapshot {
  knownUsd: number;
  unknownEvents: number;
}

export interface MeteredDeps {
  /** Reserve one request against the daily call quota. */
  reserveQuota: () => Promise<boolean>;
  /** Spend since the budget epoch. `null` means it could not be read. */
  readSpend: () => Promise<SpendSnapshot | null>;
  /** Append one ledger row. `false` means the write failed. */
  writeLedger: (row: Record<string, unknown>) => Promise<boolean>;
  /**
   * The provider request. Returns the parsed answer and whatever usage the
   * provider reported, plus how the attempt ended — the three are independent
   * and the caller must not infer any of them from the others.
   */
  call: () => Promise<{ result: unknown; usage?: ModelUsage; status: AiRequestStatus }>;
}

export type MeteredRefusal =
  | 'model-not-approved'
  | 'provider-failed'
  | 'quota-exhausted'
  | 'budget-reached'
  | 'spend-unknown'
  | 'accounting-failed';

export type MeteredOutcome =
  | { ok: true; result: unknown; event: AiSpendEvent }
  | { ok: false; refusal: MeteredRefusal; detail: string };

/**
 * A budget held across several calls in one invocation.
 *
 * The persisted total is read once — it is a database round trip and the
 * numbers in between are ours — but it is then kept *current* by adding each
 * call's cost as it completes. Reading once and reusing that answer for a
 * whole batch loop is the bug this class exists to prevent: at $4.249 spent,
 * every batch in the loop would consult the same stale "allowed" and sail past
 * the ceiling together.
 */
export class SpendSession {
  private persisted: SpendSnapshot | null | undefined;
  /** Cost accrued by calls this invocation has already made. */
  private running = 0;
  /** Set when a ledger write failed; no further paid call may happen. */
  private accountingBroken = false;

  private readonly deps: Pick<MeteredDeps, 'readSpend' | 'writeLedger'>;
  private readonly ceilingUsd: number;

  // Assigned in the body rather than declared as constructor parameter
  // properties: this project builds with `erasableSyntaxOnly`, which forbids
  // the shorthand because it emits real code rather than erasing to nothing.
  constructor(deps: Pick<MeteredDeps, 'readSpend' | 'writeLedger'>, ceilingUsd: number) {
    this.deps = deps;
    this.ceilingUsd = ceilingUsd;
  }

  /** The persisted snapshot, read at most once per invocation. */
  async snapshot(): Promise<SpendSnapshot | null> {
    if (this.persisted === undefined) this.persisted = await this.deps.readSpend();
    return this.persisted;
  }

  async gate(): Promise<{ allowed: true } | { allowed: false; refusal: MeteredRefusal; detail: string }> {
    /**
     * A failed ledger write means a call happened whose cost we cannot
     * account for. Continuing would spend against a total already known to be
     * wrong, so the invocation stops making paid calls entirely — the same
     * fail-closed reasoning as an unreadable counter, applied to a write.
     */
    if (this.accountingBroken) {
      return {
        allowed: false,
        refusal: 'accounting-failed',
        detail: 'A spending record could not be written, so no further metered calls are made.',
      };
    }

    const persisted = await this.snapshot();
    /**
     * Unknown-cost events are absent from `knownUsd` entirely, so the total is
     * a floor rather than the truth. Spending against a number known to be
     * incomplete is how a ceiling gets quietly passed, so their existence
     * refuses just as an unreadable ledger does.
     */
    const spent = persisted === null || persisted.unknownEvents > 0
      ? null
      : persisted.knownUsd + this.running;

    const decision = spendGate(spent, this.ceilingUsd);
    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      refusal: decision.reason === 'ceiling-reached' ? 'budget-reached' : 'spend-unknown',
      detail: decision.detail,
    };
  }

  /**
   * Record what a call cost and fold it into the running total.
   *
   * Written immediately rather than accumulated and flushed at the end. If the
   * function dies between a provider charging us and a deferred flush, the
   * cost vanishes from our accounting while remaining very much present on the
   * invoice — and the next invocation would start from a total that is too low.
   */
  async record(event: AiSpendEvent): Promise<boolean> {
    const written = await this.deps.writeLedger(spendLedgerRow(event));
    if (!written) {
      this.accountingBroken = true;
      return false;
    }
    if (event.estimatedUsd !== null) this.running += event.estimatedUsd;
    // A call we could not cost makes every later total a floor, so it stops
    // further paid work for the same reason an unreadable ledger does.
    else this.accountingBroken = true;
    return true;
  }

  /** For diagnostics. Known persisted spend plus this invocation's own. */
  async report(): Promise<{
    knownUsd: number | null;
    unknownEvents: number | null;
    ceilingUsd: number;
    remainingUsd: number | null;
  }> {
    const persisted = await this.snapshot();
    if (persisted === null) {
      return { knownUsd: null, unknownEvents: null, ceilingUsd: this.ceilingUsd, remainingUsd: null };
    }
    const knownUsd = persisted.knownUsd + this.running;
    return {
      knownUsd,
      unknownEvents: persisted.unknownEvents,
      ceilingUsd: this.ceilingUsd,
      remainingUsd: Math.max(0, this.ceilingUsd - knownUsd),
    };
  }
}

/**
 * Make one paid model call, with every guard applied in the order that keeps
 * the cheapest refusal first.
 *
 * Budget before quota before provider: each step is more expensive to reach
 * than the last, and a refusal that has already spent a quota unit on a call
 * the budget was going to reject is a refusal that cost something.
 *
 * Records a ledger row for **every attempt that reached the provider**,
 * including ones whose reply could not be parsed — those were billed, and
 * `invalid_output` beside a real non-zero cost is precisely the signal worth
 * having. Attempts refused before the provider write nothing, because nothing
 * was spent.
 */
export async function meteredModelCall(
  input: {
    operation: string;
    provider: string;
    requestedModel: string;
    /** The refusal from the model allowlist, when the configured model failed it. */
    modelRefusal?: string;
  },
  session: SpendSession,
  deps: MeteredDeps,
): Promise<MeteredOutcome> {
  if (input.modelRefusal) {
    return { ok: false, refusal: 'model-not-approved', detail: input.modelRefusal };
  }

  const gate = await session.gate();
  if (!gate.allowed) return { ok: false, refusal: gate.refusal, detail: gate.detail };

  if (!await deps.reserveQuota()) {
    return {
      ok: false,
      refusal: 'quota-exhausted',
      detail: 'The daily AI request allowance for this deployment is spent.',
    };
  }

  const { result, usage, status } = await deps.call();

  /**
   * The provider reported usage but named a model we do not price, so the
   * cost is unknown. Recorded as such — never as zero — and the session then
   * refuses further paid work until somebody reconciles it.
   */
  const event = spendEvent({
    provider: input.provider,
    requestedModel: input.requestedModel,
    operation: input.operation,
    usage,
    status: usage === undefined && status === 'success' ? 'usage_missing' : status,
  });

  await session.record(event);

  if (status !== 'success') {
    return { ok: false, refusal: 'provider-failed', detail: `Provider request ended as ${status}.` };
  }
  return { ok: true, result, event };
}

/** Re-exported so callers need only one import for the metered path. */
export { estimateCost, spendEvent, spendLedgerRow };

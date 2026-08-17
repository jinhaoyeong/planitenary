/**
 * The one door every paid model call goes through.
 *
 * The important ordering is deliberately server-owned:
 *
 *   budget read -> atomic quota + pre-provider accounting reservation
 *   -> one provider attempt -> accounting finalisation -> result
 *
 * The reservation is created before the provider is contacted. If the
 * database cannot create it, the provider is never reached. If finalisation
 * fails, the reservation remains unresolved in the database and this session
 * refuses further work; a later invocation sees the unresolved row too.
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

/** Known finalised spend, plus reservations that are not finalised yet. */
export interface SpendSnapshot {
  knownUsd: number;
  unknownEvents: number;
  reservedUsd?: number;
}

export interface AiSpendSnapshotRow {
  estimated_cost_usd: string | number | null;
  cost_status: string;
  attempt_status: string;
  reserved_cost_usd: string | number | null;
}

/** Reduce ledger rows without importing the database client into unit tests. */
export function summarizeAiSpendRows(rows: AiSpendSnapshotRow[]): SpendSnapshot & { reservedUsd: number } {
  let knownUsd = 0;
  let unknownEvents = 0;
  let reservedUsd = 0;
  for (const row of rows) {
    if (row.attempt_status === 'resolved') {
      if (row.cost_status === 'known' && row.estimated_cost_usd !== null) {
        knownUsd += Number(row.estimated_cost_usd) || 0;
      } else {
        reservedUsd += Number(row.reserved_cost_usd) || 0;
      }
    } else {
      reservedUsd += Number(row.reserved_cost_usd) || 0;
      unknownEvents += 1;
    }
  }
  return { knownUsd, unknownEvents, reservedUsd };
}

export type ReservationRefusal = 'quota-exhausted' | 'budget-reached' | 'spend-unknown' | 'accounting-failed';

export type AttemptReservation =
  | { ok: true; attemptId: string }
  | { ok: false; refusal: ReservationRefusal; detail: string };

/**
 * What the provider adapter can prove about dispatch.
 *
 * Absence is deliberately treated as `possibly-dispatched`: older adapters
 * and unexpected exceptions must retain the reservation, never manufacture a
 * zero-cost attempt from missing telemetry.
 */
export type ProviderDispatchStatus = 'not-dispatched' | 'possibly-dispatched';

export interface MeteredDeps {
  /** Atomically reserves global/user quota and a durable ledger attempt. */
  reserveAttempt: (row: Record<string, unknown>) => Promise<AttemptReservation>;
  /** Finalises the pre-provider row. False leaves it reserved/unresolved. */
  finalizeAttempt: (attemptId: string, row: Record<string, unknown>) => Promise<boolean>;
  /** Spend since the budget epoch. `null` means it could not be read. */
  readSpend: () => Promise<SpendSnapshot | null>;
  /**
   * The provider request. The usage and request id belong to this attempt only;
   * callers must create fresh state for every batch.
   */
  call: () => Promise<{
    result: unknown;
    usage?: ModelUsage;
    providerRequestId?: string;
    status: AiRequestStatus;
    dispatchStatus?: ProviderDispatchStatus;
  }>;
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
 * Persisted reservations are included in the snapshot. Running reservations
 * are replaced by their final known cost, never added twice.
 */
export class SpendSession {
  private persisted: SpendSnapshot | null | undefined;
  private runningKnown = 0;
  private runningReserved = 0;
  private accountingBroken = false;

  private readonly deps: Pick<MeteredDeps, 'readSpend'>;
  private readonly ceilingUsd: number;

  constructor(deps: Pick<MeteredDeps, 'readSpend'>, ceilingUsd: number) {
    this.deps = deps;
    this.ceilingUsd = ceilingUsd;
  }

  /** The persisted snapshot, read at most once per invocation. */
  async snapshot(): Promise<SpendSnapshot | null> {
    if (this.persisted === undefined) this.persisted = await this.deps.readSpend();
    return this.persisted;
  }

  async gate(): Promise<{ allowed: true } | { allowed: false; refusal: MeteredRefusal; detail: string }> {
    if (this.accountingBroken) {
      return {
        allowed: false,
        refusal: 'accounting-failed',
        detail: 'A spending attempt remains unresolved, so no further metered calls are made.',
      };
    }

    const persisted = await this.snapshot();
    const spent = persisted === null || persisted.unknownEvents > 0
      ? null
      : persisted.knownUsd + (persisted.reservedUsd || 0) + this.runningKnown + this.runningReserved;

    const decision = spendGate(spent, this.ceilingUsd);
    if (decision.allowed === true) return { allowed: true };
    return {
      allowed: false,
      refusal: decision.reason === 'ceiling-reached' ? 'budget-reached' : 'spend-unknown',
      detail: decision.detail,
    };
  }

  noteReservation(reservedUsd: number): void {
    this.runningReserved += reservedUsd;
  }

  /**
   * Fold the finalisation result into this invocation.
   *
   * A finalisation failure is never treated as success. The row created before
   * the provider remains reserved in the database, so the next invocation also
   * refuses or counts it rather than assuming the call never happened.
   */
  settleReservation(reservedUsd: number, event: AiSpendEvent, finalised: boolean): boolean {
    if (!finalised) {
      // The durable row is still open, so keep its reservation visible in the
      // same invocation's report as well as in the next invocation's read.
      this.accountingBroken = true;
      return false;
    }
    if (event.estimatedUsd === null) {
      // A terminal bounded-unknown row keeps the full reservation as budget
      // exposure. It is accounted for, so it must not permanently poison the
      // whole AI tier; only a genuinely failed finalisation does that.
      return true;
    }
    this.runningReserved = Math.max(0, this.runningReserved - reservedUsd);
    this.runningKnown += event.estimatedUsd;
    return true;
  }

  async report(): Promise<{
    knownUsd: number | null;
    reservedUsd: number | null;
    unknownEvents: number | null;
    ceilingUsd: number;
    remainingUsd: number | null;
  }> {
    const persisted = await this.snapshot();
    if (persisted === null) {
      return {
        knownUsd: null,
        reservedUsd: null,
        unknownEvents: null,
        ceilingUsd: this.ceilingUsd,
        remainingUsd: null,
      };
    }
    const knownUsd = persisted.knownUsd + this.runningKnown;
    const reservedUsd = (persisted.reservedUsd || 0) + this.runningReserved;
    return {
      knownUsd,
      reservedUsd,
      unknownEvents: persisted.unknownEvents,
      ceilingUsd: this.ceilingUsd,
      remainingUsd: Math.max(0, this.ceilingUsd - knownUsd - reservedUsd),
    };
  }
}

/**
 * Make one paid model call with durable accounting around the provider.
 */
export async function meteredModelCall(
  input: {
    operation: string;
    provider: string;
    requestedModel: string;
    modelRefusal?: string;
    accounting: {
      userId: string;
      tripId?: string;
      materialKey?: string;
      reservedUsd: number;
    };
  },
  session: SpendSession,
  deps: MeteredDeps,
): Promise<MeteredOutcome> {
  if (input.modelRefusal) {
    return { ok: false, refusal: 'model-not-approved', detail: input.modelRefusal };
  }

  if (!input.accounting.userId || !Number.isFinite(input.accounting.reservedUsd) || input.accounting.reservedUsd <= 0) {
    return {
      ok: false,
      refusal: 'accounting-failed',
      detail: 'The metered operation has no valid authenticated accounting reservation.',
    };
  }

  const gate = await session.gate();
  if (gate.allowed === false) return { ok: false, refusal: gate.refusal, detail: gate.detail };

  let reservation: AttemptReservation;
  try {
    reservation = await deps.reserveAttempt({
      user_id: input.accounting.userId,
      trip_id: input.accounting.tripId ?? null,
      material_key: input.accounting.materialKey ?? null,
      provider: input.provider,
      model_requested: input.requestedModel,
      operation: input.operation,
      reserved_cost_usd: input.accounting.reservedUsd,
    });
  } catch {
    return {
      ok: false,
      refusal: 'accounting-failed',
      detail: 'The AI accounting reservation failed, so the provider was not contacted.',
    };
  }
  if (reservation.ok === false) {
    return { ok: false, refusal: reservation.refusal, detail: reservation.detail };
  }
  session.noteReservation(input.accounting.reservedUsd);

  let response: {
    result: unknown;
    usage?: ModelUsage;
    providerRequestId?: string;
    status: AiRequestStatus;
    dispatchStatus?: ProviderDispatchStatus;
  };
  try {
    response = await deps.call();
  } catch {
    // Once control entered an arbitrary adapter, an exception alone cannot
    // prove the request stayed local. Conservative exposure is mandatory.
    response = { result: undefined, status: 'network_error', dispatchStatus: 'possibly-dispatched' };
  }

  const requestStatus = response.usage === undefined && response.status === 'success'
    ? 'usage_missing'
    : response.status;

  /**
   * Unknown usage is recorded as unknown unless the adapter positively proves
   * the request never crossed the dispatch boundary. Only that case has known
   * zero exposure; null token counts remain honest because no provider usage
   * exists.
   */
  const measuredEvent = spendEvent({
    provider: input.provider,
    requestedModel: input.requestedModel,
    operation: input.operation,
    usage: response.usage,
    status: requestStatus,
  });
  const definitelyNotDispatched = response.usage === undefined && response.dispatchStatus === 'not-dispatched';
  const event: AiSpendEvent = definitelyNotDispatched
    ? { ...measuredEvent, estimatedUsd: 0, unknownReason: undefined }
    : measuredEvent;

  let finalised = false;
  try {
    finalised = await deps.finalizeAttempt(
      reservation.attemptId,
      spendLedgerRow(event, {
        providerRequestId: response.providerRequestId,
        errorCode: definitelyNotDispatched ? 'not-dispatched' : undefined,
        userId: input.accounting.userId,
        tripId: input.accounting.tripId,
        materialKey: input.accounting.materialKey,
      }),
    );
  } catch {
    finalised = false;
  }
  const accounted = session.settleReservation(input.accounting.reservedUsd, event, finalised);
  if (!accounted) {
    return {
      ok: false,
      refusal: 'accounting-failed',
      detail: 'The provider attempt could not be finalised safely, so no successful answer is returned.',
    };
  }

  if (requestStatus !== 'success') {
    return { ok: false, refusal: 'provider-failed', detail: `Provider request ended as ${requestStatus}.` };
  }
  return { ok: true, result: response.result, event };
}

export { estimateCost, spendEvent, spendLedgerRow };

/**
 * The generic model boundary.
 *
 * `travel-evidence` owns the two grounded operations that reach a card
 * (`place-brief`, `admission-read`) and validates their output before anything
 * is shown. This endpoint is the un-opinionated sibling: it forwards an
 * operation to the selected provider and returns the parsed JSON.
 *
 * Because it does no validation of its own, **nothing it returns may be
 * rendered as fact without being validated by the caller.** It exists for
 * interpretation tasks whose output is structured data the app then checks —
 * not for prose destined straight for a screen.
 *
 * Two things it does own, because both are about spending rather than truth:
 * the daily cap, and the refusal to fail over between providers.
 */
import {
  aiBudgetEpoch,
  aiBudgetUsd,
  isReasoningOperation,
  json,
  preflight,
  expiryFor,
  reasoningCallLimit,
  resolveReasoning,
  REASONING_OPERATIONS,
  REASONING_QUOTA_PROVIDER,
  REASONING_QUOTA_TIMEZONE,
} from '../_shared/providers.ts';
import { callModel } from '../_shared/reasoning.ts';
import { budgetWindowStart, type ModelUsage } from '../_shared/aiCost.ts';
import {
  INTELLIGENCE_SCHEMA_VERSION,
  type IntelligenceCandidate,
  type IntelligenceTripContext,
  type ValidatedIntelligence,
} from '../_shared/candidateIntelligence.ts';
import { resolveCandidateIntelligence } from '../_shared/intelligenceService.ts';
import { SpendSession, meteredModelCall } from '../_shared/meteredModel.ts';
import {
  readCandidateIntelligence,
  readSpendToDate,
  serviceClient,
  writeCandidateIntelligence,
  writeSpendEvent,
} from '../_shared/cache.ts';
import { reserveQuota } from '../_shared/quota.ts';

interface ReasoningBody { operation?: string; input?: unknown; }

/**
 * The ceiling on one request's input, in characters of serialised JSON.
 *
 * A metered endpoint that accepts an arbitrarily large body lets anyone who
 * can reach it decide what a call costs, and input is billed per token. The
 * bound is on the *serialised* payload rather than on a field count because
 * that is the thing that maps to tokens — one enormous string and ten thousand
 * tiny ones cost the same either way.
 *
 * Roughly 30k characters ≈ 8k tokens, comfortably above what any operation
 * here legitimately sends and far below anything worth worrying about.
 */
const MAX_INPUT_CHARS = 30_000;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = (await request.json().catch(() => ({}))) as ReasoningBody;
  if (!body.operation || body.input === undefined) {
    return json({ error: 'operation and input are required.' }, 400);
  }

  /**
   * An allowlist, not a free-text field. `operation` reaches the model as part
   * of the prompt, so an open string is both a prompt-injection surface and a
   * way for anyone who can reach this endpoint to spend the deployment's
   * budget on work it never meant to do.
   */
  if (!isReasoningOperation(body.operation)) {
    return json({
      error: `Unknown operation. Allowed: ${REASONING_OPERATIONS.join(', ')}.`,
    }, 400);
  }

  /**
   * Captured once the allowlist has narrowed it. A property access cannot stay
   * narrowed across the awaits below, and re-reading `body.operation` later
   * would hand an unvalidated string to the model.
   */
  const operation = body.operation;

  // Bounded before the model is resolved, so an oversized body is refused
  // without any chance of it reaching a metered provider.
  const serialised = JSON.stringify(body.input);
  if (serialised.length > MAX_INPUT_CHARS) {
    return json({
      error: `Input too large: ${serialised.length} characters, limit ${MAX_INPUT_CHARS}.`,
    }, 413);
  }

  const resolution = resolveReasoning(operation);
  // A refused model is reported as its own failure. Collapsing it into "not
  // configured" would hide a misconfiguration behind an ordinary-looking state.
  if (resolution.status === 'misconfigured') return json({ error: resolution.error }, 500);
  if (resolution.status === 'unconfigured') return json({ error: 'AI reasoning is not configured.' }, 503);
  const { options } = resolution;

  /**
   * The shared metered boundary, identical to the one `travel-evidence` uses.
   *
   * This endpoint previously enforced only the daily *request* quota and no
   * dollar ceiling at all — so every operation routed through here would have
   * spent against the prepaid balance with nothing watching. Both endpoints
   * now go through one door, which is the only way a budget stays a budget as
   * features are added.
   */
  const cache = serviceClient();
  const session = new SpendSession(
    {
      readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())),
      writeLedger: (row) => writeSpendEvent(cache, row),
    },
    aiBudgetUsd(),
  );

  let usage: ModelUsage | undefined;

  /** One metered call, wired once and reused by every operation below. */
  const meteredDeps = (operation: string) => ({
    reserveQuota: () => reserveQuota(cache, {
      provider: REASONING_QUOTA_PROVIDER,
      calls: 1,
      units: 1,
      callLimit: reasoningCallLimit(),
      resetTimezone: REASONING_QUOTA_TIMEZONE,
      failClosed: true,
    }),
    readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())),
    writeLedger: (row: Record<string, unknown>) => writeSpendEvent(cache, row),
    call: async (payload: unknown) => {
      const result = await callModel(operation, payload, {
        ...options,
        onUsage: (reported) => { usage = reported; },
      });
      return {
        result,
        usage,
        status: (result !== undefined ? 'success' : usage ? 'invalid_output' : 'provider_error') as
          'success' | 'invalid_output' | 'provider_error',
      };
    },
  });

  /**
   * Candidate intelligence has its own shape: it consults a per-candidate cache
   * first, batches only the misses, and returns validated atoms rather than raw
   * model output. It reaches the provider exclusively through the same
   * `meteredModelCall` as everything else, so it inherits the model allowlist,
   * both ceilings, the daily quota, the spend guard and the ledger without
   * restating any of them.
   */
  if (operation === 'candidate-intelligence') {
    const payload = body.input as {
      trip?: IntelligenceTripContext;
      candidates?: IntelligenceCandidate[];
      plannerContextRevision?: string;
    };
    if (!payload?.trip || !Array.isArray(payload.candidates)) {
      return json({ error: 'trip and candidates are required.' }, 400);
    }

    const { results, diagnostics } = await resolveCandidateIntelligence(
      payload.trip,
      payload.candidates,
      {
        model: options.model,
        plannerContextRevision: payload.plannerContextRevision,
        maxSerialisedChars: MAX_INPUT_CHARS,
        readCache: (keys) => readCandidateIntelligence(cache, keys) as Promise<
          Map<string, ValidatedIntelligence | null | undefined>
        >,
        writeCache: (entries) => writeCandidateIntelligence(
          cache,
          entries.map((entry) => ({
            cacheKey: entry.cacheKey,
            candidateId: entry.candidate.candidateId,
            candidateRevision: entry.candidate.candidateRevision,
            profileRevision: entry.profileRevision,
            plannerContextRevision: entry.plannerContextRevision,
            schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
            model: entry.model,
            intelligence: entry.intelligence,
          })),
          expiryFor('placeIdentity'),
        ),
        callMetered: async (requestPayload) => {
          const call = await meteredModelCall(
            {
              operation: 'candidate-intelligence',
              provider: options.provider,
              requestedModel: options.model,
            },
            session,
            { ...meteredDeps('candidate-intelligence'), call: () => meteredDeps('candidate-intelligence').call(requestPayload) },
          );
          return call.ok
            ? { ok: true as const, result: call.result }
            : { ok: false as const, refusal: call.refusal };
        },
      },
    );

    return json({
      operation,
      provider: options.provider,
      results,
      diagnostics,
      spend: await session.report(),
    });
  }

  const outcome = await meteredModelCall(
    { operation: body.operation, provider: options.provider, requestedModel: options.model },
    session,
    {
      ...meteredDeps(operation),
      // One attempt, no retry, no failover to the other vendor — see
      // `callModel`. A failed interpretation is a missing interpretation.
      call: () => meteredDeps(operation).call(body.input),
    },
  );

  if (!outcome.ok) {
    const status = outcome.refusal === 'quota-exhausted' ? 429
      : outcome.refusal === 'provider-failed' ? 502
        : 503;
    return json({ error: outcome.detail, refusal: outcome.refusal }, status);
  }

  return json({ operation, provider: options.provider, result: outcome.result });
});

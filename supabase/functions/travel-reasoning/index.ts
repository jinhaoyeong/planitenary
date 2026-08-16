/**
 * Authenticated reasoning boundary.
 *
 * Candidate facts are still validated client material for this beta because
 * discovery is intentionally session-scoped. Spending is not: the handler
 * establishes the caller, verifies the owned trip, scopes cache/accounting to
 * that trip, and reaches the provider only after the atomic reservation exists.
 */
import {
  aiBudgetEpoch,
  aiReasoningLimits,
  aiSafetyBudgetUsd,
  expiryFor,
  json,
  preflight,
  resolveReasoning,
  REASONING_OPERATIONS,
  type ReasoningOperation,
} from '../_shared/providers.ts';
import { callModel } from '../_shared/reasoning.ts';
import { budgetWindowStart, maximumReservedCost, type ModelUsage } from '../_shared/aiCost.ts';
import {
  INTELLIGENCE_SCHEMA_VERSION,
  intelligenceBatchClaimKey,
  intelligenceCacheKey,
  type IntelligenceCandidate,
} from '../_shared/candidateIntelligence.ts';
import { resolveCandidateIntelligence, type CacheReadOutcome } from '../_shared/intelligenceService.ts';
import { authenticateRequest } from '../_shared/auth.ts';
import { authorizeCandidateTrip, type ReasoningTripInput } from '../_shared/reasoningRequest.ts';
import { readOwnedTrip } from '../_shared/tripOwnership.ts';
import {
  claimCandidateIntelligence,
  finalizeAiSpendAttempt,
  readCandidateIntelligence,
  readSpendToDate,
  releaseCandidateIntelligence,
  serviceClient,
  writeCandidateIntelligence,
} from '../_shared/cache.ts';
import { reserveAiReasoningAttempt } from '../_shared/quota.ts';
import { SpendSession, meteredModelCall, type MeteredDeps } from '../_shared/meteredModel.ts';

interface ReasoningBody { operation?: string; input?: unknown; }

const MAX_INPUT_CHARS = 30_000;
const CLAIM_TTL_MS = 30_000;

const responseStatus = (refusal: string): number => {
  if (refusal === 'quota-exhausted') return 429;
  if (refusal === 'provider-failed') return 502;
  if (refusal === 'budget-reached') return 429;
  return 503;
};

const authorizationStatus = (code: string): number => {
  if (code === 'unauthorized') return 401;
  if (code === 'invalid-trip') return 400;
  if (code === 'trip-not-owned') return 403;
  if (code === 'trip-lookup-failed') return 503;
  return 409;
};

/** Fresh usage/request state is created here for every batch invocation. */
const meteredDependencies = (input: {
  cache: NonNullable<ReturnType<typeof serviceClient>>;
  userId: string;
  limits: NonNullable<ReturnType<typeof aiReasoningLimits>>;
  budgetUsd: number;
  operation: string;
  provider: string;
  model: string;
  tripId?: string;
  materialKey?: string;
  maxCostUsd: number;
}, call: MeteredDeps['call']): MeteredDeps => ({
    reserveAttempt: (row) => reserveAiReasoningAttempt(input.cache, {
      userId: input.userId,
      tripId: input.tripId,
      provider: String(row.provider || input.provider),
      model: String(row.model_requested || input.model),
      operation: String(row.operation || input.operation),
      materialKey: input.materialKey,
      reservedUsd: input.maxCostUsd,
      budgetUsd: input.budgetUsd,
      budgetSince: budgetWindowStart(aiBudgetEpoch()),
      globalLimit: input.limits.global,
      userLimit: input.limits.user,
      tripLimit: input.limits.trip,
    }),
    finalizeAttempt: (attemptId, row) => finalizeAiSpendAttempt(input.cache, attemptId, row),
    readSpend: () => readSpendToDate(input.cache, budgetWindowStart(aiBudgetEpoch())),
    call,
  });

/** Build a fresh provider callback for one metered request. */
const providerCall = (
  operation: string,
  options: { apiKey: string; provider: 'openai' | 'gemini'; model: string; reasoningEffort?: string; maxOutputTokens: number },
  payload: unknown,
): MeteredDeps['call'] => {
  let usage: ModelUsage | undefined;
  let providerRequestId: string | undefined;
  return async () => {
    usage = undefined;
    providerRequestId = undefined;
    const result = await callModel(operation, payload, {
      ...options,
      onUsage: (reported) => { usage = reported; },
      onProviderResponse: (response) => {
        providerRequestId = response.providerRequestId;
        if (response.usage) usage = response.usage;
      },
    });
    return {
      result,
      usage,
      providerRequestId,
      status: (result !== undefined ? 'success' : usage ? 'invalid_output' : 'provider_error') as
        'success' | 'invalid_output' | 'provider_error',
    };
  };
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authentication = await authenticateRequest(request);
  if (authentication.ok === false) return json({ error: authentication.detail }, authentication.status);

  const body = (await request.json().catch(() => ({}))) as ReasoningBody;
  if (!body.operation || body.input === undefined) {
    return json({ error: 'operation and input are required.' }, 400);
  }
  if (!REASONING_OPERATIONS.includes(body.operation as ReasoningOperation)) {
    return json({ error: `Unknown operation. Allowed: ${REASONING_OPERATIONS.join(', ')}.` }, 400);
  }
  const operation = body.operation as ReasoningOperation;

  const serialised = JSON.stringify(body.input);
  if (serialised.length > MAX_INPUT_CHARS) {
    return json({ error: `Input too large: ${serialised.length} characters, limit ${MAX_INPUT_CHARS}.` }, 413);
  }

  const cache = serviceClient();
  if (!cache) return json({ error: 'AI accounting is not configured.' }, 503);

  let candidateAuthorization: Awaited<ReturnType<typeof authorizeCandidateTrip>> | undefined;
  if (operation === 'candidate-intelligence') {
    const payload = body.input as {
      trip?: ReasoningTripInput;
      candidates?: IntelligenceCandidate[];
      plannerContextRevision?: string;
    };
    if (!payload?.trip || !Array.isArray(payload.candidates)) {
      return json({ error: 'trip and candidates are required.' }, 400);
    }
    candidateAuthorization = await authorizeCandidateTrip(
      payload,
      authentication.caller.userId,
      (tripId, userId) => readOwnedTrip(cache, tripId, userId),
    );
    if (candidateAuthorization.ok === false) {
      return json({ error: candidateAuthorization.detail }, authorizationStatus(candidateAuthorization.code));
    }
  }

  const resolution = resolveReasoning(operation);
  if (resolution.status === 'misconfigured') return json({ error: resolution.error }, 500);
  if (resolution.status === 'unconfigured') return json({ error: 'AI reasoning is not configured.' }, 503);
  const { options } = resolution;
  const limits = aiReasoningLimits();
  const budgetUsd = aiSafetyBudgetUsd();
  if (!limits || budgetUsd === null) {
    return json({ error: 'AI spending limits are not configured safely.' }, 503);
  }
  const maxCostUsd = maximumReservedCost({
    provider: options.provider,
    model: options.model,
    maxOutputTokens: options.maxOutputTokens,
  });
  if (maxCostUsd === null) {
    return json({ error: 'The selected AI provider/model has no conservative accounting policy.' }, 503);
  }

  const session = new SpendSession(
    { readSpend: () => readSpendToDate(cache, budgetWindowStart(aiBudgetEpoch())) },
    budgetUsd,
  );

  if (operation === 'candidate-intelligence' && candidateAuthorization?.ok) {
    const payload = body.input as {
      trip: ReasoningTripInput;
      candidates: IntelligenceCandidate[];
      plannerContextRevision?: string;
    };
    const authorizedTrip = candidateAuthorization.trip;
    const { results, diagnostics } = await resolveCandidateIntelligence(
      authorizedTrip,
      payload.candidates,
      {
        model: options.model,
        tripId: candidateAuthorization.tripId,
        plannerContextRevision: payload.plannerContextRevision,
        maxSerialisedChars: MAX_INPUT_CHARS,
        readCache: (keys) => readCandidateIntelligence(
          cache,
          candidateAuthorization!.tripId,
          keys,
        ) as Promise<CacheReadOutcome>,
        writeCache: (entries) => writeCandidateIntelligence(
          cache,
          entries.map((entry) => ({
            tripId: candidateAuthorization!.tripId,
            cacheKey: entry.cacheKey,
            candidateId: entry.candidate.candidateId,
            candidateRevision: entry.candidate.candidateRevision,
            tripMaterialRevision: entry.tripMaterialRevision,
            plannerRevision: entry.plannerRevision,
            schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
            model: entry.model,
            intelligence: entry.intelligence,
          })),
          expiryFor('placeIdentity'),
        ),
        claimBatch: (claimKey) => claimCandidateIntelligence(cache, {
          claimKey,
          userId: authentication.caller.userId,
          tripId: candidateAuthorization!.tripId,
          expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
        }),
        releaseBatch: (claimKey) => releaseCandidateIntelligence(cache, claimKey),
        callMetered: async (requestPayload) => {
          const batch = (requestPayload as { candidates?: IntelligenceCandidate[] }).candidates || [];
          const materialKey = intelligenceBatchClaimKey({
            tripId: candidateAuthorization!.tripId,
            model: options.model,
            cacheKeys: batch.map((candidate) => intelligenceCacheKey({
              tripId: candidateAuthorization!.tripId,
              candidateId: candidate.candidateId,
              candidateRevision: candidate.candidateRevision,
              plannerRevision: candidate.plannerRevision,
              tripMaterialRevision: authorizedTrip.tripMaterialRevision,
              model: options.model,
            })),
          });
          const deps = meteredDependencies({
            cache,
            userId: authentication.caller.userId,
            limits,
            budgetUsd,
            operation: 'candidate-intelligence',
            provider: options.provider,
            model: options.model,
            tripId: candidateAuthorization!.tripId,
            materialKey,
            maxCostUsd,
          }, providerCall('candidate-intelligence', options, requestPayload));
          const call = await meteredModelCall(
            {
              operation: 'candidate-intelligence',
              provider: options.provider,
              requestedModel: options.model,
              accounting: {
                userId: authentication.caller.userId,
                tripId: candidateAuthorization!.tripId,
                materialKey,
                reservedUsd: maxCostUsd,
              },
            },
            session,
            deps,
          );
          return call.ok === true
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

  const deps = meteredDependencies({
    cache,
    userId: authentication.caller.userId,
    limits,
    budgetUsd,
    operation,
    provider: options.provider,
    model: options.model,
    maxCostUsd,
  }, providerCall(operation, options, body.input));
  const outcome = await meteredModelCall(
    {
      operation,
      provider: options.provider,
      requestedModel: options.model,
      accounting: { userId: authentication.caller.userId, reservedUsd: maxCostUsd },
    },
    session,
    deps,
  );
  if (outcome.ok === false) return json({ error: outcome.detail, refusal: outcome.refusal }, responseStatus(outcome.refusal));
  return json({ operation, provider: options.provider, result: outcome.result });
});

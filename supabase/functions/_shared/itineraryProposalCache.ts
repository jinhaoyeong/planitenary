/**
 * Exact itinerary-proposal cache lookup, kept free of Deno and of any model
 * client so Plan my trip can reuse a paid preview without initialising one.
 *
 * A hit is never "the latest proposal". The only usable row is the one whose
 * trip id and material revision both match the trip we just authorised and
 * the planning material we just derived.
 */
import {
  buildPlanningMaterial,
  type PlanningMaterial,
  type TripItineraryProposal,
} from './itineraryProposal.ts';

export type ExactProposalCacheReader = (
  tripId: string,
  materialRevision: string,
) => Promise<unknown>;

export type ExactProposalCacheLookup =
  | { kind: 'hit'; proposal: TripItineraryProposal; material: PlanningMaterial }
  | { kind: 'miss'; material: PlanningMaterial; materialChars: number }
  | { kind: 'too-large'; materialChars: number; limit: number };

export interface CachedProposalLimits {
  maxInputChars: number;
  maxModelRounds: number;
  maxToolCalls: number;
  maxWebSearches: number;
  maxRouteCalls: number;
  maxPlaceLookups: number;
}

export const GENERATION_DISABLED_DETAIL =
  'New AI generation is disabled. No matching cached proposal was available.';

/** The kill switch must block new paid calls, not already-paid exact cache hits. */
export function isGenerationKillSwitch(configuredModel: string): boolean {
  return configuredModel.trim().toLowerCase() === 'disabled';
}

/**
 * Fail closed unless every identity field still matches the authorised lookup.
 *
 * The database query already filters by trip and revision; this second check
 * is what stops a malformed or swapped JSON payload from becoming a hit.
 */
export function usableCachedItineraryProposal(
  proposal: unknown,
  tripId: string,
  materialRevision: string,
): TripItineraryProposal | null {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const value = proposal as TripItineraryProposal;
  return value.kind === 'itinerary-proposal-v1'
    && value.tripId === tripId
    && value.materialRevision === materialRevision
    && value.applied === false
    ? value
    : null;
}

export async function lookupExactItineraryProposalCache(input: {
  tripId: string;
  itinerary: unknown;
  maxInputChars: number;
  readCache: ExactProposalCacheReader;
}): Promise<ExactProposalCacheLookup> {
  const material = await buildPlanningMaterial(input.tripId, input.itinerary);
  const materialChars = JSON.stringify(material).length;
  if (materialChars > input.maxInputChars) {
    return { kind: 'too-large', materialChars, limit: input.maxInputChars };
  }
  const stored = await input.readCache(input.tripId, material.revision);
  const proposal = usableCachedItineraryProposal(stored, input.tripId, material.revision);
  return proposal
    ? { kind: 'hit', proposal, material }
    : { kind: 'miss', material, materialChars };
}

/** Paid generation is the miss path only. A hit must not reserve, meter, or call. */
export function paidGenerationShouldRun(kind: ExactProposalCacheLookup['kind']): boolean {
  return kind === 'miss';
}

export function cachedItineraryProposalEnvelope(
  proposal: TripItineraryProposal,
  limits: CachedProposalLimits,
) {
  return {
    operation: 'build-itinerary' as const,
    tripId: proposal.tripId,
    status: proposal.status === 'valid' ? 'answered' as const : 'partial' as const,
    itineraryProposal: proposal,
    applied: false as const,
    cached: true as const,
    transcript: [] as const,
    budget: { modelRounds: 0, toolCalls: 0, webSearches: 0, routeCalls: 0, placeLookups: 0 },
    limits,
    spend: { knownUsd: 0, unknownEvents: 0, reservedUsd: 0 },
  };
}

export function generationDisabledRefusal(tripId: string) {
  return {
    operation: 'build-itinerary' as const,
    tripId,
    status: 'refused' as const,
    applied: false as const,
    refusal: 'generation-disabled' as const,
    detail: GENERATION_DISABLED_DETAIL,
  };
}

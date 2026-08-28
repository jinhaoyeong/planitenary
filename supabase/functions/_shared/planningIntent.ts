/**
 * Server-owned intent and outcome contract for Smart Plan.
 *
 * The browser may choose a scope and a source/cache policy. It may not send
 * places, coordinates, opening hours, or proposal metadata: those are derived
 * again from the owned itinerary and factual provider results.
 */

export type PlanningScope =
  | { type: 'day'; day: number }
  | { type: 'trip' };

export type PlanningSourcePolicy = 'saved-only' | 'saved-plus-suggestions';
export type PlanningCachePolicy = 'prefer-cache' | 'fresh-alternative';

export interface PlanningRequest {
  scope: PlanningScope;
  sourcePolicy: PlanningSourcePolicy;
  cachePolicy: PlanningCachePolicy;
  /** Identity of the arrangement the traveller is asking to differ from. */
  previousProposalId?: string;
}

export const DEFAULT_PLANNING_REQUEST: PlanningRequest = {
  scope: { type: 'trip' },
  sourcePolicy: 'saved-plus-suggestions',
  cachePolicy: 'prefer-cache',
};

export interface PlanningPreflight {
  eligibleSavedPlaces: number;
  suggestedPlaces: number;
  missingCanonicalIdentity: number;
  missingCoordinates: number;
  targetCapacity: number;
  discoveryAvailable: boolean;
}

export interface ProposalMeta {
  planningRunId: string;
  scope: PlanningScope;
  source: 'cache' | 'fresh';
  savedPlaceCount: number;
  suggestedPlaceCount: number;
  assignedCount: number;
  omittedCount: number;
  routedLegCount: number;
  validationVersion: number;
  bookingConstraintsApplied?: number;
  confirmedBookingsApplied?: number;
  requestedBookingsProtected?: number;
  bookingConflicts?: number;
  /** Stable assignment structure; timestamps and prose are deliberately absent. */
  arrangementFingerprint: string;
}

export type PlanningOutcomeCode =
  | 'ready'
  | 'needs_places'
  | 'unresolvable_places'
  | 'no_verified_candidates'
  /**
   * The factual sources could not be reached. Distinct from
   * `no_verified_candidates`, which is a claim about the city rather than
   * about us: saying "no verified places exist" when Overpass merely timed
   * out tells the traveller something false about where they are going.
   */
  | 'discovery_unavailable'
  | 'generation_unavailable'
  | 'no_alternative'
  | 'failed';

export interface PlanningOutcomeEnvelope {
  outcome: PlanningOutcomeCode;
  detail?: string;
  preflight?: PlanningPreflight;
}

export type PlanningProgressStage =
  | 'planning_started'
  | 'preflight_complete'
  | 'discovery_started'
  | 'discovery_complete'
  | 'routing_started'
  | 'routing_complete'
  | 'scheduling_started'
  | 'validation_started'
  | 'validation_complete'
  | 'proposal_ready';

export interface PlanningProgressEvent {
  stage: PlanningProgressStage;
  detail?: string;
  count?: number;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

export function parsePlanningRequest(value: unknown): PlanningRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_PLANNING_REQUEST;
  const raw = value as Record<string, unknown>;
  const rawScope = raw.scope && typeof raw.scope === 'object' && !Array.isArray(raw.scope)
    ? raw.scope as Record<string, unknown>
    : {};
  const day = typeof rawScope.day === 'number' && Number.isInteger(rawScope.day) && rawScope.day > 0
    ? Math.min(rawScope.day, 366)
    : undefined;
  const scope: PlanningScope = rawScope.type === 'day' && day
    ? { type: 'day', day }
    : { type: 'trip' };
  return {
    scope,
    sourcePolicy: raw.sourcePolicy === 'saved-only' ? 'saved-only' : 'saved-plus-suggestions',
    cachePolicy: raw.cachePolicy === 'fresh-alternative' ? 'fresh-alternative' : 'prefer-cache',
    previousProposalId: text(raw.previousProposalId, 180),
  };
}

export const planningRequestKey = (request: PlanningRequest): string => [
  request.scope.type,
  request.scope.type === 'day' ? request.scope.day : 'all',
  request.sourcePolicy,
].join(':');

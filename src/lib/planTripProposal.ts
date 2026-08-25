/** Client transport for the Phase 2A proposal-only planner. */
import { invokeTravelFunction } from './supabase';
import type {
  ProposalConflict,
  ProposedItineraryDay,
  ProposedItineraryItem,
  SuggestedPlaceMaterial,
  TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import {
  DEFAULT_PLANNING_REQUEST,
  parsePlanningRequest,
  type PlanningOutcomeCode,
  type PlanningPreflight,
  type PlanningProgressEvent,
  type PlanningRequest,
  type ProposalMeta,
} from '../../supabase/functions/_shared/planningIntent';
import { parseStructuredPlaceRef } from '../../supabase/functions/_shared/placeReference';
import { parsePlaceImage } from '../../supabase/functions/_shared/placeImages';
import { activityCitiesFrom, parseDayTransfer } from '../../supabase/functions/_shared/dayCitySemantics';

export interface PlanTripResult {
  status: 'answered' | 'partial' | 'refused';
  outcome: PlanningOutcomeCode;
  proposal?: TripItineraryProposal;
  detail?: string;
  preflight?: PlanningPreflight;
  progress: PlanningProgressEvent[];
  cached: boolean;
}

const text = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const strings = (value: unknown, max = 20): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, max)
    : [];

const providerModeMatches = (requestedMode: string, providerMode: string | undefined): boolean => {
  if (!providerMode) return true;
  const supported: Record<string, readonly string[]> = {
    walking: ['walking', 'foot-walking', 'WALK'],
    driving: ['driving-car', 'DRIVE'],
    cycling: ['cycling-regular', 'BICYCLE'],
    'public-transport': ['TRANSIT'],
  };
  return supported[requestedMode]?.includes(providerMode) === true;
};

const parseSuggestedPlace = (value: unknown): SuggestedPlaceMaterial | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const ref = parseStructuredPlaceRef(raw.ref);
  const name = text(raw.name, 180);
  const city = text(raw.city, 160);
  const coordinates = Array.isArray(raw.coordinates) && raw.coordinates.length === 2
    && raw.coordinates.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? raw.coordinates as [number, number]
    : undefined;
  const duration = finite(raw.durationMinutes);
  if (!ref || !name || !city || !coordinates || duration === undefined) return undefined;
  const openingHours = Array.isArray(raw.openingHours) ? raw.openingHours.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const window = entry as Record<string, unknown>;
    const opensAt = text(window.opensAt, 5);
    const closesAt = text(window.closesAt, 5);
    if (!opensAt || !closesAt) return [];
    return [{
      opensAt,
      closesAt,
      days: Array.isArray(window.days)
        ? window.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
        : undefined,
      sourceUrl: text(window.sourceUrl, 1000),
    }];
  }) : [];
  return {
    ref,
    name,
    city,
    countryCode: text(raw.countryCode, 2)?.toUpperCase(),
    location: text(raw.location, 160),
    coordinates,
    categories: strings(raw.categories, 12),
    durationMinutes: Math.max(15, Math.round(duration)),
    openingHours,
    sourceUrls: strings(raw.sourceUrls, 12).filter((entry) => /^https?:\/\//i.test(entry)),
    image: parsePlaceImage(raw.image),
  };
};

const parseItem = (value: unknown): ProposedItineraryItem | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 180);
  const name = text(raw.name, 180);
  const arrivalTime = text(raw.arrivalTime, 5);
  const startTime = text(raw.startTime, 5);
  const endTime = text(raw.endTime, 5);
  const duration = finite(raw.visitDurationMinutes);
  const allowedTypes = ['place', 'reservation', 'meal', 'rest', 'free-time'] as const;
  const type = allowedTypes.find((candidate) => candidate === raw.type);
  if (!id || !name || !arrivalTime || !startTime || !endTime || duration === undefined || !type) return undefined;

  const rawTravel = raw.travelFromPrevious && typeof raw.travelFromPrevious === 'object'
    ? raw.travelFromPrevious as Record<string, unknown>
    : null;
  const fromPlaceId = text(rawTravel?.fromPlaceId, 120);
  const fromName = text(rawTravel?.fromName, 180);
  const travelStatus = rawTravel?.status === 'confirmed' || rawTravel?.status === 'unavailable'
    ? rawTravel.status
    : undefined;
  const source = rawTravel?.source === 'provider' || rawTravel?.source === 'cache' || rawTravel?.source === 'unavailable'
    ? rawTravel.source
    : undefined;
  const routeMode = ['walking', 'public-transport', 'driving', 'cycling'].find((candidate) => candidate === rawTravel?.mode);
  const requestedMode = ['walking', 'public-transport', 'driving', 'cycling']
    .find((candidate) => candidate === rawTravel?.requestedMode);
  const displayMode = requestedMode ?? routeMode;
  const providerMode = text(rawTravel?.providerMode, 80);
  const modeMismatch = Boolean(displayMode && !providerModeMatches(displayMode, providerMode));

  return {
    id,
    placeId: text(raw.placeId, 120),
    type,
    name,
    arrivalTime,
    startTime,
    endTime,
    visitDurationMinutes: Math.round(duration),
    travelFromPrevious: rawTravel && fromPlaceId && fromName && travelStatus && source && displayMode
      ? {
          fromPlaceId,
          fromName,
          mode: displayMode as 'walking' | 'public-transport' | 'driving' | 'cycling',
          requestedMode: requestedMode as 'walking' | 'public-transport' | 'driving' | 'cycling' | undefined,
          providerMode,
          provider: text(rawTravel.provider, 80),
          durationMinutes: modeMismatch ? undefined : finite(rawTravel.durationMinutes),
          distanceMeters: finite(rawTravel.distanceMeters),
          source: modeMismatch ? 'unavailable' : source,
          status: modeMismatch ? 'unavailable' : travelStatus,
        }
      : undefined,
    bufferMinutes: Math.max(0, Math.round(finite(raw.bufferMinutes) ?? 0)),
    rationale: text(raw.rationale, 500) ?? 'Deterministically scheduled from the proposal material.',
    warnings: strings(raw.warnings, 8),
    evidence: strings(raw.evidence, 12).filter((entry) => /^https?:\/\//i.test(entry)),
    imageUrl: text(raw.imageUrl, 1000),
    priority: ['must-do', 'interested', 'optional', 'locked'].find((entry) => entry === raw.priority) as ProposedItineraryItem['priority'],
    locked: raw.locked === true,
    activityCity: text(raw.activityCity, 160),
    suggestedPlace: parseSuggestedPlace(raw.suggestedPlace),
  };
};

const parseDay = (value: unknown): ProposedItineraryDay | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const day = finite(raw.day);
  const stayCity = text(raw.stayCity, 160) ?? text(raw.city, 160);
  const startTime = text(raw.startTime, 5);
  const endTime = text(raw.endTime, 5);
  const metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics as Record<string, unknown> : {};
  if (!day || !Number.isInteger(day) || !stayCity || !startTime || !endTime) return undefined;
  return {
    day,
    date: text(raw.date, 20),
    stayCity,
    activityCities: activityCitiesFrom(strings(raw.activityCities, 6), stayCity),
    transfer: parseDayTransfer(raw.transfer, stayCity),
    city: stayCity,
    startTime,
    endTime,
    rationale: text(raw.rationale, 300),
    items: Array.isArray(raw.items) ? raw.items.flatMap((entry) => parseItem(entry) ?? []) : [],
    warnings: strings(raw.warnings, 12),
    metrics: {
      placeCount: Math.max(0, Math.round(finite(metrics.placeCount) ?? 0)),
      travelMinutes: Math.max(0, Math.round(finite(metrics.travelMinutes) ?? 0)),
      freeMinutes: Math.max(0, Math.round(finite(metrics.freeMinutes) ?? 0)),
      clusterChanges: Math.max(0, Math.round(finite(metrics.clusterChanges) ?? 0)),
    },
  };
};

const parseConflict = (value: unknown): ProposalConflict | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const code = text(raw.code, 80) as ProposalConflict['code'] | undefined;
  const message = text(raw.message, 500);
  if (!code || !message || (raw.severity !== 'error' && raw.severity !== 'warning')) return undefined;
  return {
    code,
    severity: raw.severity,
    message,
    day: finite(raw.day),
    placeId: text(raw.placeId, 120),
    relatedPlaceId: text(raw.relatedPlaceId, 120),
  };
};

const parseProposalMeta = (value: unknown): ProposalMeta | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const planningRunId = text(raw.planningRunId, 180);
  const arrangementFingerprint = text(raw.arrangementFingerprint, 180);
  const source = raw.source === 'cache' || raw.source === 'fresh' ? raw.source : undefined;
  const validationVersion = finite(raw.validationVersion);
  const parsedIntent = parsePlanningRequest({ scope: raw.scope });
  if (!planningRunId || !arrangementFingerprint || !source || validationVersion === undefined) return undefined;
  return {
    planningRunId,
    scope: parsedIntent.scope,
    source,
    savedPlaceCount: Math.max(0, Math.round(finite(raw.savedPlaceCount) ?? 0)),
    suggestedPlaceCount: Math.max(0, Math.round(finite(raw.suggestedPlaceCount) ?? 0)),
    assignedCount: Math.max(0, Math.round(finite(raw.assignedCount) ?? 0)),
    omittedCount: Math.max(0, Math.round(finite(raw.omittedCount) ?? 0)),
    routedLegCount: Math.max(0, Math.round(finite(raw.routedLegCount) ?? 0)),
    validationVersion: Math.round(validationVersion),
    arrangementFingerprint,
  };
};

const parsePreflight = (value: unknown): PlanningPreflight | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    eligibleSavedPlaces: Math.max(0, Math.round(finite(raw.eligibleSavedPlaces) ?? 0)),
    suggestedPlaces: Math.max(0, Math.round(finite(raw.suggestedPlaces) ?? 0)),
    missingCanonicalIdentity: Math.max(0, Math.round(finite(raw.missingCanonicalIdentity) ?? 0)),
    missingCoordinates: Math.max(0, Math.round(finite(raw.missingCoordinates) ?? 0)),
    targetCapacity: Math.max(0, Math.round(finite(raw.targetCapacity) ?? 0)),
    discoveryAvailable: raw.discoveryAvailable === true,
  };
};

const PROGRESS_STAGES = new Set<PlanningProgressEvent['stage']>([
  'planning_started', 'preflight_complete', 'discovery_started', 'discovery_complete',
  'routing_started', 'routing_complete', 'scheduling_started', 'validation_started',
  'validation_complete', 'proposal_ready',
]);

const parseProgress = (value: unknown): PlanningProgressEvent[] => Array.isArray(value)
  ? value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const raw = entry as Record<string, unknown>;
      if (!PROGRESS_STAGES.has(raw.stage as PlanningProgressEvent['stage'])) return [];
      return [{
        stage: raw.stage as PlanningProgressEvent['stage'],
        detail: text(raw.detail, 240),
        count: finite(raw.count),
      }];
    }).slice(0, 30)
  : [];

export function parseTripProposal(payload: unknown): TripItineraryProposal | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const raw = payload as Record<string, unknown>;
  if (raw.kind !== 'itinerary-proposal-v1' || raw.applied !== false) return undefined;
  const id = text(raw.id, 180);
  const tripId = text(raw.tripId, 180);
  const materialRevision = text(raw.materialRevision, 180);
  const createdAt = text(raw.createdAt, 80);
  const pace = raw.pace === 'relaxed' || raw.pace === 'balanced' || raw.pace === 'fast' ? raw.pace : undefined;
  const status = raw.status === 'valid' || raw.status === 'needs-review' ? raw.status : undefined;
  const meta = parseProposalMeta(raw.meta);
  const route = raw.routeSummary && typeof raw.routeSummary === 'object'
    ? raw.routeSummary as Record<string, unknown>
    : {};
  if (!id || !tripId || !materialRevision || !createdAt || !pace || !status || !meta) return undefined;
  return {
    kind: 'itinerary-proposal-v1',
    id,
    tripId,
    materialRevision,
    createdAt,
    status,
    applied: false,
    pace,
    days: Array.isArray(raw.days) ? raw.days.flatMap((entry) => parseDay(entry) ?? []) : [],
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts.flatMap((entry) => parseConflict(entry) ?? []) : [],
    warnings: strings(raw.warnings, 30),
    omittedPlaceIds: strings(raw.omittedPlaceIds, 50),
    routeSummary: {
      matrixCalls: Math.max(0, Math.round(finite(route.matrixCalls) ?? 0)),
      confirmedLegs: Math.max(0, Math.round(finite(route.confirmedLegs) ?? 0)),
      unavailableLegs: Math.max(0, Math.round(finite(route.unavailableLegs) ?? 0)),
      allDurationsProviderDerived: route.allDurationsProviderDerived === true,
    },
    repairIterations: Math.max(0, Math.round(finite(raw.repairIterations) ?? 0)),
    meta,
  };
}

export async function planTripProposal(
  tripId: string,
  requestOrInvoke: PlanningRequest | ((name: string, body: unknown) => Promise<unknown>) = DEFAULT_PLANNING_REQUEST,
  invokeOverride: (name: string, body: unknown) => Promise<unknown> = invokeTravelFunction,
): Promise<PlanTripResult> {
  const request = typeof requestOrInvoke === 'function'
    ? DEFAULT_PLANNING_REQUEST
    : parsePlanningRequest(requestOrInvoke);
  const invoke = typeof requestOrInvoke === 'function' ? requestOrInvoke : invokeOverride;
  if (!tripId) return { status: 'refused', outcome: 'failed', detail: 'A trip is required.', progress: [], cached: false };
  try {
    const response = await invoke('planitenary-agent', {
      operation: 'build-itinerary',
      tripId,
      question: 'Build a complete proposal from my saved trip material.',
      planningRequest: request,
    });
    const envelope = response && typeof response === 'object' ? response as Record<string, unknown> : {};
    const proposal = parseTripProposal(envelope.itineraryProposal);
    const allowedOutcomes: PlanningOutcomeCode[] = [
      'ready', 'needs_places', 'unresolvable_places', 'no_verified_candidates',
      'generation_unavailable', 'no_alternative', 'failed',
    ];
    const outcome = allowedOutcomes.find((entry) => entry === envelope.outcome)
      ?? (proposal?.status === 'valid' && proposal.meta.assignedCount > 0 ? 'ready' : 'failed');
    const status = envelope.status === 'answered' || envelope.status === 'partial' || envelope.status === 'refused'
      ? envelope.status
      : proposal ? (proposal.status === 'valid' ? 'answered' : 'partial') : 'refused';
    const progress = parseProgress(envelope.progress);
    const cached = envelope.cached === true || proposal?.meta.source === 'cache';
    if (outcome === 'ready' && (!proposal || proposal.status !== 'valid' || proposal.meta.assignedCount <= 0)) {
      return { status: 'refused', outcome: 'failed', detail: 'The planner returned an empty or malformed proposal, so it was not shown.', progress, cached };
    }
    if (!proposal && status !== 'refused') {
      return { status: 'refused', outcome: 'failed', detail: 'The planner returned a malformed proposal, so it was not shown.', progress, cached };
    }
    return {
      status,
      outcome,
      proposal,
      detail: text(envelope.detail, 500),
      preflight: parsePreflight(envelope.preflight),
      progress,
      cached,
    };
  } catch (error) {
    return {
      status: 'refused',
      outcome: 'failed',
      detail: error instanceof Error ? error.message : 'The proposal planner is unavailable.',
      progress: [],
      cached: false,
    };
  }
}

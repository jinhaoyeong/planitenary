/** Client transport for the Phase 2A proposal-only planner. */
import { invokeTravelFunction } from './supabase';
import type {
  ProposalConflict,
  ProposedItineraryDay,
  ProposedItineraryItem,
  TripItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposal';
import { activityCitiesFrom, parseDayTransfer } from '../../supabase/functions/_shared/dayCitySemantics';

export interface PlanTripResult {
  status: 'answered' | 'partial' | 'refused';
  proposal?: TripItineraryProposal;
  detail?: string;
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
  const route = raw.routeSummary && typeof raw.routeSummary === 'object'
    ? raw.routeSummary as Record<string, unknown>
    : {};
  if (!id || !tripId || !materialRevision || !createdAt || !pace || !status) return undefined;
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
  };
}

export async function planTripProposal(
  tripId: string,
  invoke: (name: string, body: unknown) => Promise<unknown> = invokeTravelFunction,
): Promise<PlanTripResult> {
  if (!tripId) return { status: 'refused', detail: 'A trip is required.' };
  try {
    const response = await invoke('planitenary-agent', {
      operation: 'build-itinerary',
      tripId,
      question: 'Build a complete proposal from my saved trip material.',
    });
    const envelope = response && typeof response === 'object' ? response as Record<string, unknown> : {};
    const proposal = parseTripProposal(envelope.itineraryProposal);
    const status = envelope.status === 'answered' || envelope.status === 'partial' || envelope.status === 'refused'
      ? envelope.status
      : proposal ? (proposal.status === 'valid' ? 'answered' : 'partial') : 'refused';
    if (!proposal && status !== 'refused') {
      return { status: 'refused', detail: 'The planner returned a malformed proposal, so it was not shown.' };
    }
    return { status, proposal, detail: text(envelope.detail, 500) };
  } catch (error) {
    return { status: 'refused', detail: error instanceof Error ? error.message : 'The proposal planner is unavailable.' };
  }
}

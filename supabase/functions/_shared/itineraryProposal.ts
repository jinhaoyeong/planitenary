/**
 * Phase 2A itinerary proposals: bounded material in, deterministic schedule out.
 *
 * The model is allowed to choose a day and an ordering. It is not allowed to
 * choose a clock time, an opening window, or a travel duration. Those values
 * are produced here from owned-trip material and route-provider results.
 *
 * Nothing in this file persists data. A proposal always carries `applied:
 * false`; there is no save callback, database client, or itinerary writer.
 *
 * Imports stay tiny and Deno-free so Vitest exercises the exact scheduling
 * rules used by the Edge Function: a fingerprint helper, and the shared
 * arrival/departure buffers also used by `destinationPlanner`.
 *
 * Both identities this module mints — a material revision and a proposal ID —
 * are compared for equality at the Phase 2B write boundary, where matching
 * means "this is the trip and the plan the traveller reviewed". They were
 * previously a 32-bit FNV-1a digest in base 36, which was appropriate while
 * they were only cache keys and is not appropriate for an authorisation
 * identity.
 */
import { canonicalFingerprint } from './canonicalHash.ts';
import {
  cityKey,
  cityReachability,
  isPlacementAllowed,
  placementConflictMessage,
  type CityReachability,
} from './cityReachability.ts';
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from './itineraryEdgeTiming.ts';

export { ARRIVAL_SETTLING_MINUTES, DEPARTURE_LEAD_MINUTES };

export type ProposalPace = 'relaxed' | 'balanced' | 'fast';
export type ProposalPriority = 'must-do' | 'interested' | 'optional' | 'locked';
export type ProposalRouteMode = 'walking' | 'public-transport' | 'driving' | 'cycling';

export interface PlanningHoursWindow {
  opensAt: string;
  closesAt: string;
  /** JavaScript weekday numbers, Sunday = 0. Absent means every day. */
  days?: number[];
  sourceUrl?: string;
}

export interface PlanningPlace {
  id: string;
  name: string;
  city: string;
  cluster: string;
  coordinates?: [number, number];
  categories: string[];
  priority: ProposalPriority;
  durationRangeMinutes: [number, number];
  openingHours: PlanningHoursWindow[];
  sourceUrls: string[];
  imageUrl?: string;
  indoorOutdoor?: 'indoor' | 'outdoor' | 'mixed';
  fixedDay?: number;
  fixedStartTime?: string;
  locked: boolean;
  reservation: boolean;
}

export type FixedTransportRole = 'arrival' | 'departure' | 'transfer';
export type FixedTransportKind = 'flight' | 'transport';

/**
 * A timed flight or user-entered transport already on the itinerary.
 *
 * These are facts, not planner output. The model may see them as available
 * windows; it may not move, invent, or delete them.
 */
export interface PlanningFixedEvent {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  role: FixedTransportRole;
  transportKind: FixedTransportKind;
  coordinates?: [number, number];
}

/** One usable sightseeing interval on a day, after fixed transport is reserved. */
export interface PlanningDayWindow {
  startTime: string;
  endTime: string;
  city: string;
}

export interface PlanningDayMaterial {
  day: number;
  date?: string;
  city: string;
  startTime: string;
  endTime: string;
  maxMainActivities: number;
  fixedPlaceIds: string[];
  note?: string;
  /** Present only when the itinerary already contains timed fixed transport. */
  fixedEvents?: PlanningFixedEvent[];
  /** Present only when fixed transport splits or tightens the day. */
  windows?: PlanningDayWindow[];
}

export interface PlanningMaterial {
  version: 1;
  tripId: string;
  revision: string;
  name: string;
  cities: string[];
  pace: ProposalPace;
  styles: string[];
  tripTypes: string[];
  moods: string[];
  transportModes: string[];
  preferences: {
    hiddenGems?: boolean;
  };
  arrivalTime?: string;
  departureTime?: string;
  baseLocation?: string;
  baseCoordinates?: [number, number];
  days: PlanningDayMaterial[];
  places: PlanningPlace[];
  /** Required places outside the bounded provider matrix, reported as errors. */
  excludedRequiredPlaces: Array<{ id: string; name: string }>;
  clusters: Array<{ id: string; city: string; placeIds: string[] }>;
  limits: {
    maxPlaces: number;
    maxDays: number;
    maxRepairIterations: number;
  };
}

export interface ModelDayComposition {
  day: number;
  placeIds: string[];
  rationale?: string;
}

export interface ModelItineraryComposition {
  days: ModelDayComposition[];
}

export interface RouteMatrixLeg {
  fromPlaceId: string;
  toPlaceId: string;
  status: 'ok' | 'unknown';
  durationMinutes?: number;
  distanceMeters?: number;
  mode: ProposalRouteMode;
  requestedMode?: ProposalRouteMode;
  providerMode?: string;
  provider?: string;
  source: 'provider' | 'cache' | 'unavailable';
}

export interface ProposedTravelLeg {
  fromPlaceId: string;
  fromName: string;
  mode: ProposalRouteMode;
  requestedMode?: ProposalRouteMode;
  providerMode?: string;
  provider?: string;
  durationMinutes?: number;
  distanceMeters?: number;
  source: 'provider' | 'cache' | 'unavailable';
  status: 'confirmed' | 'unavailable';
}

export type ProposedItemType = 'place' | 'reservation' | 'meal' | 'rest' | 'free-time';

export interface ProposedItineraryItem {
  id: string;
  placeId?: string;
  type: ProposedItemType;
  name: string;
  arrivalTime: string;
  startTime: string;
  endTime: string;
  visitDurationMinutes: number;
  travelFromPrevious?: ProposedTravelLeg;
  bufferMinutes: number;
  rationale: string;
  warnings: string[];
  evidence: string[];
  imageUrl?: string;
  priority?: ProposalPriority;
  locked?: boolean;
}

export interface ProposedItineraryDay {
  day: number;
  date?: string;
  city: string;
  startTime: string;
  endTime: string;
  rationale?: string;
  items: ProposedItineraryItem[];
  warnings: string[];
  metrics: {
    placeCount: number;
    travelMinutes: number;
    freeMinutes: number;
    clusterChanges: number;
  };
}

export type ProposalConflictCode =
  | 'activity-overlap'
  | 'route-unavailable'
  | 'route-gap-invalid'
  | 'opening-hours-conflict'
  | 'opening-hours-unknown'
  | 'arrival-day-infeasible'
  | 'departure-day-infeasible'
  | 'fixed-reservation-conflict'
  | 'must-do-omitted'
  | 'day-window-exceeded'
  | 'excessive-region-bouncing'
  /**
   * A place scheduled in a city it cannot be reached from that day. Distinct
   * from `excessive-region-bouncing`, which is about too much *legitimate*
   * movement; this one is about movement that could not happen at all.
   */
  | 'incompatible-location'
  | 'unknown-place'
  | 'duplicate-place';

export interface ProposalConflict {
  code: ProposalConflictCode;
  severity: 'error' | 'warning';
  message: string;
  day?: number;
  placeId?: string;
  relatedPlaceId?: string;
}

export interface TripItineraryProposal {
  kind: 'itinerary-proposal-v1';
  id: string;
  tripId: string;
  materialRevision: string;
  createdAt: string;
  status: 'valid' | 'needs-review';
  applied: false;
  pace: ProposalPace;
  days: ProposedItineraryDay[];
  conflicts: ProposalConflict[];
  warnings: string[];
  omittedPlaceIds: string[];
  routeSummary: {
    matrixCalls: number;
    confirmedLegs: number;
    unavailableLegs: number;
    allDurationsProviderDerived: boolean;
  };
  repairIterations: number;
}

export interface ProposalEngineDeps {
  chooseComposition: (input: {
    material: PlanningMaterial;
    round: number;
    conflicts: ProposalConflict[];
    previous?: ModelItineraryComposition;
  }) => Promise<unknown>;
  getRouteMatrix: (input: {
    placeIds: string[];
    mode: ProposalRouteMode;
  }) => Promise<RouteMatrixLeg[]>;
  now?: () => string;
}

/** 25 x 25 is the route function's documented 625-element ordinary limit. */
const MAX_PLACES = 25;
const MAX_DAYS = 21;
export const MAX_REPAIR_ITERATIONS = 2;

const PACE_RULES: Record<ProposalPace, {
  start: string;
  end: string;
  maxMain: number;
  buffer: number;
  mealMinutes: number;
  minimumFreeMinutes: number;
}> = {
  relaxed: { start: '10:00', end: '20:30', maxMain: 2, buffer: 35, mealMinutes: 85, minimumFreeMinutes: 90 },
  balanced: { start: '09:15', end: '21:30', maxMain: 3, buffer: 25, mealMinutes: 70, minimumFreeMinutes: 60 },
  fast: { start: '08:30', end: '22:00', maxMain: 4, buffer: 18, mealMinutes: 55, minimumFreeMinutes: 30 },
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const text = (value: unknown, max = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
};

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const coordinates = (value: unknown): [number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const lat = number(value[0]);
  const lng = number(value[1]);
  return lat !== undefined && lng !== undefined ? [lat, lng] : undefined;
};

export const clockToMinutes = (value?: string): number | undefined => {
  if (!value) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined;
};

export const minutesToClock = (value: number): string => {
  const safe = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const addDays = (start: string | undefined, index: number): string | undefined => {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return undefined;
  const timestamp = Date.parse(`${start}T00:00:00Z`);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + index * 86_400_000).toISOString().slice(0, 10)
    : undefined;
};

const weekday = (date?: string): number | undefined => {
  if (!date) return undefined;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).getUTCDay() : undefined;
};


const cleanUrl = (value: unknown): string | undefined => {
  const candidate = text(value, 1000);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

const wikimediaImage = (value: unknown): string | undefined => {
  const url = cleanUrl(value);
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'upload.wikimedia.org' || host.endsWith('.wikimedia.org') ? url : undefined;
  } catch {
    return undefined;
  }
};

const paceFromProfile = (profile: Record<string, unknown> | null): ProposalPace => {
  const moods = asArray(profile?.moods).filter((entry): entry is string => typeof entry === 'string');
  const tripTypes = asArray(profile?.tripTypes).filter((entry): entry is string => typeof entry === 'string');
  if (moods.some((mood) => ['slow-living', 'calm', 'minimal', 'romantic', 'luxury'].includes(mood))
    || tripTypes.some((type) => ['relaxation', 'family', 'business'].includes(type))) return 'relaxed';
  if (moods.includes('fast-paced') || tripTypes.includes('adventure')) return 'fast';
  return 'balanced';
};

const openingHours = (activity: Record<string, unknown>): PlanningHoursWindow[] => {
  const references = asArray(activity.sourceReferences).flatMap((raw) => {
    const reference = asRecord(raw);
    const url = cleanUrl(reference?.url);
    return url ? [url] : [];
  });
  const weekly = asArray(activity.openingHoursWeek).flatMap((raw): PlanningHoursWindow[] => {
    const window = asRecord(raw);
    const opensAt = text(window?.opensAt, 5);
    const closesAt = text(window?.closesAt, 5);
    if (clockToMinutes(opensAt) === undefined || clockToMinutes(closesAt) === undefined) return [];
    const days = asArray(window?.days).filter((entry): entry is number =>
      typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 6);
    return [{ opensAt: opensAt!, closesAt: closesAt!, days: days.length > 0 ? days : undefined, sourceUrl: references[0] }];
  });
  if (weekly.length > 0) return weekly;
  const legacy = asRecord(activity.openingHours);
  const opensAt = text(legacy?.opensAt, 5);
  const closesAt = text(legacy?.closesAt, 5);
  return clockToMinutes(opensAt) !== undefined && clockToMinutes(closesAt) !== undefined
    ? [{ opensAt: opensAt!, closesAt: closesAt!, sourceUrl: references[0] }]
    : [];
};

const placeIdOf = (activity: Record<string, unknown>, day?: number): string | undefined =>
  text(activity.id, 120)
  ?? text(activity.providerPlaceId, 120)
  ?? (text(activity.name, 160) ? `${day ?? 0}:${text(activity.name, 160)!.toLowerCase()}` : undefined);

/**
 * The discovery panel records a Must do against `candidate.id`, but the place it
 * saves carries `discovered-<candidate.id>`. Looking a decision up by the saved
 * activity ID alone therefore always missed, and an explicit Must do silently
 * arrived here as `optional`.
 *
 * So resolve a decision against every identity one saved place can honestly be
 * known by. Names are deliberately absent: `placeIdOf` may fall back to one to
 * give a place an ID, but a decision must never be inherited from a different
 * place that happens to share a name.
 */
const DISCOVERED_ACTIVITY_PREFIX = 'discovered-';

/**
 * The identities that name exactly one logical place, most current first, so a
 * live decision always outranks a stale one recorded under an older form.
 *
 * Exported so the review UI can attach a saved activity as a decision target
 * using this same precedence — never a display name.
 */
export const canonicalDecisionKeysOf = (activity: Record<string, unknown>): string[] => {
  const activityId = text(activity.id, 120);
  const providerPlaceId = text(activity.providerPlaceId, 120);
  const provider = text(activity.provider, 40);
  const candidateId = activityId && activityId.startsWith(DISCOVERED_ACTIVITY_PREFIX)
    ? text(activityId.slice(DISCOVERED_ACTIVITY_PREFIX.length), 120)
    : undefined;
  return [...new Set([
    // What the discovery panel is keying decisions with right now.
    candidateId,
    // `osm-n123` is how discovery composes that key from the provider pair.
    // Rebuilding it resolves trips saved before the activity kept its candidate
    // ID, without rewriting any stored decision.
    provider && providerPlaceId ? `${provider}-${providerPlaceId}` : undefined,
    activityId,
  ].filter((key): key is string => Boolean(key)))];
};

const canonicalKeysOf = canonicalDecisionKeysOf;

/**
 * A bare provider place ID such as `n3507545614` is only meaningful next to the
 * provider that issued it, so it is a legacy read path and never a canonical
 * identity — see `unambiguousLegacyKeys` for when it may be trusted.
 */
const legacyKeyOf = (activity: Record<string, unknown>): string | undefined =>
  text(activity.providerPlaceId, 120);

/**
 * Bare provider IDs are not namespaced, so two providers can issue the same raw
 * string for different places. Accept one as a decision key only where it names
 * a single place across the whole trip; where it does not, fail closed to no
 * legacy match rather than promote somebody else's place.
 */
const unambiguousLegacyKeys = (activities: Record<string, unknown>[]): Set<string> => {
  const owners = new Map<string, Set<string>>();
  for (const activity of activities) {
    const legacy = legacyKeyOf(activity);
    if (!legacy) continue;
    const owner = canonicalKeysOf(activity)[0] ?? legacy;
    const claimed = owners.get(legacy) ?? new Set<string>();
    claimed.add(owner);
    owners.set(legacy, claimed);
  }
  return new Set([...owners]
    .filter(([, claimed]) => claimed.size === 1)
    .map(([legacy]) => legacy));
};

/** Canonical identities first, then a bare provider ID only where it is safe. */
const decisionKeysOf = (activity: Record<string, unknown>, safeLegacyKeys: Set<string>): string[] => {
  const keys = canonicalKeysOf(activity);
  const legacy = legacyKeyOf(activity);
  return legacy && safeLegacyKeys.has(legacy) && !keys.includes(legacy) ? [...keys, legacy] : keys;
};

/** Schedule furniture the planner rebuilds rather than treats as a place. */
export const PLANNER_MANAGED_KINDS = ['meal-window', 'rest-window', 'free-time'] as const;

const PLANNER_EXCLUDED_KINDS: string[] = [...PLANNER_MANAGED_KINDS, 'transport'];

/** Whether the planner is allowed to schedule this activity as a place at all. */
export const isPlannerPlace = (activity: Record<string, unknown>, day?: number): boolean =>
  Boolean(text(activity.name, 160))
  && Boolean(placeIdOf(activity, day))
  && !PLANNER_EXCLUDED_KINDS.includes(text(activity.kind, 40) ?? '')
  && text(activity.type, 60) !== 'flight';

interface RawFixedTransport {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  start: number;
  end: number;
  transportKind: FixedTransportKind;
  coordinates?: [number, number];
}

/**
 * Timed flights and user-entered transport already on a day.
 *
 * Untimed rows are ignored: inventing a duration would be the one thing this
 * feature must not do. Same-day clamp only — an overnight block is reserved
 * through end-of-day rather than guessed into tomorrow.
 */
const extractFixedTransport = (activity: Record<string, unknown>, dayNumber: number): RawFixedTransport | undefined => {
  const type = text(activity.type, 60);
  const kind = text(activity.kind, 40);
  if (type !== 'flight' && kind !== 'transport') return undefined;
  const startTime = text(activity.time, 5);
  const start = clockToMinutes(startTime);
  const duration = number(activity.durationMinutes);
  if (start === undefined || duration === undefined || duration <= 0) return undefined;
  const end = Math.min(1439, start + duration);
  if (end <= start) return undefined;
  const name = text(activity.name, 160) ?? (type === 'flight' ? 'Flight' : 'Transport');
  const id = text(activity.id, 120) ?? `${dayNumber}:fixed:${name.toLowerCase()}`;
  return {
    id,
    name,
    startTime: startTime!,
    endTime: minutesToClock(end),
    start,
    end,
    transportKind: type === 'flight' ? 'flight' : 'transport',
    coordinates: coordinates(activity.coordinates),
  };
};

const formatTravellerClock = (value: string): string => {
  const minutes = clockToMinutes(value);
  if (minutes === undefined) return value;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${twelve}:00 ${period}` : `${twelve}:${String(minute).padStart(2, '0')} ${period}`;
};

const classifyFixedTransport = (
  indexInDay: number,
  eventsOnDay: number,
  dayIndex: number,
  dayCount: number,
  city: string,
  prevCity?: string,
  nextCity?: string,
): FixedTransportRole => {
  const isEarliest = indexInDay === 0;
  const isLatest = indexInDay === eventsOnDay - 1;
  const alreadyHere = Boolean(prevCity && prevCity === city);
  const cityChangedFromPrev = Boolean(prevCity && prevCity !== city);
  const cityChangesNext = Boolean(nextCity && nextCity !== city);
  const inbound = isEarliest && !alreadyHere && (dayIndex === 0 || cityChangedFromPrev);
  // A one-day trip is an arrival, never a trip-edge departure — same rule as
  // `shapeTripEdge`. Last-day departures only exist when there is a later
  // day to have come from, or the next day's city says the traveller is leaving.
  const outbound = isLatest && ((dayCount > 1 && dayIndex === dayCount - 1) || cityChangesNext);
  if (inbound && outbound) return 'transfer';
  if (inbound) return 'arrival';
  if (outbound) return 'departure';
  return 'transfer';
};

const subtractIntervals = (
  span: { start: number; end: number },
  holes: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> => {
  let parts = span.end > span.start ? [span] : [];
  for (const hole of holes) {
    parts = parts.flatMap((part) => {
      if (hole.end <= part.start || hole.start >= part.end) return [part];
      const next: Array<{ start: number; end: number }> = [];
      if (hole.start > part.start) next.push({ start: part.start, end: Math.min(hole.start, part.end) });
      if (hole.end < part.end) next.push({ start: Math.max(hole.end, part.start), end: part.end });
      return next.filter((entry) => entry.end > entry.start);
    });
  }
  return parts;
};

const constrainDayAroundFixedTransport = (
  day: PlanningDayMaterial,
  rawEvents: RawFixedTransport[],
  context: { dayIndex: number; dayCount: number; prevCity?: string; nextCity?: string },
): PlanningDayMaterial => {
  if (rawEvents.length === 0) return day;
  const sorted = [...rawEvents].sort((left, right) => left.start - right.start || left.end - right.end);
  const fixedEvents: PlanningFixedEvent[] = sorted.map((event, index) => ({
    id: event.id,
    name: event.name,
    startTime: event.startTime,
    endTime: event.endTime,
    role: classifyFixedTransport(
      index,
      sorted.length,
      context.dayIndex,
      context.dayCount,
      day.city,
      context.prevCity,
      context.nextCity,
    ),
    transportKind: event.transportKind,
    coordinates: event.coordinates,
  }));

  let start = clockToMinutes(day.startTime) ?? 0;
  let end = clockToMinutes(day.endTime) ?? 1439;
  const notes = day.note ? [day.note] : [];
  const holes: Array<{ start: number; end: number }> = [];
  let lastOutboundEnd: number | undefined;

  for (const event of fixedEvents) {
    const eventStart = clockToMinutes(event.startTime)!;
    const eventEnd = clockToMinutes(event.endTime)!;
    const flight = event.transportKind === 'flight';
    const settling = flight ? ARRIVAL_SETTLING_MINUTES : 0;
    const lead = flight ? DEPARTURE_LEAD_MINUTES : 0;
    if (event.role === 'arrival') {
      holes.push({ start: 0, end: eventEnd + settling });
      start = Math.max(start, eventEnd + settling);
      notes.push(`Arrival at ${formatTravellerClock(event.endTime)} — activities planned afterward.`);
    } else if (event.role === 'departure') {
      const unconstrainedStart = clockToMinutes(day.startTime) ?? 0;
      // A takeoff already before the sightseeing day only reserves its interval.
      // An 18:00 departure still ends the day after the existing airport lead.
      if (eventStart >= unconstrainedStart) {
        holes.push({ start: Math.max(0, eventStart - lead), end: 1440 });
        end = Math.min(end, eventStart - lead);
        notes.push(`Activities finish before the ${formatTravellerClock(event.startTime)} departure.`);
      } else {
        holes.push({ start: eventStart, end: eventEnd });
      }
    } else {
      holes.push({
        start: Math.max(0, eventStart - lead),
        end: eventEnd + settling,
      });
    }
    if (event.role === 'transfer' || event.role === 'departure') lastOutboundEnd = eventEnd + settling;
  }

  const span = { start, end };
  const parts = subtractIntervals(span, holes);
  const windows: PlanningDayWindow[] = parts.map((part) => ({
    startTime: minutesToClock(part.start),
    endTime: minutesToClock(part.end),
    city: lastOutboundEnd !== undefined && context.nextCity && part.start >= lastOutboundEnd
      ? context.nextCity
      : day.city,
  }));

  let maxMainActivities = day.maxMainActivities;
  let startTime = minutesToClock(Math.max(0, start));
  let endTime = minutesToClock(Math.max(0, end));
  if (windows.length === 0 || windows.every((window) => {
    const width = (clockToMinutes(window.endTime) ?? 0) - (clockToMinutes(window.startTime) ?? 0);
    return width < 15;
  })) {
    maxMainActivities = 0;
    startTime = minutesToClock(Math.max(0, start));
    endTime = minutesToClock(Math.max(0, Math.min(start, end)));
    notes.push('This day has no usable planning window around fixed transport.');
  } else if (fixedEvents.some((event) => event.role === 'arrival') && start >= 17 * 60) {
    maxMainActivities = 0;
  }

  return {
    ...day,
    startTime,
    endTime,
    maxMainActivities,
    note: notes.filter((entry, index, all) => all.indexOf(entry) === index).join(' '),
    fixedEvents,
    windows,
  };
};

const dayWindowsOf = (day: PlanningDayMaterial): PlanningDayWindow[] =>
  day.windows && day.windows.length > 0
    ? day.windows
    : [{ startTime: day.startTime, endTime: day.endTime, city: day.city }];

const citiesOnDay = (day: PlanningDayMaterial): Set<string> =>
  new Set([day.city, ...dayWindowsOf(day).map((window) => window.city)]);

/**
 * May this place be scheduled on this day?
 *
 * Two ways to qualify, and they are different situations:
 *
 * **The day already covers that city.** On a transfer day the traveller is in
 * Osaka in the morning and Kyoto in the evening, and both cities are on the
 * day's windows. A place in either is simply where they are.
 *
 * **The day's base can reach it and come back.** The traveller sleeps in Osaka
 * and spends the day in Kyoto. The hotel does not move, the day's city does not
 * change, and this is the single most common shape of a Kansai trip.
 *
 * Anything else is a misplacement: a stop in a city the traveller is neither in
 * nor able to get to that day. That — and only that — is refused. The rule is
 * never "the place's city must equal the day's city", because that sentence
 * would delete every day trip in the plan.
 */
const placementAllowedOnDay = (
  day: PlanningDayMaterial,
  place: PlanningPlace,
  reach: CityReachability,
): boolean => {
  const covered = new Set([...citiesOnDay(day)].map(cityKey));
  if (covered.has(cityKey(place.city))) return true;
  return isPlacementAllowed(reach.verdictFor(day.city, place));
};

const overlappingFixedEvent = (
  events: PlanningFixedEvent[] | undefined,
  start: number,
  end: number,
): PlanningFixedEvent | undefined =>
  events?.find((event) => {
    const eventStart = clockToMinutes(event.startTime);
    const eventEnd = clockToMinutes(event.endTime);
    return eventStart !== undefined && eventEnd !== undefined && start < eventEnd && end > eventStart;
  });

const nextFeasibleStart = (
  day: PlanningDayMaterial,
  placeCity: string,
  earliest: number,
  duration: number,
): number | undefined => {
  const windows = dayWindowsOf(day);
  const mixedCities = windows.some((window) => window.city !== day.city);
  const blocks = [...(day.fixedEvents ?? [])].sort((left, right) =>
    (clockToMinutes(left.startTime) ?? 0) - (clockToMinutes(right.startTime) ?? 0));
  for (const window of windows) {
    if (mixedCities && window.city !== placeCity) continue;
    const windowStart = clockToMinutes(window.startTime);
    const windowEnd = clockToMinutes(window.endTime);
    if (windowStart === undefined || windowEnd === undefined) continue;
    let start = Math.max(earliest, windowStart);
    for (const block of blocks) {
      const blockStart = clockToMinutes(block.startTime);
      const blockEnd = clockToMinutes(block.endTime);
      if (blockStart === undefined || blockEnd === undefined) continue;
      if (start < blockEnd && start + duration > blockStart) start = blockEnd;
    }
    if (start >= windowStart && start + duration <= windowEnd) return start;
  }
  return undefined;
};

export interface PlannerActivityRef {
  placeId: string;
  activity: Record<string, unknown>;
  /** The day it currently sits on; absent for the unassigned inbox. */
  day?: number;
}

/**
 * Every activity the planner may schedule, under the exact identity and in the
 * exact dedup order `buildPlanningMaterial` gives it. Applying a proposal has
 * to resolve a place ID back to the activity the material named, so the two
 * walks share this one definition rather than reimplementing it.
 */
export function indexPlannerActivities(itineraryValue: unknown): PlannerActivityRef[] {
  const itinerary = asRecord(itineraryValue) ?? {};
  const refs: PlannerActivityRef[] = [];
  const seen = new Set<string>();
  const add = (activity: Record<string, unknown>, day?: number) => {
    if (!isPlannerPlace(activity, day)) return;
    const placeId = placeIdOf(activity, day)!;
    if (seen.has(placeId)) return;
    seen.add(placeId);
    refs.push({ placeId, activity, day });
  };
  asArray(itinerary.days).slice(0, MAX_DAYS).forEach((raw, index) => {
    const day = asRecord(raw) ?? {};
    const dayNumber = Number.isInteger(day.day) ? Number(day.day) : index + 1;
    for (const rawActivity of asArray(day.activities)) {
      const activity = asRecord(rawActivity);
      if (activity) add(activity, dayNumber);
    }
  });
  for (const raw of asArray(itinerary.unassignedActivities)) {
    const activity = asRecord(raw);
    if (activity) add(activity);
  }
  return refs;
}

/** The day numbers `buildPlanningMaterial` and a proposal both work over. */
export function plannedDayNumbers(itineraryValue: unknown): number[] {
  return asArray(asRecord(itineraryValue)?.days).slice(0, MAX_DAYS).map((raw, index) => {
    const day = asRecord(raw) ?? {};
    return Number.isInteger(day.day) ? Number(day.day) : index + 1;
  });
}

const isLockedPlace = (activity: Record<string, unknown>): boolean =>
  activity.locked === true
  || asArray(activity.lockedFields).some((entry) => entry === 'all' || entry === 'schedule');

/**
 * Discovery Skip / Visited are stored decisions, not planning candidates.
 * Locked places stay admitted: a fixed schedule is not a regeneration candidate.
 */
const isExcludedPlanningDecision = (decision: string | undefined): decision is 'skip' | 'visited' =>
  decision === 'skip' || decision === 'visited';

const resolvedDecision = (
  activity: Record<string, unknown>,
  decisions: Record<string, unknown>,
  safeLegacyKeys: Set<string>,
): string | undefined => {
  const decisionKeys = decisionKeysOf(activity, safeLegacyKeys);
  return decisionKeys
    .map((key) => text(decisions[key], 20))
    .find((entry): entry is string => Boolean(entry));
};

const activityPlace = (
  activity: Record<string, unknown>,
  options: {
    day?: number;
    city?: string;
    decisions: Record<string, unknown>;
    mustDo: Set<string>;
    safeLegacyKeys: Set<string>;
  },
): PlanningPlace | undefined => {
  if (!isPlannerPlace(activity, options.day)) return undefined;
  const name = text(activity.name, 160)!;
  const id = placeIdOf(activity, options.day)!;
  const kind = text(activity.kind, 40);
  const type = text(activity.type, 60);
  const fixed = isLockedPlace(activity);
  // One canonical identity set for both the traveller's discovery decision and
  // the trip's Must do constraint, so the two can never disagree about a place.
  const decisionKeys = decisionKeysOf(activity, options.safeLegacyKeys);
  const decision = resolvedDecision(activity, options.decisions, options.safeLegacyKeys);
  if (!fixed && isExcludedPlanningDecision(decision)) return undefined;
  const requiredByConstraint = decisionKeys.some((key) => options.mustDo.has(key));
  const priority: ProposalPriority = fixed
    ? 'locked'
    : requiredByConstraint || decision === 'must-do'
      ? 'must-do'
      : decision === 'interested' ? 'interested' : 'optional';
  const duration = Math.max(15, Math.min(720, Math.round(number(activity.durationMinutes) ?? 90)));
  const sourceUrls = asArray(activity.sourceReferences).flatMap((raw) => {
    const reference = asRecord(raw);
    const url = cleanUrl(reference?.url);
    return url ? [url] : [];
  }).slice(0, 6);
  const location = text(activity.location, 120);
  return {
    id,
    name,
    city: options.city ?? 'Unassigned',
    cluster: location ?? options.city ?? 'Unassigned',
    coordinates: coordinates(activity.coordinates),
    categories: [type, kind].filter((entry): entry is string => Boolean(entry)),
    priority,
    durationRangeMinutes: [duration, duration],
    openingHours: openingHours(activity),
    sourceUrls,
    imageUrl: wikimediaImage(activity.photoUrl ?? activity.imageUrl),
    indoorOutdoor: ['indoor', 'outdoor', 'mixed'].includes(String(activity.indoorOutdoor))
      ? activity.indoorOutdoor as PlanningPlace['indoorOutdoor']
      : undefined,
    fixedDay: fixed ? options.day : undefined,
    fixedStartTime: fixed ? text(activity.time, 5) : undefined,
    locked: fixed,
    reservation: activity.bookingStatus === 'confirmed' || activity.reservationRequirement === 'required',
  };
};

/** Convert owned itinerary JSON into the only bounded material the model sees. */
export async function buildPlanningMaterial(
  tripId: string,
  itineraryValue: unknown,
): Promise<PlanningMaterial> {
  const itinerary = asRecord(itineraryValue) ?? {};
  const profile = asRecord(itinerary.tripProfile);
  const constraints = asRecord(itinerary.planningConstraints);
  const discovery = asRecord(itinerary.discoveryState);
  const decisions = asRecord(discovery?.decisions) ?? {};
  const mustDo = new Set(asArray(constraints?.mustDoActivityIds)
    .filter((entry): entry is string => typeof entry === 'string'));
  const pace = paceFromProfile(profile);
  const rules = PACE_RULES[pace];
  const rawDays = asArray(itinerary.days).slice(0, MAX_DAYS);
  const startDate = text(profile?.startDate, 10);
  const arrivalTime = text(profile?.arrivalTime, 5);
  const departureTime = text(profile?.departureTime, 5);
  const baseLocation = text(constraints?.accommodationLocation, 160);
  const baseCoordinates = coordinates(constraints?.accommodationCoordinates);
  const cities = asArray(itinerary.cities).filter((entry): entry is string => typeof entry === 'string').slice(0, 12);
  const styles = asArray(profile?.styles).filter((entry): entry is string => typeof entry === 'string').slice(0, 12);
  const tripTypes = asArray(profile?.tripTypes).filter((entry): entry is string => typeof entry === 'string').slice(0, 12);
  const moods = asArray(profile?.moods).filter((entry): entry is string => typeof entry === 'string').slice(0, 12);
  const transportModes = asArray(profile?.transport).filter((entry): entry is string => typeof entry === 'string').slice(0, 12);
  const preferences = { hiddenGems: typeof profile?.hiddenGems === 'boolean' ? profile.hiddenGems : undefined };
  const candidatePlaces: PlanningPlace[] = [];
  const seen = new Set<string>();
  const excludedPlanningPlaces = new Map<string, 'skip' | 'visited'>();
  // Whether a bare provider ID is safe to read a decision from depends on every
  // other place in the trip, so it has to be settled before any one is judged.
  const safeLegacyKeys = unambiguousLegacyKeys([
    ...rawDays.flatMap((raw) => asArray(asRecord(raw)?.activities)),
    ...asArray(itinerary.unassignedActivities),
  ].flatMap((raw) => {
    const activity = asRecord(raw);
    return activity ? [activity] : [];
  }));

  const recordPlanningExclusion = (activity: Record<string, unknown>, day?: number): boolean => {
    if (!isPlannerPlace(activity, day) || isLockedPlace(activity)) return false;
    const decision = resolvedDecision(activity, decisions, safeLegacyKeys);
    if (!isExcludedPlanningDecision(decision)) return false;
    const id = placeIdOf(activity, day)!;
    if (!excludedPlanningPlaces.has(id)) excludedPlanningPlaces.set(id, decision);
    return true;
  };

  const fixedByDay: RawFixedTransport[][] = [];
  const draftDays = rawDays.map((raw, index): PlanningDayMaterial => {
    const day = asRecord(raw) ?? {};
    const dayNumber = Number.isInteger(day.day) ? Number(day.day) : index + 1;
    const city = text(day.city, 120) ?? text(asArray(profile?.destinations)[0] && asRecord(asArray(profile?.destinations)[0])?.city, 120) ?? 'Destination';
    const fixedPlaceIds: string[] = [];
    const events: RawFixedTransport[] = [];
    for (const rawActivity of asArray(day.activities)) {
      const activity = asRecord(rawActivity);
      if (!activity) continue;
      const fixed = extractFixedTransport(activity, dayNumber);
      if (fixed) events.push(fixed);
      if (recordPlanningExclusion(activity, dayNumber)) continue;
      const place = activityPlace(activity, { day: dayNumber, city, decisions, mustDo, safeLegacyKeys });
      if (!place || seen.has(place.id)) continue;
      seen.add(place.id);
      candidatePlaces.push(place);
      if (place.locked) fixedPlaceIds.push(place.id);
    }
    fixedByDay.push(events);
    let startTime = text(constraints?.preferredStartTime, 5) ?? rules.start;
    let endTime = text(constraints?.preferredEndTime, 5) ?? rules.end;
    let maxMainActivities = Math.max(1, Math.min(6, Math.round(number(constraints?.maxMainActivitiesPerDay) ?? rules.maxMain)));
    let note: string | undefined;
    if (index === 0 && clockToMinutes(arrivalTime) !== undefined) {
      const usable = clockToMinutes(arrivalTime)! + ARRIVAL_SETTLING_MINUTES;
      startTime = minutesToClock(usable);
      maxMainActivities = usable >= 17 * 60 ? 0 : Math.min(maxMainActivities, 1);
      note = `Starts after the ${arrivalTime} arrival and a ${ARRIVAL_SETTLING_MINUTES}-minute arrival buffer.`;
    }
    if (index === rawDays.length - 1 && rawDays.length > 1 && clockToMinutes(departureTime) !== undefined) {
      endTime = minutesToClock(Math.max(0, clockToMinutes(departureTime)! - DEPARTURE_LEAD_MINUTES));
      maxMainActivities = Math.min(maxMainActivities, 1);
      note = `Ends ${DEPARTURE_LEAD_MINUTES} minutes before the ${departureTime} departure.`;
    }
    return {
      day: dayNumber,
      date: text(day.date, 20) ?? addDays(startDate, index),
      city,
      startTime,
      endTime,
      maxMainActivities,
      fixedPlaceIds,
      note,
    };
  });
  const days = draftDays.map((draft, index) => constrainDayAroundFixedTransport(draft, fixedByDay[index] ?? [], {
    dayIndex: index,
    dayCount: draftDays.length,
    prevCity: draftDays[index - 1]?.city,
    nextCity: draftDays[index + 1]?.city,
  }));

  for (const raw of asArray(itinerary.unassignedActivities)) {
    const activity = asRecord(raw);
    if (!activity) continue;
    if (recordPlanningExclusion(activity)) continue;
    const place = activityPlace(activity, {
      city: text(activity.location, 120) ?? days[0]?.city,
      decisions,
      mustDo,
      safeLegacyKeys,
    });
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    candidatePlaces.push(place);
  }

  const priorityOrder: Record<ProposalPriority, number> = {
    locked: 0,
    'must-do': 1,
    interested: 2,
    optional: 3,
  };
  const places = candidatePlaces
    .map((place, index) => ({ place, index }))
    .sort((left, right) => priorityOrder[left.place.priority] - priorityOrder[right.place.priority]
      || left.index - right.index)
    .slice(0, MAX_PLACES)
    .map(({ place }) => place);
  const included = new Set(places.map((place) => place.id));
  const excludedRequiredPlaces = candidatePlaces
    .filter((place) => !included.has(place.id) && (place.priority === 'must-do' || place.locked))
    .map((place) => ({ id: place.id, name: place.name }));

  const byCluster = new Map<string, { id: string; city: string; placeIds: string[] }>();
  for (const place of places) {
    const id = `${place.city.toLowerCase()}::${place.cluster.toLowerCase()}`;
    const cluster = byCluster.get(id) ?? { id, city: place.city, placeIds: [] };
    cluster.placeIds.push(place.id);
    byCluster.set(id, cluster);
  }

  /**
   * The revision is compared for equality when a reviewed plan is staged, so it
   * has to name this exact material rather than merely index it. Canonical
   * serialisation keeps it a property of the material rather than of the order
   * these fields happened to be assembled in.
   */
  const revision = `plan-v1-${await canonicalFingerprint({
    tripId,
    itineraryRevision: itinerary.revision,
    pace,
    arrivalTime,
    departureTime,
    baseLocation,
    baseCoordinates,
    cities,
    styles,
    tripTypes,
    moods,
    transportModes,
    preferences,
    days,
    places,
    excludedRequiredPlaces,
    excludedPlanningPlaces: [...excludedPlanningPlaces]
      .map(([id, decision]) => ({ id, decision }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })}`;

  return {
    version: 1,
    tripId,
    revision,
    name: text(itinerary.name, 160) ?? 'Untitled trip',
    cities,
    pace,
    styles,
    tripTypes,
    moods,
    transportModes,
    preferences,
    arrivalTime,
    departureTime,
    baseLocation,
    baseCoordinates,
    days,
    places,
    excludedRequiredPlaces,
    clusters: [...byCluster.values()],
    limits: { maxPlaces: MAX_PLACES, maxDays: MAX_DAYS, maxRepairIterations: MAX_REPAIR_ITERATIONS },
  };
}

/** Only place IDs from the material survive the model boundary. */
export function parseModelComposition(value: unknown, material: PlanningMaterial): ModelItineraryComposition | undefined {
  const raw = asRecord(value);
  const rawDays = asArray(raw?.days);
  if (rawDays.length === 0 || rawDays.length > material.days.length) return undefined;
  const knownPlaces = new Set(material.places.map((place) => place.id));
  const knownDays = new Set(material.days.map((day) => day.day));
  const seen = new Set<string>();
  const days: ModelDayComposition[] = [];
  for (const rawDay of rawDays) {
    const day = asRecord(rawDay);
    const dayNumber = number(day?.day);
    if (!dayNumber || !Number.isInteger(dayNumber) || !knownDays.has(dayNumber)) return undefined;
    const placeIds = asArray(day?.placeIds).flatMap((entry) => {
      const id = text(entry, 120);
      if (!id || !knownPlaces.has(id) || seen.has(id)) return [];
      seen.add(id);
      return [id];
    });
    days.push({ day: dayNumber, placeIds, rationale: text(day?.rationale, 300) });
  }
  return { days };
}

/** Deterministic fallback used only for malformed mock/provider output. */
export function defaultComposition(material: PlanningMaterial): ModelItineraryComposition {
  const assignments = material.days.map((day) => ({ day: day.day, placeIds: [...day.fixedPlaceIds] }));
  const capacity = new Map(material.days.map((day) => [day.day, Math.max(day.fixedPlaceIds.length, day.maxMainActivities)]));
  const sorted = [...material.places]
    .filter((place) => !place.locked)
    .sort((left, right) => {
      const priority = { 'must-do': 0, interested: 1, optional: 2, locked: 0 };
      return priority[left.priority] - priority[right.priority]
        || left.city.localeCompare(right.city)
        || left.cluster.localeCompare(right.cluster)
        || left.name.localeCompare(right.name);
    });
  const reach = cityReachability(material.places);
  const hasRoom = (candidate: PlanningDayMaterial) =>
    (assignments.find((entry) => entry.day === candidate.day)?.placeIds.length ?? 0)
      < (capacity.get(candidate.day) ?? 0);
  for (const place of sorted) {
    /**
     * A day in the place's own city first, then a day whose base can reach it.
     *
     * The previous last resort was "any day with room at all", which is
     * precisely how an Osaka place landed on a Kyoto day once the Osaka days
     * filled up. Leaving a place unscheduled is the correct outcome there: it
     * stays on the shortlist for the traveller to place, and
     * `unscheduledReasons` explains it, rather than the plan quietly asserting
     * a journey nobody could make.
     */
    const day = material.days.find((candidate) => citiesOnDay(candidate).has(place.city) && hasRoom(candidate))
      ?? material.days.find((candidate) => hasRoom(candidate) && placementAllowedOnDay(candidate, place, reach));
    if (day) assignments.find((entry) => entry.day === day.day)!.placeIds.push(place.id);
  }
  return { days: assignments };
}

const routeKey = (from: string, to: string) => `${from}::${to}`;

const routeMap = (legs: RouteMatrixLeg[]): Map<string, RouteMatrixLeg> =>
  new Map(legs.map((leg) => [routeKey(leg.fromPlaceId, leg.toPlaceId), leg]));

const hoursForDate = (place: PlanningPlace, date?: string): PlanningHoursWindow | undefined => {
  const day = weekday(date);
  return place.openingHours.find((window) => day === undefined || !window.days || window.days.includes(day));
};

const durationFor = (place: PlanningPlace, pace: ProposalPace): number => {
  const [minimum, maximum] = place.durationRangeMinutes;
  if (pace === 'relaxed') return maximum;
  if (pace === 'fast') return minimum;
  return Math.round((minimum + maximum) / 2);
};

const makeMeal = (day: number, start: number, duration: number): ProposedItineraryItem => ({
  id: `proposal-day-${day}-lunch`,
  type: 'meal',
  name: 'Lunch · venue flexible',
  arrivalTime: minutesToClock(start),
  startTime: minutesToClock(start),
  endTime: minutesToClock(start + duration),
  visitDurationMinutes: duration,
  bufferMinutes: 0,
  rationale: 'A protected meal window rather than an invented restaurant.',
  warnings: [],
  evidence: [],
});

function composeSchedule(
  material: PlanningMaterial,
  composition: ModelItineraryComposition,
  routeLegs: RouteMatrixLeg[],
): { days: ProposedItineraryDay[]; conflicts: ProposalConflict[] } {
  const places = new Map(material.places.map((place) => [place.id, place]));
  const routes = routeMap(routeLegs);
  const conflicts: ProposalConflict[] = [];
  const scheduled = new Set<string>();
  const rules = PACE_RULES[material.pace];

  const days = material.days.map((day): ProposedItineraryDay => {
    const selected = composition.days.find((candidate) => candidate.day === day.day);
    const orderedIds = selected?.placeIds ?? [];
    const ids = [...day.fixedPlaceIds, ...orderedIds.filter((id) => !day.fixedPlaceIds.includes(id))];
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    duplicateIds.forEach((id) => conflicts.push({
      code: 'duplicate-place', severity: 'error', day: day.day, placeId: id,
      message: `${places.get(id)?.name ?? id} appears more than once on Day ${day.day}.`,
    }));
    const ordered = [...new Set(ids)].flatMap((id) => {
      const place = places.get(id);
      if (!place) {
        conflicts.push({ code: 'unknown-place', severity: 'error', day: day.day, placeId: id, message: `Unknown place ${id}.` });
        return [];
      }
      if (place.fixedDay && place.fixedDay !== day.day) {
        conflicts.push({
          code: 'fixed-reservation-conflict', severity: 'error', day: day.day, placeId: id,
          message: `${place.name} is fixed on Day ${place.fixedDay} and cannot move to Day ${day.day}.`,
        });
        return [];
      }
      return [place];
    });

    const movableCount = ordered.filter((place) => !place.locked).length;
    if (movableCount > day.maxMainActivities) {
      const edgeCode = (day.fixedEvents ?? []).some((event) => event.role === 'arrival') || (day.day === material.days[0]?.day && material.arrivalTime)
        ? 'arrival-day-infeasible'
        : (day.fixedEvents ?? []).some((event) => event.role === 'departure') || (day.day === material.days[material.days.length - 1]?.day && material.departureTime)
          ? 'departure-day-infeasible'
          : 'day-window-exceeded';
      conflicts.push({
        code: edgeCode,
        severity: 'error',
        day: day.day,
        message: day.maxMainActivities === 0 && (day.fixedEvents?.length ?? 0) > 0
          ? `Day ${day.day} has no usable planning window around fixed transport.`
          : `Day ${day.day} allows ${day.maxMainActivities} movable ${day.maxMainActivities === 1 ? 'place' : 'places'} at this pace, but ${movableCount} were proposed.`,
      });
    }

    const dayStart = clockToMinutes(day.startTime) ?? clockToMinutes(rules.start)!;
    const dayEnd = clockToMinutes(day.endTime) ?? clockToMinutes(rules.end)!;
    const inboundEvent = (day.fixedEvents ?? []).find((event) => event.role === 'arrival');
    const outboundEvent = (day.fixedEvents ?? []).find((event) => event.role === 'departure');
    const asAnchor = (event: PlanningFixedEvent): PlanningPlace => ({
      id: event.id,
      name: event.name,
      city: day.city,
      cluster: day.city,
      categories: [event.transportKind],
      priority: 'locked',
      durationRangeMinutes: [1, 1],
      openingHours: [],
      sourceUrls: [],
      locked: true,
      reservation: false,
      coordinates: event.coordinates,
    });
    let clock = dayStart;
    let previous: PlanningPlace | undefined = inboundEvent?.coordinates ? asAnchor(inboundEvent) : undefined;
    let lunchAdded = false;
    const items: ProposedItineraryItem[] = [];
    const hasFixedTransport = (day.fixedEvents?.length ?? 0) > 0;

    for (const place of ordered) {
      if (scheduled.has(place.id)) {
        conflicts.push({ code: 'duplicate-place', severity: 'error', day: day.day, placeId: place.id, message: `${place.name} is already assigned to another day.` });
        continue;
      }
      if (hasFixedTransport && !place.locked && day.maxMainActivities === 0) {
        continue;
      }
      const duration = durationFor(place, material.pace);
      const inboundAnchor = !previous && inboundEvent?.coordinates ? asAnchor(inboundEvent) : undefined;
      let from = previous ?? inboundAnchor;
      const fromAirport = Boolean(from && inboundEvent && from.id === inboundEvent.id);
      let leg = from ? routes.get(routeKey(from.id, place.id)) : undefined;
      let travelMinutes = from && leg?.status === 'ok' && typeof leg.durationMinutes === 'number'
        ? Math.max(0, Math.round(leg.durationMinutes))
        : 0;
      let buffer = from && !fromAirport ? rules.buffer : 0;
      if (from && (!leg || leg.status !== 'ok' || typeof leg.durationMinutes !== 'number')) {
        conflicts.push({
          code: 'route-unavailable', severity: 'warning', day: day.day, placeId: place.id, relatedPlaceId: from.id,
          message: `No provider route was available from ${from.name} to ${place.name}; no travel duration was invented.`,
        });
      }
      const inboundEnd = inboundEvent ? clockToMinutes(inboundEvent.endTime) : undefined;
      let arrival = fromAirport && inboundEnd !== undefined
        ? Math.max(clock, inboundEnd + travelMinutes)
        : clock + travelMinutes;
      let start = fromAirport ? Math.max(arrival, clock) : arrival + buffer;
      const fixedStart = clockToMinutes(place.fixedStartTime);
      if (fixedStart !== undefined) {
        if (start > fixedStart) {
          conflicts.push({
            code: 'fixed-reservation-conflict', severity: 'error', day: day.day, placeId: place.id,
            message: `${place.name}'s fixed ${place.fixedStartTime} start cannot be reached from the previous item.`,
          });
        }
        start = fixedStart;
        arrival = Math.min(arrival, start);
      }

      if (!lunchAdded && start >= 12 * 60 + 30 && start <= 14 * 60 + 30) {
        const meal = makeMeal(day.day, Math.max(clock, 12 * 60 + 30), rules.mealMinutes);
        const mealStart = clockToMinutes(meal.startTime)!;
        const mealEnd = clockToMinutes(meal.endTime)!;
        if (mealEnd <= dayEnd && !overlappingFixedEvent(day.fixedEvents, mealStart, mealEnd)) {
          items.push(meal);
          clock = mealEnd;
          previous = undefined;
          arrival = clock + travelMinutes;
          start = fromAirport ? Math.max(arrival, clock) : arrival + buffer;
          if (fixedStart !== undefined) start = fixedStart;
        }
        lunchAdded = true;
      }

      const hours = hoursForDate(place, day.date);
      const warnings: string[] = [];
      if (place.openingHours.length === 0) {
        warnings.push('Opening hours are unknown; verify before relying on this slot.');
        conflicts.push({
          code: 'opening-hours-unknown', severity: 'warning', day: day.day, placeId: place.id,
          message: `${place.name} has no verified hours for this proposal.`,
        });
      } else if (!hours) {
        conflicts.push({
          code: 'opening-hours-conflict', severity: 'error', day: day.day, placeId: place.id,
          message: `${place.name} is closed on ${day.date ?? `Day ${day.day}`}.`,
        });
      } else {
        const opens = clockToMinutes(hours.opensAt)!;
        const closes = clockToMinutes(hours.closesAt)!;
        start = Math.max(start, opens);
        if (start + duration > closes) {
          conflicts.push({
            code: 'opening-hours-conflict', severity: 'error', day: day.day, placeId: place.id,
            message: `${place.name} cannot fit before its ${hours.closesAt} closing time.`,
          });
        }
      }
      let end = start + duration;
      if (hasFixedTransport) {
        const crossed = (day.fixedEvents ?? []).find((event) => {
          const eventStart = clockToMinutes(event.startTime);
          const eventEnd = clockToMinutes(event.endTime);
          return eventStart !== undefined && eventEnd !== undefined && clock <= eventStart && start >= eventEnd;
        });
        if (crossed) {
          previous = crossed.coordinates ? asAnchor(crossed) : undefined;
          from = previous;
          leg = from ? routes.get(routeKey(from.id, place.id)) : undefined;
          travelMinutes = from && leg?.status === 'ok' && typeof leg.durationMinutes === 'number'
            ? Math.max(0, Math.round(leg.durationMinutes))
            : 0;
          buffer = from ? rules.buffer : 0;
        }
        const feasible = nextFeasibleStart(day, place.city, start, duration);
        if (feasible === undefined || overlappingFixedEvent(day.fixedEvents, feasible, feasible + duration)) {
          const blocked = overlappingFixedEvent(day.fixedEvents, start, end);
          const departure = outboundEvent || blocked?.role === 'departure' || blocked?.role === 'transfer';
          const arrivalBlock = inboundEvent || blocked?.role === 'arrival';
          const code: ProposalConflictCode = blocked
            ? 'activity-overlap'
            : departure
              ? 'departure-day-infeasible'
              : arrivalBlock
                ? 'arrival-day-infeasible'
                : 'day-window-exceeded';
          const message = blocked
            ? `${place.name} overlaps ${blocked.name}.`
            : departure
              ? `${place.name} could not fit before your departure.`
              : arrivalBlock
                ? `${place.name} starts before you arrive.`
                : `${place.name} does not fit around fixed transport on Day ${day.day}.`;
          if (place.priority === 'must-do' || place.locked) {
            conflicts.push({ code, severity: 'error', day: day.day, placeId: place.id, message });
          } else if (blocked) {
            conflicts.push({ code, severity: 'error', day: day.day, placeId: place.id, message });
          }
          continue;
        }
        if (feasible > start) {
          start = feasible;
          arrival = Math.min(arrival, start);
          end = start + duration;
        }
        if (outboundEvent?.coordinates && place.coordinates) {
          const toAirport = routes.get(routeKey(place.id, outboundEvent.id));
          const takeoff = clockToMinutes(outboundEvent.startTime);
          if (toAirport?.status === 'ok' && typeof toAirport.durationMinutes === 'number' && takeoff !== undefined) {
            const lead = outboundEvent.transportKind === 'flight' ? DEPARTURE_LEAD_MINUTES : 0;
            const latest = takeoff - Math.max(lead, toAirport.durationMinutes + rules.buffer);
            if (end > latest) {
              conflicts.push({
                code: 'departure-day-infeasible',
                severity: 'error',
                day: day.day,
                placeId: place.id,
                message: `${place.name} could not fit before your departure.`,
              });
              continue;
            }
          } else if (!toAirport || toAirport.status !== 'ok' || typeof toAirport.durationMinutes !== 'number') {
            conflicts.push({
              code: 'route-unavailable',
              severity: 'warning',
              day: day.day,
              placeId: place.id,
              relatedPlaceId: outboundEvent.id,
              message: `No provider route was available from ${place.name} to ${outboundEvent.name}; no travel duration was invented.`,
            });
          }
        }
      }
      if (end > dayEnd) {
        conflicts.push({
          code: outboundEvent || (day.day === material.days[material.days.length - 1]?.day && material.departureTime)
            ? 'departure-day-infeasible' : 'day-window-exceeded',
          severity: 'error', day: day.day, placeId: place.id,
          message: outboundEvent
            ? `${place.name} could not fit before your departure.`
            : `${place.name} would end at ${minutesToClock(end)}, after Day ${day.day}'s ${day.endTime} limit.`,
        });
        if (hasFixedTransport) continue;
      }
      if ((day.day === material.days[0]?.day && material.arrivalTime && start < dayStart)
        || (inboundEvent && start < dayStart)) {
        conflicts.push({
          code: 'arrival-day-infeasible', severity: 'error', day: day.day, placeId: place.id,
          message: inboundEvent
            ? `${place.name} starts before you arrive.`
            : `${place.name} starts before the arrival-day buffer ends.`,
        });
        if (hasFixedTransport) continue;
      }

      items.push({
        id: `proposal-day-${day.day}-${place.id}`,
        placeId: place.id,
        type: place.reservation ? 'reservation' : 'place',
        name: place.name,
        arrivalTime: minutesToClock(arrival),
        startTime: minutesToClock(start),
        endTime: minutesToClock(end),
        visitDurationMinutes: duration,
        travelFromPrevious: from ? {
          fromPlaceId: from.id,
          fromName: from.name,
          mode: leg?.mode ?? 'walking',
          requestedMode: leg?.requestedMode ?? leg?.mode ?? 'walking',
          providerMode: leg?.providerMode,
          provider: leg?.provider,
          durationMinutes: leg?.status === 'ok' ? travelMinutes : undefined,
          distanceMeters: leg?.distanceMeters,
          source: leg?.status === 'ok' ? leg.source : 'unavailable',
          status: leg?.status === 'ok' ? 'confirmed' : 'unavailable',
        } : undefined,
        bufferMinutes: buffer,
        rationale: selected?.rationale ?? `${place.priority === 'must-do' ? 'Must-do priority' : 'Grouped'} in ${place.cluster}.`,
        warnings,
        evidence: [...place.sourceUrls, ...place.openingHours.flatMap((window) => window.sourceUrl ? [window.sourceUrl] : [])]
          .filter((url, index, all) => all.indexOf(url) === index),
        imageUrl: place.imageUrl,
        priority: place.priority,
        locked: place.locked,
      });
      scheduled.add(place.id);
      previous = place;
      clock = end;
    }

    if (!lunchAdded && items.length > 1 && clock < dayEnd - rules.mealMinutes) {
      const meal = makeMeal(day.day, Math.max(clock, 12 * 60 + 30), rules.mealMinutes);
      const mealStart = clockToMinutes(meal.startTime)!;
      const mealEnd = clockToMinutes(meal.endTime)!;
      if (!overlappingFixedEvent(day.fixedEvents, mealStart, mealEnd) && mealEnd <= dayEnd) {
        items.push(meal);
      }
    }
    items.sort((left, right) => (clockToMinutes(left.startTime) ?? 0) - (clockToMinutes(right.startTime) ?? 0));
    const usedEnd = items.reduce((latest, item) => Math.max(latest, clockToMinutes(item.endTime) ?? latest), dayStart);
    const travelMinutesTotal = items.reduce((total, item) => total + (item.travelFromPrevious?.durationMinutes ?? 0), 0);
    const clusters = items.flatMap((item) => item.placeId ? [places.get(item.placeId)?.cluster] : []).filter(Boolean);
    let clusterChanges = 0;
    for (let index = 1; index < clusters.length; index += 1) if (clusters[index] !== clusters[index - 1]) clusterChanges += 1;
    if (clusterChanges > 2) {
      conflicts.push({
        code: 'excessive-region-bouncing', severity: 'warning', day: day.day,
        message: `Day ${day.day} crosses neighbourhood clusters ${clusterChanges} times.`,
      });
    }
    const freeMinutes = Math.max(0, dayEnd - usedEnd);
    const warnings = [day.note].filter((entry): entry is string => Boolean(entry));
    if (freeMinutes < rules.minimumFreeMinutes) warnings.push(`This ${material.pace} day keeps only ${freeMinutes} free minutes.`);
    return {
      day: day.day,
      date: day.date,
      city: day.city,
      startTime: day.startTime,
      endTime: day.endTime,
      rationale: selected?.rationale,
      items,
      warnings,
      metrics: {
        placeCount: items.filter((item) => item.placeId).length,
        travelMinutes: travelMinutesTotal,
        freeMinutes,
        clusterChanges,
      },
    };
  });

  for (const place of material.places.filter((candidate) => candidate.priority === 'must-do' || candidate.priority === 'locked')) {
    if (!scheduled.has(place.id)) {
      const blockedDay = material.days.find((day) =>
        (day.fixedEvents?.length ?? 0) > 0
        && (citiesOnDay(day).has(place.city) || day.city === place.city));
      const departure = blockedDay?.fixedEvents?.some((event) => event.role === 'departure' || event.role === 'transfer');
      const arrival = blockedDay?.fixedEvents?.some((event) => event.role === 'arrival');
      conflicts.push({
        code: 'must-do-omitted',
        severity: 'error',
        placeId: place.id,
        day: blockedDay?.day,
        message: departure
          ? `${place.name} could not fit before your departure.`
          : arrival
            ? `${place.name} starts before you arrive.`
            : `${place.name} is ${place.locked ? 'locked' : 'Must do'} but does not fit in the proposal.`,
      });
    }
  }
  for (const place of material.excludedRequiredPlaces) conflicts.push({
    code: 'must-do-omitted',
    severity: 'error',
    placeId: place.id,
    message: `${place.name} is required but falls outside the ${material.limits.maxPlaces}-place planning limit.`,
  });
  return { days, conflicts };
}

/** Validate a proposal independently of the builder that produced it. */
export function validateItineraryProposal(
  proposalDays: ProposedItineraryDay[],
  material: PlanningMaterial,
): ProposalConflict[] {
  const conflicts: ProposalConflict[] = [];
  const places = new Map(material.places.map((place) => [place.id, place]));
  const scheduled = new Set<string>();
  const reach = cityReachability(material.places);
  for (const day of proposalDays) {
    const materialDay = material.days.find((entry) => entry.day === day.day);
    const startLimit = clockToMinutes(materialDay?.startTime);
    const endLimit = clockToMinutes(materialDay?.endTime);
    const sorted = [...day.items].sort((left, right) => (clockToMinutes(left.startTime) ?? 0) - (clockToMinutes(right.startTime) ?? 0));
    sorted.forEach((item, index) => {
      const start = clockToMinutes(item.startTime);
      const end = clockToMinutes(item.endTime);
      if (start === undefined || end === undefined || end <= start) {
        conflicts.push({ code: 'activity-overlap', severity: 'error', day: day.day, placeId: item.placeId, message: `${item.name} has an invalid time window.` });
        return;
      }
      const previous = sorted[index - 1];
      const previousEnd = previous ? clockToMinutes(previous.endTime) : undefined;
      if (previous && previousEnd !== undefined && start < previousEnd) {
        conflicts.push({
          code: previous.locked || item.locked ? 'fixed-reservation-conflict' : 'activity-overlap',
          severity: 'error', day: day.day, placeId: item.placeId, relatedPlaceId: previous.placeId,
          message: `${previous.name} overlaps ${item.name} on Day ${day.day}.`,
        });
      }
      if (startLimit !== undefined && start < startLimit) conflicts.push({
        code: day.day === material.days[0]?.day && material.arrivalTime ? 'arrival-day-infeasible' : 'day-window-exceeded',
        severity: 'error', day: day.day, placeId: item.placeId,
        message: `${item.name} starts before Day ${day.day}'s usable window.`,
      });
      if (endLimit !== undefined && end > endLimit) conflicts.push({
        code: day.day === material.days[material.days.length - 1]?.day && material.departureTime
          ? 'departure-day-infeasible' : 'day-window-exceeded',
        severity: 'error', day: day.day, placeId: item.placeId,
        message: `${item.name} ends after Day ${day.day}'s usable window.`,
      });
      if (item.travelFromPrevious?.durationMinutes !== undefined && item.travelFromPrevious.durationMinutes <= 0) conflicts.push({
        code: 'route-gap-invalid', severity: 'error', day: day.day, placeId: item.placeId,
        message: `The route into ${item.name} has a non-positive duration.`,
      });
      if (item.placeId) {
        if (scheduled.has(item.placeId)) conflicts.push({ code: 'duplicate-place', severity: 'error', day: day.day, placeId: item.placeId, message: `${item.name} appears more than once.` });
        scheduled.add(item.placeId);
        const place = places.get(item.placeId);
        /**
         * The city check. A saved place keeps its own city identity: nothing
         * downstream may quietly relocate an Osaka stop into a Kyoto day
         * because that day happened to have room. A day trip the base can
         * reach is not a relocation and passes untouched.
         */
        if (place && materialDay && !placementAllowedOnDay(materialDay, place, reach)) conflicts.push({
          code: 'incompatible-location', severity: 'error', day: day.day, placeId: item.placeId,
          message: placementConflictMessage(item.name, place.city, day.day, materialDay.city),
        });
        const window = place ? hoursForDate(place, day.date) : undefined;
        if (place && place.openingHours.length > 0 && (!window
          || start < clockToMinutes(window.opensAt)!
          || end > clockToMinutes(window.closesAt)!)) conflicts.push({
          code: 'opening-hours-conflict', severity: 'error', day: day.day, placeId: item.placeId,
          message: `${item.name} is outside its verified opening window.`,
        });
      }
      const blocked = overlappingFixedEvent(materialDay?.fixedEvents, start, end);
      if (blocked) {
        conflicts.push({
          code: 'activity-overlap',
          severity: 'error',
          day: day.day,
          placeId: item.placeId,
          message: `${item.name} overlaps ${blocked.name}.`,
        });
      }
      if (materialDay?.windows && materialDay.windows.length > 0 && item.type !== 'meal') {
        const inside = materialDay.windows.some((window) => {
          const windowStart = clockToMinutes(window.startTime);
          const windowEnd = clockToMinutes(window.endTime);
          return windowStart !== undefined && windowEnd !== undefined && start >= windowStart && end <= windowEnd;
        });
        if (!inside) {
          const arrival = (materialDay.fixedEvents ?? []).some((event) => event.role === 'arrival');
          const departure = (materialDay.fixedEvents ?? []).some((event) => event.role === 'departure');
          conflicts.push({
            code: arrival && startLimit !== undefined && start < startLimit
              ? 'arrival-day-infeasible'
              : departure
                ? 'departure-day-infeasible'
                : 'day-window-exceeded',
            severity: 'error',
            day: day.day,
            placeId: item.placeId,
            message: arrival && startLimit !== undefined && start < startLimit
              ? `${item.name} starts before you arrive.`
              : departure
                ? `${item.name} could not fit before your departure.`
                : `${item.name} does not fit around fixed transport on Day ${day.day}.`,
          });
        }
      }
    });
  }
  for (const place of material.places.filter((candidate) => candidate.priority === 'must-do' || candidate.priority === 'locked')) {
    if (!scheduled.has(place.id)) {
      const blockedDay = material.days.find((day) =>
        (day.fixedEvents?.length ?? 0) > 0
        && (citiesOnDay(day).has(place.city) || day.city === place.city));
      const departure = blockedDay?.fixedEvents?.some((event) => event.role === 'departure' || event.role === 'transfer');
      const arrival = blockedDay?.fixedEvents?.some((event) => event.role === 'arrival');
      conflicts.push({
        code: 'must-do-omitted',
        severity: 'error',
        placeId: place.id,
        day: blockedDay?.day,
        message: departure
          ? `${place.name} could not fit before your departure.`
          : arrival
            ? `${place.name} starts before you arrive.`
            : `${place.name} is required but omitted.`,
      });
    }
  }
  for (const place of material.excludedRequiredPlaces) conflicts.push({
    code: 'must-do-omitted',
    severity: 'error',
    placeId: place.id,
    message: `${place.name} is required but falls outside the ${material.limits.maxPlaces}-place planning limit.`,
  });
  return conflicts;
}

const dedupeConflicts = (conflicts: ProposalConflict[]): ProposalConflict[] => {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.code}:${conflict.day ?? ''}:${conflict.placeId ?? ''}:${conflict.relatedPlaceId ?? ''}:${conflict.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function runItineraryProposalEngine(
  material: PlanningMaterial,
  deps: ProposalEngineDeps,
): Promise<TripItineraryProposal> {
  let previous: ModelItineraryComposition | undefined;
  let conflicts: ProposalConflict[] = [];
  let finalDays: ProposedItineraryDay[] = [];
  let routeLegs: RouteMatrixLeg[] = [];
  let matrixCalls = 0;
  let repairIterations = 0;

  for (let attempt = 0; attempt <= MAX_REPAIR_ITERATIONS; attempt += 1) {
    const raw = await deps.chooseComposition({ material, round: attempt + 1, conflicts, previous });
    const composition = parseModelComposition(raw, material) ?? defaultComposition(material);
    const placeIds = [...new Set([
      ...composition.days.flatMap((day) => day.placeIds),
      ...material.days.flatMap((day) => (day.fixedEvents ?? []).flatMap((event) => event.coordinates ? [event.id] : [])),
    ])];
    routeLegs = placeIds.length >= 2
      ? await deps.getRouteMatrix({ placeIds, mode: 'walking' })
      : [];
    if (placeIds.length >= 2) matrixCalls += 1;
    const built = composeSchedule(material, composition, routeLegs);
    finalDays = built.days;
    conflicts = dedupeConflicts([...built.conflicts, ...validateItineraryProposal(finalDays, material)]);
    previous = composition;
    if (!conflicts.some((conflict) => conflict.severity === 'error')) break;
    if (attempt < MAX_REPAIR_ITERATIONS) repairIterations += 1;
  }

  const scheduled = new Set(finalDays.flatMap((day) => day.items.flatMap((item) => item.placeId ? [item.placeId] : [])));
  const confirmedLegs = finalDays.reduce((total, day) => total + day.items.filter((item) => item.travelFromPrevious?.status === 'confirmed').length, 0);
  const unavailableLegs = finalDays.reduce((total, day) => total + day.items.filter((item) => item.travelFromPrevious?.status === 'unavailable').length, 0);
  const now = deps.now?.() ?? new Date().toISOString();
  const status = conflicts.some((conflict) => conflict.severity === 'error') ? 'needs-review' : 'valid';
  const omittedPlaceIds = material.places.filter((place) => !scheduled.has(place.id)).map((place) => place.id);
  const routeSummary = {
    matrixCalls,
    confirmedLegs,
    unavailableLegs,
    allDurationsProviderDerived: finalDays.every((day) => day.items.every((item) =>
      item.travelFromPrevious?.durationMinutes === undefined
      || item.travelFromPrevious.source === 'provider'
      || item.travelFromPrevious.source === 'cache')),
  };
  /**
   * The ID is a fingerprint of the plan, not of the moment it was made.
   *
   * Phase 2B stages by this ID, so "same ID" has to mean "same plan" for that
   * binding to be worth anything — and it has to mean it against an adversary,
   * not merely on average, which is why this is SHA-256 over a canonical form
   * rather than the short non-cryptographic digest these identities used while
   * they were only cache keys.
   *
   * Everything that can change what the traveller sees, what validation decides,
   * or what Apply writes participates. That includes `createdAt`, which is not
   * decoration here: `applyProposalToItinerary` stamps it onto every generated
   * meal and rest window, so two otherwise identical plans made at different
   * moments produce different itineraries and must not share an identity. Only
   * `kind` and `applied` are left out, both being constants, along with the ID
   * itself.
   */
  const fingerprint = await canonicalFingerprint({
    tripId: material.tripId,
    materialRevision: material.revision,
    createdAt: now,
    status,
    pace: material.pace,
    days: finalDays,
    conflicts,
    warnings: conflicts.filter((conflict) => conflict.severity === 'warning').map((conflict) => conflict.message),
    omittedPlaceIds,
    routeSummary,
    repairIterations,
  });
  return {
    kind: 'itinerary-proposal-v1',
    id: `proposal-${fingerprint}`,
    tripId: material.tripId,
    materialRevision: material.revision,
    createdAt: now,
    status,
    applied: false,
    pace: material.pace,
    days: finalDays,
    conflicts,
    warnings: conflicts.filter((conflict) => conflict.severity === 'warning').map((conflict) => conflict.message),
    omittedPlaceIds,
    routeSummary,
    repairIterations,
  };
}

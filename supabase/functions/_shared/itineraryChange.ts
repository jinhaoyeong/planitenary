/**
 * Phase 2B: turning a validated proposal into an exact itinerary, deterministically.
 *
 * Everything a write depends on is computed here and nowhere else — the
 * resulting itinerary, the hashes that bind it to a base revision, the diff the
 * traveller confirms, and the rules that refuse an unsafe apply. No model, no
 * network, no clock beyond an injected one, no database.
 *
 * The separation matters: the server stages the exact resulting itinerary
 * *before* anyone confirms anything, and Apply then writes that stored result
 * byte for byte. The browser never sends itinerary JSON back, so there is no
 * point at which client input can steer what gets written. Like
 * `itineraryProposal.ts`, this module has no imports beyond its sibling and no
 * runtime APIs, so Vitest exercises exactly what the Edge Function runs.
 */
import {
  PLANNER_MANAGED_KINDS,
  clockToMinutes,
  indexPlannerActivities,
  plannedDayNumbers,
  type ProposalConflict,
  type ProposedItineraryItem,
  type TripItineraryProposal,
} from './itineraryProposal.ts';
import {
  activityCitiesFrom,
  cleanCity,
  parseDayTransfer,
  sameCity,
} from './dayCitySemantics.ts';

export type ChangeProposalStatus = 'pending' | 'applied' | 'stale' | 'expired' | 'cancelled';

export type ChangeRefusal =
  | 'proposal-stale'
  | 'proposal-expired'
  | 'proposal-not-pending'
  | 'proposal-blocked'
  | 'proposal-invalid'
  | 'undo-stale'
  | 'change-not-undoable';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const text = (value: unknown, max = 200): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, max) : undefined;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Re-exported so callers of this module have one place to reach for a
 * fingerprint. Neither is the database's base-revision authority: that hash is
 * computed in SQL from the stored `jsonb` under a row lock, because only a value
 * derived from the row itself can be trusted to describe the row at write time.
 * These exist to prove the apply transform is deterministic and to fingerprint a
 * payload in transit.
 */
export { canonicalFingerprint, canonicalJson } from './canonicalHash.ts';

// ---------------------------------------------------------------------------
// Applying a proposal
// ---------------------------------------------------------------------------

const MANAGED_KINDS: string[] = [...PLANNER_MANAGED_KINDS];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Sort by clock, keeping the original relative order of equal times. */
const byTime = <T>(entries: T[], timeOf: (entry: T) => string | undefined): T[] => entries
  .map((entry, index) => ({ entry, index, minutes: clockToMinutes(timeOf(entry)) ?? 24 * 60 + 1 }))
  .sort((left, right) => left.minutes - right.minutes || left.index - right.index)
  .map(({ entry }) => entry);

const windowKind = (type: ProposedItineraryItem['type']): string | undefined => {
  if (type === 'meal') return 'meal-window';
  if (type === 'rest') return 'rest-window';
  if (type === 'free-time') return 'free-time';
  return undefined;
};

/**
 * Schedule furniture, written in exactly the shape the app's own save path
 * produces. That equality is load-bearing: the client adopts the applied
 * itinerary into local state, and if its next autosave normalised these fields
 * into anything different the stored result would drift and Undo would refuse.
 * `generatedAt` therefore comes from the proposal rather than a clock, so the
 * transform stays deterministic.
 */
const windowActivity = (
  item: ProposedItineraryItem,
  day: number,
  index: number,
  generatedAt: string,
): Record<string, unknown> => ({
  id: `proposal-${item.type}-${day}-${index}`,
  kind: windowKind(item.type),
  time: item.startTime,
  durationMinutes: item.visitDurationMinutes,
  name: item.name,
  description: item.rationale,
  type: item.type === 'meal' ? 'food' : 'other',
  bookingStatus: 'none',
  source: 'generated',
  locked: false,
  lockedFields: [],
  generatedMetadata: {
    source: 'generated',
    generatedAt,
    reason: item.rationale,
    confidence: 'high',
  },
});

/**
 * A scheduled place keeps everything the traveller and the providers put on it
 * and takes only its timing from the proposal. Travel figures are copied
 * verbatim from the route result; nothing is estimated here.
 */
const scheduledActivity = (
  source: Record<string, unknown>,
  item: ProposedItineraryItem,
): Record<string, unknown> => {
  const next = clone(source);
  next.time = item.startTime;
  next.durationMinutes = item.visitDurationMinutes;
  const travel = item.travelFromPrevious;
  next.transportMinutes = travel?.status === 'confirmed' ? travel.durationMinutes : undefined;
  next.transportMode = travel?.status === 'confirmed' ? travel.mode : undefined;
  next.travelEstimateSource = travel
    ? (travel.status === 'confirmed' ? 'provider-route' : 'unknown')
    : 'unknown';
  return next;
};

/** Materialise a factual server-owned suggestion only after explicit Apply. */
const suggestedActivity = (item: ProposedItineraryItem): Record<string, unknown> | undefined => {
  const place = item.suggestedPlace;
  if (!place || !item.placeId) return undefined;
  const image = place.image;
  return {
    id: item.placeId,
    kind: 'place',
    time: item.startTime,
    durationMinutes: item.visitDurationMinutes,
    name: place.name,
    description: `${place.categories.join(', ') || 'Suggested place'} in ${place.city}.`,
    type: 'sight',
    city: place.city,
    location: place.location ?? place.city,
    coordinates: place.coordinates,
    provider: place.ref.provider,
    providerPlaceId: place.ref.providerPlaceId,
    placeRef: place.ref,
    source: 'imported',
    bookingStatus: 'none',
    locked: false,
    lockedFields: [],
    openingHours: place.openingHours[0],
    openingHoursWeek: place.openingHours.map((window) => ({
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      days: window.days,
    })),
    sourceReferences: place.sourceUrls.map((url) => ({ label: 'Place source', url })),
    photoUrl: image?.url,
    photoThumbnailUrl: image?.thumbnailUrl,
    photoAttribution: image?.attribution,
    photoSourcePage: image?.sourcePage,
    photoLicense: image?.licence,
    photoLicenseUrl: image?.licenceUrl,
    photoImageKey: image?.sourcePage,
  };
};

export interface AppliedItineraryResult {
  itinerary: Record<string, unknown>;
  /** Places the proposal did not schedule; moved to the inbox, never deleted. */
  unscheduledPlaceIds: string[];
  /** Place IDs the proposal referenced that no longer exist in the trip. */
  unresolvedPlaceIds: string[];
  /** Proposed overnight moves lacking the exact explicit transfer authority. */
  unauthorizedBaseChanges: Array<{ day: number; from: string; to: string }>;
}

/**
 * Build the exact itinerary a proposal would produce.
 *
 * Pure and total: same inputs, same bytes out. Two rules keep it from losing
 * anything the traveller owns — activities the planner never had authority over
 * (flights, transport, hand-entered furniture) are carried through untouched,
 * and a place the proposal left out moves to the unassigned inbox rather than
 * being deleted.
 */
export function applyProposalToItinerary(
  itineraryValue: unknown,
  proposal: TripItineraryProposal,
): AppliedItineraryResult {
  const itinerary = clone(asRecord(itineraryValue) ?? {});
  const refs = indexPlannerActivities(itinerary);
  const byPlaceId = new Map(refs.map((ref) => [ref.placeId, ref]));
  const plannedDays = new Set(plannedDayNumbers(itinerary));
  const proposalDays = new Map(proposal.days.map((day) => [day.day, day]));

  const scheduled = new Set<string>();
  const unresolvedPlaceIds: string[] = [];
  const unauthorizedBaseChanges: Array<{ day: number; from: string; to: string }> = [];
  // Identity, not equality: `indexPlannerActivities` ran over this same cloned
  // itinerary, so its refs point at the very objects the days hold.
  const plannerOwned = new Set(refs.map((ref) => ref.activity));

  const days = asArray(itinerary.days).map((raw, index) => {
    const day = asRecord(raw) ?? {};
    const dayNumber = Number.isInteger(day.day) ? Number(day.day) : index + 1;
    const proposed = proposalDays.get(dayNumber);
    if (!proposed) return day;

    const currentStay = cleanCity(day.stayCity) ?? cleanCity(day.city) ?? '';
    const proposedStay = cleanCity(proposed.stayCity) ?? cleanCity(proposed.city) ?? currentStay;
    const transfer = parseDayTransfer(proposed.transfer, proposedStay);
    const baseChanged = !sameCity(currentStay, proposedStay);
    const authorized = Boolean(baseChanged && transfer
      && sameCity(transfer.from, currentStay)
      && sameCity(transfer.to, proposedStay));
    if ((baseChanged && !authorized) || !sameCity(proposed.city, proposedStay)) {
      unauthorizedBaseChanges.push({ day: dayNumber, from: currentStay, to: proposedStay });
    }

    const activities = asArray(day.activities).flatMap((entry) => {
      const activity = asRecord(entry);
      return activity ? [activity] : [];
    });
    /**
     * Anything the planner had no authority over stays exactly where it is: a
     * flight, a transfer, a hand-entered note. Only places it could schedule
     * and the schedule furniture it generates are rebuilt.
     */
    const preserved = activities.filter((activity) => {
      const kind = text(activity.kind, 40) ?? '';
      return !MANAGED_KINDS.includes(kind) && !plannerOwned.has(activity);
    });

    const rebuilt = proposed.items.flatMap((item, itemIndex): Record<string, unknown>[] => {
      if (item.type === 'place' || item.type === 'reservation') {
        const ref = item.placeId ? byPlaceId.get(item.placeId) : undefined;
        const source = ref?.activity ?? suggestedActivity(item);
        if (!source) {
          if (item.placeId) unresolvedPlaceIds.push(item.placeId);
          return [];
        }
        if (item.placeId) scheduled.add(item.placeId);
        return [scheduledActivity(source, item)];
      }
      return [windowActivity(item, dayNumber, itemIndex, proposal.createdAt)];
    });

    const nextActivities = byTime([...preserved, ...rebuilt], (activity) => text(activity.time, 5));
    day.activities = nextActivities;
    day.stayCity = proposedStay;
    day.city = proposedStay;
    day.activityCities = activityCitiesFrom([
      ...asArray(proposed.activityCities),
      ...nextActivities.map((activity) => activity.city),
    ], proposedStay);
    if (transfer) day.transfer = transfer;
    else delete day.transfer;
    return day;
  });

  /**
   * A place the proposal did not schedule is not gone — it goes back to the
   * inbox, where the traveller can see it and put it somewhere. Silently
   * dropping it would be the one thing an apply must never do.
   */
  const unscheduledPlaceIds: string[] = [];
  const inbox = asArray(itinerary.unassignedActivities).flatMap((entry) => {
    const activity = asRecord(entry);
    return activity ? [clone(activity)] : [];
  });
  const inboxIds = new Set(inbox.map((activity) => text(activity.id, 120)).filter(Boolean));
  for (const ref of refs) {
    if (scheduled.has(ref.placeId)) continue;
    if (ref.day === undefined || !plannedDays.has(ref.day)) continue;
    if (!proposalDays.has(ref.day)) continue;
    unscheduledPlaceIds.push(ref.placeId);
    const activity = clone(ref.activity);
    const id = text(activity.id, 120);
    if (id && inboxIds.has(id)) continue;
    if (id) inboxIds.add(id);
    inbox.push(activity);
  }

  itinerary.days = days;
  if (inbox.length > 0 || itinerary.unassignedActivities !== undefined) {
    itinerary.unassignedActivities = inbox;
  }
  itinerary.revision = Math.max(0, Math.round(finite(itinerary.revision) ?? 0)) + 1;

  return { itinerary, unscheduledPlaceIds, unresolvedPlaceIds, unauthorizedBaseChanges };
}

// ---------------------------------------------------------------------------
// Blocking validation
// ---------------------------------------------------------------------------

export interface StagedValidation {
  ok: boolean;
  blocking: string[];
  warnings: string[];
}

const timedPlaces = (day: Record<string, unknown>): Array<{ name: string; start: number; end: number }> =>
  asArray(day.activities).flatMap((entry) => {
    const activity = asRecord(entry);
    if (!activity) return [];
    const start = clockToMinutes(text(activity.time, 5));
    if (start === undefined) return [];
    const duration = Math.max(0, Math.round(finite(activity.durationMinutes) ?? 0));
    return [{ name: text(activity.name, 160) ?? 'Activity', start, end: start + duration }];
  });

/**
 * The last gate before a write, run at stage time and again inside Apply.
 *
 * It re-derives its answer from the stored result rather than trusting the
 * proposal's own verdict, so a proposal that was valid when composed cannot be
 * applied if the itinerary it produces is not.
 */
export function validateStagedChange(
  proposal: TripItineraryProposal,
  applied: AppliedItineraryResult,
): StagedValidation {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (proposal.applied !== false) blocking.push('The proposal is not in a proposable state.');
  if (proposal.status !== 'valid') {
    blocking.push('The proposal has unresolved conflicts and cannot be applied.');
  }
  for (const conflict of proposal.conflicts) {
    if (conflict.severity === 'error') blocking.push(conflict.message);
    else warnings.push(conflict.message);
  }
  if (applied.unresolvedPlaceIds.length > 0) {
    blocking.push(`The proposal references ${applied.unresolvedPlaceIds.length} place(s) that are no longer in this trip.`);
  }
  for (const change of applied.unauthorizedBaseChanges) {
    blocking.push(`Day ${change.day} cannot change its overnight base from ${change.from || 'unknown'} to ${change.to || 'unknown'} without an authorized transfer.`);
  }

  const seenIds = new Set<string>();
  for (const raw of asArray(applied.itinerary.days)) {
    const day = asRecord(raw);
    if (!day) {
      blocking.push('The resulting itinerary contains a malformed day.');
      continue;
    }
    const dayNumber = finite(day.day);
    if (dayNumber !== undefined && (!Number.isInteger(dayNumber) || dayNumber < 1)) {
      blocking.push(`Day ${String(day.day)} is not a valid day number.`);
    }
    for (const entry of asArray(day.activities)) {
      const activity = asRecord(entry);
      if (!activity || !text(activity.name, 160)) {
        blocking.push('The resulting itinerary contains an activity with no name.');
        continue;
      }
      const id = text(activity.id, 120);
      if (id) {
        if (seenIds.has(id)) blocking.push(`Duplicate activity identity "${id}" in the resulting itinerary.`);
        seenIds.add(id);
      }
      if (clockToMinutes(text(activity.time, 5)) === undefined) {
        blocking.push(`"${text(activity.name, 160)}" has no valid start time.`);
      }
    }
    const timed = timedPlaces(day);
    for (let index = 1; index < timed.length; index += 1) {
      if (timed[index].start < timed[index - 1].end) {
        blocking.push(`"${timed[index - 1].name}" and "${timed[index].name}" overlap on day ${dayNumber ?? '?'}.`);
      }
    }
  }

  return { ok: blocking.length === 0, blocking: [...new Set(blocking)].slice(0, 20), warnings: [...new Set(warnings)].slice(0, 20) };
}

// ---------------------------------------------------------------------------
// Structured diff
// ---------------------------------------------------------------------------

export interface DiffPlace {
  id: string;
  name: string;
  day?: number;
  time?: string;
}

export interface ItineraryChangeDiff {
  added: DiffPlace[];
  removed: DiffPlace[];
  moved: Array<DiffPlace & { fromDay: number; toDay: number }>;
  retimed: Array<DiffPlace & { fromTime: string; toTime: string }>;
  durationChanged: Array<DiffPlace & { fromMinutes?: number; toMinutes?: number }>;
  travelChanged: Array<DiffPlace & { fromMinutes?: number; toMinutes?: number }>;
  windowsAdded: Array<{ kind: string; name: string; day: number; time: string }>;
  windowsRemoved: Array<{ kind: string; name: string; day: number; time: string }>;
  dayCounts: Array<{ day: number; before: number; after: number }>;
  preservedMustDo: DiffPlace[];
  unscheduled: DiffPlace[];
  warnings: string[];
  conflicts: ProposalConflict[];
  totals: {
    added: number;
    removed: number;
    moved: number;
    retimed: number;
    daysTouched: number;
  };
}

interface Placement {
  id: string;
  name: string;
  day?: number;
  time?: string;
  durationMinutes?: number;
  transportMinutes?: number;
  managedKind?: string;
}

const placements = (itineraryValue: unknown): Map<string, Placement> => {
  const itinerary = asRecord(itineraryValue) ?? {};
  const result = new Map<string, Placement>();
  const record = (activity: Record<string, unknown>, day: number | undefined, fallback: string) => {
    const id = text(activity.id, 120) ?? fallback;
    if (result.has(id)) return;
    const kind = text(activity.kind, 40) ?? '';
    result.set(id, {
      id,
      name: text(activity.name, 160) ?? 'Activity',
      day,
      time: text(activity.time, 5),
      durationMinutes: finite(activity.durationMinutes),
      transportMinutes: finite(activity.transportMinutes),
      managedKind: MANAGED_KINDS.includes(kind) ? kind : undefined,
    });
  };
  asArray(itinerary.days).forEach((raw, index) => {
    const day = asRecord(raw) ?? {};
    const dayNumber = Number.isInteger(day.day) ? Number(day.day) : index + 1;
    asArray(day.activities).forEach((entry, position) => {
      const activity = asRecord(entry);
      if (activity) record(activity, dayNumber, `day${dayNumber}:${position}`);
    });
  });
  asArray(itinerary.unassignedActivities).forEach((entry, position) => {
    const activity = asRecord(entry);
    if (activity) record(activity, undefined, `inbox:${position}`);
  });
  return result;
};

const asDiffPlace = (placement: Placement): DiffPlace => ({
  id: placement.id,
  name: placement.name,
  day: placement.day,
  time: placement.time,
});

/**
 * What will actually change, derived by comparing the two itineraries rather
 * than by reading the proposal's intent. Correctness lives in these atoms; any
 * sentence shown to the traveller is rendered from them.
 */
export function diffItineraries(
  beforeValue: unknown,
  afterValue: unknown,
  proposal?: TripItineraryProposal,
): ItineraryChangeDiff {
  const before = placements(beforeValue);
  const after = placements(afterValue);

  const diff: ItineraryChangeDiff = {
    added: [],
    removed: [],
    moved: [],
    retimed: [],
    durationChanged: [],
    travelChanged: [],
    windowsAdded: [],
    windowsRemoved: [],
    dayCounts: [],
    preservedMustDo: [],
    unscheduled: [],
    warnings: proposal?.warnings ?? [],
    conflicts: proposal?.conflicts ?? [],
    totals: { added: 0, removed: 0, moved: 0, retimed: 0, daysTouched: 0 },
  };

  for (const [id, entry] of after) {
    const previous = before.get(id);
    if (entry.managedKind) {
      if (!previous && entry.day !== undefined && entry.time) {
        diff.windowsAdded.push({ kind: entry.managedKind, name: entry.name, day: entry.day, time: entry.time });
      }
      continue;
    }
    if (!previous) {
      diff.added.push(asDiffPlace(entry));
      continue;
    }
    if (previous.day !== entry.day) {
      if (entry.day === undefined) diff.unscheduled.push(asDiffPlace(entry));
      else if (previous.day !== undefined) {
        diff.moved.push({ ...asDiffPlace(entry), fromDay: previous.day, toDay: entry.day });
      } else diff.added.push(asDiffPlace(entry));
    } else if (previous.time !== entry.time && previous.time && entry.time) {
      diff.retimed.push({ ...asDiffPlace(entry), fromTime: previous.time, toTime: entry.time });
    }
    if (previous.durationMinutes !== entry.durationMinutes) {
      diff.durationChanged.push({
        ...asDiffPlace(entry),
        fromMinutes: previous.durationMinutes,
        toMinutes: entry.durationMinutes,
      });
    }
    if (previous.transportMinutes !== entry.transportMinutes) {
      diff.travelChanged.push({
        ...asDiffPlace(entry),
        fromMinutes: previous.transportMinutes,
        toMinutes: entry.transportMinutes,
      });
    }
  }

  for (const [id, entry] of before) {
    if (after.has(id)) continue;
    if (entry.managedKind) {
      if (entry.day !== undefined && entry.time) {
        diff.windowsRemoved.push({ kind: entry.managedKind, name: entry.name, day: entry.day, time: entry.time });
      }
      continue;
    }
    diff.removed.push(asDiffPlace(entry));
  }

  const dayCount = (source: Map<string, Placement>) => {
    const counts = new Map<number, number>();
    for (const entry of source.values()) {
      if (entry.day === undefined) continue;
      counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1);
    }
    return counts;
  };
  const beforeDays = dayCount(before);
  const afterDays = dayCount(after);
  for (const day of [...new Set([...beforeDays.keys(), ...afterDays.keys()])].sort((a, b) => a - b)) {
    const from = beforeDays.get(day) ?? 0;
    const to = afterDays.get(day) ?? 0;
    if (from !== to) diff.dayCounts.push({ day, before: from, after: to });
  }

  if (proposal) {
    for (const day of proposal.days) {
      for (const item of day.items) {
        if (item.priority !== 'must-do' || !item.placeId) continue;
        const entry = after.get(item.placeId);
        if (entry) diff.preservedMustDo.push(asDiffPlace(entry));
      }
    }
  }

  const touched = new Set<number>();
  for (const entry of [...diff.added, ...diff.removed, ...diff.retimed]) {
    if (entry.day !== undefined) touched.add(entry.day);
  }
  for (const entry of diff.moved) { touched.add(entry.fromDay); touched.add(entry.toDay); }
  for (const entry of diff.dayCounts) touched.add(entry.day);

  diff.totals = {
    added: diff.added.length,
    removed: diff.removed.length,
    moved: diff.moved.length,
    retimed: diff.retimed.length,
    daysTouched: touched.size,
  };
  return diff;
}

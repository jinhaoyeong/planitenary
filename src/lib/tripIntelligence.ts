import type {
  Activity,
  ActivityType,
  DayPlan,
  Itinerary,
  PlannerChangeRecord,
} from '../data';
import { profileRevision } from './identityFields';
import type { TripProfile } from './tripProfile';

export type PlannerAction = 'generate' | 'optimise-day' | 'optimise-trip';
export type PlannerChangeKind = 'move' | 'time' | 'insert' | 'remove' | 'travel';

export interface ProposedChange {
  id: string;
  dayNumber: number;
  activityId?: string;
  kind: PlannerChangeKind;
  label: string;
  current?: string;
  proposed?: string;
  protected?: boolean;
}

export interface ItineraryProposal {
  id: string;
  action: PlannerAction;
  createdAt: string;
  profileRevision: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  beforeDays: DayPlan[];
  afterDays: DayPlan[];
  changes: ProposedChange[];
  travelMinutesBefore: number;
  travelMinutesAfter: number;
}

export interface PlannerOptions {
  dayNumber?: number;
  allowManualMoves?: boolean;
}

const DEFAULT_START = 9 * 60;
const DEFAULT_END = 20 * 60;
const DEFAULT_ACTIVITY_MINUTES = 90;
const MEAL_MINUTES = 60;
const REST_MINUTES = 45;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const parseMinutes = (value?: string) => {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const formatMinutes = (value: number) => {
  const safe = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const activityDuration = (activity: Activity) => Math.max(15, activity.durationMinutes || DEFAULT_ACTIVITY_MINUTES);

const coordinatesFor = (activity: Activity): [number, number] | undefined => activity.coordinates;

const distanceKm = (from: [number, number], to: [number, number]) => {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(to[0] - from[0]);
  const dLng = radians(to[1] - from[1]);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const estimateTravelMinutes = (from?: [number, number], to?: [number, number], mode = 'public-transport') => {
  if (!from || !to) return null;
  const km = distanceKm(from, to);
  const speed = mode === 'walking' ? 4.5 : mode === 'car' ? 28 : 20;
  return Math.max(5, Math.round((km / speed) * 60 + (mode === 'walking' ? 5 : 12)));
};

const activityLabel = (activity: Activity) => activity.name || 'Untitled activity';

const isLocked = (activity: Activity) => Boolean(activity.lockedFields?.includes('*') || activity.lockedFields?.includes('schedule'));

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const generatedActivity = (
  day: DayPlan,
  type: Extract<ActivityType, 'food' | 'cafe' | 'walk'>,
  time: string,
  name: string,
  description: string,
  durationMinutes: number,
): Activity => ({
  id: createId('activity'),
  time,
  durationMinutes,
  name,
  description,
  type,
  location: day.city ? `Near ${day.city}` : undefined,
  source: 'generated',
  bookingStatus: 'none',
  lockedFields: [],
  generatedMetadata: {
    source: 'generated',
    generatedAt: new Date().toISOString(),
    reason: 'Added to keep the day practical and paced.',
    confidence: 'medium',
  },
});

const totalTravelMinutes = (day: DayPlan, transport = 'public-transport') => {
  let total = 0;
  for (let index = 1; index < day.activities.length; index += 1) {
    const previous = coordinatesFor(day.activities[index - 1]);
    const current = coordinatesFor(day.activities[index]);
    total += estimateTravelMinutes(previous, current, transport) || day.activities[index].transportMinutes || 0;
  }
  return total;
};

const sortByNearest = (activities: Activity[]) => {
  const remaining = [...activities];
  const ordered: Activity[] = [];
  while (remaining.length > 0) {
    if (ordered.length === 0) {
      const earliestIndex = remaining.reduce((best, activity, index) => {
        const current = parseMinutes(activity.time) ?? Number.MAX_SAFE_INTEGER;
        const selected = parseMinutes(remaining[best].time) ?? Number.MAX_SAFE_INTEGER;
        return current < selected ? index : best;
      }, 0);
      ordered.push(remaining.splice(earliestIndex, 1)[0]);
      continue;
    }
    const previousCoords = coordinatesFor(ordered[ordered.length - 1]);
    if (!previousCoords) {
      ordered.push(remaining.shift() as Activity);
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((activity, index) => {
      const coords = coordinatesFor(activity);
      const distance = coords ? distanceKm(previousCoords, coords) : Number.POSITIVE_INFINITY;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
};

const scheduleActivities = (activities: Activity[], startAt = DEFAULT_START, transport = 'public-transport') => {
  let cursor = startAt;
  return activities.map((activity, index) => {
    const previous = index > 0 ? activities[index - 1] : undefined;
    const travel = previous ? estimateTravelMinutes(coordinatesFor(previous), coordinatesFor(activity), transport) : null;
    cursor += travel || 0;
    const next = {
      ...activity,
      time: formatMinutes(cursor),
      transportMinutes: travel ?? activity.transportMinutes,
      transportMode: travel ? transport : activity.transportMode,
    };
    cursor += activityDuration(activity);
    return next;
  });
};

const preserveLockedSlots = (day: DayPlan, candidates: Activity[]) => {
  const lockedSlots = day.activities.map((activity, index) => (isLocked(activity) ? { index, activity } : null)).filter(Boolean) as Array<{ index: number; activity: Activity }>;
  if (lockedSlots.length === 0) return candidates;
  const unlocked = candidates.filter((activity) => !isLocked(activity));
  const result = [...day.activities];
  let nextUnlocked = 0;
  result.forEach((activity, index) => {
    if (!isLocked(activity)) result[index] = unlocked[nextUnlocked++];
  });
  lockedSlots.forEach(({ index, activity }) => { result[index] = activity; });
  return result;
};

const addBreaks = (day: DayPlan, activities: Activity[], profile: TripProfile): Activity[] => {
  const includeMeals = profile !== undefined && profile.moods.includes('fast-paced') === false;
  if (activities.length === 0) {
    return [
      generatedActivity(day, 'food', '12:30', 'Lunch near your base', 'A flexible meal window to keep the day grounded.', MEAL_MINUTES),
      generatedActivity(day, 'cafe', '15:00', 'Café and rest', 'A deliberate pause before the next decision.', REST_MINUTES),
    ];
  }
  if (!includeMeals || activities.some((activity) => activity.type === 'food')) return activities;
  const result = [...activities];
  const hasAfternoonPause = result.some((activity) => (parseMinutes(activity.time) || 0) >= 14 * 60 && activity.type === 'cafe');
  if (!hasAfternoonPause && result.length >= 2) {
    result.splice(Math.min(2, result.length), 0, generatedActivity(day, 'cafe', '15:00', 'Café and rest', 'A deliberate pause between main activities.', REST_MINUTES));
  }
  return result;
};

const buildChanges = (beforeDays: DayPlan[], afterDays: DayPlan[]): ProposedChange[] => {
  const changes: ProposedChange[] = [];
  afterDays.forEach((afterDay) => {
    const beforeDay = beforeDays.find((day) => day.day === afterDay.day);
    if (!beforeDay) return;
    const beforeById = new Map(beforeDay.activities.map((activity) => [activity.id, activity]));
    afterDay.activities.forEach((activity, index) => {
      const before = activity.id ? beforeById.get(activity.id) : undefined;
      if (!before) {
        changes.push({ id: `${afterDay.day}-${activity.id}-insert`, dayNumber: afterDay.day, activityId: activity.id, kind: 'insert', label: `Add ${activityLabel(activity)}`, proposed: activity.time });
        return;
      }
      const beforeIndex = beforeDay.activities.findIndex((candidate) => candidate.id === activity.id);
      if (beforeIndex !== index) {
        changes.push({ id: `${afterDay.day}-${activity.id}-move`, dayNumber: afterDay.day, activityId: activity.id, kind: 'move', label: `Move ${activityLabel(activity)}`, current: `Position ${beforeIndex + 1}`, proposed: `Position ${index + 1}`, protected: isLocked(before) });
      }
      if (before.time !== activity.time) {
        changes.push({ id: `${afterDay.day}-${activity.id}-time`, dayNumber: afterDay.day, activityId: activity.id, kind: 'time', label: `Reschedule ${activityLabel(activity)}`, current: before.time, proposed: activity.time, protected: isLocked(before) });
      }
      if (before.transportMinutes !== activity.transportMinutes && activity.transportMinutes) {
        changes.push({ id: `${afterDay.day}-${activity.id}-travel`, dayNumber: afterDay.day, activityId: activity.id, kind: 'travel', label: `Add travel to ${activityLabel(activity)}`, current: before.transportMinutes ? `${before.transportMinutes} min` : 'Unknown', proposed: `${activity.transportMinutes} min` });
      }
    });
  });
  return changes;
};

const makeProposal = (
  itinerary: Itinerary,
  profile: TripProfile,
  action: PlannerAction,
  reason: string,
  beforeDays: DayPlan[],
  afterDays: DayPlan[],
): ItineraryProposal => {
  void itinerary;
  const changes = buildChanges(beforeDays, afterDays);
  const lockedChanges = changes.filter((change) => change.protected);
  return {
    id: createId('suggestion'),
    action,
    createdAt: new Date().toISOString(),
    profileRevision: profileRevision(profile),
    reason,
    confidence: lockedChanges.length > 0 ? 'medium' : 'high',
    beforeDays,
    afterDays,
    changes,
    travelMinutesBefore: beforeDays.reduce((sum, day) => sum + totalTravelMinutes(day, profile.transport[0]), 0),
    travelMinutesAfter: afterDays.reduce((sum, day) => sum + totalTravelMinutes(day, profile.transport[0]), 0),
  };
};

const planningStartMinutes = (itinerary: Itinerary, profile: TripProfile) => {
  const preferred = parseMinutes(itinerary.planningConstraints?.preferredStartTime);
  if (preferred !== null) return preferred;
  if (profile.moods.includes('slow-living') || profile.moods.includes('calm')) return 10 * 60;
  if (profile.moods.includes('fast-paced')) return 8 * 60;
  return DEFAULT_START;
};

export function generateInitialItinerary(itinerary: Itinerary, profile: TripProfile): ItineraryProposal {
  const beforeDays = clone(itinerary.days);
  const afterDays = beforeDays.map((day) => {
    const existing = day.activities.length > 0 ? day.activities : addBreaks(day, [], profile);
    const generated = existing.map((activity) => ({
      ...activity,
      source: activity.source || 'manual',
      durationMinutes: activity.durationMinutes || DEFAULT_ACTIVITY_MINUTES,
    }));
    const withBreaks = addBreaks(day, generated, profile);
    return { ...day, activities: scheduleActivities(withBreaks, planningStartMinutes(itinerary, profile), profile.transport[0]) };
  });
  return makeProposal(
    itinerary,
    profile,
    'generate',
    'The plan keeps confirmed places together, adds deliberate meal and rest windows, and leaves unknown travel details visible instead of guessing.',
    beforeDays,
    afterDays,
  );
}

const optimiseOneDay = (day: DayPlan, profile: TripProfile, itinerary: Itinerary) => {
  const movable = sortByNearest(day.activities.filter((activity) => !isLocked(activity)));
  const arranged = preserveLockedSlots(day, movable);
  const scheduled = scheduleActivities(arranged, planningStartMinutes(itinerary, profile), profile.transport[0]);
  return { ...day, activities: scheduled };
};

export function optimiseDay(itinerary: Itinerary, profile: TripProfile, dayNumber: number): ItineraryProposal {
  const beforeDays = clone(itinerary.days);
  const afterDays = beforeDays.map((day) => day.day === dayNumber ? optimiseOneDay(day, profile, itinerary) : day);
  return makeProposal(
    itinerary,
    profile,
    'optimise-day',
    'Locations with coordinates are clustered to reduce backtracking. Locked activities remain in place, and uncertain travel remains marked as unknown.',
    beforeDays,
    afterDays,
  );
}

export function optimiseTrip(itinerary: Itinerary, profile: TripProfile): ItineraryProposal {
  const beforeDays = clone(itinerary.days);
  const afterDays = beforeDays.map((day) => optimiseOneDay(day, profile, itinerary));
  return makeProposal(
    itinerary,
    profile,
    'optimise-trip',
    'Each day is reordered independently around its existing city and coordinates, with protected activities preserved.',
    beforeDays,
    afterDays,
  );
}

export function applyItineraryProposal(
  itinerary: Itinerary,
  proposal: ItineraryProposal,
  selectedChangeIds: Iterable<string> = proposal.changes.map((change) => change.id),
): { itinerary: Itinerary; applied: ProposedChange[]; history: PlannerChangeRecord } {
  const selected = new Set(selectedChangeIds);
  const selectedChanges = proposal.changes.filter((change) => selected.has(change.id) && !change.protected);
  if (selectedChanges.length === 0) {
    const history: PlannerChangeRecord = {
      id: proposal.id,
      action: proposal.action,
      createdAt: proposal.createdAt,
      summary: 'No planner changes applied.',
      affectedDayNumbers: [],
      beforeDays: [],
      afterDays: [],
    };
    return { itinerary, applied: [], history };
  }
  const selectedDays = new Set(selectedChanges.map((change) => change.dayNumber));
  const days = itinerary.days.map((day) => {
    if (!selectedDays.has(day.day)) return day;
    const proposedDay = proposal.afterDays.find((candidate) => candidate.day === day.day);
    if (!proposedDay) return day;
    const dayChanges = proposal.changes.filter((change) => change.dayNumber === day.day);
    const allSafeChangesSelected = !dayChanges.some((change) => change.protected)
      && dayChanges.filter((change) => !change.protected).every((change) => selected.has(change.id));
    if (allSafeChangesSelected) return { ...day, activities: proposedDay.activities };

    const selectedActivityIds = new Set(selectedChanges.map((change) => change.activityId).filter((id): id is string => Boolean(id)));
    const nextActivities = day.activities.map((activity) => {
      const proposedActivity = proposedDay.activities.find((candidate) => candidate.id === activity.id);
      if (!proposedActivity || !selectedActivityIds.has(activity.id || '')) return activity;
      const hasTimeChange = selectedChanges.some((change) => change.activityId === activity.id && change.kind === 'time');
      const hasTravelChange = selectedChanges.some((change) => change.activityId === activity.id && change.kind === 'travel');
      return {
        ...activity,
        time: hasTimeChange ? proposedActivity.time : activity.time,
        transportMinutes: hasTravelChange ? proposedActivity.transportMinutes : activity.transportMinutes,
        transportMode: hasTravelChange ? proposedActivity.transportMode : activity.transportMode,
      };
    });
    const selectedInserts = proposedDay.activities.filter((activity) => activity.source === 'generated' && selectedChanges.some((change) => change.activityId === activity.id));
    return { ...day, activities: [...nextActivities, ...selectedInserts] };
  });
  const history: PlannerChangeRecord = {
    id: proposal.id,
    action: proposal.action,
    createdAt: new Date().toISOString(),
    summary: `${selectedChanges.length} planner changes applied.`,
    affectedDayNumbers: Array.from(selectedDays),
    beforeDays: itinerary.days.filter((day) => selectedDays.has(day.day)),
    afterDays: days.filter((day) => selectedDays.has(day.day)),
  };
  return {
    itinerary: {
      ...itinerary,
      schemaVersion: Math.max(2, itinerary.schemaVersion || 1),
      days,
      plannerHistory: [...(itinerary.plannerHistory || []), history].slice(-10),
      lastPlannerProfileRevision: proposal.profileRevision,
    },
    applied: selectedChanges,
    history,
  };
}

export function undoPlannerChange(itinerary: Itinerary, historyId: string): Itinerary {
  const history = itinerary.plannerHistory?.find((entry) => entry.id === historyId);
  if (!history) return itinerary;
  const canUndo = history.afterDays.every((afterDay) => {
    const currentDay = itinerary.days.find((day) => day.day === afterDay.day);
    return currentDay && JSON.stringify(currentDay) === JSON.stringify(afterDay);
  });
  if (!canUndo) return itinerary;
  const restoredDays = itinerary.days.map((day) => history.beforeDays.find((before) => before.day === day.day) || day);
  return {
    ...itinerary,
    days: restoredDays,
    plannerHistory: (itinerary.plannerHistory || []).filter((entry) => entry.id !== historyId),
  };
}

export const plannerDefaults = {
  start: formatMinutes(DEFAULT_START),
  end: formatMinutes(DEFAULT_END),
  mealMinutes: MEAL_MINUTES,
  restMinutes: REST_MINUTES,
  dayEnd: formatMinutes(DEFAULT_END),
};

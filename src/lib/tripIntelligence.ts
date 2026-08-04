import type {
  Activity,
  ActivityType,
  DayPlan,
  Itinerary,
  PlannerOperation,
  PlanningConstraints,
  PlannerChangeRecord,
} from '../data';
import { profileRevision } from './identityFields';
import { declaredTripDays } from './tripDuration';
import type { TripProfile } from './tripProfile';

export type PlannerAction = 'generate' | 'optimise-day' | 'optimise-trip';
export type PlannerChangeKind = 'move' | 'time' | 'insert' | 'remove' | 'travel' | 'constraint' | 'budget' | 'availability';

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
  baseProfileRevision: string;
  baseItineraryRevision: number;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  beforeDays: DayPlan[];
  afterDays: DayPlan[];
  beforeUnassignedActivities: Activity[];
  afterUnassignedActivities: Activity[];
  changes: ProposedChange[];
  travelMinutesBefore: number;
  travelMinutesAfter: number;
  coordinateCoverage: number;
  unknownLegCount: number;
  coverage: PlannerCoverage;
  warnings: string[];
}

export interface PlannerCoverage {
  placeVerification: number;
  coordinates: number;
  openingHours: number;
  route: number;
  reservations: number;
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

const isScheduleWindow = (activity: Activity) => activity.kind === 'meal-window'
  || activity.kind === 'rest-window'
  || activity.kind === 'free-time'
  || (activity.source === 'generated' && !activity.providerPlaceId && (activity.type === 'food' || activity.type === 'cafe'));

const isPlaceActivity = (activity: Activity) => !isScheduleWindow(activity)
  && activity.kind !== 'transport';

const isLocked = (activity: Activity) => Boolean(activity.locked || activity.lockedFields?.includes('all') || activity.lockedFields?.includes('schedule'));

const stableId = (prefix: string, value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
};

const generatedActivity = (
  itineraryId: string,
  day: DayPlan,
  type: Extract<ActivityType, 'food' | 'cafe' | 'walk'>,
  time: string,
  name: string,
  description: string,
  durationMinutes: number,
): Activity => ({
  id: stableId('activity', `${itineraryId}|day-${day.day}|placeholder|${type}|${time}`),
  kind: type === 'food' ? 'meal-window' : 'rest-window',
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
    generatedAt: 'planner-generated',
    reason: 'Added to keep the day practical and paced.',
    confidence: 'medium',
  },
});

const travelMetrics = (day: DayPlan, transport = 'public-transport') => {
  const placeActivities = day.activities.filter(isPlaceActivity);
  let total = 0;
  let knownLegs = 0;
  let unknownLegs = 0;
  for (let index = 1; index < placeActivities.length; index += 1) {
    const previous = coordinatesFor(placeActivities[index - 1]);
    const current = coordinatesFor(placeActivities[index]);
    const estimate = estimateTravelMinutes(previous, current, transport);
    if (estimate !== null) {
      total += estimate;
      knownLegs += 1;
    } else if (placeActivities[index].transportMinutes) {
      total += placeActivities[index].transportMinutes || 0;
      knownLegs += 1;
    } else {
      unknownLegs += 1;
    }
  }
  return { total, knownLegs, unknownLegs };
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

const scheduleActivities = (activities: Activity[], startAt = DEFAULT_START, transport = 'public-transport'): Activity[] => {
  let cursor = startAt;
  return activities.map((activity, index) => {
    const previous = index > 0 ? activities[index - 1] : undefined;
    const travel = previous ? estimateTravelMinutes(coordinatesFor(previous), coordinatesFor(activity), transport) : null;
    const lockedTime = isLocked(activity) ? parseMinutes(activity.time) : null;
    cursor = lockedTime !== null ? lockedTime : cursor + (travel || 0);
    const next: Activity = {
      ...activity,
      time: lockedTime !== null ? activity.time : formatMinutes(cursor),
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

const addBreaks = (itineraryId: string, day: DayPlan, activities: Activity[], profile: TripProfile, constraints: PlanningConstraints = {}) => {
  void profile;
  const includeMeals = constraints.includeMealBreaks !== false;
  if (activities.length === 0) return [];
  if (!includeMeals || activities.some((activity) => activity.kind === 'meal-window' || activity.type === 'food')) return activities;
  const result = [...activities];
  const hasAfternoonPause = result.some((activity) => (parseMinutes(activity.time) || 0) >= 14 * 60 && activity.kind === 'rest-window');
  if (!hasAfternoonPause && result.length >= 2) {
    result.splice(Math.min(2, result.length), 0, generatedActivity(itineraryId, day, 'cafe', '15:00', 'Rest window', 'A deliberate pause between main activities.', REST_MINUTES));
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
    beforeDay.activities.forEach((activity) => {
      if (!afterDays.some((candidate) => candidate.activities.some((item) => item.id === activity.id))) {
        changes.push({ id: `${beforeDay.day}-${activity.id}-remove`, dayNumber: beforeDay.day, activityId: activity.id, kind: 'remove', label: `Move ${activityLabel(activity)} to another day`, current: `Day ${beforeDay.day}`, proposed: 'Another day', protected: isLocked(activity) });
      }
    });
  });
  return changes;
};

const buildOperations = (changes: ProposedChange[], beforeDays: DayPlan[], afterDays: DayPlan[]): PlannerOperation[] => changes.map((change) => {
  const beforeDay = beforeDays.find((day) => day.day === change.dayNumber);
  const afterDay = afterDays.find((day) => day.day === change.dayNumber);
  const beforeIndex = beforeDay?.activities.findIndex((activity) => activity.id === change.activityId) ?? -1;
  const afterIndex = afterDay?.activities.findIndex((activity) => activity.id === change.activityId) ?? -1;
  const beforeActivity = beforeDay?.activities[beforeIndex];
  const afterActivity = afterDay?.activities[afterIndex];
  if (change.kind === 'move') return { kind: 'move', dayNumber: change.dayNumber, activityId: change.activityId, beforeIndex, afterIndex };
  if (change.kind === 'time') return { kind: 'time', dayNumber: change.dayNumber, activityId: change.activityId, before: beforeActivity?.time, after: afterActivity?.time };
  if (change.kind === 'travel') return { kind: 'travel', dayNumber: change.dayNumber, activityId: change.activityId, before: { transportMinutes: beforeActivity?.transportMinutes, transportMode: beforeActivity?.transportMode }, after: { transportMinutes: afterActivity?.transportMinutes, transportMode: afterActivity?.transportMode } };
  if (change.kind === 'insert') return { kind: 'insert', dayNumber: change.dayNumber, activityId: change.activityId, afterIndex, after: afterActivity };
  if (change.kind === 'remove') return { kind: 'remove', dayNumber: change.dayNumber, activityId: change.activityId, beforeIndex, before: beforeActivity };
  return { kind: 'lock', dayNumber: change.dayNumber, activityId: change.activityId };
});

const plannerCoverage = (days: DayPlan[], knownLegs: number, unknownLegs: number): PlannerCoverage => {
  const places = days.flatMap((day) => day.activities).filter(isPlaceActivity);
  const totalLegs = knownLegs + unknownLegs;
  if (places.length === 0) {
    return { placeVerification: 0, coordinates: 0, openingHours: 0, route: 0, reservations: 0 };
  }
  return {
    placeVerification: places.filter((activity) => Boolean(activity.providerPlaceId)).length / places.length,
    coordinates: places.filter((activity) => Boolean(activity.coordinates)).length / places.length,
    openingHours: places.filter((activity) => Boolean(activity.openingHours?.opensAt && activity.openingHours?.closesAt)).length / places.length,
    route: totalLegs > 0 ? knownLegs / totalLegs : places.length <= 1 ? 1 : 0,
    reservations: places.filter((activity) => activity.bookingStatus !== undefined).length / places.length,
  };
};

const plannerConfidence = (coverage: PlannerCoverage): ItineraryProposal['confidence'] => {
  const values = Object.values(coverage);
  if (coverage.placeVerification === 0 || coverage.coordinates === 0 || coverage.route === 0) return 'low';
  if (values.every((value) => value >= 1)) return 'high';
  return 'medium';
};

const makeProposal = (
  itinerary: Itinerary,
  profile: TripProfile,
  action: PlannerAction,
  reason: string,
  beforeDays: DayPlan[],
  afterDays: DayPlan[],
  beforeUnassignedActivities: Activity[] = [],
  afterUnassignedActivities: Activity[] = [],
): ItineraryProposal => {
  const changes = buildChanges(beforeDays, afterDays);
  const beforeMetrics = beforeDays.reduce((sum, day) => {
    const metrics = travelMetrics(day, profile.transport[0]);
    return { total: sum.total + metrics.total, knownLegs: sum.knownLegs + metrics.knownLegs, unknownLegs: sum.unknownLegs + metrics.unknownLegs };
  }, { total: 0, knownLegs: 0, unknownLegs: 0 });
  const afterMetrics = afterDays.reduce((sum, day) => {
    const metrics = travelMetrics(day, profile.transport[0]);
    return { total: sum.total + metrics.total, knownLegs: sum.knownLegs + metrics.knownLegs, unknownLegs: sum.unknownLegs + metrics.unknownLegs };
  }, { total: 0, knownLegs: 0, unknownLegs: 0 });
  const totalLegs = afterMetrics.knownLegs + afterMetrics.unknownLegs;
  const coverage = plannerCoverage(afterDays, afterMetrics.knownLegs, afterMetrics.unknownLegs);
  const warnings: string[] = afterMetrics.unknownLegs > 0
    ? [`${afterMetrics.unknownLegs} movement leg${afterMetrics.unknownLegs === 1 ? '' : 's'} lack coordinates and remain unknown.`]
    : [];
  if (coverage.placeVerification < 1) warnings.push('Some places are not linked to a verified discovery source.');
  if (coverage.coordinates < 1) warnings.push('Some places lack coordinates, so their movement remains approximate.');
  if (afterDays.flatMap((day) => day.activities).filter(isPlaceActivity).length === 0) {
    warnings.push('No real places are scheduled. Add or discover places before building a destination-specific itinerary.');
  }
  const constraints = itinerary.planningConstraints;
  const preferredEnd = parseMinutes(constraints?.preferredEndTime);
  const currencies = new Set<string>();
  let knownBudget = 0;
  afterDays.forEach((day) => day.activities.forEach((activity) => {
    const start = parseMinutes(activity.time);
    if (preferredEnd !== null && start !== null && start + activityDuration(activity) > preferredEnd) {
      warnings.push(`${activityLabel(activity)} ends after the preferred day end.`);
    }
    if (constraints?.maxMainActivitiesPerDay && day.activities.filter(isPlaceActivity).length > constraints.maxMainActivitiesPerDay) {
      warnings.push(`Day ${day.day} exceeds the maximum main activity limit.`);
    }
    constraints?.unavailableTimes?.forEach((window) => {
      if (!window.date || window.date === day.date) {
        const windowStart = parseMinutes(window.start);
        const windowEnd = parseMinutes(window.end);
        if (start !== null && windowStart !== null && windowEnd !== null && start < windowEnd && start + activityDuration(activity) > windowStart) {
          warnings.push(`${activityLabel(activity)} overlaps unavailable time${window.reason ? ` (${window.reason})` : ''}.`);
        }
      }
    });
    const openingStart = parseMinutes(activity.openingHours?.opensAt);
    const openingEnd = parseMinutes(activity.openingHours?.closesAt);
    if (start !== null && openingStart !== null && openingEnd !== null && (start < openingStart || start + activityDuration(activity) > openingEnd)) {
      warnings.push(`${activityLabel(activity)} falls outside its known opening hours.`);
    }
    if (activity.estimatedCost) {
      currencies.add(activity.estimatedCost.currency);
      if (activity.estimatedCost.currency === (constraints?.maxBudgetCurrency || profile.tripCurrency)) knownBudget += activity.estimatedCost.amount;
    }
  }));
  if (currencies.size > 1) warnings.push('Known costs use multiple currencies; no combined total is calculated without a saved conversion rate.');
  if (constraints?.maxBudgetAmount !== undefined && knownBudget > constraints.maxBudgetAmount) warnings.push('Known costs exceed the configured budget limit.');
  const declaredDays = declaredTripDays(profile);
  if (declaredDays > afterDays.length && afterDays.length > 0) {
    warnings.push(`Planning covers the ${afterDays.length} daily pages already created, not all ${declaredDays} days of the trip.`);
  }
  const uniqueWarnings = Array.from(new Set(warnings));
  return {
    id: stableId('suggestion', `${itinerary.id}|${action}|${itinerary.revision || 0}|${beforeDays.map((day) => day.activities.map((activity) => activity.id).join(',')).join('|')}`),
    action,
    createdAt: new Date().toISOString(),
    baseProfileRevision: profileRevision(profile),
    baseItineraryRevision: itinerary.revision || 0,
    reason,
    confidence: plannerConfidence(coverage),
    beforeDays,
    afterDays,
    beforeUnassignedActivities,
    afterUnassignedActivities,
    changes,
    travelMinutesBefore: beforeMetrics.total,
    travelMinutesAfter: afterMetrics.total,
    coordinateCoverage: totalLegs > 0 ? afterMetrics.knownLegs / totalLegs : 0,
    unknownLegCount: afterMetrics.unknownLegs,
    coverage,
    warnings: uniqueWarnings,
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
  const beforeUnassignedActivities = clone(itinerary.unassignedActivities || []);
  const afterDays = beforeDays.map((day) => {
    const existing = day.activities.length > 0 ? day.activities : addBreaks(itinerary.id, day, [], profile, itinerary.planningConstraints);
    const generated = existing.map((activity) => ({
      ...activity,
      source: activity.source || 'manual',
      durationMinutes: activity.durationMinutes || DEFAULT_ACTIVITY_MINUTES,
    }));
    const withBreaks = addBreaks(itinerary.id, day, generated, profile, itinerary.planningConstraints);
    return { ...day, activities: scheduleActivities(withBreaks, planningStartMinutes(itinerary, profile), profile.transport[0]) };
  });
  const remainingInbox = [...beforeUnassignedActivities];
  const assignedDays = afterDays.map((day) => ({ ...day, activities: [...day.activities] }));
  remainingInbox.forEach((activity, index) => {
    const target = assignedDays[index % Math.max(1, assignedDays.length)];
    if (target) target.activities.push({ ...activity, source: activity.source || 'manual' });
  });
  const scheduledDays = assignedDays.map((day) => ({ ...day, activities: scheduleActivities(day.activities, planningStartMinutes(itinerary, profile), profile.transport[0]) }));
  return makeProposal(
    itinerary,
    profile,
    'generate',
    'The plan organises confirmed places, preserves locks, and leaves unknown travel details visible instead of inventing destinations.',
    beforeDays,
    scheduledDays,
    beforeUnassignedActivities,
    [],
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
    itinerary.unassignedActivities || [],
    itinerary.unassignedActivities || [],
  );
}

export function optimiseTrip(itinerary: Itinerary, profile: TripProfile): ItineraryProposal {
  const beforeDays = clone(itinerary.days);
  const afterDays = beforeDays.map((day) => ({
    ...day,
    activities: day.activities.filter((activity) => isLocked(activity) || isScheduleWindow(activity)),
  }));
  const movable = beforeDays.flatMap((day) => day.activities.filter((activity) => !isLocked(activity) && isPlaceActivity(activity)).map((activity) => ({ activity, originalDay: day.day })));
  const maxMain = itinerary.planningConstraints?.maxMainActivitiesPerDay || 4;
  const destinationPoints = profile.destinations.filter((destination) => typeof destination.lat === 'number' && typeof destination.lng === 'number');
  const dayLoad = (day: DayPlan) => day.activities.filter(isPlaceActivity).length;
  const dayScore = (day: DayPlan, activity: Activity, originalDay: number) => {
    const coords = coordinatesFor(activity);
    const destination = coords && destinationPoints.length > 0
      ? destinationPoints.reduce((closest, candidate) => {
          const candidateDistance = distanceKm(coords, [candidate.lat as number, candidate.lng as number]);
          const closestDistance = distanceKm(coords, [closest.lat as number, closest.lng as number]);
          return candidateDistance < closestDistance ? candidate : closest;
        })
      : undefined;
    const cityMatch = destination ? day.city.toLowerCase().includes(destination.city.toLowerCase()) : false;
    const capacityPenalty = dayLoad(day) >= maxMain ? 1000 : dayLoad(day) * 5;
    const originalPenalty = day.day === originalDay ? 0 : 2;
    return capacityPenalty + originalPenalty + (cityMatch ? 0 : destination ? 250 : 0);
  };
  movable.sort((left, right) => Number(itinerary.planningConstraints?.mustDoActivityIds?.includes(right.activity.id || '')) - Number(itinerary.planningConstraints?.mustDoActivityIds?.includes(left.activity.id || '')));
  movable.forEach(({ activity, originalDay }) => {
    const target = afterDays.reduce((best, day) => dayScore(day, activity, originalDay) < dayScore(best, activity, originalDay) ? day : best, afterDays[0]);
    target.activities.push(activity);
  });
  const scheduledDays = afterDays.map((day) => optimiseOneDay(day, profile, itinerary));
  return makeProposal(
    itinerary,
    profile,
    'optimise-trip',
    'Unlocked activities are distributed across the trip by destination fit and daily capacity, then each day is ordered to reduce approximate backtracking. Locked and must-do activities are preserved.',
    beforeDays,
    scheduledDays,
    itinerary.unassignedActivities || [],
    itinerary.unassignedActivities || [],
  );
}

export function applyItineraryProposal(
  itinerary: Itinerary,
  profile: TripProfile,
  proposal: ItineraryProposal,
  selectedChangeIds: Iterable<string> = proposal.changes.map((change) => change.id),
): { ok: boolean; reason?: 'profile-changed' | 'itinerary-changed'; itinerary: Itinerary; applied: ProposedChange[]; history?: PlannerChangeRecord } {
  if (proposal.baseProfileRevision !== profileRevision(profile)) return { ok: false, reason: 'profile-changed', itinerary, applied: [] };
  if (proposal.baseItineraryRevision !== (itinerary.revision || 0)) return { ok: false, reason: 'itinerary-changed', itinerary, applied: [] };
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
    return { ok: true, itinerary, applied: [], history };
  }
  const selectedDays = new Set(selectedChanges.map((change) => change.dayNumber));
  const selectedInboxIds = new Set(selectedChanges.filter((change) => change.kind === 'insert').map((change) => change.activityId));
  const nextUnassigned = (itinerary.unassignedActivities || []).filter((activity) => !selectedInboxIds.has(activity.id));
  const days = itinerary.days.map((day) => {
    if (!selectedDays.has(day.day)) return day;
    const proposedDay = proposal.afterDays.find((candidate) => candidate.day === day.day);
    if (!proposedDay) return day;
    const dayChanges = proposal.changes.filter((change) => change.dayNumber === day.day);
    const allSafeChangesSelected = !dayChanges.some((change) => change.protected)
      && dayChanges.filter((change) => !change.protected).every((change) => selected.has(change.id));
    if (allSafeChangesSelected) return { ...day, activities: proposedDay.activities };

    const selectedDayChanges = selectedChanges.filter((change) => change.dayNumber === day.day);
    const selectedActivityIds = new Set(selectedDayChanges.map((change) => change.activityId).filter((id): id is string => Boolean(id)));
    const selectedRemovals = new Set(selectedDayChanges.filter((change) => change.kind === 'remove').map((change) => change.activityId));
    const selectedInserts = proposedDay.activities.filter((activity) => selectedDayChanges.some((change) => change.kind === 'insert' && change.activityId === activity.id));
    let nextActivities = day.activities.filter((activity) => !selectedRemovals.has(activity.id));
    nextActivities = [...nextActivities, ...selectedInserts];
    const orderChanges = selectedDayChanges.filter((change) => change.kind === 'move' || change.kind === 'insert');
    if (orderChanges.length > 0) {
      const proposedIndexes = new Map(proposedDay.activities.map((activity, index) => [activity.id, index]));
      const selectedOrderIds = new Set(orderChanges.map((change) => change.activityId));
      nextActivities.sort((left, right) => {
        const leftSelected = selectedOrderIds.has(left.id);
        const rightSelected = selectedOrderIds.has(right.id);
        if (leftSelected && rightSelected) return (proposedIndexes.get(left.id) || 0) - (proposedIndexes.get(right.id) || 0);
        if (leftSelected) return -1;
        if (rightSelected) return 1;
        return day.activities.indexOf(left) - day.activities.indexOf(right);
      });
    }
    nextActivities = nextActivities.map((activity) => {
      const proposedActivity = proposedDay.activities.find((candidate) => candidate.id === activity.id);
      if (!proposedActivity || !selectedActivityIds.has(activity.id || '')) return activity;
      const hasTimeChange = selectedDayChanges.some((change) => change.activityId === activity.id && change.kind === 'time');
      const hasTravelChange = selectedDayChanges.some((change) => change.activityId === activity.id && change.kind === 'travel');
      return {
        ...activity,
        time: hasTimeChange ? proposedActivity.time : activity.time,
        transportMinutes: hasTravelChange ? proposedActivity.transportMinutes : activity.transportMinutes,
        transportMode: hasTravelChange ? proposedActivity.transportMode : activity.transportMode,
      };
    });
    return { ...day, activities: nextActivities };
  });
  const history: PlannerChangeRecord = {
    id: proposal.id,
    action: proposal.action,
    createdAt: new Date().toISOString(),
    summary: `${selectedChanges.length} planner changes applied.`,
    affectedDayNumbers: Array.from(selectedDays),
    operations: buildOperations(selectedChanges, itinerary.days, days),
    beforeUnassignedActivities: itinerary.unassignedActivities || [],
    afterUnassignedActivities: nextUnassigned,
    beforeDays: itinerary.days.filter((day) => selectedDays.has(day.day)),
    afterDays: days.filter((day) => selectedDays.has(day.day)),
  };
  return {
    ok: true,
    itinerary: {
      ...itinerary,
      schemaVersion: Math.max(2, itinerary.schemaVersion || 1),
      days,
      unassignedActivities: nextUnassigned,
      plannerHistory: [...(itinerary.plannerHistory || []), history].slice(-10),
      lastPlannerProfileRevision: proposal.baseProfileRevision,
    },
    applied: selectedChanges,
    history,
  };
}

export function undoPlannerChange(itinerary: Itinerary, historyId: string): Itinerary {
  const history = itinerary.plannerHistory?.find((entry) => entry.id === historyId);
  if (!history) return itinerary;
  if (!history.operations || history.operations.length === 0) return itinerary;
  const nextDays = clone(itinerary.days);
  for (const operation of history.operations) {
    const day = nextDays.find((candidate) => candidate.day === operation.dayNumber);
    if (!day) continue;
    const currentIndex = day.activities.findIndex((activity) => activity.id === operation.activityId);
    if (operation.kind === 'time' && currentIndex >= 0) {
      const current = day.activities[currentIndex];
      if (current.time === operation.after) current.time = typeof operation.before === 'string' ? operation.before : current.time;
    } else if (operation.kind === 'travel' && currentIndex >= 0) {
      const current = day.activities[currentIndex];
      if (JSON.stringify({ transportMinutes: current.transportMinutes, transportMode: current.transportMode }) === JSON.stringify(operation.after)) {
        const before = operation.before as { transportMinutes?: number; transportMode?: string };
        current.transportMinutes = before.transportMinutes;
        current.transportMode = before.transportMode;
      }
    } else if (operation.kind === 'move' && currentIndex >= 0 && currentIndex === operation.afterIndex) {
      const [activity] = day.activities.splice(currentIndex, 1);
      day.activities.splice(Math.max(0, Math.min(operation.beforeIndex ?? 0, day.activities.length)), 0, activity);
    } else if (operation.kind === 'insert' && currentIndex >= 0) {
      const current = day.activities[currentIndex];
      if (current.source === 'generated' || JSON.stringify(current) === JSON.stringify(operation.after)) day.activities.splice(currentIndex, 1);
    } else if (operation.kind === 'remove' && currentIndex < 0 && operation.before) {
      day.activities.splice(Math.max(0, Math.min(operation.beforeIndex ?? day.activities.length, day.activities.length)), 0, operation.before as Activity);
    }
  }
  const currentInbox = itinerary.unassignedActivities || [];
  const canRestoreInbox = JSON.stringify(currentInbox) === JSON.stringify(history.afterUnassignedActivities || []);
  return {
    ...itinerary,
    days: nextDays,
    unassignedActivities: canRestoreInbox ? (history.beforeUnassignedActivities || []) : currentInbox,
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

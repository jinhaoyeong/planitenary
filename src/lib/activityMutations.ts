import type { Itinerary } from '../data';

/**
 * Explicit activity deletion is a separate, user-confirmed mutation. Planner
 * rebuilds never call this boundary, which keeps "generate" distinct from
 * "delete" in both code and tests.
 */
export const removeActivityFromDay = (
  itinerary: Itinerary,
  dayNumber: number,
  activityIndex: number,
): Itinerary => {
  const dayIndex = itinerary.days.findIndex((day) => day.day === dayNumber);
  const day = itinerary.days[dayIndex];
  if (!day || activityIndex < 0 || activityIndex >= day.activities.length) return itinerary;

  return {
    ...itinerary,
    days: itinerary.days.map((entry, index) => index === dayIndex
      ? { ...entry, activities: entry.activities.filter((_, itemIndex) => itemIndex !== activityIndex) }
      : entry),
  };
};

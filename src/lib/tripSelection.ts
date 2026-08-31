import type { Itinerary } from '../data';
import type { TripSummary } from './trips';

export const currentTripStorageKey = (userId: string): string => `current-trip-${userId}`;

/**
 * A remembered id wins over incidental registry ordering. Updated timestamps
 * remain the fallback for accounts that have not selected a trip on this
 * device yet.
 */
export const currentTripFirst = (
  trips: TripSummary[],
  selectedTripId: string | null,
): TripSummary[] => {
  if (!selectedTripId || !trips.some((trip) => trip.id === selectedTripId)) return trips;
  return [...trips].sort((left, right) => {
    if (left.id === selectedTripId) return -1;
    if (right.id === selectedTripId) return 1;
    return 0;
  });
};

/** A row/key may only open the itinerary whose id it names. */
export const itineraryMatchesTrip = (
  expectedTripId: string,
  itinerary: unknown,
): itinerary is Itinerary => Boolean(
  itinerary
  && typeof itinerary === 'object'
  && (itinerary as Partial<Itinerary>).id === expectedTripId,
);

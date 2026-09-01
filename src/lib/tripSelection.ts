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

/**
 * The trip id a payload claims for itself, before anything has normalised it.
 *
 * Read from the raw value on purpose. `sanitizeItinerary` stamps the fallback
 * trip's id onto whatever it is given, so by the time a payload is sanitised
 * every identity check downstream compares the expected id against itself and
 * can never fail. The check has to happen here, on the bytes as they arrived.
 */
export const rawItineraryId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
};

/**
 * Whether a raw payload may be loaded as trip `expectedTripId`.
 *
 * Fail closed on a conflict: a payload that names a *different* trip is that
 * other trip's content, and adopting it under this id is how Bangkok came to
 * open as Phuket. It is rejected rather than repaired, because there is no way
 * to tell whether the id or the content is the mistaken half.
 *
 * A payload with **no** id is the supported legacy case — trips saved before
 * the itinerary carried its own id, and blank rows the app writes itself. Those
 * are accepted and take the expected id, which is what the storage key or the
 * queried row already asserted about them.
 */
export const rawPayloadBelongsToTrip = (expectedTripId: string, payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const claimed = rawItineraryId(payload);
  return claimed === undefined || claimed === expectedTripId;
};

/** A row/key may only open the itinerary whose id it names. */
export const itineraryMatchesTrip = (
  expectedTripId: string,
  itinerary: unknown,
): itinerary is Itinerary => rawPayloadBelongsToTrip(expectedTripId, itinerary);

import type { Itinerary } from '../data';
import { sanitizeItinerary, shouldAdoptItineraryForTrip } from './itinerarySanitize';
import { rawPayloadBelongsToTrip } from './tripSelection';

/**
 * The one gate every itinerary payload passes through before it becomes the
 * screen.
 *
 * Five asynchronous sources can hand `App` an itinerary — the first fetch,
 * local storage, the legacy demo key, a realtime row change, and a `storage`
 * event from another tab — and each was making the same three decisions inline,
 * slightly differently. Two of those decisions were being made in the wrong
 * order: the payload was sanitised (which stamps the selected trip's id onto
 * it) *before* its identity was checked, so the check compared the expected id
 * against itself and could not fail.
 *
 * Ordering the three questions once, here, is what makes them answerable:
 *
 *   1. is this still the trip the traveller is looking at?
 *   2. does the raw payload claim to be that trip?
 *   3. is it newer than what we already hold for that trip?
 *
 * It lives outside the component so those questions can be asked in a test with
 * real deferred promises, rather than inferred from reading effects.
 */

export type AdoptionOutcome =
  /** Adopted; `itinerary` is the sanitised result. */
  | 'adopted'
  /** The traveller selected a different trip while this was in flight. */
  | 'stale-selection'
  /** The payload named a different trip than the one it arrived for. */
  | 'identity-mismatch'
  /** Correct trip, but not newer than what is already held. */
  | 'older-revision';

export interface AdoptionResult {
  outcome: AdoptionOutcome;
  itinerary?: Itinerary;
}

export interface TripScopedItineraryStore {
  /** The trip the traveller has selected, advanced synchronously on open. */
  readonly activeTripId: string;
  /** The newest itinerary held for {@link activeTripId}, or null before load. */
  readonly latest: Itinerary | null;
  /** Selecting a trip. Synchronous, so an in-flight response cannot outrun it. */
  select(tripId: string, itinerary: Itinerary | null): void;
  /**
   * Follow a trip id that changed elsewhere (a render, a restored session).
   * Held content belongs to the trip it came from and is dropped with it, so a
   * previous trip's revision can never be weighed against the new one's.
   */
  syncActiveTripId(tripId: string): void;
  /** Record a locally produced itinerary as the newest for the active trip. */
  hold(itinerary: Itinerary): void;
  consider(input: {
    /** The trip this payload was requested for. */
    arrivedForTripId: string;
    /** Exactly as received: unparsed shape, un-sanitised, id intact. */
    raw: unknown;
    /** Sanitiser fallback. Must be the itinerary for `arrivedForTripId`. */
    fallback: Itinerary;
  }): AdoptionResult;
  /** Whether this itinerary may be written back for the active trip. */
  canPersist(itinerary: Itinerary | null | undefined): boolean;
}

export const createTripScopedItineraryStore = (
  initialTripId: string,
  initialItinerary: Itinerary | null = null,
): TripScopedItineraryStore => {
  let activeTripId = initialTripId;
  let latest = initialItinerary;

  return {
    get activeTripId() { return activeTripId; },
    get latest() { return latest; },

    select(tripId, itinerary) {
      activeTripId = tripId;
      latest = itinerary;
    },

    syncActiveTripId(tripId) {
      if (tripId === activeTripId) return;
      activeTripId = tripId;
      latest = null;
    },

    hold(itinerary) {
      latest = itinerary;
    },

    consider({ arrivedForTripId, raw, fallback }) {
      /**
       * A response describes the trip it was asked for, not the trip that is
       * open now. Bangkok's fetch resolving after the traveller opened Phuket
       * is stale by definition, however new its revision is.
       */
      if (arrivedForTripId !== activeTripId) return { outcome: 'stale-selection' };

      // Before sanitisation, while the payload still has its own id.
      if (!rawPayloadBelongsToTrip(arrivedForTripId, raw)) return { outcome: 'identity-mismatch' };

      const sanitized = sanitizeItinerary(raw, fallback);
      if (!shouldAdoptItineraryForTrip(activeTripId, sanitized, latest)) {
        return { outcome: 'older-revision' };
      }

      latest = sanitized;
      return { outcome: 'adopted', itinerary: sanitized };
    },

    canPersist(itinerary) {
      return Boolean(itinerary) && itinerary!.id === activeTripId;
    },
  };
};

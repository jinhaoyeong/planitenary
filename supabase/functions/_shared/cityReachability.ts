/**
 * Whether a place can be visited from where the traveller is sleeping.
 *
 * The planner has always had two different situations that look identical in
 * the data, and that is the whole reason a saved place could end up in the
 * wrong city:
 *
 * **A day trip.** The traveller sleeps in Osaka and spends Tuesday in Kyoto.
 * Legitimate, extremely common in Kansai, and the deck deliberately offers
 * Kyoto, Nara and Kobe places to an Osaka trip for exactly this reason.
 *
 * **A misplacement.** Dotonbori — an Osaka place — is scheduled on a day the
 * traveller is based in Kyoto, because the model was looking for a day with
 * room and nothing stopped it.
 *
 * A day carries one city and a place carries its own, so those two are the
 * same shape. The only thing that separates them is *geography*: Kyoto is
 * forty minutes from Osaka and can be a day out; Dotonbori is not somewhere
 * you nip to from Kyoto in the middle of a Kyoto day. This module supplies
 * that missing fact, so the guard can refuse the second without ever refusing
 * the first.
 *
 * ## Reachability is permission; pace is density
 *
 * These were previously the same switch (`allowCrossCityDays` on the pace
 * profile), which made a relaxed traveller unable to visit Kyoto from Osaka at
 * all — not because it is far, but because they said they wanted a calm trip.
 * That conflates two unrelated questions. A relaxed traveller staying in Osaka
 * may certainly spend a day in Kyoto; they just want three stops there instead
 * of seven. So:
 *
 * - **Reachability decides whether a cross-city visit is possible at all.**
 * - **Pace decides how much fits once it is.**
 *
 * Nothing here reads a pace, and nothing here counts activities.
 *
 * ## No network, no new stored fields
 *
 * Centroids are derived from the coordinates of the shortlisted places
 * themselves, which are already in the planning material. There is no
 * geocoding call, no city-coordinate table to maintain and drift, and nothing
 * new to persist or migrate: a city is where its places are. A city whose
 * places carry no coordinates yields no centroid, and the rules below say what
 * happens then — which is always "allow", never "guess".
 */

import { distanceKm } from './placeImages.ts';

/** A city key that survives casing and stray whitespace, and nothing more. */
export const cityKey = (city: string | undefined | null): string =>
  (city || '').trim().toLowerCase();

/**
 * How far a day trip may reach, as the crow flies.
 *
 * Straight-line kilometres rather than travel minutes, because minutes need a
 * routing call and this check has to be free and synchronous — it runs inside
 * proposal validation, on every candidate placement.
 *
 * 80 km is chosen against the case this exists for. In Kansai it comfortably
 * admits every real day trip out of Osaka — Kyoto (~40 km), Nara (~30 km),
 * Kobe (~30 km), Himeji (~75 km) — and excludes the ones that are not day
 * trips from an Osaka base: Kanazawa (~200 km), Hiroshima (~280 km), Tokyo
 * (~400 km). Straight-line under-reads rail distance slightly, which biases
 * the guard toward *allowing*, and that is the right direction to be wrong in:
 * a wrongly-allowed day trip is a plan the traveller can see and reject, while
 * a wrongly-refused one is a place that silently never gets scheduled.
 */
export const DAY_TRIP_RADIUS_KM = 80;

/** What a place is, relative to the city a day is based in. */
export type PlacementVerdict =
  /** The place is in the base city. Always fine. */
  | 'same-city'
  /** A different city, close enough to go and come back. A day trip. */
  | 'day-trip'
  /** A different city, too far to visit from this base. A misplacement. */
  | 'unreachable'
  /** Not enough geography to judge. Treated as allowed; see {@link cityReachability}. */
  | 'unknown';

interface CityPoint {
  lat: number;
  lng: number;
}

export interface PlaceLocation {
  city: string;
  coordinates?: [number, number];
}

export interface CityReachability {
  /** Where a city's shortlisted places sit, or `undefined` if none are located. */
  centroidOf: (city: string) => CityPoint | undefined;
  /** Straight-line kilometres between two cities, when both are located. */
  distanceBetween: (from: string, to: string) => number | undefined;
  /** How a place relates to the city a day is based in. */
  verdictFor: (baseCity: string, place: PlaceLocation) => PlacementVerdict;
}

/**
 * A city's location, averaged over the places shortlisted there.
 *
 * A mean is right for this and a bounding box would not be: the question is
 * "roughly where is this city relative to that one", over distances of tens of
 * kilometres, and a couple of outlying stops move a mean by very little at
 * that scale. Places without coordinates contribute nothing rather than
 * dragging the centroid to (0, 0).
 */
const centroids = (places: readonly PlaceLocation[]): Map<string, CityPoint> => {
  const sums = new Map<string, { lat: number; lng: number; count: number }>();
  for (const place of places) {
    const key = cityKey(place.city);
    if (!key || !place.coordinates) continue;
    const [lat, lng] = place.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const running = sums.get(key) ?? { lat: 0, lng: 0, count: 0 };
    running.lat += lat;
    running.lng += lng;
    running.count += 1;
    sums.set(key, running);
  }
  const points = new Map<string, CityPoint>();
  for (const [key, running] of sums) {
    points.set(key, { lat: running.lat / running.count, lng: running.lng / running.count });
  }
  return points;
};

/**
 * Build the reachability view for one trip's places.
 *
 * The `'unknown'` verdict is load-bearing and deliberately permissive. This
 * guard exists to catch a place being dropped on the wrong side of the country,
 * and it sits in front of the traveller's own saved trip — so when the data
 * cannot answer the question, refusing would delete real plans over missing
 * coordinates. Silence means yes here, and the cost of that choice is bounded:
 * an unlocatable place can be misplaced exactly as it could before this module
 * existed. Nothing gets worse; the cases we *can* judge get better.
 */
export function cityReachability(places: readonly PlaceLocation[]): CityReachability {
  const points = centroids(places);

  const centroidOf = (city: string): CityPoint | undefined => points.get(cityKey(city));

  const distanceBetween = (from: string, to: string): number | undefined => {
    const a = centroidOf(from);
    const b = centroidOf(to);
    if (!a || !b) return undefined;
    return distanceKm(a.lat, a.lng, b.lat, b.lng);
  };

  const verdictFor = (baseCity: string, place: PlaceLocation): PlacementVerdict => {
    const base = cityKey(baseCity);
    const target = cityKey(place.city);
    // A day with no city of its own constrains nothing, and a place with no
    // city cannot be shown to be in the wrong one.
    if (!base || !target) return 'unknown';
    if (base === target) return 'same-city';

    /**
     * The place's own coordinates are preferred over its city's centroid.
     * A place is a point; the centroid is an average of its neighbours, and
     * for a place near a city boundary the point is the better answer.
     */
    const from = centroidOf(base);
    if (!from) return 'unknown';
    const to = place.coordinates
      && Number.isFinite(place.coordinates[0])
      && Number.isFinite(place.coordinates[1])
      ? { lat: place.coordinates[0], lng: place.coordinates[1] }
      : centroidOf(target);
    if (!to) return 'unknown';

    return distanceKm(from.lat, from.lng, to.lat, to.lng) <= DAY_TRIP_RADIUS_KM
      ? 'day-trip'
      : 'unreachable';
  };

  return { centroidOf, distanceBetween, verdictFor };
}

/** Only an `unreachable` verdict is a defect. Day trips are the point. */
export const isPlacementAllowed = (verdict: PlacementVerdict): boolean =>
  verdict !== 'unreachable';

/**
 * What to tell somebody whose plan just lost a stop.
 *
 * Names the place, its city and the day's base, because "incompatible
 * location" on its own gives a traveller nothing to act on — and this string
 * is also what goes back to the model on a repair pass, which can only fix
 * what it has been told specifically.
 */
export const placementConflictMessage = (
  placeName: string,
  placeCity: string,
  dayNumber: number,
  baseCity: string,
): string =>
  `${placeName} is in ${placeCity.trim()}; Day ${dayNumber} is based in ${baseCity.trim()} and ${placeCity.trim()} is too far to visit and return the same day.`;

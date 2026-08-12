import {
  toCandidateIntelligenceTripMaterial,
  tripMaterialRevision,
} from './intelligenceMaterial.ts';
import type { IntelligenceTripContext } from './candidateIntelligence.ts';

export interface ReasoningTripInput extends IntelligenceTripContext {
  tripId: string;
  budgetTier?: string;
}

export interface AuthoritativeTripMaterial extends IntelligenceTripContext {
  source: 'persisted-itinerary-profile';
}

export type TripLookup =
  | { kind: 'owned'; tripId: string; userId: string; itineraryData: unknown }
  | { kind: 'missing' }
  | { kind: 'error' };

export type AuthorizationFailureCode =
  | 'unauthorized'
  | 'invalid-trip'
  | 'trip-not-owned'
  | 'trip-lookup-failed'
  | 'trip-material-unavailable'
  | 'trip-material-mismatch';

export type AuthorizationResult =
  | { ok: true; trip: AuthoritativeTripMaterial; tripId: string }
  | { ok: false; code: AuthorizationFailureCode; detail: string };

const MOOD_PACE: Record<string, string> = {
  'slow-living': 'very-relaxed',
  calm: 'relaxed',
  minimal: 'relaxed',
  romantic: 'relaxed',
  luxury: 'relaxed',
  'fast-paced': 'active',
  festive: 'balanced',
  'hidden-gems': 'balanced',
};

const TRIP_TYPE_PACE: Record<string, string> = {
  relaxation: 'relaxed',
  family: 'relaxed',
  business: 'relaxed',
  adventure: 'active',
};

const PACE_RANK: Record<string, number> = {
  'very-relaxed': 0,
  relaxed: 1,
  balanced: 2,
  active: 3,
  intensive: 4,
};

const strings = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== 'string')) return null;
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
};

const canonicalSet = (values: string[]): string[] => [...new Set(values)].sort();

const sameStrings = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Reproduce the app's deterministic pace inference from persisted profile facts. */
export function authoritativeTripMaterial(itineraryData: unknown): AuthoritativeTripMaterial | null {
  if (!itineraryData || typeof itineraryData !== 'object' || Array.isArray(itineraryData)) return null;
  const profile = (itineraryData as Record<string, unknown>).tripProfile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const raw = profile as Record<string, unknown>;
  const styles = strings(raw.styles);
  const moods = strings(raw.moods);
  const tripTypes = strings(raw.tripTypes);
  if (!styles || !moods || !tripTypes) return null;

  const signals = [...moods, ...tripTypes]
    .map((value) => MOOD_PACE[value] || TRIP_TYPE_PACE[value])
    .filter((value): value is string => Boolean(value));
  const pace = signals.length === 0
    ? 'balanced'
    : signals.reduce((slowest, value) => PACE_RANK[value] < PACE_RANK[slowest] ? value : slowest);
  const tripMaterial = toCandidateIntelligenceTripMaterial({
    tripMaterialRevision: '',
    styles: canonicalSet(styles),
    pace,
  });
  return {
    ...tripMaterial,
    tripMaterialRevision: tripMaterialRevision(tripMaterial),
    source: 'persisted-itinerary-profile',
  };
}

export function validTripId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.trim());
}

/**
 * Verify the owned trip and compare the material that the server actually
 * owns. Candidate discovery facts remain client-supplied for this phase.
 */
export async function authorizeCandidateTrip(
  input: unknown,
  userId: string | null,
  lookupTrip: (tripId: string, userId: string) => Promise<TripLookup>,
): Promise<AuthorizationResult> {
  if (!userId) return { ok: false, code: 'unauthorized', detail: 'Authentication required.' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid-trip', detail: 'trip and candidates are required.' };
  }
  const rawInput = input as Record<string, unknown>;
  const rawTrip = rawInput.trip;
  if (!rawTrip || typeof rawTrip !== 'object' || Array.isArray(rawTrip)) {
    return { ok: false, code: 'invalid-trip', detail: 'trip and candidates are required.' };
  }
  const trip = rawTrip as Partial<ReasoningTripInput>;
  if (!validTripId(trip.tripId)) {
    return { ok: false, code: 'invalid-trip', detail: 'A valid tripId is required.' };
  }

  const owned = await lookupTrip(trip.tripId.trim(), userId);
  if (owned.kind === 'error') {
    return {
      ok: false,
      code: 'trip-lookup-failed',
      detail: 'The trip could not be verified safely. Please try again.',
    };
  }
  if (owned.kind !== 'owned') {
    return { ok: false, code: 'trip-not-owned', detail: 'That trip is not available to this account.' };
  }
  const authoritative = authoritativeTripMaterial(owned.itineraryData);
  if (!authoritative) {
    return {
      ok: false,
      code: 'trip-material-unavailable',
      detail: 'This trip has no authoritative profile material for paid reasoning.',
    };
  }

  const clientStyles = strings(trip.styles);
  if (!clientStyles || typeof trip.pace !== 'string' || !trip.tripMaterialRevision) {
    return { ok: false, code: 'invalid-trip', detail: 'The trip material is invalid.' };
  }
  const clientCanonical = toCandidateIntelligenceTripMaterial({
    tripMaterialRevision: trip.tripMaterialRevision,
    styles: canonicalSet(clientStyles),
    pace: trip.pace,
  });
  const clientRevision = tripMaterialRevision(clientCanonical);
  if (
    !sameStrings(clientCanonical.styles, authoritative.styles)
    || clientCanonical.pace !== authoritative.pace
    || clientRevision !== authoritative.tripMaterialRevision
    || trip.tripMaterialRevision !== authoritative.tripMaterialRevision
  ) {
    return {
      ok: false,
      code: 'trip-material-mismatch',
      detail: 'The submitted trip material does not match the saved trip profile.',
    };
  }

  return { ok: true, trip: authoritative, tripId: owned.tripId };
}

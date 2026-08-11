/**
 * Exactly what the model is shown, and therefore exactly what makes a cached
 * answer stale.
 *
 * Those two lists were previously separate — one assembled by the request
 * builder, one implied by whatever the revision happened to hash — and keeping
 * them in step was a thing to remember. Here they are the same object: each
 * mapper returns one normalized snapshot, the request sends it, and the
 * revision is its canonical serialization. Drift stops being a discipline and
 * becomes difficult to express.
 *
 * The membership rule is narrower than "whatever we happen to know". A fact
 * reaches the model only if some currently-accepted validator rule can check a
 * claim resting on it. Anything else is ambient context: the model can still
 * let it steer which atoms it picks, no rule can catch that influence, and its
 * changes would invalidate correct answers for nothing. That is the reasoning
 * that removed `deterministicScore`, and it applies to every field.
 *
 * Three owners, three revisions, because they change for unrelated reasons:
 *
 *   candidate material → this place changed
 *   planner material   → this place's relationship to the trip changed
 *   trip material      → this traveller changed
 *
 * No Deno APIs and no runtime imports, so vitest exercises all of it.
 */

import type {
  IntelligenceCandidate,
  IntelligenceTripContext,
} from './candidateIntelligence.ts';

/**
 * Facts about the place itself.
 *
 * Four fields, each with a live consumer:
 *
 * - `matchedStyleTags`    → `style-match`, `weak-style-match`
 * - `indoorOutdoor`       → `indoor-option`
 * - `durationRangeMinutes` → see the note below
 */
export interface CandidateMaterial {
  matchedStyleTags: string[];
  indoorOutdoor: 'indoor' | 'outdoor' | 'both' | null;
  /**
   * **Kept deliberately, and not for the reason it looks like.**
   *
   * Its own atoms — `short-stop` and `duration-pressure` — currently fail
   * closed, so by the membership rule above this field should have gone with
   * `travelMinutesFromCluster` and the rest. It stays because a *different*
   * consumer is live: `validateCandidateIntelligence` bounds the model's
   * `suggestedDurationMinutes` against this range and drops it when it falls
   * outside.
   *
   * So removing this would not merely tidy the payload — it would silently
   * turn a validated number into an unchecked one. A later cleanup pass
   * reading only the atom table would remove it correctly-looking and wrongly.
   */
  durationRangeMinutes: [number, number] | null;
}

/**
 * How the place relates to the rest of the trip.
 *
 * Two fields: `clusterId` for `cluster-fit`, and `pairableCandidateIds` for
 * pairing validation. `travelMinutesFromCluster` and
 * `underrepresentedCategories` are absent because every atom that consumed
 * them fails closed — a raw number whose meaning the validator has explicitly
 * refused to define is exactly the ambient context this module excludes.
 */
export interface PlannerMaterial {
  clusterId: string | null;
  pairableCandidateIds: string[];
}

/**
 * Facts about the traveller.
 *
 * `budgetTier` is absent. After the budget atoms began failing closed it had
 * no consumer at all in the validator, so sending it meant the model could
 * weigh a preference no rule could check, and editing a budget would have
 * regenerated intelligence that could not possibly differ.
 */
export interface TripMaterial {
  styles: string[];
  pace: string;
}

/**
 * Sorted and de-duplicated, because these are sets written as arrays.
 *
 * Two candidates tagged `[food, culture]` and `[culture, food, food]` are the
 * same candidate, and any difference between their revisions would be a cache
 * miss with no answer behind it.
 */
const canonicalSet = (values: readonly string[] | undefined): string[] =>
  [...new Set(values || [])].sort();

/**
 * Serialise with a fixed key order.
 *
 * `JSON.stringify` follows insertion order, so two objects built by different
 * code paths could carry identical facts and serialise differently. Sorting
 * the keys removes construction order from the answer entirely.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/** The place, as the model may see it. */
export function toCandidateIntelligenceMaterial(candidate: IntelligenceCandidate): CandidateMaterial {
  return {
    matchedStyleTags: canonicalSet(candidate.matchedStyleTags),
    indoorOutdoor: candidate.indoorOutdoor ?? null,
    durationRangeMinutes: candidate.durationRangeMinutes
      ? [candidate.durationRangeMinutes[0], candidate.durationRangeMinutes[1]]
      : null,
  };
}

/** The place's relationships, as the model may see them. */
export function toPlannerIntelligenceMaterial(candidate: IntelligenceCandidate): PlannerMaterial {
  return {
    clusterId: candidate.clusterId ?? null,
    // Order carries no meaning here: a pairing set is a set.
    pairableCandidateIds: canonicalSet(candidate.pairableCandidateIds),
  };
}

/** The traveller, as the model may see them. */
export function toCandidateIntelligenceTripMaterial(trip: IntelligenceTripContext): TripMaterial {
  return {
    styles: canonicalSet(trip.styles),
    pace: trip.pace,
  };
}

/**
 * Versioned so a change to what a revision *means* invalidates the answers the
 * previous meaning produced. Human-readable rather than hashed: these are
 * small, and a revision nobody can read is a revision nobody can debug. The
 * one hash this codebase already has is FNV-1a 32-bit, which is fine for a
 * description and not for a key that decides what a traveller is shown.
 */
export const CANDIDATE_MATERIAL_VERSION = 'ci-candidate-v1';
export const PLANNER_MATERIAL_VERSION = 'ci-planner-v1';
export const TRIP_MATERIAL_VERSION = 'ci-trip-v1';

export const candidateMaterialRevision = (material: CandidateMaterial): string =>
  `${CANDIDATE_MATERIAL_VERSION}:${canonicalJson(material)}`;

export const plannerMaterialRevision = (material: PlannerMaterial): string =>
  `${PLANNER_MATERIAL_VERSION}:${canonicalJson(material)}`;

export const tripMaterialRevision = (material: TripMaterial): string =>
  `${TRIP_MATERIAL_VERSION}:${canonicalJson(material)}`;

/** Exported for the tests that measure key size before these become DB keys. */
export { canonicalJson };

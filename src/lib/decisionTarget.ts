/**
 * Review-card decision identity.
 *
 * Discovery cards are keyed by `candidate.id` (`wikivoyage-…`, `osm-n…`).
 * Saved itinerary places are keyed by the planner's canonical activity
 * identity. Those two are allowed to differ; a Skip on a card must not be
 * stored against a listing id if the card is known to be a saved activity.
 *
 * Names are never consulted. Two places can share a display name, and this
 * module must not conflate them.
 */

import type { Activity, Itinerary } from '../data';
import type { CandidateDecision, PlaceCandidate } from './destinationIntelligence';
import type { StructuredPlaceRef } from '../../supabase/functions/_shared/placeReference';
import {
  canonicalDecisionKeysOf,
  indexPlannerActivities,
  isPlannerPlace,
} from '../../supabase/functions/_shared/itineraryProposal';

export type DecisionCard = Pick<PlaceCandidate, 'id'>
  & Partial<Pick<PlaceCandidate, 'savedActivityId' | 'provider' | 'providerPlaceId' | 'placeRef'>>;

const VALID_DECISIONS: readonly CandidateDecision[] = ['must-do', 'interested', 'skip', 'visited'];

const asDecision = (value: unknown): CandidateDecision | undefined =>
  typeof value === 'string' && (VALID_DECISIONS as readonly string[]).includes(value)
    ? value as CandidateDecision
    : undefined;

const cityKey = (value: string | undefined): string => (value || '').trim().toLowerCase();

/**
 * Identities a discovery/review card may honestly be known by.
 *
 * `candidate.id` first — that is what the deck stores. A provider-qualified
 * key only when both halves are present, matching planning canonical form.
 */
export const candidateIdentityKeys = (candidate: DecisionCard): string[] => {
  const keys = [candidate.id];
  if (candidate.provider && candidate.providerPlaceId) {
    keys.push(`${candidate.provider}-${candidate.providerPlaceId}`);
  }
  return [...new Set(keys.filter(Boolean))];
};

/** The planning identity a decision control on this card must read and write. */
export const decisionTargetIdOf = (candidate: DecisionCard): string =>
  candidate.savedActivityId || candidate.id;

/**
 * Read precedence for the selected radio on a card.
 *
 * 1. Saved-activity decision, when the card is explicitly linked.
 * 2. Candidate-key decision, so an older listing Skip remains visible on a
 *    linked card until the traveller confirms, and so unsaved cards work.
 *
 * An unlinked card never reads another place's saved-activity key.
 */
export const resolvedCardDecision = (
  decisions: Record<string, CandidateDecision | string | undefined>,
  candidate: DecisionCard,
): CandidateDecision | undefined => {
  const target = decisionTargetIdOf(candidate);
  const saved = asDecision(decisions[target]);
  if (saved) return saved;
  if (target !== candidate.id) return asDecision(decisions[candidate.id]);
  return undefined;
};

/**
 * One user action: write the canonical planning key, and keep the listing
 * key in sync when they differ so discovery state still sees the card as
 * reviewed.
 */
export const cardDecisionWrites = (
  candidate: DecisionCard,
  decision: CandidateDecision,
): Record<string, CandidateDecision> => {
  const target = decisionTargetIdOf(candidate);
  const writes: Record<string, CandidateDecision> = { [target]: decision };
  if (candidate.id !== target) writes[candidate.id] = decision;
  return writes;
};

/**
 * The trusted references belonging to the decisions that exist right now.
 *
 * Keyed by the same keys `cardDecisionWrites` writes under, so a reference is
 * found by the decision it was captured with rather than by anything about the
 * place. Nothing is derived here: a candidate either arrived from the server
 * carrying a reference or it did not, and a decision made before references
 * existed simply has no entry — that is the correct, permanent answer for it.
 *
 * Refs for keys that no longer have a decision are dropped, so undoing a
 * decision cannot leave identity behind for a choice the traveller withdrew.
 */
export const decisionPlaceRefs = (
  decisions: Record<string, CandidateDecision | string | undefined>,
  candidates: readonly DecisionCard[],
  existing?: Record<string, StructuredPlaceRef>,
): Record<string, StructuredPlaceRef> | undefined => {
  const refs: Record<string, StructuredPlaceRef> = {};
  for (const [key, ref] of Object.entries(existing ?? {})) {
    if (decisions[key] !== undefined) refs[key] = ref;
  }
  for (const candidate of candidates) {
    const ref = candidate.placeRef;
    if (!ref) continue;
    for (const key of new Set([decisionTargetIdOf(candidate), candidate.id])) {
      if (key && decisions[key] !== undefined) refs[key] = ref;
    }
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
};

/**
 * Attach `savedActivityId` when a candidate identity is already one of the
 * saved activity's canonical keys. No name, coordinate, or "nearest" guess.
 */
export const bindSavedActivityIds = (
  candidates: readonly PlaceCandidate[],
  itinerary: unknown,
): PlaceCandidate[] => {
  const claimed = new Set<string>();
  const byKey = new Map<string, string>();
  for (const ref of indexPlannerActivities(itinerary)) {
    const activityId = typeof ref.activity.id === 'string' ? ref.activity.id : ref.placeId;
    if (!activityId || claimed.has(activityId)) continue;
    claimed.add(activityId);
    for (const key of canonicalDecisionKeysOf(ref.activity)) {
      if (!byKey.has(key)) byKey.set(key, activityId);
    }
  }

  return candidates.map((candidate) => {
    if (candidate.savedActivityId) return candidate;
    const linkedId = candidateIdentityKeys(candidate)
      .map((key) => byKey.get(key))
      .find((id): id is string => Boolean(id));
    return linkedId ? { ...candidate, savedActivityId: linkedId } : candidate;
  });
};

const activityCity = (
  itinerary: Itinerary,
  day: number | undefined,
): string | undefined => {
  if (day === undefined) return undefined;
  const match = itinerary.days.find((entry) => entry.day === day);
  return match?.city;
};

const reviewCandidateFromActivity = (activity: Activity, city: string): PlaceCandidate => {
  const id = activity.id || activity.name;
  const provider = activity.provider || 'osm';
  return {
    id,
    savedActivityId: id,
    provider,
    providerPlaceId: activity.providerPlaceId,
    name: activity.name,
    description: activity.description,
    city,
    neighbourhood: activity.location,
    countryCode: '',
    coordinates: activity.coordinates,
    categories: activity.type ? [activity.type] : ['sight'],
    experienceTags: activity.type ? [activity.type] : ['sight'],
    estimatedVisitMinutes: Math.max(15, activity.durationMinutes || 90),
    indoorOutdoor: activity.indoorOutdoor || 'mixed',
    reservationStatus: activity.reservationRequirement || 'unknown',
    sourceReferences: activity.sourceReferences || [],
    sourceConfidence: activity.sourceReferences?.length ? 'medium' : 'low',
    lastVerifiedAt: activity.lastVerifiedAt || new Date(0).toISOString(),
  };
};

/**
 * Discovery cards plus unmatched saved planner places for this city.
 *
 * Linked discovery cards keep their listing `id` and gain `savedActivityId`.
 * Manual saved places that share no canonical key with any listing appear as
 * their own cards, targeted at `activity.id`.
 */
export const reviewCandidatesForItinerary = (
  candidates: readonly PlaceCandidate[],
  itinerary: Itinerary,
  options: { city?: string } = {},
): PlaceCandidate[] => {
  const bound = bindSavedActivityIds(candidates, itinerary);
  const linkedIds = new Set(bound.map((candidate) => candidate.savedActivityId).filter((id): id is string => Boolean(id)));
  const wantedCity = cityKey(options.city);
  const primaryCity = cityKey(itinerary.cities[0]);

  const injected: PlaceCandidate[] = [];
  for (const ref of indexPlannerActivities(itinerary)) {
    if (!isPlannerPlace(ref.activity, ref.day)) continue;
    const activity = ref.activity as unknown as Activity;
    const activityId = typeof activity.id === 'string' ? activity.id : ref.placeId;
    if (!activityId || linkedIds.has(activityId)) continue;
    const savedCity = cityKey(activityCity(itinerary, ref.day));
    if (wantedCity) {
      if (ref.day === undefined) {
        if (primaryCity && primaryCity !== wantedCity) continue;
      } else if (savedCity !== wantedCity) {
        continue;
      }
    }
    injected.push(reviewCandidateFromActivity(
      { ...activity, id: activityId },
      activityCity(itinerary, ref.day) || options.city || itinerary.cities[0] || '',
    ));
  }

  return [...injected, ...bound];
};

/** Decision keys that must survive rediscovery while the saved place still exists. */
export const retainedDecisionIdsOf = (itinerary: unknown): string[] =>
  indexPlannerActivities(itinerary).flatMap((ref) => {
    const activityId = typeof ref.activity.id === 'string' ? ref.activity.id : ref.placeId;
    return activityId ? [activityId] : [];
  });

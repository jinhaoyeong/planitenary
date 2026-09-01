import type { Activity } from '../data';
import type { PlaceCandidate } from './destinationIntelligence';
import { canonicalDecisionKeysOf } from '../../supabase/functions/_shared/itineraryProposal';

/**
 * Deciding whether a saved activity and a discovery candidate are the same
 * place.
 *
 * The planner keeps activities it must not replace and adds the candidates the
 * traveller accepted. When one place is both — already saved, and offered again
 * by discovery — the two must collapse to one row. Matching them on
 * `savedActivityId || candidate.id` only worked for candidates discovery had
 * already linked: a place saved before that link existed carries
 * `discovered-osm-n142` while the candidate offering it is `osm-n142`, so the
 * same museum appeared twice.
 *
 * The precedence below is {@link canonicalDecisionKeysOf} — already the app's
 * answer to "which identities name exactly one place" — with the canonical
 * server-owned ref in front of it. Reused rather than restated so the legacy
 * recovery rules cannot drift into two versions.
 *
 * Names are deliberately not an identity signal. Two restaurants in one city
 * share a name often enough that collapsing on it would silently delete one of
 * them, which is the failure this module exists to avoid: where identity cannot
 * be proven the planner keeps both.
 */

const clean = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const identityKeys = (record: {
  placeRef?: { canonicalPlaceId?: string; provider?: string; providerPlaceId?: string };
  provider?: string;
  providerPlaceId?: string;
  id?: string;
  savedActivityId?: string;
}): string[] => {
  const keys: string[] = [];

  // 1. Canonical server-owned identity: the only one resolved across providers.
  const canonical = clean(record.placeRef?.canonicalPlaceId);
  if (canonical) keys.push(`canonical:${canonical}`);

  // 2. Provider-qualified identity carried on the structured ref.
  const refProvider = clean(record.placeRef?.provider);
  const refPlaceId = clean(record.placeRef?.providerPlaceId);
  if (refProvider && refPlaceId) keys.push(`place:${refProvider.toLowerCase()}-${refPlaceId}`);

  /**
   * 3-4. Provider pair, saved-activity link, and the `discovered-` form a place
   * saved before candidate ids were kept. All three come from the shared
   * helper, including the prefix-stripping this module must not re-implement.
   */
  const savedActivityId = clean(record.savedActivityId);
  for (const key of canonicalDecisionKeysOf({
    id: savedActivityId ?? record.id,
    provider: record.provider,
    providerPlaceId: record.providerPlaceId,
  })) {
    keys.push(`place:${key.toLowerCase()}`);
  }
  // A candidate names both itself and the activity it stands for.
  if (savedActivityId && record.id) {
    for (const key of canonicalDecisionKeysOf({ id: record.id })) keys.push(`place:${key.toLowerCase()}`);
  }

  return [...new Set(keys)];
};

export const activityPlaceIdentityKeys = (activity: Activity): string[] => identityKeys(activity);

export const candidatePlaceIdentityKeys = (
  candidate: Pick<PlaceCandidate, 'id'> & Partial<PlaceCandidate>,
): string[] => identityKeys(candidate);

/** A lookup built once for the set of activities a rebuild is preserving. */
export const placeIdentityIndex = (activities: readonly Activity[]): Set<string> =>
  new Set(activities.flatMap(activityPlaceIdentityKeys));

/**
 * Whether the index provably already holds this place.
 *
 * Proof only: no shared key means "not known to be the same", never "different".
 * The caller keeps both records in that case.
 */
export const indexHasPlace = (index: Set<string>, keys: readonly string[]): boolean =>
  keys.some((key) => index.has(key));

/**
 * Cross-source place identity resolution.
 *
 * The same place appears under many names across sources:
 *
 *   Kuromon Ichiba Market · Kuromon Market · 黒門市場 · 黑门市场 · 大阪黑门市场
 *
 * Merging those into one canonical place is what lets a RedNote post, a Google
 * review and an official hours page all inform the same itinerary row.
 *
 * The hard rule enforced here: **never merge on name similarity alone.** Text
 * is only ever supporting evidence on top of a structural signal (provider id,
 * coordinates, address, website, phone). Two different ramen shops on the same
 * street have very similar names; conflating them would put a traveller outside
 * the wrong door.
 */

import type { CanonicalPlace } from './travelEvidence';

export type IdentityMatchSignal =
  | 'provider-id'
  | 'coordinates'
  | 'address'
  | 'website'
  | 'phone'
  | 'alias';

export interface PlaceIdentityMatch {
  canonicalPlaceId: string;
  evidenceId: string;
  /** 0–1. Below {@link REVIEW_THRESHOLD} the match must not affect planning. */
  matchConfidence: number;
  matchedBy: IdentityMatchSignal[];
}

/** An unresolved place reference observed in some external source. */
export interface PlaceObservation {
  /** Id of the evidence record this reference came from. */
  evidenceId: string;
  name: string;
  localName?: string;
  city?: string;
  countryCode?: string;
  neighbourhood?: string;
  coordinates?: [number, number];
  address?: string;
  website?: string;
  phone?: string;
  providerIds?: Partial<Record<'google' | 'amap' | 'baidu' | 'tripadvisor', string>>;
}

/** At or above this, a match is trusted enough to influence the itinerary. */
export const AUTO_MERGE_THRESHOLD = 0.8;
/** Below this a match is discarded outright rather than queued for review. */
export const REVIEW_THRESHOLD = 0.5;

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Fold a name to a comparable key: lowercase, strip punctuation, drop the
 * generic words that differ between listings of the same venue.
 */
const GENERIC_WORDS = new Set([
  'the', 'a', 'an', 'de', 'la', 'le', 'el',
  'market', 'ichiba', 'shopping', 'street', 'temple', 'shrine', 'museum',
  'park', 'garden', 'tower', 'station', 'restaurant', 'cafe', 'bar',
]);

export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    // Keep CJK ideographs and kana alongside latin letters and digits.
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const significantTokens = (value: string): string[] =>
  normaliseName(value).split(' ').filter((token) => token.length > 0 && !GENERIC_WORDS.has(token));

/**
 * Phone equality across formats. The same venue is listed as `+81 6-6631-0007`
 * by one source and `06-6631-0007` by another: same line, different country-code
 * and trunk-zero conventions. Comparing the significant suffix handles both
 * without needing a full libphonenumber dependency.
 */
function phonesMatch(left: string, right: string): boolean {
  const digits = (value: string) => value.replace(/[^\d]/g, '').replace(/^0+/, '');
  const a = digits(left);
  const b = digits(right);
  // Too short to be a real subscriber number — refuse rather than guess.
  if (a.length < 7 || b.length < 7) return false;
  const length = Math.min(9, a.length, b.length);
  return a.slice(-length) === b.slice(-length);
}

const normaliseWebsite = (value: string): string => {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
};

const normaliseAddress = (value: string): string =>
  value.toLowerCase().replace(/[^\p{Letter}\p{Number}]/gu, '');

/**
 * Name overlap, 0–1. Uses token overlap rather than edit distance so that
 * "Kuromon Ichiba Market" and "Kuromon Market" score high while "Ichiran
 * Dotonbori" and "Ichiran Umeda" — same chain, different branch — do not.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = significantTokens(left);
  const b = significantTokens(right);
  if (a.length === 0 || b.length === 0) {
    // Fall back to whole-string equality for CJK names that tokenise to one unit.
    return normaliseName(left) === normaliseName(right) ? 1 : 0;
  }
  const setB = new Set(b);
  const shared = a.filter((token) => setB.has(token)).length;
  return shared / Math.max(a.length, b.length);
}

/** True when either side lists the other's name among its aliases. */
const aliasHit = (place: CanonicalPlace, observation: PlaceObservation): boolean => {
  const candidates = [observation.name, observation.localName]
    .filter((value): value is string => Boolean(value))
    .map(normaliseName);
  const known = [place.primaryName, place.localName, ...place.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normaliseName);
  return candidates.some((candidate) => known.includes(candidate));
};

/**
 * Score one observation against one canonical place.
 *
 * Structural signals accumulate confidence. Name agreement can only *add* to a
 * structural match, and on its own is capped below {@link REVIEW_THRESHOLD} so
 * it can never trigger a merge by itself.
 */
export function scoreIdentityMatch(
  place: CanonicalPlace,
  observation: PlaceObservation,
): PlaceIdentityMatch {
  const matchedBy: IdentityMatchSignal[] = [];
  let confidence = 0;

  // 1. Provider id — the strongest possible signal; same provider, same id.
  for (const [provider, id] of Object.entries(observation.providerIds || {})) {
    if (id && place.providerIds[provider as keyof CanonicalPlace['providerIds']] === id) {
      matchedBy.push('provider-id');
      confidence = 1;
      break;
    }
  }

  if (confidence < 1) {
    // 2. Coordinates — tiered, because listings disagree by a few dozen metres.
    if (observation.coordinates) {
      const metres = distanceMeters(place.coordinates, observation.coordinates);
      if (metres <= 60) {
        matchedBy.push('coordinates');
        confidence += 0.55;
      } else if (metres <= 150) {
        matchedBy.push('coordinates');
        confidence += 0.35;
      } else if (metres <= 400) {
        // Plausibly co-located. Weak, but it is still a structural signal, so
        // it can carry a match into review rather than silent rejection —
        // social posts routinely geotag a block away from the door.
        matchedBy.push('coordinates');
        confidence += 0.1;
      } else {
        // Far apart is positive evidence they are *different* places.
        confidence -= 0.5;
      }
    }

    // 3. Website and 4. phone — near-certain when a venue publishes them.
    if (observation.website && place.website
      && normaliseWebsite(observation.website) === normaliseWebsite(place.website)) {
      matchedBy.push('website');
      confidence += 0.45;
    }
    if (observation.phone && place.phone && phonesMatch(observation.phone, place.phone)) {
      matchedBy.push('phone');
      confidence += 0.45;
    }

    // 5. Address.
    if (observation.address && place.address
      && normaliseAddress(observation.address) === normaliseAddress(place.address)) {
      matchedBy.push('address');
      confidence += 0.4;
    }

    // 6. Known alias, including the local-language name.
    if (aliasHit(place, observation)) {
      matchedBy.push('alias');
      confidence += 0.3;
    }
  }

  // A different city is disqualifying regardless of how well the names read.
  if (observation.city && place.city
    && normaliseName(observation.city) !== normaliseName(place.city)) {
    confidence -= 0.4;
  }

  // 7. Name similarity — supporting evidence only.
  const nameScore = Math.max(
    nameSimilarity(place.primaryName, observation.name),
    observation.localName ? nameSimilarity(place.localName || place.primaryName, observation.localName) : 0,
  );
  confidence += nameScore * 0.25;

  // Structural gate: without any structural signal, cap below the review
  // threshold so text agreement alone can never merge two records.
  const hasStructuralSignal = matchedBy.some((signal) => signal !== 'alias');
  if (!hasStructuralSignal) confidence = Math.min(confidence, REVIEW_THRESHOLD - 0.01);

  return {
    canonicalPlaceId: place.id,
    evidenceId: observation.evidenceId,
    matchConfidence: Math.max(0, Math.min(1, confidence)),
    matchedBy,
  };
}

export interface ResolutionOutcome {
  /** Confident enough to influence ranking and scheduling. */
  merged?: PlaceIdentityMatch;
  /** Plausible but unverified. Surfaced for review; must not affect planning. */
  needsReview?: PlaceIdentityMatch;
  /** Nothing matched — this is a new place, or unusable. */
  unmatched: boolean;
}

/**
 * Resolve one observation against the known canonical places, returning the
 * best match and where it sits relative to the merge/review thresholds.
 */
export function resolvePlaceObservation(
  places: CanonicalPlace[],
  observation: PlaceObservation,
): ResolutionOutcome {
  const best = places
    .map((place) => scoreIdentityMatch(place, observation))
    .sort((a, b) => b.matchConfidence - a.matchConfidence)[0];

  if (!best || best.matchConfidence < REVIEW_THRESHOLD) return { unmatched: true };
  if (best.matchConfidence >= AUTO_MERGE_THRESHOLD) return { merged: best, unmatched: false };
  return { needsReview: best, unmatched: false };
}

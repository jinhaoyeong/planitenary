/**
 * Multi-dimensional place scoring.
 *
 * The old ranker produced a single opaque number from interest and data
 * completeness. That cannot express the distinction a traveller actually cares
 * about: a place can be historically famous but currently mediocre, or newly
 * trending but heavily promoted, or perfect but impractical to reach.
 *
 * So the score is decomposed. Each dimension is computed independently, kept on
 * the result for the "Why this recommendation?" panel, and only then combined.
 * Penalties are subtracted last so a strong place with a closure report cannot
 * be carried by its other dimensions.
 */

import type { PlaceCandidate } from './destinationIntelligence';
import {
  buildRationale,
  collectShortlistStats,
  type RationalePoint,
  type ShortlistStats,
} from './placeRationale';
import type { PlaceEvidenceSummary } from './travelEvidence';
import type { RecommendationMix, TravelBehaviourProfile } from './travelBehaviour';
import type { TripProfile } from './tripProfile';

export interface PlaceIntelligenceScore {
  /** Match against the traveller's stated interests and styles. */
  travellerFit: number;
  /** How central this is to understanding the destination. */
  destinationSignificance: number;
  /** What recent visitors report, as distinct from historical reputation. */
  currentQuality: number;
  /** Whether it is interesting *now*, not whether it once went viral. */
  trendStrength: number;
  /** Local character versus a purely tourist-facing experience. */
  localRelevance: number;
  /** Can it actually be reached, entered and fitted into a day. */
  practicality: number;
  /** How well-sourced everything above is. */
  evidenceConfidence: number;
  /** 0–1 risk the praise is commercially motivated. Subtracted, not added. */
  promotionRisk: number;
}

export interface ScoredPlace {
  candidate: PlaceCandidate;
  /** 0–100, after weighting and penalties. */
  score: number;
  dimensions: PlaceIntelligenceScore;
  /** Structured, traceable explanation points — what the panel should render. */
  rationale: RationalePoint[];
  /** The same points flattened, for callers that still take a string list. */
  reasons: string[];
  /** Things the traveller should know before choosing it. */
  cautions: string[];
}

/**
 * Base weights. These sum to 1 and express the product's priorities: what the
 * traveller asked for matters most, and evidence quality is a modifier rather
 * than a headline.
 */
const BASE_WEIGHTS = {
  travellerFit: 0.24,
  destinationSignificance: 0.16,
  currentQuality: 0.15,
  practicality: 0.15,
  neighbourhoodFit: 0.10,
  trendStrength: 0.08,
  localRelevance: 0.07,
  evidenceConfidence: 0.05,
} as const;

/**
 * How the traveller's chosen mix re-balances the weights. "Trendy" leans on
 * what is popular now; "hidden-local" leans away from it and toward local
 * character; "classic" prioritises the destination's enduring significance.
 */
const MIX_ADJUSTMENTS: Record<RecommendationMix, Partial<Record<keyof typeof BASE_WEIGHTS, number>>> = {
  classic: { destinationSignificance: 0.08, trendStrength: -0.05, localRelevance: -0.03 },
  balanced: {},
  trendy: { trendStrength: 0.09, currentQuality: 0.03, destinationSignificance: -0.08, localRelevance: -0.04 },
  'hidden-local': { localRelevance: 0.10, destinationSignificance: -0.06, trendStrength: -0.04 },
};

function weightsFor(mix: RecommendationMix) {
  const adjustments = MIX_ADJUSTMENTS[mix] || {};
  const weights = { ...BASE_WEIGHTS } as Record<keyof typeof BASE_WEIGHTS, number>;
  for (const [key, delta] of Object.entries(adjustments)) {
    weights[key as keyof typeof BASE_WEIGHTS] = Math.max(0, weights[key as keyof typeof BASE_WEIGHTS] + delta);
  }
  // Renormalise so a mix cannot inflate or deflate the overall scale.
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(weights) as Array<keyof typeof BASE_WEIGHTS>) {
    weights[key] /= total;
  }
  return weights;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Travel styles → the category and tag vocabulary places are labelled with.
 *
 * Exported because `destinationPlanner` held a verbatim copy of this table and
 * the two had to be edited in lockstep to stay honest. One table, one place.
 */
export const STYLE_TAGS: Record<string, string[]> = {
  cafes: ['cafes', 'food'],
  'street-food': ['street-food', 'food', 'market', 'food-district'],
  'night-markets': ['market', 'evening', 'nightlife'],
  temples: ['temples', 'temple', 'shrine', 'history'],
  museums: ['museums', 'museum', 'art'],
  history: ['history', 'temple', 'shrine'],
  architecture: ['architecture', 'view'],
  shopping: ['shopping', 'market'],
  mountains: ['nature', 'hiking', 'view'],
  hiking: ['hiking', 'walk', 'nature'],
  nature: ['nature', 'park', 'garden'],
  beaches: ['waterfront', 'nature'],
  wildlife: ['wildlife', 'aquarium'],
  'scenic-train': ['view', 'waterfront'],
  anime: ['anime', 'theme-park'],
  nightlife: ['nightlife', 'evening', 'view'],
};

/**
 * Which of the traveller's own stated styles this place actually satisfies.
 *
 * `travellerFit` computed an intersection and kept only its size, so the panel
 * could say "Matches what you said you like" and nothing more — the same
 * sentence on every card, naming neither the style nor the place. The names are
 * the whole value: "you said temples and history" is checkable, and differs
 * card to card.
 *
 * **Stricter than the scoring intersection, deliberately.** `STYLE_TAGS` is
 * fuzzy on purpose — `temples` expands to include `history` so a shrine scores
 * for a history-minded traveller — and that is fine inside a number. Said out
 * loud it becomes false: the Osaka Museum of History carries no temple tag, and
 * telling someone "you asked for temples, and this is that" is a wrong claim
 * about their own input, which is worse than a vague one.
 *
 * So a style is named only on the tags that *define* it, not the ones it
 * borrows. Each list is read up to the first entry that is another style's own
 * name — the point where it stops describing itself and starts reaching across.
 * `temples: ['temples', 'temple', 'shrine', 'history']` defines itself with the
 * first three and borrows the fourth, so a place tagged only `history` scores
 * for temples but is never described as one.
 *
 * When one tag would name two chosen styles, only the style that owns it is
 * named: a park is `nature`, not `mountains`, when both were asked for.
 *
 * Returns the traveller's own words, not the internal tags, because those are
 * the words they chose.
 */
const STYLE_KEYS = new Set(Object.keys(STYLE_TAGS));

function definingTags(style: string): string[] {
  const expansion = STYLE_TAGS[style] || [style];
  const borrowed = expansion.findIndex((tag) => tag !== style && STYLE_KEYS.has(tag));
  const defining = borrowed === -1 ? expansion : expansion.slice(0, borrowed);
  // Some styles are borrowed vocabulary all the way down — `mountains` is
  // described entirely as `nature`, `hiking`, `view`. Truncating those to
  // nothing would mean they could never be named at all, so they keep the whole
  // list and rely on the ownership rule below to yield to a better-fitting
  // style when the traveller asked for one.
  return defining.length > 0 ? defining : expansion;
}

export function matchedStyleTags(candidate: PlaceCandidate, profile: TripProfile): string[] {
  const tags = new Set<string>([...candidate.categories, ...candidate.experienceTags]);
  const matched = profile.styles.filter((style) => definingTags(style).some((tag) => tags.has(tag)));

  // A tag that is another chosen style's own name belongs to that style.
  const claimed = new Set<string>(matched.filter((style) => tags.has(style)));
  return matched.filter((style) => tags.has(style) || !definingTags(style).some((tag) => claimed.has(tag)));
}

function travellerFit(candidate: PlaceCandidate, profile: TripProfile): number {
  const wanted = new Set(profile.styles.flatMap((style) => STYLE_TAGS[style] || [style]));
  if (wanted.size === 0) return 0.65;
  const tags = new Set([...candidate.categories, ...candidate.experienceTags]);
  const matches = [...wanted].filter((tag) => tags.has(tag)).length;
  return clamp01(0.3 + matches * 0.22);
}

function destinationSignificance(candidate: PlaceCandidate): number {
  if (candidate.categories.includes('essential')) return 1;

  /**
   * Two independent signals, whichever is available:
   *
   * - `notability` — documentation. An encyclopedia article or a guidebook
   *   entry means the wider world considers this place worth explaining.
   * - `reviewCount` — footfall. A place many people rated is a place people go.
   *
   * Providers without reviews supply the first; providers without notability
   * data supply the second. Taking the stronger of the two means a source
   * carrying only one of them is not silently penalised for the gap.
   */
  const footfall = candidate.reviewCount
    ? clamp01(Math.log10(candidate.reviewCount + 1) / 4.5)
    : 0;
  const documented = typeof candidate.notability === 'number' ? clamp01(candidate.notability) : 0;
  const weight = Math.max(footfall, documented);

  if (candidate.categories.includes('local-character')) return clamp01(0.75 + weight * 0.25);
  return clamp01(0.55 + weight * 0.4);
}

/**
 * What visitors report *lately*. Prefers the evidence summary; falls back to
 * the provider rating, which is a lifetime average and so is discounted.
 */
function currentQuality(candidate: PlaceCandidate, evidence?: PlaceEvidenceSummary): number {
  if (evidence && evidence.sourceCount > 0) {
    const positive = evidence.positiveThemes.length;
    const negative = evidence.negativeThemes.length;
    const balance = (positive + 1) / (positive + negative + 2); // Laplace-smoothed
    // Thin evidence is pulled toward neutral; well-corroborated evidence is
    // allowed to speak at close to full strength.
    return clamp01(0.5 + (balance - 0.5) * (0.5 + 0.5 * evidence.evidenceConfidence));
  }
  if (typeof candidate.rating === 'number') {
    // A lifetime star average is weak evidence about *current* quality: it is
    // dominated by years of older visits. Deliberately kept below what real
    // recent evidence can reach, so fresh reports outrank old reputation.
    const normalised = clamp01((candidate.rating - 1) / 4);
    return clamp01(0.5 + (normalised - 0.5) * 0.4);
  }
  return 0.55;
}

function localRelevance(candidate: PlaceCandidate, evidence?: PlaceEvidenceSummary): number {
  let score = candidate.categories.includes('local-character') ? 0.85 : 0.5;
  if (candidate.categories.includes('theme-park')) score -= 0.2;
  if (evidence) {
    const themes = evidence.positiveThemes.join(' ').toLowerCase();
    if (themes.includes('local')) score += 0.15;
    if (evidence.negativeThemes.join(' ').toLowerCase().includes('tourist trap')) score -= 0.3;
  }
  return clamp01(score);
}

/**
 * Whether the place can actually be used: known hours, reachable coordinates,
 * a visit length that fits a day, and a wait the traveller will tolerate.
 */
function practicality(
  candidate: PlaceCandidate,
  behaviour: TravelBehaviourProfile,
  evidence?: PlaceEvidenceSummary,
): number {
  let score = 0.5;
  if (candidate.coordinates) score += 0.2;
  if (candidate.openingHours) score += 0.15;
  if (candidate.reservationStatus === 'not-needed') score += 0.1;
  if (candidate.reservationStatus === 'required') score -= 0.05;

  // A place that eats most of the day is less practical for a short trip.
  const maxStops = behaviour.maxMainActivitiesPerDay ?? 3;
  if (candidate.estimatedVisitMinutes > 240 && maxStops > 2) score -= 0.15;

  const tolerance = behaviour.meals.maximumQueueMinutes ?? 40;
  if (evidence?.typicalQueueMinutes !== undefined) {
    score -= clamp01(evidence.typicalQueueMinutes / Math.max(1, tolerance) - 1) * 0.3;
  }
  if (evidence?.crowdRisk) {
    const crowdPenalty = behaviour.crowdTolerance === 'avoid'
      ? 0.35
      : behaviour.crowdTolerance === 'moderate'
        ? 0.18
        : 0.05;
    score -= evidence.crowdRisk * crowdPenalty;
  }
  return clamp01(score);
}

function neighbourhoodFit(candidate: PlaceCandidate, clusterSizes: Map<string, number>): number {
  const key = candidate.neighbourhood || candidate.city;
  const size = clusterSizes.get(key) || 1;
  // Places in a dense area are easier to combine into a coherent day.
  return clamp01(0.5 + (size - 1) * 0.12);
}

export interface ScoringInputs {
  profile: TripProfile;
  behaviour: TravelBehaviourProfile;
  /** Evidence summaries keyed by candidate id, where gathered. */
  evidence?: Record<string, PlaceEvidenceSummary>;
  /** Trend strength 0–1 keyed by candidate id, where computed. */
  trends?: Record<string, number>;
}

/**
 * Score one place across every dimension, then combine.
 *
 * Penalties are applied to the combined score rather than to a dimension, so
 * that a closure or a heavy promotion signal reduces the place outright instead
 * of being averaged away by unrelated strengths.
 */
export function scorePlace(
  candidate: PlaceCandidate,
  inputs: ScoringInputs,
  clusterSizes: Map<string, number> = new Map(),
  /** The finished population, when there is one. Comparative reasons need it. */
  shortlist?: ShortlistStats,
): ScoredPlace {
  const evidence = inputs.evidence?.[candidate.id];
  const dimensions: PlaceIntelligenceScore = {
    travellerFit: travellerFit(candidate, inputs.profile),
    destinationSignificance: destinationSignificance(candidate),
    currentQuality: currentQuality(candidate, evidence),
    trendStrength: clamp01(inputs.trends?.[candidate.id] ?? 0),
    localRelevance: localRelevance(candidate, evidence),
    practicality: practicality(candidate, inputs.behaviour, evidence),
    evidenceConfidence: evidence?.evidenceConfidence ?? (candidate.sourceReferences.length > 0 ? 0.5 : 0.2),
    promotionRisk: evidence?.promotionRisk ?? 0,
  };

  const weights = weightsFor(inputs.behaviour.recommendationMix);
  const weighted =
    dimensions.travellerFit * weights.travellerFit
    + dimensions.destinationSignificance * weights.destinationSignificance
    + dimensions.currentQuality * weights.currentQuality
    + dimensions.practicality * weights.practicality
    + neighbourhoodFit(candidate, clusterSizes) * weights.neighbourhoodFit
    + dimensions.trendStrength * weights.trendStrength
    + dimensions.localRelevance * weights.localRelevance
    + dimensions.evidenceConfidence * weights.evidenceConfidence;

  const cautions: string[] = [];

  // --- Penalties ----------------------------------------------------------
  // Promotion only bites above a threshold: some commercial signal is normal.
  const promotionPenalty = Math.max(0, dimensions.promotionRisk - 0.4) * 0.35;
  if (dimensions.promotionRisk >= 0.6) {
    cautions.push('Much of the praise for this place looks promotional.');
  }

  const closureReported = evidence?.warnings.some((warning) => warning.includes('closed')) ?? false;
  const closurePenalty = closureReported ? 0.5 : 0;
  if (closureReported) cautions.push('A source reports this place as closed. Check before you go.');

  if (evidence?.negativeThemes.some((theme) => /overrated|tourist trap/i.test(theme))) {
    cautions.push('Recent visitors describe this as overrated.');
  }
  if (!candidate.openingHours) cautions.push('Opening hours are unverified.');
  if (evidence?.typicalQueueMinutes !== undefined && evidence.typicalQueueMinutes >= 45) {
    cautions.push(`Visitors report waits of about ${evidence.typicalQueueMinutes} minutes.`);
  }
  if ((evidence?.crowdRisk ?? 0) >= 0.55) cautions.push('Recent evidence suggests this place can be crowded; the plan treats crowding as a real time cost.');

  const score = Math.round(100 * clamp01(weighted - promotionPenalty - closurePenalty));

  // --- Explanations --------------------------------------------------------
  // Built in `placeRationale`, which orders by what actually carried the score
  // and names the evidence behind it. This used to be a table of six fixed
  // sentences picked by threshold, so most of a thirty-place shortlist read
  // identically — the reason a traveller told us it felt hardcoded.
  const rationale = buildRationale({
    candidate,
    dimensions,
    weights,
    matchedStyles: matchedStyleTags(candidate, inputs.profile),
    evidence,
    shortlist,
  });

  return { candidate, score, dimensions, rationale, reasons: toReasons(rationale, evidence), cautions };
}

/** The flat string list the existing UI consumes, derived from the points. */
function toReasons(rationale: RationalePoint[], evidence?: PlaceEvidenceSummary): string[] {
  const reasons = rationale.map((point) => point.text);
  if (evidence && evidence.sourceCount > 0) {
    reasons.push(`Backed by ${evidence.sourceCount} ${evidence.sourceCount === 1 ? 'source' : 'sources'}`);
  }
  return reasons;
}

/**
 * Score and order a whole shortlist.
 *
 * Two passes, deliberately. Comparative reasons — "the most documented on your
 * Osaka list" — are only meaningful against the finished population, so every
 * card must be scored before any card is explained. Doing it per-card as they
 * were scored would let two cards compare themselves against different
 * denominators.
 */
export function scorePlaces(
  candidates: PlaceCandidate[],
  inputs: ScoringInputs,
  options: { cityLabel?: string } = {},
): ScoredPlace[] {
  const clusterSizes = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.neighbourhood || candidate.city;
    clusterSizes.set(key, (clusterSizes.get(key) || 0) + 1);
  }

  const scored = candidates.map((candidate) => scorePlace(candidate, inputs, clusterSizes));
  const shortlist = collectShortlistStats(scored, options.cityLabel ?? candidates[0]?.city);
  const weights = weightsFor(inputs.behaviour.recommendationMix);

  return scored
    .map((place) => {
      const rationale = buildRationale({
        candidate: place.candidate,
        dimensions: place.dimensions,
        weights,
        matchedStyles: matchedStyleTags(place.candidate, inputs.profile),
        evidence: inputs.evidence?.[place.candidate.id],
        shortlist,
      });
      return { ...place, rationale, reasons: toReasons(rationale, inputs.evidence?.[place.candidate.id]) };
    })
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

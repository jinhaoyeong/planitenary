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
  /** Plain-language reasons, strongest first, for the explanation panel. */
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

/** Travel styles → the category and tag vocabulary places are labelled with. */
const STYLE_TAGS: Record<string, string[]> = {
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

function travellerFit(candidate: PlaceCandidate, profile: TripProfile): number {
  const wanted = new Set(profile.styles.flatMap((style) => STYLE_TAGS[style] || [style]));
  if (wanted.size === 0) return 0.65;
  const tags = new Set([...candidate.categories, ...candidate.experienceTags]);
  const matches = [...wanted].filter((tag) => tags.has(tag)).length;
  return clamp01(0.3 + matches * 0.22);
}

function destinationSignificance(candidate: PlaceCandidate): number {
  if (candidate.categories.includes('essential')) return 1;
  // A place many people have rated is, empirically, a place people go to.
  const ratingWeight = candidate.reviewCount
    ? clamp01(Math.log10(candidate.reviewCount + 1) / 4.5)
    : 0;
  if (candidate.categories.includes('local-character')) return clamp01(0.75 + ratingWeight * 0.25);
  return clamp01(0.55 + ratingWeight * 0.4);
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

  // --- Explanations, strongest dimension first ----------------------------
  const reasons: string[] = [];
  const ranked: Array<[keyof PlaceIntelligenceScore, string]> = [
    ['travellerFit', 'Matches what you said you like'],
    ['destinationSignificance', 'Central to understanding this city'],
    ['currentQuality', 'Recent visitors rate the experience highly'],
    ['trendStrength', 'Getting a lot of attention right now'],
    ['localRelevance', 'Has genuine local character'],
    ['practicality', 'Straightforward to fit into a day'],
  ];
  for (const [key, label] of ranked.sort((a, b) => dimensions[b[0]] - dimensions[a[0]])) {
    if (dimensions[key] >= 0.7 && reasons.length < 3) reasons.push(label);
  }
  if (reasons.length === 0) reasons.push('Adds variety to your shortlist');
  if (evidence && evidence.sourceCount > 0) {
    reasons.push(`Backed by ${evidence.sourceCount} ${evidence.sourceCount === 1 ? 'source' : 'sources'}`);
  }

  return { candidate, score, dimensions, reasons, cautions };
}

/** Score and order a whole shortlist. */
export function scorePlaces(candidates: PlaceCandidate[], inputs: ScoringInputs): ScoredPlace[] {
  const clusterSizes = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidate.neighbourhood || candidate.city;
    clusterSizes.set(key, (clusterSizes.get(key) || 0) + 1);
  }
  return candidates
    .map((candidate) => scorePlace(candidate, inputs, clusterSizes))
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

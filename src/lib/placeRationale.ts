/**
 * Why *this* place, rather than why places in general.
 *
 * The panel used to answer "why does it rank here" from a table of six fixed
 * sentences — take whichever dimensions cleared 0.7, print the top three. A
 * traveller looking at thirty cards read "Matches what you said you like" on
 * most of them and correctly concluded the app was not really answering. The
 * complaint was not that the sentences were wrong; it was that they were the
 * same, and a reason shared by everything explains nothing.
 *
 * Four things make a point worth showing here:
 *
 * 1. **It names something.** Not "matches your interests" but "you said temples
 *    and history". The intersection was always computed and always discarded.
 * 2. **It reflects what actually carried the score.** The old ordering sorted
 *    on raw dimension value, so significance at 0.9 outranked traveller fit at
 *    0.8 even though fit is weighted half as heavily again and contributed
 *    more. Ordering by contribution puts the real reason first.
 * 3. **It distinguishes.** A dimension that is high for most of the shortlist
 *    carries no information about any one member of it, so it is dropped.
 * 4. **It does not overclaim.** Comparative copy is where superlatives creep
 *    in: "the only one open in the evening" must mean exactly one, ties must
 *    read as ties, and a five-place list has no meaningful percentiles at all.
 *
 * Everything here is deterministic and traceable to a field on the candidate.
 * `basis` records what each point came from, which is also what lets a model
 * layer rephrase these without being able to invent new ones.
 */

import type { PlaceCandidate } from './destinationIntelligence';
import type { PlaceIntelligenceScore } from './placeIntelligence';
import type { PlaceEvidenceSummary } from './travelEvidence';

export type RationaleKind =
  | 'style-match'
  | 'significance'
  | 'recent-quality'
  | 'trend'
  | 'local'
  | 'practical'
  | 'evidence';

export interface RationalePoint {
  /** Stable identity, so a rephrasing layer can select but never invent. */
  id: string;
  kind: RationaleKind;
  text: string;
  /** The field or comparison this is traceable to. */
  basis: string;
  /** True when the point is stated relative to the rest of the shortlist. */
  comparative: boolean;
}

/**
 * Below this many candidates, a percentile is not a fact about the shortlist,
 * it is an artefact of its size. Being "top 20%" of four places means being
 * first, which the score already says.
 */
const MIN_SHORTLIST_FOR_PERCENTILES = 8;

/** Below this, drop comparison entirely — there is nothing to compare against. */
const MIN_SHORTLIST_FOR_COMPARISON = 3;

/**
 * A dimension true of more than this share of the shortlist is not telling the
 * traveller anything about the card in front of them.
 */
const NON_DISCRIMINATING_SHARE = 0.7;

/** How strong a dimension must be before it is worth mentioning at all. */
const NOTABLE = 0.7;

/** Top-quintile membership is what earns comparative phrasing. */
const COMPARATIVE_PERCENTILE = 0.8;

export interface ShortlistStats {
  size: number;
  /** Every candidate's value for each dimension, in no particular order. */
  values: Partial<Record<keyof PlaceIntelligenceScore, number[]>>;
  /** How many places on the shortlist are open past 18:00. */
  openLateCount: number;
  /** How many are free to enter, where a source said so. */
  freeCount: number;
  /** For copy: "your Osaka list". */
  cityLabel?: string;
}

export interface RationaleInput {
  candidate: PlaceCandidate;
  dimensions: PlaceIntelligenceScore;
  /** The mix-adjusted weights the score was actually combined with. */
  weights: Partial<Record<keyof PlaceIntelligenceScore, number>>;
  /** The traveller's own style words this place satisfies. */
  matchedStyles: string[];
  evidence?: PlaceEvidenceSummary;
  shortlist?: ShortlistStats;
}

const listWords = (words: string[]): string => {
  const readable = words.map((word) => word.replace(/-/g, ' '));
  if (readable.length === 1) return readable[0];
  if (readable.length === 2) return `${readable[0]} and ${readable[1]}`;
  return `${readable.slice(0, -1).join(', ')} and ${readable[readable.length - 1]}`;
};

/**
 * Where `value` sits among `all`, as a share of the shortlist it is at least as
 * good as. Also reports how many share the exact value, because a three-way tie
 * for first must not be described as "the most".
 */
function standing(value: number, all: number[]): { percentile: number; ties: number; better: number } {
  const better = all.filter((entry) => entry > value).length;
  const ties = all.filter((entry) => entry === value).length;
  const atOrBelow = all.length - better;
  return { percentile: all.length === 0 ? 0 : atOrBelow / all.length, ties, better };
}

/** Whether a dimension says anything specific about this card. */
function discriminates(dimension: keyof PlaceIntelligenceScore, shortlist?: ShortlistStats): boolean {
  const all = shortlist?.values[dimension];
  if (!all || all.length < MIN_SHORTLIST_FOR_COMPARISON) return true;
  const share = all.filter((value) => value >= NOTABLE).length / all.length;
  return share <= NON_DISCRIMINATING_SHARE;
}

/**
 * "the most documented" when it is genuinely alone at the top, "among the most"
 * when it is not. Returns undefined when the shortlist is too small or the
 * place is not near the top, and the caller falls back to a plain statement.
 */
function comparativePhrase(
  dimension: keyof PlaceIntelligenceScore,
  value: number,
  superlative: string,
  shortlist?: ShortlistStats,
): string | undefined {
  const all = shortlist?.values[dimension];
  if (!all || all.length < MIN_SHORTLIST_FOR_PERCENTILES) return undefined;
  const { percentile, ties, better } = standing(value, all);
  if (percentile < COMPARATIVE_PERCENTILE) return undefined;
  const scope = shortlist?.cityLabel ? `your ${shortlist.cityLabel} list` : 'your list';
  if (better === 0 && ties === 1) return `The ${superlative} on ${scope}`;
  return `Among the ${superlative} on ${scope}`;
}

/** Whether the place has a window running past 18:00 on any day. */
export function opensLate(candidate: PlaceCandidate): boolean {
  return (candidate.openingHours?.periods || []).some((period) => (period.closesAt || '') > '18:00');
}

/**
 * Two or three points explaining this place's position, strongest first.
 *
 * Never empty: a place with nothing distinctive still gets an honest line
 * saying so, which is more useful than an empty section.
 */
export function buildRationale(input: RationaleInput): RationalePoint[] {
  const { candidate, dimensions, weights, matchedStyles, evidence, shortlist } = input;
  const points: RationalePoint[] = [];

  // --- Ordered by what actually carried the score ---------------------------
  // Not by raw dimension value. A 0.9 on a 0.16-weighted dimension contributed
  // less than a 0.8 on a 0.24-weighted one, and leading with the former
  // misdescribes the ranking it is supposed to explain.
  const ordered = (Object.keys(dimensions) as Array<keyof PlaceIntelligenceScore>)
    .filter((dimension) => dimension !== 'promotionRisk')
    .map((dimension) => ({ dimension, contribution: dimensions[dimension] * (weights[dimension] ?? 0) }))
    .sort((a, b) => b.contribution - a.contribution);

  for (const { dimension } of ordered) {
    if (points.length >= 3) break;
    const value = dimensions[dimension];
    if (value < NOTABLE) continue;
    if (!discriminates(dimension, shortlist)) continue;

    switch (dimension) {
      case 'travellerFit': {
        // The one point that is specific by construction: it quotes the
        // traveller's own words back at them.
        if (matchedStyles.length === 0) break;
        const named = matchedStyles.slice(0, 3);
        const tail = matchedStyles.length === 1
          ? 'that is exactly what this is'
          : matchedStyles.length > named.length
            ? 'this is tagged for those and more'
            : 'this is tagged for all of them';
        points.push({
          id: 'style-match',
          kind: 'style-match',
          text: `You asked for ${listWords(named)} — ${tail}`,
          basis: `styles: ${matchedStyles.join(', ')}`,
          comparative: false,
        });
        break;
      }

      case 'destinationSignificance': {
        const signals = candidate.notabilitySignals || [];
        const comparative = comparativePhrase('destinationSignificance', value, 'most documented', shortlist);
        if (signals.length > 0) {
          points.push({
            id: 'significance-signals',
            kind: 'significance',
            // "is a listed heritage site and has an encyclopedia entry" is a
            // fact its neighbours on the list may not share.
            text: `Well documented — it ${listWords(signals.slice(0, 2))}`,
            basis: `notabilitySignals: ${signals.join('; ')}`,
            comparative: false,
          });
        } else if (comparative) {
          points.push({
            id: 'significance-comparative',
            kind: 'significance',
            text: comparative,
            basis: `destinationSignificance percentile within ${shortlist?.size} candidates`,
            comparative: true,
          });
        } else if (candidate.categories.includes('essential')) {
          points.push({
            id: 'significance-essential',
            kind: 'significance',
            text: `Most visitors to ${candidate.city} see this one`,
            basis: 'category: essential',
            comparative: false,
          });
        }
        break;
      }

      case 'currentQuality': {
        const themes = evidence?.positiveThemes || [];
        if (themes.length === 0) break;
        points.push({
          id: 'recent-quality-themes',
          kind: 'recent-quality',
          // Quoting what visitors actually said beats asserting that they
          // rated it highly.
          text: `Recent visitors keep mentioning ${listWords(themes.slice(0, 2).map((theme) => theme.toLowerCase()))}`,
          basis: `positiveThemes from ${evidence?.sourceCount ?? 0} sources`,
          comparative: false,
        });
        break;
      }

      case 'trendStrength': {
        const comparative = comparativePhrase('trendStrength', value, 'most talked about right now', shortlist);
        if (!comparative) break;
        points.push({
          id: 'trend-comparative',
          kind: 'trend',
          text: comparative,
          basis: `trendStrength percentile within ${shortlist?.size} candidates`,
          comparative: true,
        });
        break;
      }

      case 'localRelevance': {
        if (!candidate.categories.includes('local-character')) break;
        points.push({
          id: 'local-character',
          kind: 'local',
          text: 'Somewhere locals actually use, not only a stop on the tourist route',
          basis: 'category: local-character',
          comparative: false,
        });
        break;
      }

      case 'practicality': {
        // Only worth saying when it is *unusually* practical. "Straightforward
        // to fit into a day" was true of nearly everything.
        if (!opensLate(candidate) || !shortlist) break;
        if (shortlist.size < MIN_SHORTLIST_FOR_COMPARISON) break;
        if (shortlist.openLateCount === 0) break;
        const scope = shortlist.cityLabel ? `your ${shortlist.cityLabel} list` : 'your list';
        points.push({
          id: 'practical-open-late',
          kind: 'practical',
          text: shortlist.openLateCount === 1
            ? `The only place on ${scope} still open in the evening`
            : `One of the few on ${scope} still open in the evening`,
          basis: `${shortlist.openLateCount} of ${shortlist.size} candidates open past 18:00`,
          comparative: true,
        });
        break;
      }

      default:
        break;
    }
  }

  // --- Fallbacks -----------------------------------------------------------
  if (points.length === 0) {
    points.push({
      id: 'variety',
      kind: 'evidence',
      text: candidate.neighbourhood
        ? `Nothing stands out on paper, but it groups well with the rest of ${candidate.neighbourhood}`
        : 'Nothing stands out on paper — it is here for variety',
      basis: 'no dimension cleared the notable threshold',
      comparative: false,
    });
  }

  return points.slice(0, 3);
}

/**
 * Gather the shortlist-wide numbers the comparative rules need.
 *
 * Done once per shortlist rather than per card: every comparison is against the
 * same population, and recomputing it thirty times would be thirty chances for
 * two cards to compare against different denominators.
 */
export function collectShortlistStats(
  entries: Array<{ candidate: PlaceCandidate; dimensions: PlaceIntelligenceScore }>,
  cityLabel?: string,
): ShortlistStats {
  const values: ShortlistStats['values'] = {};
  for (const entry of entries) {
    for (const key of Object.keys(entry.dimensions) as Array<keyof PlaceIntelligenceScore>) {
      (values[key] ||= []).push(entry.dimensions[key]);
    }
  }
  return {
    size: entries.length,
    values,
    openLateCount: entries.filter((entry) => opensLate(entry.candidate)).length,
    freeCount: entries.filter((entry) => entry.candidate.priceLevel === 0).length,
    cityLabel,
  };
}

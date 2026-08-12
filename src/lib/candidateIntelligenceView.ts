/**
 * Validated atoms, as a card can show them.
 *
 * The server decides what is *true*; this decides what is worth the space. On
 * a 390px deck the decision buttons have to stay dominant, so the main face
 * gets a fit label, at most three match chips and one short explanation —
 * anything further belongs behind Details. An honest card nobody can act on
 * because the buttons were pushed below a paragraph is not an improvement.
 *
 * Atom names never reach the screen. `style-match(local-neighbourhoods)` is an
 * internal identifier; the traveller reads "Local neighbourhoods".
 */

import type {
  Recommendation,
  ValidatedIntelligence,
} from '../../supabase/functions/_shared/candidateIntelligence';

/** Whether intelligence is available, and why not when it is not. */
export type IntelligenceStatus = 'ready' | 'deterministic-only' | 'unavailable';

export interface IntelligenceView {
  /** "Good fit for your trip". Absent when the model gave no recommendation. */
  fitLabel?: string;
  /** Short chips, capped for the main face. */
  matches: string[];
  /** Matches beyond the cap, for Details. */
  overflowMatches: string[];
  explanation: string[];
  cautions: string[];
  pairings: string[];
}

/**
 * How many match chips the main card face may carry.
 *
 * Three is a layout budget rather than a truth budget: a fourth chip wraps on
 * a 390px card and starts pushing the decision controls down, which is the one
 * thing this feature must not do.
 */
export const MAX_VISIBLE_MATCHES = 3;

const FIT_LABEL: Record<Recommendation, string> = {
  'must-do': 'Strong fit for your trip',
  interested: 'Good fit for your trip',
  optional: 'Optional for your trip',
  'weak-fit': 'Weaker match for your trip',
};

/** Sentence case, so "local-neighbourhoods" reads as "Local neighbourhoods". */
const humanise = (value: string): string => {
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * A short chip for an atom, or `undefined` where a chip would say nothing.
 *
 * Only the atoms that name something the traveller would recognise become
 * chips. `cluster-fit` and `low-detour` are real and useful, but "Same
 * planning area" as a bare chip is jargon — those stay in the explanation
 * where they have room to be a sentence.
 */
export function matchLabel(type: string, reference?: string): string | undefined {
  switch (type) {
    case 'style-match':
      return reference ? humanise(reference) : undefined;
    case 'pace-fit':
      return reference ? `${humanise(reference)} pace` : undefined;
    case 'budget-fit':
      return 'In budget';
    case 'short-stop':
      return 'Short stop';
    case 'indoor-option':
      return 'Indoor option';
    case 'portfolio-variety':
      return 'Adds variety';
    default:
      return undefined;
  }
}

/**
 * Assemble what the card shows.
 *
 * `explanation` deliberately excludes anything already said as a chip. A card
 * reading "Food · Relaxed pace" above "You asked for food, and this is tagged
 * for it. It fits the relaxed pace you set." spends four lines saying two
 * things, and the repetition reads as padding rather than as care.
 */
export function buildIntelligenceView(
  intelligence: ValidatedIntelligence,
  copy: string[],
  pairingNames: string[],
): IntelligenceView {
  const chips: string[] = [];
  const chipAtomTypes = new Set<string>();

  for (const reason of intelligence.reasons) {
    const label = matchLabel(reason.type, reason.references[0]);
    if (!label || chips.includes(label)) continue;
    chips.push(label);
    chipAtomTypes.add(reason.type);
  }

  /**
   * Sentences whose atom already became a chip are dropped. The renderer emits
   * one line per atom in order, so the reason lines and the chips are the same
   * information in two forms.
   */
  const explanation = copy.filter((line) => {
    // Pairings have their own secondary note below the rationale. The shared
    // renderer also returns the sentence for direct consumers, so remove it
    // here rather than making the card print the same advice twice.
    if (pairingNames.length > 0 && line.startsWith('Worth considering alongside ')) return false;
    const isChipRestated = intelligence.reasons.some((reason) => {
      if (!chipAtomTypes.has(reason.type)) return false;
      const label = matchLabel(reason.type, reason.references[0]);
      return Boolean(label) && lineIsAbout(line, reason.type, reason.references[0]);
    });
    return !isChipRestated;
  });

  return {
    fitLabel: intelligence.recommendation ? FIT_LABEL[intelligence.recommendation] : undefined,
    matches: chips.slice(0, MAX_VISIBLE_MATCHES),
    overflowMatches: chips.slice(MAX_VISIBLE_MATCHES),
    explanation,
    cautions: [],
    pairings: pairingNames,
  };
}

/**
 * Whether a rendered line is the sentence form of a given atom.
 *
 * Matched on the atom's own reference rather than on phrasing, so rewording
 * the renderer cannot silently stop the de-duplication working — the copy is
 * expected to change and this must not be coupled to it.
 */
function lineIsAbout(line: string, type: string, reference?: string): boolean {
  const lower = line.toLowerCase();
  if (reference) {
    const rawReference = reference.toLowerCase();
    const normalisedLine = lower.replace(/[-_]+/g, ' ');
    const normalisedReference = rawReference.replace(/[-_]+/g, ' ');
    if (lower.includes(rawReference) || normalisedLine.includes(normalisedReference)) return true;
  }
  if (type === 'short-stop') return lower.includes('shorter stop');
  if (type === 'indoor-option') return lower.includes('indoor option');
  if (type === 'budget-fit') return lower.includes('inside your budget');
  if (type === 'portfolio-variety') return lower.includes('currently short of');
  return false;
}

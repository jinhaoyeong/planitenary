/**
 * Why a place suits *this* traveller.
 *
 * `place-brief` answers "what is this place", and every sentence it produces
 * must be a literal quotation from a retrieved page. That rule cannot work
 * here, because the claim being made is of a different kind: no webpage
 * anywhere says "this fits your relaxed pace and sits in your Ebisu cluster".
 * It is not a fact about the world at all — it is a statement about the
 * traveller's own inputs and about numbers this application computed.
 *
 * So the grounding moves rather than disappearing. Instead of quoting a
 * source, every claim must cite **a fact Planitenary already owns**, and the
 * check is the same in spirit: mechanical, not a request in a prompt.
 *
 * The structural decision that makes it work is that **the model never writes
 * the sentence**. It selects from a closed set of reason atoms, each carrying
 * references that are verified against the snapshot it was given; the
 * application renders the prose afterwards. A model that cannot emit free text
 * cannot emit an unsupported claim — the failure is impossible rather than
 * detectable. Asking for a paragraph and proving it safe afterwards is the
 * approach this deliberately rejects, because proving a sentence has no
 * unsupported implication is not something any validator can do.
 *
 * No Deno APIs and no runtime imports, so vitest exercises every rule here.
 */

/** Facts about the trip the model may reason from. Nothing else is sent. */
export interface IntelligenceTripContext {
  profileRevision: string;
  /** Exactly what the traveller selected. Never an expanded or fuzzy set. */
  interests: string[];
  styles: string[];
  pace: string;
  budgetTier?: string;
}

/**
 * Facts about one candidate the model may reason from.
 *
 * Deliberately narrow. A field absent here is a claim the model cannot make,
 * which is a stronger guarantee than a field present and later refused —
 * it cannot cite what it was never shown.
 */
export interface IntelligenceCandidate {
  candidateId: string;
  candidateRevision: string;
  name: string;
  category: string;
  area?: string;
  /** The planner's own cluster. Two places pair only if these agree. */
  clusterId?: string;
  /**
   * Tags already promoted to exact matches by `matchedStyleTags`.
   *
   * The fuzzy expansion that lets a shrine score for a history-minded
   * traveller stays inside the number and never reaches this list. Saying "you
   * asked for temples" about a history museum is a false claim about the
   * traveller's own input, and this project has already shipped that bug once.
   */
  matchedStyleTags: string[];
  matchedInterestTags: string[];
  /** Evidence-backed or deterministic. Absent means no duration may be given. */
  durationRangeMinutes?: [number, number];
  indoorOutdoor?: 'indoor' | 'outdoor' | 'both';
  /** Computed travel time. Absent forbids any detour claim. */
  travelMinutesFromCluster?: number;
  /** Candidates the planner considers genuinely pairable with this one. */
  pairableCandidateIds: string[];
  /**
   * Categories the current shortlist is deterministically short of.
   *
   * Absent means the composition was never computed, which forbids a variety
   * claim outright rather than letting it pass unchecked.
   */
  underrepresentedCategories?: string[];
}

export const REASON_ATOM_TYPES = [
  'interest-match', 'style-match', 'pace-fit', 'budget-fit', 'cluster-fit',
  'low-detour', 'short-stop', 'indoor-option', 'portfolio-variety',
  'weak-profile-match',
] as const;

export const CAUTION_ATOM_TYPES = [
  'weak-interest-match', 'detour', 'high-walking', 'duration-pressure',
  'portfolio-duplication', 'budget-mismatch',
] as const;

export type ReasonAtomType = typeof REASON_ATOM_TYPES[number];
export type CautionAtomType = typeof CAUTION_ATOM_TYPES[number];

export interface Atom {
  type: string;
  /** What the atom rests on: an interest, a style, a candidate id, a cluster. */
  references: string[];
}

export const RECOMMENDATIONS = ['must-do', 'interested', 'optional', 'weak-fit'] as const;
export type Recommendation = typeof RECOMMENDATIONS[number];

/** One candidate's validated intelligence. Every field survived a check. */
export interface ValidatedIntelligence {
  candidateId: string;
  /** Advisory. The deterministic ranking is untouched and remains the truth. */
  personalFitScore: number | null;
  recommendation: Recommendation | null;
  reasons: Array<{ type: ReasonAtomType; references: string[] }>;
  cautions: Array<{ type: CautionAtomType; references: string[] }>;
  pairWithCandidateIds: string[];
  suggestedDurationMinutes: number | null;
}

export type AtomRejection =
  | 'unknown-atom-type'
  | 'interest-not-selected'
  | 'style-not-selected'
  | 'style-not-matched'
  | 'pace-mismatch'
  | 'not-same-cluster'
  | 'unknown-candidate-reference'
  | 'no-computed-travel'
  | 'no-known-duration'
  | 'indoor-unknown'
  | 'unsupported-weak-claim'
  /** The fact is known and says the opposite of what the atom claims. */
  | 'budget-policy-unavailable'
  /**
   * The app owns no deterministic definition of the band this atom asserts.
   * A number existing is not a threshold.
   */
  | 'detour-policy-unavailable'
  | 'duration-policy-unavailable'
  /** No walking-specific metric exists; generic travel time cannot stand in. */
  | 'walking-metric-unavailable'
  /** Shared geography is not shared substance. */
  | 'duplication-metric-unavailable'
  | 'composition-unknown'
  | 'category-not-underrepresented'
  | 'missing-reference';

export interface IntelligenceValidation {
  byCandidate: Map<string, ValidatedIntelligence | null>;
  rejections: Array<{ candidateId: string; reason: string }>;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * Whether one atom is supported by the facts the model was given.
 *
 * Returns `undefined` when the atom stands, or the reason it does not. Each
 * rule names the specific app-owned fact the claim rests on; there is no
 * generic "looks plausible" path, and an atom whose supporting field is
 * *unknown* always fails rather than defaulting to true. Unknown is not a
 * quiet yes — the same rule the rest of this codebase keeps.
 */
export function atomRejection(
  atom: Atom,
  trip: IntelligenceTripContext,
  candidate: IntelligenceCandidate,
  pool: Map<string, IntelligenceCandidate>,
): AtomRejection | undefined {
  const reference = atom.references[0];
  const needsReference = () => (reference ? undefined : 'missing-reference' as const);

  switch (atom.type) {
    case 'interest-match':
      return needsReference()
        // The traveller's literal selection, not an expansion of it.
        || (trip.interests.includes(reference) ? undefined : 'interest-not-selected');

    case 'style-match': {
      const missing = needsReference();
      if (missing) return missing;
      if (!trip.styles.includes(reference)) return 'style-not-selected';
      // Selected *and* genuinely matched by this candidate. A style the
      // traveller chose says nothing about a place that does not carry it.
      return candidate.matchedStyleTags.includes(reference) ? undefined : 'style-not-matched';
    }

    case 'weak-interest-match':
    case 'weak-profile-match':
      /**
       * An honest weak match still has to be true. The claim is only supported
       * when the candidate really does match none of the traveller's stated
       * interests — otherwise it is a different kind of false statement about
       * their input, and an unearned apology reads as badly as unearned praise.
       */
      return candidate.matchedInterestTags.length === 0 ? undefined : 'unsupported-weak-claim';

    case 'pace-fit':
      return needsReference() || (reference === trip.pace ? undefined : 'pace-mismatch');

    /**
     * Opposing atoms get separate arms, even where their preconditions match.
     *
     * They previously shared one, which checked that `budgetFits` was *known*
     * and never what it said — so a place the app knew to be over budget could
     * carry a `budget-fit` atom and render "its published price sits inside
     * your budget". The precondition genuinely is shared; the verdict never
     * was, and grouping them is what hid that for both directions at once.
     */
    /**
     * Fail closed: the two sides of this claim are not comparable yet.
     *
     * `budgetFits` was a precomputed boolean supplied by the caller, which
     * made a fact about the *traveller's budget* look like a fact about the
     * *place* — so changing only the budget would have made the place appear
     * to change. Removing it exposed that nothing else can answer the question.
     *
     * The traveller picks `budget | mid-range | luxury`; a place carries a
     * numeric `priceLevel` that is absent for most OSM results. The one
     * existing comparator, `budgetFit` in `destinationPlanner.ts`, returns a
     * 0–1 ranking score on a gradient with no point at which it says
     * "exceeds", and scores unknown prices at a neutral 0.75.
     *
     * That is correct for a ranking and wrong for a sentence. Promoting it
     * would repeat the `STYLE_TAGS` mistake this project already shipped once:
     * fuzzy is fine inside a number, and not fine said out loud. Re-enable
     * when an explicit affordability policy exists — a product decision, not
     * a type conversion.
     */
    case 'budget-fit':
    case 'budget-mismatch':
      return 'budget-policy-unavailable';

    case 'cluster-fit': {
      const missing = needsReference();
      if (missing) return missing;
      const other = pool.get(reference);
      if (!other) return 'unknown-candidate-reference';
      // Geography the planner computed, never inferred from place names.
      if (!candidate.clusterId || candidate.clusterId !== other.clusterId) return 'not-same-cluster';
      return undefined;
    }

    /**
     * Fails closed: shared geography is not shared substance.
     *
     * This shared an arm with `cluster-fit`, so being in one cluster was taken
     * as proof of covering similar ground. A shrine and a ramen counter in the
     * same neighbourhood are one cluster and nothing alike — telling a
     * traveller they duplicate each other is a claim about *content* resting
     * on a fact about *place*. Re-enable when the planner owns a similarity
     * verdict; until then there is no fact here to check.
     */
    case 'portfolio-duplication':
      return 'duplication-metric-unavailable';

    /**
     * Fail closed: a computed travel time is not a threshold.
     *
     * These three shared one arm that asked only whether a number existed, so
     * any journey at all satisfied both "adds little travel" and "is out of
     * the way" simultaneously. The app defines no deterministic band for
     * either, and borrowing a nearby number — `PACE_DEFAULTS` holds a daily
     * walking ceiling — would swap an unsupported claim for a more plausible
     * one, which is worse because it survives review.
     */
    case 'low-detour':
    case 'detour':
      return 'detour-policy-unavailable';

    /**
     * Fail closed for a stronger reason than the two above: the wrong *fact*,
     * not merely a missing threshold. `travelMinutesFromCluster` is generic
     * travel time, so it cannot establish a walking claim at any threshold.
     * This needs a walking-specific planner metric before it can mean anything.
     */
    case 'high-walking':
      return 'walking-metric-unavailable';

    /**
     * Fail closed: a known duration is not a verdict about it. These shared an
     * arm, so any range proved both "works as a shorter stop" and "not a quick
     * look". Whether 45–90 minutes is short depends on the day it sits in,
     * which is the scheduler's judgement and not this module's to invent.
     */
    case 'short-stop':
    case 'duration-pressure':
      return 'duration-policy-unavailable';

    case 'indoor-option':
      /**
       * Unknown and outdoor fail together, and that is deliberate rather than
       * lazy: "we never recorded whether this is indoors" and "this is
       * outdoors" are different facts, but neither supports offering the place
       * as shelter. A rainy-day suggestion resting on a guess is exactly the
       * confident wrong answer this project treats as worse than a gap.
       */
      return candidate.indoorOutdoor === 'indoor' || candidate.indoorOutdoor === 'both'
        ? undefined
        : 'indoor-unknown';

    case 'portfolio-variety':
      /**
       * Fails closed until the composition data actually exists.
       *
       * The reasoning that made this look admissible — composition is our own
       * arithmetic, so a claim about it is app-owned — is true and beside the
       * point: nothing currently *supplies* that arithmetic, so the atom had no
       * support to check and passed unconditionally. An atom that always passes
       * is not a validated atom, it is an unvalidated one with a rule-shaped
       * comment above it, and it was measurably weaker than the nine beside it.
       *
       * When `underrepresentedCategories` is supplied it becomes checkable:
       * this candidate's category must be one the shortlist is genuinely short
       * of.
       */
      if (!candidate.underrepresentedCategories) return 'composition-unknown';
      return candidate.underrepresentedCategories.includes(candidate.category)
        ? undefined
        : 'category-not-underrepresented';

    default:
      return 'unknown-atom-type';
  }
}

/**
 * Validate one batch of candidate intelligence.
 *
 * Two properties carried over from the batched brief, for the same reasons:
 * identity is keyed rather than positional, and one bad entry costs only
 * itself. A third is specific to this operation — **one bad atom costs only
 * itself too**. A candidate whose interest match is sound and whose queue
 * claim is invented keeps the interest match; discarding both would push the
 * card back to generic copy over a single reparable error.
 */
export function validateCandidateIntelligence(
  raw: unknown,
  request: {
    trip: IntelligenceTripContext;
    candidates: IntelligenceCandidate[];
  },
): IntelligenceValidation {
  const byCandidate = new Map<string, ValidatedIntelligence | null>();
  const rejections: IntelligenceValidation['rejections'] = [];
  const pool = new Map(request.candidates.map((candidate) => [candidate.candidateId, candidate]));

  const entries = (raw as { candidates?: unknown })?.candidates;
  const list: Array<[string, Record<string, unknown>]> =
    entries && typeof entries === 'object' && !Array.isArray(entries)
      ? Object.entries(entries as Record<string, unknown>).map(([id, value]) => [id, (value || {}) as Record<string, unknown>])
      : [];

  for (const [candidateId, entry] of list) {
    const candidate = pool.get(candidateId);
    if (!candidate) { rejections.push({ candidateId, reason: 'unknown-candidate' }); continue; }

    // Revisions are what make a cached answer safe to reuse. An answer about
    // other inputs than the ones it will be filed under is stale on arrival.
    if (entry.profileRevision !== request.trip.profileRevision) {
      rejections.push({ candidateId, reason: 'stale-profile-revision' });
      byCandidate.set(candidateId, null);
      continue;
    }
    if (entry.candidateRevision !== candidate.candidateRevision) {
      rejections.push({ candidateId, reason: 'stale-candidate-revision' });
      byCandidate.set(candidateId, null);
      continue;
    }

    const keep = <T extends string>(
      atoms: unknown,
      allowed: readonly T[],
    ): Array<{ type: T; references: string[] }> => {
      const out: Array<{ type: T; references: string[] }> = [];
      for (const item of Array.isArray(atoms) ? atoms : []) {
        const shape = item as { type?: unknown; references?: unknown } | null;
        const type = typeof shape?.type === 'string' ? shape.type : '';
        const references = asStringArray(shape?.references);
        if (!(allowed as readonly string[]).includes(type)) {
          rejections.push({ candidateId, reason: 'unknown-atom-type' });
          continue;
        }
        const refusal = atomRejection({ type, references }, request.trip, candidate, pool);
        if (refusal) { rejections.push({ candidateId, reason: refusal }); continue; }
        out.push({ type: type as T, references });
      }
      return out;
    };

    const reasons = keep(entry.reasonAtoms, REASON_ATOM_TYPES);
    const cautions = keep(entry.cautionAtoms, CAUTION_ATOM_TYPES);

    /**
     * Pairings are dropped individually. Losing one bad suggestion beats
     * losing three good ones, the same rule a malformed fare follows.
     */
    const pairWithCandidateIds = asStringArray(entry.pairWithCandidateIds).filter((id) => {
      if (id === candidateId) return false;
      if (!pool.has(id)) { rejections.push({ candidateId, reason: 'unknown-candidate-reference' }); return false; }
      // Pairing is the planner's judgement, not the model's.
      if (!candidate.pairableCandidateIds.includes(id)) {
        rejections.push({ candidateId, reason: 'pairing-not-supported' });
        return false;
      }
      return true;
    });

    /**
     * A duration may be *selected from* what is known, never invented. With no
     * range at all there is nothing to select from, so the field is dropped —
     * a plausible number with nothing behind it is what this whole layer
     * exists to prevent.
     */
    let suggestedDurationMinutes: number | null = null;
    const proposed = typeof entry.suggestedDurationMinutes === 'number' ? entry.suggestedDurationMinutes : null;
    if (proposed !== null) {
      const range = candidate.durationRangeMinutes;
      if (!range) rejections.push({ candidateId, reason: 'no-known-duration' });
      else if (proposed < range[0] || proposed > range[1]) rejections.push({ candidateId, reason: 'duration-out-of-range' });
      else suggestedDurationMinutes = proposed;
    }

    const score = typeof entry.personalFitScore === 'number' ? Math.round(entry.personalFitScore) : null;
    const recommendation = typeof entry.recommendation === 'string'
      && (RECOMMENDATIONS as readonly string[]).includes(entry.recommendation)
      ? entry.recommendation as Recommendation
      : null;

    // Everything rejected is the same outcome as no answer: the card keeps its
    // deterministic rationale rather than showing a half-supported one.
    if (reasons.length === 0 && cautions.length === 0) {
      byCandidate.set(candidateId, null);
      continue;
    }

    byCandidate.set(candidateId, {
      candidateId,
      personalFitScore: score !== null && score >= 0 && score <= 100 ? score : null,
      recommendation,
      reasons,
      cautions,
      pairWithCandidateIds,
      suggestedDurationMinutes,
    });
  }

  // Asked about and unanswered is a real answer, cached like the brief's null.
  for (const candidate of request.candidates) {
    if (!byCandidate.has(candidate.candidateId)) byCandidate.set(candidate.candidateId, null);
  }

  return { byCandidate, rejections };
}

/**
 * Turn validated atoms into the sentence a traveller reads.
 *
 * The application owns these words, which is the point: the model chose *which*
 * true things to say and in what order, and none of the phrasing came from it.
 * A claim that is not in the atom list therefore cannot appear in the copy, no
 * matter what the model wrote.
 *
 * **Every sentence is capped at exactly what its atom proves**, and that rule
 * had to be learned rather than assumed. The first version of this function
 * rendered `cluster-fit` as *"sits in the same part of the city as X, so it
 * does not need a separate journey"* — and the second half of that sentence is
 * a travel claim. `cluster-fit` establishes shared planning geography and
 * nothing more; whether reaching it costs extra travel is what `low-detour`
 * exists to say, backed by a computed route value. The validator was correct
 * and the renderer silently upgraded a weak atom into a stronger claim, which
 * is precisely the failure this whole layer is built to prevent, reintroduced
 * one layer further down.
 *
 * So the ceilings are explicit, per atom:
 *
 * - `cluster-fit`      → same planning area. Never "easy to combine", never
 *                        "little extra travel", never "no separate journey".
 * - `low-detour`       → additional travel, quoting the computed number.
 * - `short-stop`       → a shorter visit, quoting the known range.
 * - `pace-fit`         → compatible with the chosen pace. No schedule outcome.
 * - `budget-fit`       → price sits inside the budget. Nothing about value.
 * - `indoor-option`    → it is indoors. Never "good for rain", which asserts
 *                        weather this layer was never given.
 * - `interest-match`   → the traveller asked for this tag and it carries it.
 *
 * Tested against the *rendered prose*, not only against atom acceptance —
 * because this bug lived entirely downstream of a validator that was working.
 */
export function renderIntelligenceCopy(
  intelligence: ValidatedIntelligence,
  candidate: IntelligenceCandidate,
  pool: Map<string, IntelligenceCandidate>,
): string[] {
  const named = (ids: string[]) => ids.map((id) => pool.get(id)?.name).filter(Boolean) as string[];
  const lines: string[] = [];

  for (const reason of intelligence.reasons) {
    const reference = reason.references[0];
    switch (reason.type) {
      case 'interest-match':
        lines.push(`You asked for ${reference}, and this is tagged for it.`);
        break;
      case 'style-match':
        lines.push(`It matches the ${reference} you chose for this trip.`);
        break;
      case 'pace-fit':
        // Compatibility with the chosen pace. No consequence for the schedule,
        // which only the scheduler can establish.
        lines.push(`It fits the ${reference} pace you set.`);
        break;
      case 'budget-fit':
        // Where the price sits. Nothing about whether it is worth paying.
        lines.push('Its published price sits inside your budget.');
        break;
      case 'cluster-fit': {
        const [other] = named([reference]);
        // Shared planning area, and nothing further. Any claim about the
        // travel that implies belongs to `low-detour`.
        if (other) lines.push(`It sits in the same planning area as ${other}.`);
        break;
      }
      case 'low-detour':
        lines.push(`Reaching it adds about ${candidate.travelMinutesFromCluster} minutes of travel.`);
        break;
      case 'short-stop':
        lines.push(`It works as a shorter stop — around ${candidate.durationRangeMinutes?.[0]}–${candidate.durationRangeMinutes?.[1]} minutes.`);
        break;
      case 'indoor-option':
        // That it is indoors. Not that it suits weather nobody forecast here.
        lines.push('It is an indoor option.');
        break;
      case 'portfolio-variety':
        lines.push('It adds a kind of place your list is currently short of.');
        break;
      case 'weak-profile-match':
        /**
         * The honest version of the line this feature exists to replace.
         * "Nothing stands out on paper" told the traveller nothing they could
         * act on; naming *why* it is weak and why it was kept anyway does.
         */
        lines.push('A weaker match for the interests you selected.');
        break;
    }
  }

  for (const caution of intelligence.cautions) {
    switch (caution.type) {
      case 'weak-interest-match':
        lines.push('It does not match the interests you named, so treat it as optional.');
        break;
      case 'detour':
        lines.push(`It is out of the way — about ${candidate.travelMinutesFromCluster} minutes of travel to reach.`);
        break;
      case 'high-walking':
        lines.push('Fitting it in adds noticeably to a day of walking.');
        break;
      case 'duration-pressure':
        lines.push(`Allow ${candidate.durationRangeMinutes?.[0]}–${candidate.durationRangeMinutes?.[1]} minutes; it is not a quick look.`);
        break;
      case 'portfolio-duplication': {
        const [other] = named([caution.references[0]]);
        if (other) lines.push(`It covers similar ground to ${other}, already on your list.`);
        break;
      }
      case 'budget-mismatch':
        lines.push('Its published price sits above the budget you set.');
        break;
    }
  }

  /**
   * Pairing rests on the planner's own `pairableCandidateIds`, so the sentence
   * may name the places — but it may not claim the combination is convenient
   * unless a computed travel figure was also validated. "Worth seeing on the
   * same outing" is a planning suggestion; "adds little travel" is a measured
   * fact, and only `low-detour` carries one.
   */
  const pairs = named(intelligence.pairWithCandidateIds);
  if (pairs.length > 0) lines.push(`Worth considering alongside ${pairs.join(' and ')}.`);

  return lines;
}

/** How many candidates one request may carry. */
export const MAX_INTELLIGENCE_BATCH = 15;

/**
 * ---------------------------------------------------------------------------
 * Batching, caching and the metered request
 * ---------------------------------------------------------------------------
 */

/** Bumped when the atom set, a validation rule or the rendered copy changes. */
/**
 * Bumped whenever the material the model sees changes.
 *
 * v2 removed `deterministicScore`, `costKnown` and `budgetFits` from the
 * candidate contract. Any answer produced under v1 was derived from different
 * inputs, so it must not be served as current — the version is part of the
 * cache key precisely so that cannot happen.
 */
export const INTELLIGENCE_SCHEMA_VERSION = 'v2';

/**
 * The key a candidate's intelligence is filed under.
 *
 * Every input that could change the answer appears here, because correctness
 * is governed by the material facts rather than by the clock: this answer stops
 * being right when the traveller's profile changes, when the candidate's own
 * data changes, when the planner recomputes its context, or when we change the
 * rules or the words. It does not stop being right because a week passed.
 *
 * `INTELLIGENCE_SCHEMA_VERSION` is part of the key rather than merely stored
 * beside it, for the reason `VALIDATOR_VERSION` is: a rule change must
 * invalidate the answers that rule produced, including the wrongly-empty ones,
 * or a fix cannot reach anybody until the TTL happens to lapse.
 */
export function intelligenceCacheKey(input: {
  candidateId: string;
  candidateRevision: string;
  profileRevision: string;
  plannerContextRevision?: string;
  model: string;
}): string {
  return [
    INTELLIGENCE_SCHEMA_VERSION,
    input.model,
    input.candidateId,
    input.candidateRevision,
    input.profileRevision,
    input.plannerContextRevision || 'no-context',
  ].join('|');
}

/**
 * Why a candidate has no intelligence — and crucially, whether that is an
 * answer worth remembering.
 *
 * The distinction this type exists to make impossible to fumble: **"the model
 * ran and nothing it said survived" is knowledge; "the model never ran" is
 * not.** Caching the second as though it were the first would let one budget
 * ceiling or one provider timeout permanently mark a card as having no useful
 * personalisation, and it would look identical to a genuine empty answer
 * forever after. So cacheability is carried in the type rather than decided by
 * a caller reading a comment.
 */
export type IntelligenceOutcome =
  /** The model answered. `intelligence` may be null: asked, nothing survived. */
  | { kind: 'answered'; intelligence: ValidatedIntelligence | null; cacheable: true }
  /** Never asked, or asked and it failed. Nothing is learned, nothing stored. */
  | { kind: 'not-run'; reason: string; cacheable: false };

/**
 * Split candidates into batches that fit the request bound.
 *
 * Bounded by *serialised size* as well as by count, because that is what maps
 * to tokens and therefore to money — ten candidates carrying long tag lists is
 * a different request from ten carrying short ones, and a count alone cannot
 * tell them apart. The count ceiling still applies, since a batch is also a
 * blast radius: everything in one is lost together if the reply is truncated.
 *
 * A single candidate too large to fit alone is still emitted in a batch of its
 * own rather than silently dropped — refusing it here would make a place
 * permanently invisible to the feature with nothing recording why.
 */
export function buildIntelligenceBatches(
  candidates: IntelligenceCandidate[],
  maxSerialisedChars: number,
  maxPerBatch = MAX_INTELLIGENCE_BATCH,
): IntelligenceCandidate[][] {
  const batches: IntelligenceCandidate[][] = [];
  let current: IntelligenceCandidate[] = [];
  let currentChars = 0;

  for (const candidate of candidates) {
    const size = JSON.stringify(candidate).length;
    const wouldOverflow = current.length > 0
      && (current.length >= maxPerBatch || currentChars + size > maxSerialisedChars);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(candidate);
    currentChars += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * The prompt. Asks for atoms, and cannot ask for prose.
 *
 * There is no field in the schema for a sentence, which is the point: the
 * model's whole job is choosing which true things are worth saying and in what
 * order. `renderIntelligenceCopy` writes the words afterwards, so no phrasing
 * the model produced can reach a traveller even if it emits some anyway.
 */
export const INTELLIGENCE_INSTRUCTION = [
  'For each candidate, choose the reason and caution atoms that a traveller with this',
  'profile would genuinely find useful, ordered by how much they distinguish this place.',
  'Return ONLY atoms from the supplied types. Do not write sentences or descriptions.',
  'Every atom must reference a fact present in the candidate or trip snapshot:',
  'an interest or style the traveller literally selected, a cluster the planner computed,',
  'a duration or travel figure supplied. Omit any atom you cannot support that way.',
  'Never state opening hours, prices, queues, crowds, weather, ratings or best times —',
  'there is no atom for them and they will be discarded.',
  'Echo candidateId, profileRevision and candidateRevision exactly as supplied.',
  'Return {"candidates": {"<candidateId>": {"profileRevision", "candidateRevision",',
  '"personalFitScore", "recommendation", "reasonAtoms", "cautionAtoms",',
  '"pairWithCandidateIds", "suggestedDurationMinutes"}}}.',
].join(' ');

/** The snapshot one candidate contributes. Nothing outside this is sent. */
export const intelligenceSnapshot = (candidate: IntelligenceCandidate) => ({
  candidateId: candidate.candidateId,
  candidateRevision: candidate.candidateRevision,
  name: candidate.name,
  category: candidate.category,
  area: candidate.area,
  clusterId: candidate.clusterId,
  matchedStyleTags: candidate.matchedStyleTags,
  matchedInterestTags: candidate.matchedInterestTags,
  durationRangeMinutes: candidate.durationRangeMinutes,
  indoorOutdoor: candidate.indoorOutdoor,
  travelMinutesFromCluster: candidate.travelMinutesFromCluster,
  pairableCandidateIds: candidate.pairableCandidateIds,
  underrepresentedCategories: candidate.underrepresentedCategories,
});

/** The exact payload sent for one batch. Exported so a test can measure it. */
export const intelligenceRequestBody = (
  trip: IntelligenceTripContext,
  candidates: IntelligenceCandidate[],
) => ({
  instruction: INTELLIGENCE_INSTRUCTION,
  reasonAtomTypes: REASON_ATOM_TYPES,
  cautionAtomTypes: CAUTION_ATOM_TYPES,
  trip,
  candidates: candidates.map(intelligenceSnapshot),
});

/**
 * Ask for one batch, and turn the reply into per-candidate outcomes.
 *
 * `callMetered` is injected and is the *only* way this function can reach a
 * provider — there is deliberately no fetch here and no model client imported.
 * A feature that could call OpenAI directly would inherit none of the model
 * allowlist, the input and output ceilings, the daily quota, the spend guard or
 * the ledger, and it would work perfectly while doing so.
 *
 * Every refusal and every failure produces `not-run` outcomes, never a cached
 * null. A budget ceiling reached today must not permanently mark these cards as
 * having no personalisation available.
 */
export async function requestCandidateIntelligence(
  trip: IntelligenceTripContext,
  candidates: IntelligenceCandidate[],
  callMetered: (payload: unknown) => Promise<
    { ok: true; result: unknown } | { ok: false; refusal: string }
  >,
): Promise<Map<string, IntelligenceOutcome>> {
  const outcomes = new Map<string, IntelligenceOutcome>();
  if (candidates.length === 0) return outcomes;

  const answer = await callMetered(intelligenceRequestBody(trip, candidates));

  if (!answer.ok) {
    // Never asked. Nothing is learned, so nothing may be remembered.
    for (const candidate of candidates) {
      outcomes.set(candidate.candidateId, {
        kind: 'not-run', reason: answer.refusal, cacheable: false,
      });
    }
    return outcomes;
  }

  const { byCandidate } = validateCandidateIntelligence(answer.result, { trip, candidates });
  for (const candidate of candidates) {
    const intelligence = byCandidate.get(candidate.candidateId) ?? null;
    /**
     * Answered — including when the answer is null, which is a real finding:
     * the model was asked about exactly these facts and produced nothing that
     * survived. Storing it is what stops the same place being paid for again
     * tomorrow to learn the same thing.
     */
    outcomes.set(candidate.candidateId, { kind: 'answered', intelligence, cacheable: true });
  }
  return outcomes;
}

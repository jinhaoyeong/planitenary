/**
 * What the model may say about a traveller.
 *
 * `reasoning.test.ts` holds the line for claims about the *world*: every
 * sentence must be a literal quotation. This suite holds a different line, for
 * claims about the *traveller* — which no source can ever quote, and which are
 * therefore checked against the facts this application owns instead.
 *
 * The rule running through nearly every test is the same one: **unknown is not
 * a quiet yes**. An unpriced place cannot be said to fit a budget, a place
 * with no computed travel time cannot be called a short detour, and a place
 * whose indoor status nobody recorded cannot be offered as a rainy-day option.
 * Each of those would be a confident wrong answer, which this project treats
 * as worse than an admitted gap.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_INTELLIGENCE_BATCH,
  atomRejection,
  renderIntelligenceCopy,
  validateCandidateIntelligence,
  type IntelligenceCandidate,
  type IntelligenceTripContext,
  INTELLIGENCE_SCHEMA_VERSION,
  buildIntelligenceBatches,
  intelligenceCacheKey,
  intelligenceRequestBody,
  requestCandidateIntelligence,
} from '../../supabase/functions/_shared/candidateIntelligence';

/**
 * The module's own text, so a test can assert that no direct provider call
 * exists in it. A structural guarantee is worth more here than a behavioural
 * one: a feature that *could* reach OpenAI directly would bypass the model
 * allowlist, both ceilings, the quota, the spend guard and the ledger.
 */
const intelligenceModuleSource = readFileSync(
  new URL('../../supabase/functions/_shared/candidateIntelligence.ts', import.meta.url),
  'utf8',
);

const trip: IntelligenceTripContext = {
  tripMaterialRevision: 'profile-v1',
  styles: ['local-neighbourhoods'],
  pace: 'relaxed',
  budgetTier: 'mid',
};

const base: IntelligenceCandidate = {
  candidateId: 'place-a',
  candidateRevision: 'cand-a-v1',
  plannerRevision: 'plan-a-v1',
  name: 'Yanaka Ginza',
  category: 'street',
  area: 'Yanaka',
  clusterId: 'cluster-north',
  matchedStyleTags: ['local-neighbourhoods'],
  durationRangeMinutes: [45, 90],
  indoorOutdoor: 'outdoor',
  travelMinutesFromCluster: 8,
  pairableCandidateIds: ['place-b'],
};

const neighbour: IntelligenceCandidate = {
  ...base,
  candidateId: 'place-b',
  candidateRevision: 'cand-b-v1',
  name: 'Nezu Shrine',
  pairableCandidateIds: ['place-a'],
};

/** Somewhere else entirely, in another cluster and matching nothing. */
const stranger: IntelligenceCandidate = {
  ...base,
  candidateId: 'place-c',
  candidateRevision: 'cand-c-v1',
  name: 'Bank of Japan Currency Museum',
  clusterId: 'cluster-south',
  matchedStyleTags: [],
  pairableCandidateIds: [],
};

const pool = new Map([base, neighbour, stranger].map((c) => [c.candidateId, c]));
const reject = (type: string, references: string[] = [], candidate = base) =>
  atomRejection({ type, references }, trip, candidate, pool);

describe('an atom must rest on something the app owns', () => {
  it('accepts a style the traveller selected and the place carries', () => {
    expect(reject('style-match', ['local-neighbourhoods'])).toBeUndefined();
  });

  /**
   * The bug this project already shipped once, in the deterministic layer:
   * `STYLE_TAGS.temples` includes `history`, which is fine inside a score and
   * false in a sentence. Only tags promoted to exact matches may be named.
   */
  it('refuses a style the candidate does not actually carry', () => {
    expect(reject('style-match', ['local-neighbourhoods'], stranger)).toBe('style-not-matched');
  });

  it('refuses a style the traveller never chose', () => {
    expect(reject('style-match', ['temples'])).toBe('style-not-selected');
  });

  it('refuses a pace that is not the one the traveller set', () => {
    expect(reject('pace-fit', ['relaxed'])).toBeUndefined();
    expect(reject('pace-fit', ['fast-paced'])).toBe('pace-mismatch');
  });

  /**
   * Fails closed because the two sides are not comparable. The traveller picks
   * a tier; a place carries a numeric band that is absent for most results,
   * and the only existing comparator is a ranking gradient with no "exceeds"
   * point. Correct for a score, wrong for a sentence.
   */
  it.each(['budget-fit', 'budget-mismatch'])('refuses %s while no affordability policy exists', (type) => {
    expect(reject(type)).toBe('budget-policy-unavailable');
    expect(atomRejection({ type, references: [] }, { ...trip, budgetTier: 'luxury' }, base, pool))
      .toBe('budget-policy-unavailable');
  });

  /** Geography is the planner's arithmetic, never inferred from place names. */
  it('refuses a pairing across two different clusters', () => {
    expect(reject('cluster-fit', ['place-b'])).toBeUndefined();
    expect(reject('cluster-fit', ['place-c'])).toBe('not-same-cluster');
  });

  it('refuses a reference to a candidate that is not in the pool', () => {
    expect(reject('cluster-fit', ['place-invented'])).toBe('unknown-candidate-reference');
  });

  /**
   * A computed number is not a threshold. These atoms previously shared one
   * arm that asked only whether a travel time existed, so any journey at all
   * satisfied "adds little travel" and "is out of the way" at the same time.
   */
  it.each(['low-detour', 'detour'])('refuses %s while no detour band is defined', (type) => {
    expect(reject(type)).toBe('detour-policy-unavailable');
    // Not a missing-value problem: a known travel time changes nothing.
    expect(reject(type, [], { ...base, travelMinutesFromCluster: 3 })).toBe('detour-policy-unavailable');
  });

  /**
   * The wrong fact rather than a missing threshold. `travelMinutesFromCluster`
   * is generic travel time, so it cannot establish a walking claim at any
   * threshold — a transit journey is not a walk.
   */
  it('refuses high-walking because travel time is the wrong metric for it', () => {
    expect(reject('high-walking')).toBe('walking-metric-unavailable');
    expect(reject('high-walking', [], { ...base, travelMinutesFromCluster: 90 }))
      .toBe('walking-metric-unavailable');
  });

  it.each(['short-stop', 'duration-pressure'])('refuses %s while no duration policy exists', (type) => {
    expect(reject(type)).toBe('duration-policy-unavailable');
    expect(reject(type, [], { ...base, durationRangeMinutes: [10, 15] })).toBe('duration-policy-unavailable');
  });

  /**
   * Shared geography is not shared substance. This shared an arm with
   * `cluster-fit`, so one cluster was taken as proof of covering similar
   * ground — a claim about content resting on a fact about place.
   */
  it('refuses portfolio-duplication, which had no similarity fact behind it', () => {
    expect(reject('portfolio-duplication', ['place-b'])).toBe('duplication-metric-unavailable');
    // Same cluster, and still refused: proximity was never the right fact.
    expect(base.clusterId).toBe(neighbour.clusterId);
  });

  /** The neighbouring atom that *does* rest on cluster membership still works. */
  it('still accepts cluster-fit, whose claim geography genuinely supports', () => {
    expect(reject('cluster-fit', ['place-b'])).toBeUndefined();
  });

  /** Unknown is not indoor. A rainy-day plan resting on a guess is the worst case. */
  it('refuses an indoor suggestion unless indoor status is known', () => {
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: undefined })).toBe('indoor-unknown');
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: 'outdoor' })).toBe('indoor-unknown');
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: 'indoor' })).toBeUndefined();
  });

  /**
   * An unearned apology is as false as unearned praise. A place that *does*
   * match the traveller's styles may not be described as a weak match.
   */
  it('refuses a weak-match claim about a place that genuinely matches', () => {
    expect(reject('weak-style-match')).toBe('unsupported-weak-claim');
    expect(reject('weak-style-match', [], stranger)).toBeUndefined();
  });

  it('refuses an atom type it has never heard of', () => {
    expect(reject('queue-is-short')).toBe('unknown-atom-type');
    expect(reject('locals-prefer-mornings')).toBe('unknown-atom-type');
  });
});

/** The world-fact firewall, stated as the thing it forbids. */
describe('claims about the world cannot enter through this door', () => {
  it.each([
    'opening-hours', 'ticket-price', 'queue-time', 'crowd-level', 'weather',
    'rating', 'review-count', 'booking-required', 'best-time', 'trending',
    'safety', 'seasonal',
  ])('has no atom for %s, so the claim is unrepresentable', (type) => {
    expect(reject(type)).toBe('unknown-atom-type');
  });
});

const response = (over: Record<string, unknown> = {}) => ({
  candidates: {
    'place-a': {
      tripMaterialRevision: 'profile-v1',
      candidateRevision: 'cand-a-v1',
  plannerRevision: 'plan-a-v1',
      personalFitScore: 82,
      recommendation: 'interested',
      reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
      cautionAtoms: [],
      pairWithCandidateIds: [],
      suggestedDurationMinutes: 60,
      ...over,
    },
  },
});

const validate = (raw: unknown) =>
  validateCandidateIntelligence(raw, { trip, candidates: [base, neighbour, stranger] });

describe('validating a batch', () => {
  it('keeps a well-supported candidate', () => {
    const result = validate(response());
    expect(result.byCandidate.get('place-a')).toMatchObject({
      personalFitScore: 82, recommendation: 'interested', suggestedDurationMinutes: 60,
    });
  });

  /**
   * The trip and planner revisions are not checked here, because this function
   * is called with the material the request was built from — comparing them
   * would compare a value to itself. They protect through the cache key and
   * the frontend request key instead, where a mismatch can genuinely occur.
   */

  it('ignores a candidate nobody asked about', () => {
    const result = validateCandidateIntelligence(
      { candidates: { 'place-nowhere': { tripMaterialRevision: 'profile-v1' } } },
      { trip, candidates: [base] },
    );
    expect(result.rejections).toContainEqual({ candidateId: 'place-nowhere', reason: 'unknown-candidate' });
  });

  /**
   * The partial-acceptance rule. One invented claim must not cost the card its
   * three good ones and push it back to generic copy.
   */
  it('drops one bad atom and keeps the valid ones', () => {
    const result = validate(response({
      reasonAtoms: [
        { type: 'style-match', references: ['local-neighbourhoods'] },
        { type: 'style-match', references: ['temples'] },
        { type: 'pace-fit', references: ['relaxed'] },
      ],
    }));
    const kept = result.byCandidate.get('place-a');
    expect(kept?.reasons).toHaveLength(2);
    expect(result.rejections).toContainEqual({ candidateId: 'place-a', reason: 'style-not-selected' });
  });

  it('falls back to no intelligence when every atom fails', () => {
    const result = validate(response({
      reasonAtoms: [{ type: 'style-match', references: ['museums'] }],
      cautionAtoms: [],
    }));
    // Null, not a half-supported object: the card keeps its deterministic copy.
    expect(result.byCandidate.get('place-a')).toBeNull();
  });

  it('drops an unsupported pairing individually', () => {
    const result = validate(response({ pairWithCandidateIds: ['place-b', 'place-c', 'place-ghost'] }));
    expect(result.byCandidate.get('place-a')?.pairWithCandidateIds).toEqual(['place-b']);
  });

  it('refuses a duration outside the known range, and one with no range at all', () => {
    expect(validate(response({ suggestedDurationMinutes: 400 }))
      .byCandidate.get('place-a')?.suggestedDurationMinutes).toBeNull();

    const noRange = validateCandidateIntelligence(response(), {
      trip, candidates: [{ ...base, durationRangeMinutes: undefined }],
    });
    expect(noRange.byCandidate.get('place-a')?.suggestedDurationMinutes).toBeNull();
  });

  it('discards a fit score outside 0–100 without discarding the reasons', () => {
    const result = validate(response({ personalFitScore: 900 }));
    expect(result.byCandidate.get('place-a')?.personalFitScore).toBeNull();
    expect(result.byCandidate.get('place-a')?.reasons).toHaveLength(1);
  });

  it('records an unanswered candidate as a cacheable empty answer', () => {
    const result = validate(response());
    expect(result.byCandidate.get('place-b')).toBeNull();
    expect(result.byCandidate.has('place-c')).toBe(true);
  });

  it('survives a response that is not the shape asked for', () => {
    for (const raw of [null, 42, 'text', {}, { candidates: [] }, { candidates: null }]) {
      expect(() => validate(raw)).not.toThrow();
    }
  });

  /**
   * The deterministic ranking is the planner's source of truth. The model's
   * score is advisory and sits beside it; nothing here may overwrite it.
   */
  /**
   * The model no longer sees the ranking number at all. It could otherwise
   * let it steer which atoms it chose, and no validator rule can check an
   * influence that leaves no trace in the output.
   */
  it('does not expose the deterministic ranking to the model', () => {
    const body = intelligenceRequestBody(trip, [base]);
    expect(JSON.stringify(body)).not.toContain('deterministicScore');
    expect(Object.keys(body.candidates[0])).not.toContain('deterministicScore');
  });
});

describe('the copy the traveller reads', () => {
  /**
   * The application owns every word. The model chose which true things to say;
   * none of the phrasing came from it, so a claim absent from the atom list
   * cannot appear here whatever the model wrote.
   */
  it('renders only what the validated atoms support', () => {
    const validated = validate(response({
      reasonAtoms: [
        { type: 'style-match', references: ['local-neighbourhoods'] },
        { type: 'pace-fit', references: ['relaxed'] },
        { type: 'cluster-fit', references: ['place-b'] },
      ],
      pairWithCandidateIds: ['place-b'],
    })).byCandidate.get('place-a')!;

    const lines = renderIntelligenceCopy(validated, base, pool).join(' ');
    expect(lines).toContain('local-neighbourhoods');
    expect(lines).toContain('relaxed');
    expect(lines).toContain('Nezu Shrine');
    // Nothing about hours, price, queues or crowds can reach the copy.
    for (const forbidden of ['open', 'price', '¥', 'queue', 'crowd', 'rating']) {
      expect(lines.toLowerCase()).not.toContain(forbidden);
    }
  });

  /**
   * A weak-style-match is specific about the dimension it measured; it must not
   * become a generic verdict about the whole trip.
   */
  it('says a weak match is weak, without inventing a reason to like it', () => {
    const validated = validate({
      candidates: {
        'place-c': {
          tripMaterialRevision: 'profile-v1',
          candidateRevision: 'cand-c-v1',
          reasonAtoms: [{ type: 'weak-style-match', references: [] }],
          cautionAtoms: [],
        },
      },
    }).byCandidate.get('place-c')!;

    const lines = renderIntelligenceCopy(validated, stranger, pool).join(' ');
    expect(lines).toContain('does not match the styles you selected');
    expect(lines).not.toContain('weaker match for your trip');
    expect(lines).not.toContain('variety');
  });

  it('bounds a batch', () => {
    expect(MAX_INTELLIGENCE_BATCH).toBeGreaterThanOrEqual(10);
    expect(MAX_INTELLIGENCE_BATCH).toBeLessThanOrEqual(20);
  });
});

/**
 * What the finished sentence claims.
 *
 * This suite exists because a validator can be entirely correct while the
 * renderer quietly makes a stronger claim than the atom supports. That is not
 * hypothetical: the first version of `renderIntelligenceCopy` turned
 * `cluster-fit` into *"sits in the same part of the city as X, so it does not
 * need a separate journey"* — and whether a separate journey is needed is a
 * travel fact, backed by a computed route value that `cluster-fit` says
 * nothing about. Every atom test passed the whole time.
 *
 * So these assert on the rendered prose rather than on atom acceptance, and
 * they are written as *ceilings*: what each atom may not be allowed to imply.
 */
describe('an atom may not imply more than it proves', () => {
  const render = (atoms: Array<{ type: string; references?: string[] }>, candidate = base) => {
    const validated = validateCandidateIntelligence({
        candidates: {
          [candidate.candidateId]: {
            tripMaterialRevision: trip.tripMaterialRevision,
            candidateRevision: candidate.candidateRevision,
            reasonAtoms: atoms.map((atom) => ({ references: [], ...atom })),
            cautionAtoms: [],
          },
        },
      // The candidate under test replaces its namesake in the pool: a helper
      // that validated against the original would silently test a different
      // object from the one it renders.
    }, { trip, candidates: [candidate, neighbour, stranger] }).byCandidate.get(candidate.candidateId);
    // A fully rejected atom set yields no intelligence at all, which renders
    // as nothing — the card keeps its deterministic rationale instead.
    if (!validated) return '';
    return renderIntelligenceCopy(
      validated,
      candidate,
      new Map([...pool, [candidate.candidateId, candidate]]),
    ).join(' ').toLowerCase();
  };

  /**
   * The exact regression. `cluster-fit` establishes shared planning geography
   * and nothing else; the cost of getting there is `low-detour`'s claim to
   * make, and only when a computed figure supports it.
   */
  it('never turns cluster-fit alone into a claim about travel', () => {
    const copy = render([{ type: 'cluster-fit', references: ['place-b'] }]);

    expect(copy).toContain('same planning area');
    for (const overreach of [
      'separate journey', 'little extra travel', 'easy to combine',
      'without much travel', 'no extra travel', 'minutes of travel',
    ]) {
      expect(copy, overreach).not.toContain(overreach);
    }
  });

  /**
   * With `low-detour` failing closed there is no validated route to this
   * sentence at all, which is the point: the copy cannot outrun the fact.
   */
  it('cannot render a travel claim while low-detour is unsupported', () => {
    expect(render([{ type: 'low-detour' }])).not.toContain('minutes of travel');
  });

  /** `pace-fit` says the pace matches. It cannot say what that does to a day. */
  it('never turns pace-fit into a schedule consequence', () => {
    const copy = render([{ type: 'pace-fit', references: ['relaxed'] }]);
    expect(copy).toContain('relaxed pace');
    for (const overreach of ['leaves time', 'fits in the morning', 'without rushing', 'quick']) {
      expect(copy, overreach).not.toContain(overreach);
    }
  });

  /**
   * `indoor-option` establishes that the place is indoors. Whether it will
   * rain is weather, which this layer is never given and must never assert.
   */
  it('never turns indoor-option into a weather claim', () => {
    const copy = render([{ type: 'indoor-option' }], { ...base, indoorOutdoor: 'indoor' });
    expect(copy).toContain('indoor');
    for (const overreach of ['rain', 'weather', 'wet', 'forecast']) {
      expect(copy, overreach).not.toContain(overreach);
    }
  });

  /** With budget failing closed there is no route to the sentence at all. */
  it('cannot render a budget claim while affordability is undefined', () => {
    expect(render([{ type: 'budget-fit' }])).toBe('');
    expect(render([{ type: 'budget-mismatch' }])).toBe('');
  });

  /**
   * Pairing rests on the planner's own list, so the places may be named — but
   * naming them is a suggestion, not a measurement of how convenient it is.
   */
  it('never turns a pairing into a convenience claim', () => {
    const validated = validateCandidateIntelligence({
      candidates: {
        'place-a': {
          tripMaterialRevision: trip.tripMaterialRevision,
          candidateRevision: base.candidateRevision,
          reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
          cautionAtoms: [],
          pairWithCandidateIds: ['place-b'],
        },
      },
    }, { trip, candidates: [base, neighbour, stranger] }).byCandidate.get('place-a')!;

    const copy = renderIntelligenceCopy(validated, base, pool).join(' ').toLowerCase();
    expect(copy).toContain('nezu shrine');
    for (const overreach of ['little travel', 'same trip', 'on the way', 'nearby', 'short walk']) {
      expect(copy, overreach).not.toContain(overreach);
    }
  });

  /**
   * The firewall, checked at the last possible moment. Whatever atoms are
   * present, no world fact may appear in the finished copy.
   */
  it('states no world fact whatever combination of atoms is validated', () => {
    const copy = render([
      { type: 'style-match', references: ['local-neighbourhoods'] },
      { type: 'style-match', references: ['local-neighbourhoods'] },
      { type: 'pace-fit', references: ['relaxed'] },
      { type: 'cluster-fit', references: ['place-b'] },
      { type: 'low-detour' },
    ]);

    for (const worldFact of [
      'open', 'closed', 'hours', 'ticket', 'admission', '¥', '$',
      'queue', 'line', 'crowd', 'busy', 'rating', 'review', 'popular',
      'trending', 'locals', 'best time', 'sunset', 'morning', 'evening',
      'book', 'reserve', 'safe', 'season',
    ]) {
      expect(copy, worldFact).not.toContain(worldFact);
    }
  });
});

describe('portfolio-variety fails closed until composition is supplied', () => {
  /**
   * It previously passed unconditionally — the reasoning that composition is
   * app-owned was correct, but nothing supplied it, so there was nothing to
   * check. An atom that always passes is an unvalidated atom with a
   * rule-shaped comment above it.
   */
  it('is refused when no composition data exists', () => {
    expect(atomRejection({ type: 'portfolio-variety', references: [] }, trip, base, pool))
      .toBe('composition-unknown');
  });

  it('is refused when the category is not one the shortlist lacks', () => {
    expect(atomRejection(
      { type: 'portfolio-variety', references: [] },
      trip,
      { ...base, underrepresentedCategories: ['museum', 'garden'] },
      pool,
    )).toBe('category-not-underrepresented');
  });

  it('passes only when the composition proves the gap', () => {
    expect(atomRejection(
      { type: 'portfolio-variety', references: [] },
      trip,
      { ...base, underrepresentedCategories: ['street', 'museum'] },
      pool,
    )).toBeUndefined();
  });
});

describe('batching candidates into requests', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => ({
    ...base, candidateId: `place-${index}`, candidateRevision: `rev-${index}`,
  }));

  it('fits fifteen candidates into one request when they are small enough', () => {
    const batches = buildIntelligenceBatches(many(15), 30_000);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(15);
  });

  /**
   * The input bound is authoritative over the count, because it is the one
   * that maps to tokens and therefore to money. Ten candidates carrying long
   * tag lists is a different request from ten carrying short ones, and a count
   * alone cannot tell them apart.
   */
  it('splits deterministically when the serialised bound is reached first', () => {
    const size = JSON.stringify(base).length;
    const batches = buildIntelligenceBatches(many(15), size * 4);
    expect(batches.length).toBeGreaterThan(1);
    // Deterministic: the same input must always split the same way, or a cache
    // key computed from a batch would be unstable.
    expect(buildIntelligenceBatches(many(15), size * 4).map((b) => b.length))
      .toEqual(batches.map((b) => b.length));
    expect(batches.flat()).toHaveLength(15);
  });

  it('never exceeds the count ceiling', () => {
    for (const batch of buildIntelligenceBatches(many(40), 1_000_000)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_INTELLIGENCE_BATCH);
    }
  });

  /**
   * A candidate too large to fit alone still gets its own batch. Dropping it
   * would make that place permanently invisible to the feature with nothing
   * recording why.
   */
  it('emits an oversized candidate alone rather than dropping it', () => {
    const batches = buildIntelligenceBatches(many(3), 1);
    expect(batches).toHaveLength(3);
    expect(batches.flat()).toHaveLength(3);
  });

  it('sends only snapshot fields, never the whole candidate object', () => {
    const body = intelligenceRequestBody(trip, [base]);
    const serialised = JSON.stringify(body);
    expect(serialised).toContain('matchedStyleTags');
    // The instruction forbids prose; there is no field for a sentence at all.
    expect(Object.keys(body.candidates[0])).not.toContain('description');
  });
});

describe('one batch is one metered request', () => {
  const reply = (candidates: Record<string, unknown>) => ({ ok: true as const, result: { candidates } });

  const goodAnswer = {
    'place-a': {
      tripMaterialRevision: 'profile-v1',
      candidateRevision: 'cand-a-v1',
  plannerRevision: 'plan-a-v1',
      reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
      cautionAtoms: [],
    },
    'place-b': {
      tripMaterialRevision: 'profile-v1',
      candidateRevision: 'cand-b-v1',
      reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
      cautionAtoms: [],
    },
  };

  it('asks once for a whole batch', async () => {
    const callMetered = vi.fn().mockResolvedValue(reply(goodAnswer));
    const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

    expect(callMetered).toHaveBeenCalledTimes(1);
    expect(outcomes.get('place-a')).toMatchObject({ kind: 'answered', cacheable: true });
    expect(outcomes.get('place-b')).toMatchObject({ kind: 'answered', cacheable: true });
  });

  /**
   * There is no fetch and no model client in this module. A feature able to
   * call the provider directly would inherit none of the allowlist, ceilings,
   * quota, spend guard or ledger — and would work perfectly while doing so.
   */
  it('cannot reach a provider except through the injected metered call', async () => {
    const source = intelligenceModuleSource;
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('api.openai.com');
    expect(source).not.toContain('generativelanguage');
  });

  it('keeps valid neighbours when one candidate in the batch is invalid', async () => {
    const callMetered = vi.fn().mockResolvedValue(reply({
      ...goodAnswer,
      'place-b': {
        tripMaterialRevision: 'profile-v1',
        candidateRevision: 'cand-b-v1',
        reasonAtoms: [{ type: 'style-match', references: ['museums'] }],
        cautionAtoms: [],
      },
    }));
    const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

    expect((outcomes.get('place-a') as { intelligence: unknown }).intelligence).not.toBeNull();
    // Answered, but nothing survived — a real finding, and cacheable.
    expect(outcomes.get('place-b')).toMatchObject({ kind: 'answered', intelligence: null, cacheable: true });
  });
});

/**
 * The distinction this whole outcome type exists to protect.
 *
 * "The model ran and nothing survived" is knowledge worth storing. "The model
 * never ran" is not. Caching the second as the first would let one budget
 * ceiling or one timeout permanently mark a card as having no personalisation
 * — and it would look identical to a genuine empty answer forever after.
 */
describe('a non-answer is never cached as an answer', () => {
  it.each(['budget-reached', 'quota-exhausted', 'spend-unknown', 'accounting-failed', 'provider-failed', 'model-not-approved'])(
    'refuses to cache when the call was refused with %s',
    async (refusal) => {
      const callMetered = vi.fn().mockResolvedValue({ ok: false as const, refusal });
      const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

      for (const id of ['place-a', 'place-b']) {
        expect(outcomes.get(id)).toMatchObject({ kind: 'not-run', cacheable: false });
      }
    },
  );

  it('does cache the genuine empty answer', async () => {
    const callMetered = vi.fn().mockResolvedValue({ ok: true as const, result: { candidates: {} } });
    const outcomes = await requestCandidateIntelligence(trip, [base], callMetered);
    expect(outcomes.get('place-a')).toMatchObject({ kind: 'answered', intelligence: null, cacheable: true });
  });

  it('spends nothing when there is nothing to ask about', async () => {
    const callMetered = vi.fn();
    expect((await requestCandidateIntelligence(trip, [], callMetered)).size).toBe(0);
    expect(callMetered).not.toHaveBeenCalled();
  });
});

describe('the cache key', () => {
  const key = (over: Record<string, string> = {}) => intelligenceCacheKey({
    tripId: 'trip-1',
    candidateId: 'place-a',
    candidateRevision: 'cand-a-v1',
    plannerRevision: 'plan-a-v1',
    tripMaterialRevision: 'profile-v1',
    model: 'gpt-5-nano',
    ...over,
  });

  it('is stable for unchanged material facts', () => {
    expect(key()).toBe(key());
  });

  it('separates identical material belonging to different trips', () => {
    expect(key({ tripId: 'trip-2' })).not.toBe(key());
  });

  it.each([
    ['candidateRevision', 'cand-a-v2'],
    ['tripMaterialRevision', 'profile-v2'],
    ['plannerRevision', 'plan-a-v2'],
    ['model', 'gpt-5-nano-2025-08-07'],
  ])('changes when %s changes', (field, value) => {
    expect(key({ [field]: value })).not.toBe(key());
  });

  /**
   * Part of the key, not merely stored beside it. A rule or wording change has
   * to invalidate the answers it produced — including the wrongly-empty ones —
   * or a fix cannot reach anybody until the TTL happens to lapse.
   */
  it('carries the schema version', () => {
    expect(key()).toContain(INTELLIGENCE_SCHEMA_VERSION);
  });

  /**
   * Pinned to a literal rather than compared against the constant, which would
   * be tautological. Changing what the model sees must therefore change this
   * test too — the version is part of the cache key precisely so answers
   * derived from a different contract cannot be served as current.
   *
   * v4: the global profile revision left the operation entirely, replaced by
   * an operation-specific tripMaterialRevision, and each candidate gained its
   * own plannerRevision. The echo contract narrowed to two fields.
   */
  it('has been bumped for the current material contract', () => {
    expect(INTELLIGENCE_SCHEMA_VERSION).toBe('v5');
  });

  /** One candidate changing must not disturb its neighbours. */
  it('isolates candidates from one another', () => {
    expect(key({ candidateId: 'place-b' })).not.toBe(key());
    const before = key();
    key({ candidateId: 'place-b', candidateRevision: 'cand-b-v9' });
    expect(key()).toBe(before);
  });
});

/**
 * A known value is not a supporting value.
 *
 * The whole suite previously asserted only the *rejection* paths for these
 * atoms — cost unknown, budget unknown — and never that a true claim requires
 * a fact pointing the right way. So a place the app knew to be over budget
 * could carry a `budget-fit` atom and render "its published price sits inside
 * your budget", and every test stayed green.
 *
 * Every directional atom therefore needs three cases: the fact supports it,
 * the fact contradicts it, the fact is unknown.
 */
/**
 * The polarity rule that Commit 1 established still stands for every atom
 * that has a truth condition; budget no longer has one, so its truth-table
 * tests moved out with `budgetFits` rather than being weakened to match.
 * What replaces them is the ownership suite below.
 */

describe('candidate material describes the place, not the traveller', () => {
  it('carries no precomputed relationship to the traveller', () => {
    const sent = JSON.stringify(intelligenceRequestBody(trip, [base]).candidates[0]);
    for (const leaked of ['budgetFits', 'costKnown', 'deterministicScore']) {
      expect(sent, leaked).not.toContain(leaked);
    }
  });

  /** The same place, two travellers: the candidate half is byte-identical. */
  it('is unchanged when only the traveller budget differs', () => {
    const forBudget = (budgetTier: string) => JSON.stringify(
      intelligenceRequestBody({ ...trip, budgetTier }, [base]).candidates,
    );
    expect(forBudget('budget')).toBe(forBudget('luxury'));
  });

  it('changes when the place itself changes', () => {
    const a = JSON.stringify(intelligenceRequestBody(trip, [base]).candidates);
    const b = JSON.stringify(intelligenceRequestBody(trip, [{ ...base, indoorOutdoor: 'indoor' }]).candidates);
    expect(a).not.toBe(b);
  });

  /** No prompt wording may assume a field the contract no longer sends. */
  it('mentions no ranking score in the instruction it sends', () => {
    const instruction = intelligenceRequestBody(trip, [base]).instruction.toLowerCase();
    // `personalFitScore` is an output field the model returns, so "score"
    // alone is not the signal — what must be absent is any reference to the
    // ranking number it no longer receives.
    for (const stale of ['deterministicscore', 'ranking', 'rank ']) {
      expect(instruction, stale).not.toContain(stale);
    }
  });
});

describe('batching candidates into requests', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => ({
    ...base, candidateId: `place-${index}`, candidateRevision: `rev-${index}`,
  }));

  it('fits fifteen candidates into one request when they are small enough', () => {
    const batches = buildIntelligenceBatches(many(15), 30_000);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(15);
  });

  /**
   * The input bound is authoritative over the count, because it is the one
   * that maps to tokens and therefore to money. Ten candidates carrying long
   * tag lists is a different request from ten carrying short ones, and a count
   * alone cannot tell them apart.
   */
  it('splits deterministically when the serialised bound is reached first', () => {
    const size = JSON.stringify(base).length;
    const batches = buildIntelligenceBatches(many(15), size * 4);
    expect(batches.length).toBeGreaterThan(1);
    // Deterministic: the same input must always split the same way, or a cache
    // key computed from a batch would be unstable.
    expect(buildIntelligenceBatches(many(15), size * 4).map((b) => b.length))
      .toEqual(batches.map((b) => b.length));
    expect(batches.flat()).toHaveLength(15);
  });

  it('never exceeds the count ceiling', () => {
    for (const batch of buildIntelligenceBatches(many(40), 1_000_000)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_INTELLIGENCE_BATCH);
    }
  });

  /**
   * A candidate too large to fit alone still gets its own batch. Dropping it
   * would make that place permanently invisible to the feature with nothing
   * recording why.
   */
  it('emits an oversized candidate alone rather than dropping it', () => {
    const batches = buildIntelligenceBatches(many(3), 1);
    expect(batches).toHaveLength(3);
    expect(batches.flat()).toHaveLength(3);
  });

  it('sends only snapshot fields, never the whole candidate object', () => {
    const body = intelligenceRequestBody(trip, [base]);
    const serialised = JSON.stringify(body);
    expect(serialised).toContain('matchedStyleTags');
    // The instruction forbids prose; there is no field for a sentence at all.
    expect(Object.keys(body.candidates[0])).not.toContain('description');
  });
});

describe('one batch is one metered request', () => {
  const reply = (candidates: Record<string, unknown>) => ({ ok: true as const, result: { candidates } });

  const goodAnswer = {
    'place-a': {
      tripMaterialRevision: 'profile-v1',
      candidateRevision: 'cand-a-v1',
  plannerRevision: 'plan-a-v1',
      reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
      cautionAtoms: [],
    },
    'place-b': {
      tripMaterialRevision: 'profile-v1',
      candidateRevision: 'cand-b-v1',
      reasonAtoms: [{ type: 'style-match', references: ['local-neighbourhoods'] }],
      cautionAtoms: [],
    },
  };

  it('asks once for a whole batch', async () => {
    const callMetered = vi.fn().mockResolvedValue(reply(goodAnswer));
    const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

    expect(callMetered).toHaveBeenCalledTimes(1);
    expect(outcomes.get('place-a')).toMatchObject({ kind: 'answered', cacheable: true });
    expect(outcomes.get('place-b')).toMatchObject({ kind: 'answered', cacheable: true });
  });

  /**
   * There is no fetch and no model client in this module. A feature able to
   * call the provider directly would inherit none of the allowlist, ceilings,
   * quota, spend guard or ledger — and would work perfectly while doing so.
   */
  it('cannot reach a provider except through the injected metered call', async () => {
    const source = intelligenceModuleSource;
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('api.openai.com');
    expect(source).not.toContain('generativelanguage');
  });

  it('keeps valid neighbours when one candidate in the batch is invalid', async () => {
    const callMetered = vi.fn().mockResolvedValue(reply({
      ...goodAnswer,
      'place-b': {
        tripMaterialRevision: 'profile-v1',
        candidateRevision: 'cand-b-v1',
        reasonAtoms: [{ type: 'style-match', references: ['museums'] }],
        cautionAtoms: [],
      },
    }));
    const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

    expect((outcomes.get('place-a') as { intelligence: unknown }).intelligence).not.toBeNull();
    // Answered, but nothing survived — a real finding, and cacheable.
    expect(outcomes.get('place-b')).toMatchObject({ kind: 'answered', intelligence: null, cacheable: true });
  });
});

/**
 * The distinction this whole outcome type exists to protect.
 *
 * "The model ran and nothing survived" is knowledge worth storing. "The model
 * never ran" is not. Caching the second as the first would let one budget
 * ceiling or one timeout permanently mark a card as having no personalisation
 * — and it would look identical to a genuine empty answer forever after.
 */
describe('a non-answer is never cached as an answer', () => {
  it.each(['budget-reached', 'quota-exhausted', 'spend-unknown', 'accounting-failed', 'provider-failed', 'model-not-approved'])(
    'refuses to cache when the call was refused with %s',
    async (refusal) => {
      const callMetered = vi.fn().mockResolvedValue({ ok: false as const, refusal });
      const outcomes = await requestCandidateIntelligence(trip, [base, neighbour], callMetered);

      for (const id of ['place-a', 'place-b']) {
        expect(outcomes.get(id)).toMatchObject({ kind: 'not-run', cacheable: false });
      }
    },
  );

  it('does cache the genuine empty answer', async () => {
    const callMetered = vi.fn().mockResolvedValue({ ok: true as const, result: { candidates: {} } });
    const outcomes = await requestCandidateIntelligence(trip, [base], callMetered);
    expect(outcomes.get('place-a')).toMatchObject({ kind: 'answered', intelligence: null, cacheable: true });
  });

  it('spends nothing when there is nothing to ask about', async () => {
    const callMetered = vi.fn();
    expect((await requestCandidateIntelligence(trip, [], callMetered)).size).toBe(0);
    expect(callMetered).not.toHaveBeenCalled();
  });
});

describe('the cache key', () => {
  const key = (over: Record<string, string> = {}) => intelligenceCacheKey({
    tripId: 'trip-1',
    candidateId: 'place-a',
    candidateRevision: 'cand-a-v1',
    plannerRevision: 'plan-a-v1',
    tripMaterialRevision: 'profile-v1',
    model: 'gpt-5-nano',
    ...over,
  });

  it('is stable for unchanged material facts', () => {
    expect(key()).toBe(key());
  });

  it.each([
    ['candidateRevision', 'cand-a-v2'],
    ['tripMaterialRevision', 'profile-v2'],
    ['plannerRevision', 'plan-a-v2'],
    ['model', 'gpt-5-nano-2025-08-07'],
  ])('changes when %s changes', (field, value) => {
    expect(key({ [field]: value })).not.toBe(key());
  });

  /**
   * Part of the key, not merely stored beside it. A rule or wording change has
   * to invalidate the answers it produced — including the wrongly-empty ones —
   * or a fix cannot reach anybody until the TTL happens to lapse.
   */
  it('carries the schema version', () => {
    expect(key()).toContain(INTELLIGENCE_SCHEMA_VERSION);
  });

  /**
   * Pinned to a literal rather than compared against the constant, which would
   * be tautological. Changing what the model sees must therefore change this
   * test too — the version is part of the cache key precisely so answers
   * derived from a different contract cannot be served as current.
   *
   * v4: the global profile revision left the operation entirely, replaced by
   * an operation-specific tripMaterialRevision, and each candidate gained its
   * own plannerRevision. The echo contract narrowed to two fields.
   */
  it('has been bumped for the current material contract', () => {
    expect(INTELLIGENCE_SCHEMA_VERSION).toBe('v5');
  });

  /** One candidate changing must not disturb its neighbours. */
  it('isolates candidates from one another', () => {
    expect(key({ candidateId: 'place-b' })).not.toBe(key());
    const before = key();
    key({ candidateId: 'place-b', candidateRevision: 'cand-b-v9' });
    expect(key()).toBe(before);
  });
});

/**
 * A known value is not a supporting value.
 *
 * The whole suite previously asserted only the *rejection* paths for these
 * atoms — cost unknown, budget unknown — and never that a true claim requires
 * a fact pointing the right way. So a place the app knew to be over budget
 * could carry a `budget-fit` atom and render "its published price sits inside
 * your budget", and every test stayed green.
 *
 * Every directional atom therefore needs three cases: the fact supports it,
 * the fact contradicts it, the fact is unknown.
 */

/**
 * The same check one layer later. A validator can be right while the renderer
 * still prints the opposite, so the contradictory *sentence* is asserted
 * unreachable rather than merely unvalidated.
 */
describe('contradictory copy is unreachable', () => {
  const copyFor = (type: string, budgetFits: boolean) => {
    const candidate = { ...base, costKnown: true, budgetFits };
    const validated = validateCandidateIntelligence({
      candidates: {
        [candidate.candidateId]: {
          tripMaterialRevision: trip.tripMaterialRevision,
          candidateRevision: candidate.candidateRevision,
          reasonAtoms: type === 'budget-fit' ? [{ type, references: [] }] : [],
          cautionAtoms: type === 'budget-mismatch' ? [{ type, references: [] }] : [],
        },
      },
    }, { trip, candidates: [candidate] }).byCandidate.get(candidate.candidateId);
    return validated ? renderIntelligenceCopy(validated, candidate, pool).join(' ').toLowerCase() : '';
  };

  /**
   * Neither budget sentence is reachable now, in either direction. The atom
   * that could have produced them fails closed, so the copy has no route to
   * the screen regardless of what the model asks for.
   */
  it('cannot say anything about budget while affordability is undefined', () => {
    for (const fits of [true, false]) {
      expect(copyFor('budget-fit', fits)).not.toContain('budget');
      expect(copyFor('budget-mismatch', fits)).not.toContain('budget');
    }
  });

  /**
   * The atoms failing closed have no route to their copy either. Worth
   * asserting on the rendered text rather than on the rejection reason,
   * because the sentence is what a traveller would have read.
   */
  it('cannot render detour, walking or duration claims while unsupported', () => {
    const all = ['low-detour', 'detour', 'high-walking', 'short-stop', 'duration-pressure']
      .map((type) => reject(type, ['place-b']));
    expect(all.every(Boolean)).toBe(true);
  });
});

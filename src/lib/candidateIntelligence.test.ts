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
  profileRevision: 'profile-v1',
  interests: ['food', 'nightlife'],
  styles: ['local-neighbourhoods'],
  pace: 'relaxed',
  budgetTier: 'mid',
};

const base: IntelligenceCandidate = {
  candidateId: 'place-a',
  candidateRevision: 'cand-a-v1',
  name: 'Yanaka Ginza',
  category: 'street',
  area: 'Yanaka',
  clusterId: 'cluster-north',
  deterministicScore: 78,
  matchedStyleTags: ['local-neighbourhoods'],
  matchedInterestTags: ['food'],
  durationRangeMinutes: [45, 90],
  indoorOutdoor: 'outdoor',
  costKnown: true,
  budgetFits: true,
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
  matchedInterestTags: [],
  pairableCandidateIds: [],
};

const pool = new Map([base, neighbour, stranger].map((c) => [c.candidateId, c]));
const reject = (type: string, references: string[] = [], candidate = base) =>
  atomRejection({ type, references }, trip, candidate, pool);

describe('an atom must rest on something the app owns', () => {
  it('accepts an interest the traveller actually selected', () => {
    expect(reject('interest-match', ['food'])).toBeUndefined();
  });

  /** The claim is about their own input, so getting it wrong is not a nuance. */
  it('refuses an interest the traveller never selected', () => {
    expect(reject('interest-match', ['museums'])).toBe('interest-not-selected');
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

  /** A category is not a price — the rule `placeCost.ts` already enforces. */
  it('refuses a budget claim when the place has no known cost', () => {
    expect(reject('budget-fit', [], { ...base, costKnown: false })).toBe('cost-unknown');
    expect(reject('budget-mismatch', [], { ...base, costKnown: false })).toBe('cost-unknown');
  });

  it('refuses a budget claim when the trip has no budget tier', () => {
    expect(atomRejection({ type: 'budget-fit', references: [] }, { ...trip, budgetTier: undefined }, base, pool))
      .toBe('budget-unknown');
  });

  /** Geography is the planner's arithmetic, never inferred from place names. */
  it('refuses a pairing across two different clusters', () => {
    expect(reject('cluster-fit', ['place-b'])).toBeUndefined();
    expect(reject('cluster-fit', ['place-c'])).toBe('not-same-cluster');
  });

  it('refuses a reference to a candidate that is not in the pool', () => {
    expect(reject('cluster-fit', ['place-invented'])).toBe('unknown-candidate-reference');
  });

  it('refuses a detour claim with no computed travel time', () => {
    expect(reject('low-detour')).toBeUndefined();
    expect(reject('low-detour', [], { ...base, travelMinutesFromCluster: undefined })).toBe('no-computed-travel');
    expect(reject('high-walking', [], { ...base, travelMinutesFromCluster: undefined })).toBe('no-computed-travel');
  });

  it('refuses a duration claim when no duration is known', () => {
    expect(reject('short-stop')).toBeUndefined();
    expect(reject('short-stop', [], { ...base, durationRangeMinutes: undefined })).toBe('no-known-duration');
  });

  /** Unknown is not indoor. A rainy-day plan resting on a guess is the worst case. */
  it('refuses an indoor suggestion unless indoor status is known', () => {
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: undefined })).toBe('indoor-unknown');
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: 'outdoor' })).toBe('indoor-unknown');
    expect(reject('indoor-option', [], { ...base, indoorOutdoor: 'indoor' })).toBeUndefined();
  });

  /**
   * An unearned apology is as false as unearned praise. A place that *does*
   * match the traveller's interests may not be described as a weak match.
   */
  it('refuses a weak-match claim about a place that genuinely matches', () => {
    expect(reject('weak-profile-match')).toBe('unsupported-weak-claim');
    expect(reject('weak-profile-match', [], stranger)).toBeUndefined();
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
      profileRevision: 'profile-v1',
      candidateRevision: 'cand-a-v1',
      personalFitScore: 82,
      recommendation: 'interested',
      reasonAtoms: [{ type: 'interest-match', references: ['food'] }],
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

  it('rejects an answer about a stale profile', () => {
    const result = validate(response({ profileRevision: 'profile-v0' }));
    expect(result.byCandidate.get('place-a')).toBeNull();
    expect(result.rejections).toContainEqual({ candidateId: 'place-a', reason: 'stale-profile-revision' });
  });

  it('rejects an answer about a stale candidate', () => {
    const result = validate(response({ candidateRevision: 'cand-a-v0' }));
    expect(result.byCandidate.get('place-a')).toBeNull();
  });

  it('ignores a candidate nobody asked about', () => {
    const result = validateCandidateIntelligence(
      { candidates: { 'place-nowhere': { profileRevision: 'profile-v1' } } },
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
        { type: 'interest-match', references: ['food'] },
        { type: 'interest-match', references: ['museums'] },
        { type: 'pace-fit', references: ['relaxed'] },
      ],
    }));
    const kept = result.byCandidate.get('place-a');
    expect(kept?.reasons).toHaveLength(2);
    expect(result.rejections).toContainEqual({ candidateId: 'place-a', reason: 'interest-not-selected' });
  });

  it('falls back to no intelligence when every atom fails', () => {
    const result = validate(response({
      reasonAtoms: [{ type: 'interest-match', references: ['museums'] }],
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
  it('never alters the deterministic score', () => {
    const before = base.deterministicScore;
    validate(response({ personalFitScore: 5 }));
    expect(base.deterministicScore).toBe(before);
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
        { type: 'interest-match', references: ['food'] },
        { type: 'pace-fit', references: ['relaxed'] },
        { type: 'cluster-fit', references: ['place-b'] },
      ],
      pairWithCandidateIds: ['place-b'],
    })).byCandidate.get('place-a')!;

    const lines = renderIntelligenceCopy(validated, base, pool).join(' ');
    expect(lines).toContain('food');
    expect(lines).toContain('relaxed');
    expect(lines).toContain('Nezu Shrine');
    // Nothing about hours, price, queues or crowds can reach the copy.
    for (const forbidden of ['open', 'price', '¥', 'queue', 'crowd', 'rating']) {
      expect(lines.toLowerCase()).not.toContain(forbidden);
    }
  });

  /**
   * The line this whole feature exists to replace. "Nothing stands out on
   * paper — it is here for variety" told the traveller nothing actionable;
   * naming why it is weak, and why it was kept, does.
   */
  it('says a weak match is weak, without inventing a reason to like it', () => {
    const validated = validate({
      candidates: {
        'place-c': {
          profileRevision: 'profile-v1',
          candidateRevision: 'cand-c-v1',
          reasonAtoms: [{ type: 'weak-profile-match', references: [] }],
          cautionAtoms: [],
        },
      },
    }).byCandidate.get('place-c')!;

    const lines = renderIntelligenceCopy(validated, stranger, pool).join(' ');
    expect(lines).toContain('weaker match');
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
  const render = (atoms: Array<{ type: string; references?: string[] }>, candidate = base) =>
    renderIntelligenceCopy(
      validateCandidateIntelligence({
        candidates: {
          [candidate.candidateId]: {
            profileRevision: trip.profileRevision,
            candidateRevision: candidate.candidateRevision,
            reasonAtoms: atoms.map((atom) => ({ references: [], ...atom })),
            cautionAtoms: [],
          },
        },
        // The candidate under test replaces its namesake in the pool: a helper
        // that validated against the original would silently test a different
        // object from the one it renders.
      }, { trip, candidates: [candidate, neighbour, stranger] }).byCandidate.get(candidate.candidateId)!,
      candidate,
      new Map([...pool, [candidate.candidateId, candidate]]),
    ).join(' ').toLowerCase();

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

  it('allows the travel claim only when low-detour was validated', () => {
    expect(render([{ type: 'low-detour' }])).toContain('minutes of travel');
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

  /** Where the price sits, not whether it is worth paying. */
  it('never turns budget-fit into a judgement about value', () => {
    const copy = render([{ type: 'budget-fit' }]);
    expect(copy).toContain('budget');
    for (const overreach of ['good value', 'worth', 'bargain', 'cheap']) {
      expect(copy, overreach).not.toContain(overreach);
    }
  });

  /**
   * Pairing rests on the planner's own list, so the places may be named — but
   * naming them is a suggestion, not a measurement of how convenient it is.
   */
  it('never turns a pairing into a convenience claim', () => {
    const validated = validateCandidateIntelligence({
      candidates: {
        'place-a': {
          profileRevision: trip.profileRevision,
          candidateRevision: base.candidateRevision,
          reasonAtoms: [{ type: 'interest-match', references: ['food'] }],
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
      { type: 'interest-match', references: ['food'] },
      { type: 'style-match', references: ['local-neighbourhoods'] },
      { type: 'pace-fit', references: ['relaxed'] },
      { type: 'cluster-fit', references: ['place-b'] },
      { type: 'low-detour' },
      { type: 'short-stop' },
      { type: 'budget-fit' },
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
      profileRevision: 'profile-v1',
      candidateRevision: 'cand-a-v1',
      reasonAtoms: [{ type: 'interest-match', references: ['food'] }],
      cautionAtoms: [],
    },
    'place-b': {
      profileRevision: 'profile-v1',
      candidateRevision: 'cand-b-v1',
      reasonAtoms: [{ type: 'interest-match', references: ['food'] }],
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
        profileRevision: 'profile-v1',
        candidateRevision: 'cand-b-v1',
        reasonAtoms: [{ type: 'interest-match', references: ['museums'] }],
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
    candidateId: 'place-a',
    candidateRevision: 'cand-a-v1',
    profileRevision: 'profile-v1',
    plannerContextRevision: 'ctx-1',
    model: 'gpt-5-nano',
    ...over,
  });

  it('is stable for unchanged material facts', () => {
    expect(key()).toBe(key());
  });

  it.each([
    ['candidateRevision', 'cand-a-v2'],
    ['profileRevision', 'profile-v2'],
    ['plannerContextRevision', 'ctx-2'],
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

  /** One candidate changing must not disturb its neighbours. */
  it('isolates candidates from one another', () => {
    expect(key({ candidateId: 'place-b' })).not.toBe(key());
    const before = key();
    key({ candidateId: 'place-b', candidateRevision: 'cand-b-v9' });
    expect(key()).toBe(before);
  });
});

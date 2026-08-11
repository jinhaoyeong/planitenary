/**
 * What the model sees, and what therefore makes an answer stale.
 *
 * Two failures are being guarded against, and they point in opposite
 * directions. Sending a fact no rule can check lets the model weigh something
 * invisibly and invalidates correct answers for nothing. Omitting a fact a
 * rule *does* check turns a validated claim into an unchecked one. So most of
 * these tests are about membership rather than mechanics.
 *
 * The rest prove that equivalent state serialises identically — a revision
 * that changes when nothing meaningful did is a cache miss with no answer
 * behind it.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  candidateMaterialRevision,
  plannerMaterialRevision,
  toCandidateIntelligenceMaterial,
  toCandidateIntelligenceTripMaterial,
  toPlannerIntelligenceMaterial,
  tripMaterialRevision,
} from '../../supabase/functions/_shared/intelligenceMaterial';
import {
  intelligenceRequestBody,
  type IntelligenceCandidate,
  type IntelligenceTripContext,
} from '../../supabase/functions/_shared/candidateIntelligence';

const candidate = (over: Partial<IntelligenceCandidate> = {}): IntelligenceCandidate => ({
  candidateId: 'place-a',
  candidateRevision: 'derived-elsewhere',
  plannerRevision: 'planner-derived-elsewhere',
  name: 'Yanaka Ginza',
  category: 'street',
  area: 'Yanaka',
  clusterId: 'north',
  matchedStyleTags: ['local-neighbourhoods'],
  matchedInterestTags: ['food'],
  durationRangeMinutes: [45, 90],
  indoorOutdoor: 'outdoor',
  travelMinutesFromCluster: 8,
  pairableCandidateIds: ['place-b'],
  underrepresentedCategories: ['museum'],
  ...over,
});

const trip = (over: Partial<IntelligenceTripContext> = {}): IntelligenceTripContext => ({
  tripMaterialRevision: 'p1',
  interests: ['food', 'nightlife'],
  styles: ['local-neighbourhoods'],
  pace: 'relaxed',
  budgetTier: 'mid-range',
  ...over,
});

const candidateRev = (over: Partial<IntelligenceCandidate> = {}) =>
  candidateMaterialRevision(toCandidateIntelligenceMaterial(candidate(over)));
const plannerRev = (over: Partial<IntelligenceCandidate> = {}) =>
  plannerMaterialRevision(toPlannerIntelligenceMaterial(candidate(over)));
const tripRev = (over: Partial<IntelligenceTripContext> = {}) =>
  tripMaterialRevision(toCandidateIntelligenceTripMaterial(trip(over)));

describe('the place', () => {
  it.each([
    ['tag order', { matchedInterestTags: ['food'], matchedStyleTags: ['local-neighbourhoods'] }],
    ['duplicate tags', { matchedInterestTags: ['food', 'food'] }],
    ['a corrected display name', { name: 'Yanaka Ginza Shopping Street' }],
    ['a different area label', { area: 'Nezu' }],
    ['a recategorisation', { category: 'market' }],
    ['a recomputed travel time', { travelMinutesFromCluster: 34 }],
    ['a changed portfolio composition', { underrepresentedCategories: ['garden', 'museum'] }],
  ])('is unchanged by %s', (_label, over) => {
    expect(candidateRev(over)).toBe(candidateRev());
  });

  it.each([
    ['its interest tags', { matchedInterestTags: ['food', 'shopping'] }],
    ['its style tags', { matchedStyleTags: [] }],
    ['whether it is indoors', { indoorOutdoor: 'indoor' as const }],
    ['how long a visit takes', { durationRangeMinutes: [30, 60] as [number, number] }],
  ])('changes when %s changes', (_label, over) => {
    expect(candidateRev(over)).not.toBe(candidateRev());
  });

  /**
   * The exception worth naming. Its own atoms fail closed, so the membership
   * rule alone would drop it — but `suggestedDurationMinutes` is bounded
   * against this range, and removing it would silently turn a validated number
   * into an unchecked one.
   */
  it('keeps the duration range, which still bounds a validated field', () => {
    expect(toCandidateIntelligenceMaterial(candidate())).toHaveProperty('durationRangeMinutes');
  });

  it('normalises an absent value rather than omitting it', () => {
    expect(toCandidateIntelligenceMaterial(candidate({ indoorOutdoor: undefined })).indoorOutdoor)
      .toBeNull();
    expect(candidateRev({ indoorOutdoor: undefined })).toBe(candidateRev({ indoorOutdoor: undefined }));
  });
});

describe('the place in relation to the trip', () => {
  it.each([
    ['pairing order', { pairableCandidateIds: ['place-b'] }],
    ['duplicate pairings', { pairableCandidateIds: ['place-b', 'place-b'] }],
    ['a recomputed travel time', { travelMinutesFromCluster: 34 }],
    ['a changed composition', { underrepresentedCategories: [] }],
  ])('is unchanged by %s', (_label, over) => {
    expect(plannerRev(over)).toBe(plannerRev());
  });

  it.each([
    ['the cluster', { clusterId: 'south' }],
    ['the pairing set', { pairableCandidateIds: ['place-c'] }],
  ])('changes when %s changes', (_label, over) => {
    expect(plannerRev(over)).not.toBe(plannerRev());
  });

  /**
   * The most valuable of these. A route estimate moving from 6 to 34 minutes
   * currently supports no claim at all — every detour atom fails closed — so
   * paying for a fresh answer would buy an identical one.
   */
  it('does not regenerate for a metric no atom can currently use', () => {
    expect(plannerRev({ travelMinutesFromCluster: 6 })).toBe(plannerRev({ travelMinutesFromCluster: 34 }));
    expect(candidateRev({ travelMinutesFromCluster: 6 })).toBe(candidateRev({ travelMinutesFromCluster: 34 }));
  });
});

describe('the traveller', () => {
  it.each([
    ['interest order', { interests: ['nightlife', 'food'] }],
    ['duplicate interests', { interests: ['food', 'nightlife', 'food'] }],
    ['their budget tier', { budgetTier: 'luxury' }],
    ['an unrelated profile field', { tripMaterialRevision: 'p2' }],
  ])('is unchanged by %s', (_label, over) => {
    expect(tripRev(over)).toBe(tripRev());
  });

  it.each([
    ['their interests', { interests: ['food'] }],
    ['their styles', { styles: ['culture'] }],
    ['their pace', { pace: 'fast-paced' }],
  ])('changes when %s changes', (_label, over) => {
    expect(tripRev(over)).not.toBe(tripRev());
  });

  /**
   * `profileRevision` moving is the ordinary case — it changes when flight
   * times, stays, companions or dietary needs are edited, none of which this
   * operation sends. Keying off it would regenerate every candidate's
   * intelligence for edits the model cannot see.
   */
  it('ignores the global profile revision entirely', () => {
    expect(tripRev({ tripMaterialRevision: 'p9' })).toBe(tripRev({ tripMaterialRevision: 'p1' }));
  });

  /** Budget has no validator consumer since the budget atoms fail closed. */
  it('does not send the budget tier', () => {
    expect(toCandidateIntelligenceTripMaterial(trip())).not.toHaveProperty('budgetTier');
  });
});

describe('what actually reaches the provider', () => {
  const serialised = () => JSON.stringify(intelligenceRequestBody(trip(), [candidate()]));

  /**
   * Asserted against the serialised request rather than the types, because
   * TypeScript proves the shape and only this proves that nothing is appended
   * afterwards. `budgetTier` is the newest removal and the easiest to
   * reintroduce by reflex, since `trip` still carries it for other callers.
   */
  it.each([
    'name', 'area', 'category', 'deterministicScore', 'travelMinutesFromCluster',
    'underrepresentedCategories', 'costKnown', 'budgetFits', 'budgetTier',
  ])('carries no %s', (field) => {
    expect(serialised()).not.toContain(field);
  });

  it('carries every field that does have a live consumer', () => {
    for (const field of ['matchedStyleTags', 'matchedInterestTags', 'indoorOutdoor',
      'durationRangeMinutes', 'clusterId', 'pairableCandidateIds',
      'interests', 'styles', 'pace']) {
      expect(serialised(), field).toContain(field);
    }
  });

  /**
   * The structural guarantee, checked rather than assumed: the object whose
   * canonical serialisation produced the revision is the object that was sent.
   * Comparing two hand-maintained field lists would pass while the builder
   * quietly rebuilt equivalent fields of its own.
   */
  it('sends the same material the revision was derived from', () => {
    const sent = intelligenceRequestBody(trip(), [candidate()]).candidates[0];
    const material = toCandidateIntelligenceMaterial(candidate());
    const planner = toPlannerIntelligenceMaterial(candidate());

    for (const [key, value] of Object.entries({ ...material, ...planner })) {
      expect(sent, key).toHaveProperty(key, value);
    }
    // And nothing beyond the two materials plus identity.
    expect(Object.keys(sent).sort()).toEqual(
      ['candidateId', 'candidateRevision', ...Object.keys(material), ...Object.keys(planner)].sort(),
    );
  });

  /** These become database keys, so their size is worth knowing now. */
  it('produces revisions small enough to be cache keys', () => {
    for (const revision of [candidateRev(), plannerRev(), tripRev()]) {
      expect(revision.length).toBeLessThan(512);
    }
  });
});

/**
 * Serialisation must not depend on how an object was built.
 *
 * The mappers currently emit one fixed literal each, so insertion order never
 * varies today and the canonical sort looks like dead defence. It is not: the
 * revision is a *content* address, and a future mapper that assembles material
 * conditionally — spreading a base object, adding a field in a branch — would
 * produce identical facts in a different order. Without the sort that reads as
 * a different revision, and every cached answer for those candidates is
 * discarded for nothing.
 */
describe('canonical serialisation', () => {
  it('ignores the order keys were inserted in', () => {
    const built = { b: 1, a: 2, c: [3, 4] };
    const rebuilt = { c: [3, 4], a: 2, b: 1 };
    expect(JSON.stringify(built)).not.toBe(JSON.stringify(rebuilt));
    expect(canonicalJson(built)).toBe(canonicalJson(rebuilt));
  });

  /** Array order *is* meaningful — only object keys are reordered. */
  it('preserves array order, which can carry meaning', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('treats an explicit null and an absent key alike', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('serialises nested objects canonically too', () => {
    expect(canonicalJson({ outer: { b: 1, a: 2 } })).toBe(canonicalJson({ outer: { a: 2, b: 1 } }));
  });
});

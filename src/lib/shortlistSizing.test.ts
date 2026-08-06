/**
 * Shortlist sizing — the traveller's own complaint, made testable:
 *
 * > don't give them like 100 for 10+ days, they don't have time to go to so
 * > many places
 *
 * The previous `defaultDiscoveryDecisions` pre-selected a hardcoded 29 whether
 * the trip was three days or twenty-one.
 */
import { describe, expect, it } from 'vitest';
import { defaultDiscoveryDecisions, shortlistTarget } from './destinationPlanner';
import { PACE_DEFAULTS, deriveTravelBehaviour } from './travelBehaviour';
import { createEmptyProfile, manualDestination, type TripMood, type TripProfile } from './tripProfile';
import type { PlaceCandidate, RankedCandidate } from './destinationIntelligence';

const profileWith = (moods: TripMood[]): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Melbourne', 'Australia')],
  moods,
});

const behaviourFor = (moods: TripMood[]) => deriveTravelBehaviour(profileWith(moods));

const candidate = (index: number, categories: string[] = ['sight']): PlaceCandidate => ({
  id: `place-${index}`,
  name: `Place ${index}`,
  city: 'Melbourne',
  description: 'A place.',
  categories,
  experienceTags: [],
  estimatedVisitMinutes: 90,
  reservationStatus: 'not-needed',
  provider: 'osm',
  sourceReferences: [{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/1' }],
  sourceConfidence: 'medium',
} as unknown as PlaceCandidate);

const rankedList = (count: number, categories?: string[]): RankedCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    candidate: candidate(index, categories),
    score: 100 - index,
    breakdown: {},
    reasons: [],
  } as unknown as RankedCandidate));

const countOf = (decisions: Record<string, string>, value: string) =>
  Object.values(decisions).filter((decision) => decision === value).length;

describe('capacity comes from the trip, not a constant', () => {
  it('scales with the number of days', () => {
    const behaviour = behaviourFor([]);
    const short = shortlistTarget(3, behaviour, 200);
    const long = shortlistTarget(21, behaviour, 200);

    expect(long.capacity).toBeGreaterThan(short.capacity);
    // The specific failure reported: identical shortlists for both.
    expect(long.shortlist).not.toBe(short.shortlist);
  });

  it('asks for fewer places when the traveller chose a calm trip', () => {
    // The point of deriving from PACE_DEFAULTS: mood already changes
    // maxMainActivities, so it changes the deck with no second rule.
    const calm = shortlistTarget(10, behaviourFor(['calm']), 200);
    const fast = shortlistTarget(10, behaviourFor(['fast-paced']), 200);

    expect(PACE_DEFAULTS[behaviourFor(['calm']).pace].maxMainActivities)
      .toBeLessThan(PACE_DEFAULTS[behaviourFor(['fast-paced']).pace].maxMainActivities);
    expect(calm.shortlist).toBeLessThan(fast.shortlist);
  });

  it('carries headroom, because not every accepted place gets scheduled', () => {
    // Places are lost to opening hours, walking limits and clustering. Asking
    // for exactly the capacity would leave days short whenever that happens.
    const target = shortlistTarget(10, behaviourFor([]), 200);
    expect(target.shortlist).toBeGreaterThan(target.capacity);
  });

  it('never asks for more places than were actually found', () => {
    const target = shortlistTarget(21, behaviourFor([]), 12);
    expect(target.shortlist).toBe(12);
  });

  it('offers a real choice even on a single day', () => {
    // One day of a calm trip holds two stops; a two-card deck is not a choice.
    const target = shortlistTarget(1, behaviourFor(['calm']), 200);
    expect(target.shortlist).toBeGreaterThanOrEqual(6);
  });

  it('keeps must-do a minority of the shortlist', () => {
    const target = shortlistTarget(10, behaviourFor([]), 200);
    expect(target.mustDo).toBeGreaterThanOrEqual(2);
    expect(target.mustDo).toBeLessThan(target.shortlist);
  });
});

describe('the recommended shortlist honours that capacity', () => {
  it('pre-selects far fewer than the old fixed 29 for a short trip', () => {
    const decisions = defaultDiscoveryDecisions(rankedList(100), {
      dayCount: 3,
      behaviour: behaviourFor(['calm']),
    });
    expect(Object.keys(decisions).length).toBeLessThan(29);
  });

  it('gives a long trip more than a short one from the same candidates', () => {
    const behaviour = behaviourFor([]);
    const short = defaultDiscoveryDecisions(rankedList(200), { dayCount: 3, behaviour });
    const long = defaultDiscoveryDecisions(rankedList(200), { dayCount: 21, behaviour });
    expect(Object.keys(long).length).toBeGreaterThan(Object.keys(short).length);
  });

  it('does not spend sightseeing capacity on restaurants', () => {
    // Food is drawn separately when meals are scheduled. A shortlist full of
    // restaurants would leave the days with nothing to see.
    const decisions = defaultDiscoveryDecisions(rankedList(40, ['food']), {
      dayCount: 10,
      behaviour: behaviourFor([]),
    });
    expect(Object.keys(decisions)).toHaveLength(0);
  });

  it('still shortlists a night market, which is food and a sight both', () => {
    // isFoodOnly, not isFoodPlace: a place with any non-food character is a
    // genuine attraction, and excluding it would quietly delete it from the day.
    const decisions = defaultDiscoveryDecisions(rankedList(40, ['food', 'market']), {
      dayCount: 10,
      behaviour: behaviourFor([]),
    });
    expect(Object.keys(decisions).length).toBeGreaterThan(0);
  });

  it('marks the strongest few must-do and the rest interested', () => {
    const decisions = defaultDiscoveryDecisions(rankedList(200), {
      dayCount: 10,
      behaviour: behaviourFor([]),
    });
    expect(countOf(decisions, 'must-do')).toBeGreaterThanOrEqual(2);
    expect(countOf(decisions, 'interested')).toBeGreaterThan(countOf(decisions, 'must-do'));
  });

  it('falls back to the old shape when it has no trip context', () => {
    // Callers without a profile must keep working rather than sizing against
    // an invented capacity.
    const decisions = defaultDiscoveryDecisions(rankedList(100));
    expect(Object.keys(decisions)).toHaveLength(29);
  });
});

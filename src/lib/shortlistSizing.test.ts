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
import { defaultDiscoveryDecisions, measureShortlistFit, shortlistTarget } from './destinationPlanner';
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

describe('the ceiling is a promise, not a capacity claim', () => {
  it('never pre-selects more than 100 places', () => {
    // 21 days at an active pace works out at 118 without this.
    const target = shortlistTarget(21, behaviourFor(['fast-paced']), 500);
    expect(target.shortlist).toBeLessThanOrEqual(100);
  });

  it('still reports the trip’s real capacity when the ceiling binds', () => {
    // Kept separate deliberately: the cap limits what is offered, it does not
    // pretend the trip is shorter than it is. 21 active days really do hold 84
    // stops, and the target says so even while offering 100.
    const target = shortlistTarget(21, behaviourFor(['fast-paced']), 500);
    expect(target.capped).toBe(true);
    expect(target.capacity).toBe(84);
    expect(target.shortlist).toBe(100);
  });

  it('trims headroom before it ever trims the plan', () => {
    // At 21 active days the cap takes 118 down to 100, which is still above
    // the 84 the days hold — so nothing is lost, only the margin narrows.
    const target = shortlistTarget(21, behaviourFor(['fast-paced']), 500);
    expect(target.shortlist).toBeGreaterThan(target.capacity);
  });

  it('leaves a genuine shortfall visible on a trip too big for the ceiling', () => {
    // Beyond about 20 intensive days the ceiling really does offer fewer
    // places than the trip could hold, and that has to be legible.
    const huge = shortlistTarget(40, behaviourFor(['fast-paced']), 500);
    expect(huge.capped).toBe(true);
    expect(huge.capacity).toBeGreaterThan(huge.shortlist);
  });

  it('says so, so the shortfall is visible rather than discovered later', () => {
    expect(shortlistTarget(21, behaviourFor(['fast-paced']), 500).capped).toBe(true);
    expect(shortlistTarget(11, behaviourFor([]), 500).capped).toBe(false);
  });

  it('leaves every ordinary trip untouched', () => {
    // The cap must not quietly become the sizing rule for normal trips.
    for (const days of [3, 7, 11, 14]) {
      const target = shortlistTarget(days, behaviourFor([]), 500);
      expect(target.capped, `${days} days should size from capacity`).toBe(false);
    }
  });
});

describe('measuring what a build actually rejected', () => {
  const buildResult = (scheduled: number, reasons: string[]) => ({
    scheduledCandidates: Array.from({ length: scheduled }, (_, i) => ({ id: `s-${i}` })),
    unscheduledReasons: reasons.map((reason, i) => ({ candidate: { id: `u-${i}` }, reason, detail: '' })),
  } as unknown as Parameters<typeof measureShortlistFit>[0]);

  it('reports the headroom a real build implies', () => {
    // 10 accepted, 8 placed → 1.25×. This is the number that replaces the
    // guessed SHORTLIST_HEADROOM once real trips have been run.
    const measured = measureShortlistFit(buildResult(8, ['opening-hours-conflict', 'duplicate']));
    expect(measured.accepted).toBe(10);
    expect(measured.impliedHeadroom).toBeCloseTo(1.25);
    expect(measured.rejectionRate).toBeCloseTo(0.2);
  });

  it('breaks rejections down by cause, which decides the direction to tune', () => {
    // daily-capacity-reached means the shortlist was too long and headroom
    // should fall; the others mean places were lost to reality.
    const measured = measureShortlistFit(buildResult(5, [
      'daily-capacity-reached', 'daily-capacity-reached', 'walking-limit-exceeded',
    ]));
    expect(measured.byReason['daily-capacity-reached']).toBe(2);
    expect(measured.byReason['walking-limit-exceeded']).toBe(1);
  });

  it('claims no headroom from a build that placed nothing', () => {
    // A failed build says nothing about how much margin a real one needs, and
    // must not be averaged in as though it did.
    const measured = measureShortlistFit(buildResult(0, ['duplicate']));
    expect(measured.impliedHeadroom).toBe(0);
  });

  it('reports a clean build as needing no headroom at all', () => {
    const measured = measureShortlistFit(buildResult(6, []));
    expect(measured.rejectionRate).toBe(0);
    expect(measured.impliedHeadroom).toBe(1);
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

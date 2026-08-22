/**
 * Stale decisions.
 *
 * Decisions are restored by city and survive a re-discovery; the candidate list
 * does not. A provider can return a different set for the same city, and a
 * cached run can expire into a shorter one. Keeping every prior decision
 * produced the reported counter — "45 of 20 reviewed · 33 selected" alongside
 * "20 still to review", three numbers that cannot all be true — and, when none
 * of the retained ids appeared in the new list, a build that accepted nothing
 * while the traveller was looking at a shortlist of 33.
 */
import { describe, expect, it } from 'vitest';
import { buildDestinationItinerary, pruneDecisionsToCandidates, rankWithIntelligence } from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';
import { emptyItinerary } from './itinerarySanitize';
import type { CandidateDecision, PlaceCandidate } from './destinationIntelligence';
import type { Itinerary } from '../data';

/** Schedulable in full, so a build failure means the decisions were wrong. */
const place = (id: string, coordinates: [number, number] = [23.1291, 113.2644]): PlaceCandidate => ({
  id,
  provider: 'osm',
  providerPlaceId: `osm:${id}`,
  name: `Place ${id}`,
  countryCode: 'CN',
  city: 'Guangzhou',
  neighbourhood: 'Yue Xiu Qu',
  description: 'A place.',
  categories: ['sight'],
  experienceTags: ['history'],
  estimatedVisitMinutes: 90,
  indoorOutdoor: 'mixed',
  reservationStatus: 'not-needed',
  coordinates,
  sourceReferences: [{ label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/node/1' }],
  sourceConfidence: 'medium',
  lastVerifiedAt: '2026-08-01T00:00:00.000Z',
  openingHours: { periods: [{ opensAt: '09:00', closesAt: '18:00' }], sourceConfidence: 'high' },
} as unknown as PlaceCandidate);

const decisionsFor = (ids: string[], decision: CandidateDecision = 'must-do') =>
  Object.fromEntries(ids.map((id) => [id, decision])) as Record<string, CandidateDecision>;

describe('decisions are pruned to what is actually on offer', () => {
  it('keeps a decision whose place is still in the deck', () => {
    const result = pruneDecisionsToCandidates(decisionsFor(['a', 'b']), [place('a'), place('b')]);
    expect(result.decisions).toEqual({ a: 'must-do', b: 'must-do' });
    expect(result.dropped).toBe(0);
  });

  it('drops decisions about places the new run did not return', () => {
    // The reported case: far more decisions than candidates.
    const result = pruneDecisionsToCandidates(decisionsFor(['a', 'b', 'c', 'd']), [place('a')]);
    expect(Object.keys(result.decisions)).toEqual(['a']);
    expect(result.dropped).toBe(3);
  });

  it('clears everything when the run shares no places at all', () => {
    // This is what makes a build silently accept nothing: a full shortlist of
    // ids, none of which are in the ranked list the build receives.
    const result = pruneDecisionsToCandidates(decisionsFor(['old-1', 'old-2']), [place('new-1')]);
    expect(result.decisions).toEqual({});
    expect(result.dropped).toBe(2);
  });

  it('reports how many went, so the loss can be shown rather than hidden', () => {
    const result = pruneDecisionsToCandidates(decisionsFor(['a', 'b', 'c']), [place('c')]);
    expect(result.dropped).toBe(2);
  });

  it('preserves each decision to its own value, not just its presence', () => {
    const mixed: Record<string, CandidateDecision> = { a: 'must-do', b: 'interested', c: 'skip' };
    const result = pruneDecisionsToCandidates(mixed, [place('a'), place('b'), place('c')]);
    expect(result.decisions).toEqual(mixed);
  });

  it('handles an empty deck without inventing decisions', () => {
    const result = pruneDecisionsToCandidates(decisionsFor(['a']), []);
    expect(result.decisions).toEqual({});
    expect(result.dropped).toBe(1);
  });

  it('is keyed on id, because two places in a city can share a name', () => {
    const result = pruneDecisionsToCandidates(decisionsFor(['osm-1']), [place('osm-2')]);
    expect(result.decisions).toEqual({});
  });
});

describe('the counter the traveller sees becomes truthful', () => {
  it('never reports more places reviewed than exist', () => {
    // "45 of 20 reviewed" was this exact arithmetic.
    const candidates = [place('a'), place('b')];
    const { decisions } = pruneDecisionsToCandidates(
      decisionsFor(['a', 'b', 'gone-1', 'gone-2', 'gone-3']),
      candidates,
    );
    expect(Object.keys(decisions).length).toBeLessThanOrEqual(candidates.length);
  });
});

describe('a build after pruning uses the places actually chosen', () => {
  const profile: TripProfile = {
    ...createEmptyProfile('MYR'),
    destinations: [manualDestination('Guangzhou', 'China')],
    dayCount: 2,
  };
  const itinerary: Itinerary = {
    ...emptyItinerary,
    id: 'trip-1',
    days: [
      { day: 1, date: '2027-01-21', stayCity: 'Guangzhou', activityCities: [], city: 'Guangzhou', title: 'Day one', activities: [] },
      { day: 2, date: '2027-01-22', stayCity: 'Guangzhou', activityCities: [], city: 'Guangzhou', title: 'Day two', activities: [] },
    ],
  };

  it('schedules nothing when every decision was stale — the reported failure', () => {
    const candidates = [place('new-1'), place('new-2', [23.1350, 113.2700])];
    const ranked = rankWithIntelligence(candidates, profile);
    const stale = decisionsFor(['old-1', 'old-2']);

    const built = buildDestinationItinerary(itinerary, profile, ranked, stale);
    expect(built.scheduledCandidates).toHaveLength(0);
  });

  it('schedules the chosen places once the decisions refer to real candidates', () => {
    const candidates = [place('new-1'), place('new-2', [23.1350, 113.2700])];
    const ranked = rankWithIntelligence(candidates, profile);
    const chosen = decisionsFor(['new-1', 'new-2']);

    const built = buildDestinationItinerary(itinerary, profile, ranked, chosen);
    expect(built.scheduledCandidates.length).toBeGreaterThan(0);
  });
});

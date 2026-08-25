import { describe, expect, it } from 'vitest';
import { applyProposalToItinerary } from '../../supabase/functions/_shared/itineraryChange';
import type { TripItineraryProposal } from '../../supabase/functions/_shared/itineraryProposal';

const proposal: TripItineraryProposal = {
  kind: 'itinerary-proposal-v1',
  id: 'proposal-suggestion',
  tripId: 'trip-1',
  materialRevision: 'plan-v2-one',
  createdAt: '2026-08-25T12:00:00.000Z',
  status: 'valid',
  applied: false,
  pace: 'balanced',
  days: [{
    day: 1,
    stayCity: 'Tokyo',
    city: 'Tokyo',
    activityCities: ['Tokyo'],
    startTime: '10:00',
    endTime: '20:00',
    warnings: [],
    metrics: { placeCount: 1, travelMinutes: 0, freeMinutes: 510, clusterChanges: 0 },
    items: [{
      id: 'proposal-place',
      placeId: 'suggested:canonical-n42',
      type: 'place',
      name: 'Shinjuku Gyoen',
      arrivalTime: '10:00',
      startTime: '10:00',
      endTime: '11:30',
      visitDurationMinutes: 90,
      bufferMinutes: 0,
      rationale: 'Verified suggestion that fits the day.',
      warnings: [],
      evidence: ['https://www.openstreetmap.org/n42'],
      activityCity: 'Tokyo',
      suggestedPlace: {
        ref: { canonicalPlaceId: 'canonical-n42', provider: 'osm', providerPlaceId: 'n42' },
        name: 'Shinjuku Gyoen',
        city: 'Tokyo',
        location: 'Shinjuku',
        coordinates: [35.6852, 139.7101],
        categories: ['garden'],
        durationMinutes: 90,
        openingHours: [],
        sourceUrls: ['https://www.openstreetmap.org/n42'],
      },
    }],
  }],
  conflicts: [],
  warnings: [],
  omittedPlaceIds: [],
  routeSummary: { matrixCalls: 0, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
  repairIterations: 0,
  meta: {
    planningRunId: 'run-1', scope: { type: 'day', day: 1 }, source: 'fresh', savedPlaceCount: 0,
    suggestedPlaceCount: 1, assignedCount: 1, omittedCount: 0, routedLegCount: 0,
    validationVersion: 2, arrangementFingerprint: 'arrangement-1',
  },
};

describe('applying factual planning suggestions', () => {
  it('creates the suggested activity only at Apply and preserves canonical identity', () => {
    const result = applyProposalToItinerary({
      id: 'trip-1',
      revision: 1,
      days: [{ day: 1, stayCity: 'Tokyo', city: 'Tokyo', activities: [] }],
      unassignedActivities: [],
    }, proposal);

    expect(result.unresolvedPlaceIds).toEqual([]);
    expect(result.itinerary.days).toEqual([
      expect.objectContaining({
        activities: [expect.objectContaining({
          id: 'suggested:canonical-n42',
          name: 'Shinjuku Gyoen',
          placeRef: { canonicalPlaceId: 'canonical-n42', provider: 'osm', providerPlaceId: 'n42' },
          coordinates: [35.6852, 139.7101],
        })],
      }),
    ]);
  });
});

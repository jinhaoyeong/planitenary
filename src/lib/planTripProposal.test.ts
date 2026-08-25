import { describe, expect, it, vi } from 'vitest';
import { parseTripProposal, planTripProposal } from './planTripProposal';

const payload = {
  kind: 'itinerary-proposal-v1',
  id: 'proposal-1',
  tripId: 'trip-1',
  materialRevision: 'plan-v1-a',
  createdAt: '2026-08-16T08:00:00.000Z',
  status: 'valid',
  applied: false,
  pace: 'balanced',
  days: [{
    day: 1,
    date: '2026-08-17',
    city: 'Osaka',
    startTime: '09:15',
    endTime: '21:30',
    warnings: [],
    metrics: { placeCount: 1, travelMinutes: 0, freeMinutes: 300, clusterChanges: 0 },
    items: [{
      id: 'item-a', placeId: 'a', type: 'place', name: 'Osaka Castle',
      arrivalTime: '10:00', startTime: '10:00', endTime: '11:30', visitDurationMinutes: 90,
      bufferMinutes: 0, rationale: 'Must do', warnings: [], evidence: ['https://example.test/castle'],
    }],
  }],
  conflicts: [],
  warnings: [],
  omittedPlaceIds: [],
  routeSummary: { matrixCalls: 1, confirmedLegs: 0, unavailableLegs: 0, allDurationsProviderDerived: true },
  repairIterations: 0,
  meta: {
    planningRunId: 'planning-run-1',
    scope: { type: 'trip' },
    source: 'fresh',
    savedPlaceCount: 1,
    suggestedPlaceCount: 0,
    assignedCount: 1,
    omittedCount: 0,
    routedLegCount: 0,
    validationVersion: 2,
    arrangementFingerprint: 'arrangement-1',
  },
};

describe('Plan my trip client boundary', () => {
  it('accepts a proposal only when the server explicitly says it was not applied', () => {
    expect(parseTripProposal(payload)?.applied).toBe(false);
    expect(parseTripProposal({ ...payload, applied: true })).toBeUndefined();
  });

  it('calls only the read-only build operation and never asks to save', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'answered', outcome: 'ready', itineraryProposal: payload, applied: false });
    const result = await planTripProposal('trip-1', invoke);

    expect(result.status).toBe('answered');
    expect(result.proposal?.days[0].items[0].name).toBe('Osaka Castle');
    expect(invoke).toHaveBeenCalledWith('planitenary-agent', {
      operation: 'build-itinerary',
      tripId: 'trip-1',
      question: 'Build a complete proposal from my saved trip material.',
      planningRequest: {
        scope: { type: 'trip' },
        sourcePolicy: 'saved-plus-suggestions',
        cachePolicy: 'prefer-cache',
      },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/save_itinerary|apply_changes|update_activity/);
  });

  it('fails safely on malformed output', async () => {
    const result = await planTripProposal('trip-1', vi.fn().mockResolvedValue({ status: 'answered', itineraryProposal: { applied: true } }));
    expect(result).toEqual({
      status: 'refused',
      outcome: 'failed',
      detail: 'The planner returned a malformed proposal, so it was not shown.',
      progress: [],
      cached: false,
    });
  });

  it('never displays an ORS walking duration as public transport', () => {
    const withMislabeledRoute = {
      ...payload,
      days: [{
        ...payload.days[0],
        items: [{
          ...payload.days[0].items[0],
          travelFromPrevious: {
            fromPlaceId: 'hotel',
            fromName: 'Hotel',
            mode: 'public-transport',
            requestedMode: 'public-transport',
            providerMode: 'foot-walking',
            provider: 'openrouteservice',
            durationMinutes: 27,
            source: 'provider',
            status: 'confirmed',
          },
        }],
      }],
    };

    expect(parseTripProposal(withMislabeledRoute)?.days[0].items[0].travelFromPrevious).toMatchObject({
      mode: 'public-transport',
      providerMode: 'foot-walking',
      status: 'unavailable',
      source: 'unavailable',
      durationMinutes: undefined,
    });
  });
});

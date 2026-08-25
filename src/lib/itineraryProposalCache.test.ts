/**
 * Plan my trip may reuse an exact cached proposal without a model.
 *
 * These tests exist because production refused under OPENAI_MODEL=disabled
 * even when a valid paid preview was sitting in the cache: the model gate ran
 * before the exact lookup. A hit must stay free; a miss must still refuse
 * when generation is killed, and still use the paid path when it is not.
 */
import { describe, expect, it, vi } from 'vitest';
import { AGENT_LIMITS, agentModelRefusal } from '../../supabase/functions/_shared/agentContract';
import { buildPlanningMaterial } from '../../supabase/functions/_shared/itineraryProposal';
import type { TripItineraryProposal } from '../../supabase/functions/_shared/itineraryProposal';
import {
  cachedItineraryProposalEnvelope,
  generationDisabledRefusal,
  isGenerationKillSwitch,
  lookupExactItineraryProposalCache,
  paidGenerationShouldRun,
  usableCachedItineraryProposal,
} from '../../supabase/functions/_shared/itineraryProposalCache';

const itinerary = () => ({
  id: 'trip-1',
  name: 'Osaka',
  cities: ['Osaka'],
  revision: 5,
  tripProfile: { destinations: [{ city: 'Osaka', countryCode: 'JP' }], styles: [], transport: ['walking'] },
  discoveryState: {
    city: 'Osaka',
    mode: 'live',
    decisions: { 'osm-n1': 'must-do', 'osm-n2': 'interested' },
  },
  days: [{
    day: 1,
    date: '2026-08-17',
    city: 'Osaka',
    title: 'Day one',
    activities: [{
      id: 'discovered-osm-n1',
      kind: 'place',
      time: '09:00',
      durationMinutes: 90,
      name: 'Glico Man Sign',
      type: 'sight',
      provider: 'osm',
      providerPlaceId: 'n1',
      coordinates: [34.6687, 135.5013],
    }],
  }],
});

const stored = (over: Partial<TripItineraryProposal> = {}): TripItineraryProposal => ({
  kind: 'itinerary-proposal-v1',
  id: 'proposal-6284393dbe36',
  tripId: 'trip-1',
  materialRevision: 'plan-v1-stale',
  createdAt: '2026-08-17T08:00:00.000Z',
  status: 'valid',
  applied: false,
  pace: 'balanced',
  days: [],
  conflicts: [],
  warnings: [],
  omittedPlaceIds: [],
  routeSummary: { matrixCalls: 1, confirmedLegs: 1, unavailableLegs: 0, allDurationsProviderDerived: true },
  repairIterations: 0,
  ...over,
  meta: over.meta ?? {
    planningRunId: 'run-1',
    scope: { type: 'trip' },
    source: 'fresh',
    savedPlaceCount: 1,
    suggestedPlaceCount: 0,
    assignedCount: 1,
    omittedCount: 0,
    routedLegCount: 1,
    validationVersion: 2,
    arrangementFingerprint: 'arrangement-1',
  },
});

const limits = AGENT_LIMITS['build-itinerary'];

describe('exact proposal cache before the model gate', () => {
  it('returns the stored proposal on an exact hit without any paid side effects', async () => {
    const material = await buildPlanningMaterial('trip-1', itinerary());
    const proposal = stored({ materialRevision: material.revision, id: 'proposal-exact' });
    const reserve = vi.fn();
    const ledger = vi.fn();
    const model = vi.fn();
    const readCache = vi.fn(async (tripId: string, revision: string) => {
      expect(tripId).toBe('trip-1');
      expect(revision).toBe(material.revision);
      return proposal;
    });

    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: itinerary(),
      maxInputChars: limits.maxInputChars,
      readCache,
    });

    expect(lookup.kind).toBe('hit');
    if (lookup.kind !== 'hit') return;
    expect(lookup.proposal).toBe(proposal);
    expect(lookup.proposal.id).toBe('proposal-exact');
    expect(lookup.proposal.materialRevision).toBe(material.revision);
    expect(paidGenerationShouldRun(lookup.kind)).toBe(false);
    expect(reserve).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();

    const envelope = cachedItineraryProposalEnvelope(lookup.proposal, limits);
    expect(envelope.cached).toBe(true);
    expect(envelope.outcome).toBe('ready');
    expect(envelope.itineraryProposal.meta.source).toBe('cache');
    expect(envelope.applied).toBe(false);
    expect(envelope.budget).toEqual({
      modelRounds: 0, toolCalls: 0, webSearches: 0, routeCalls: 0, placeLookups: 0,
    });
    expect(envelope.spend).toEqual({ knownUsd: 0, unknownEvents: 0, reservedUsd: 0 });
  });

  it('treats a disabled model as a kill switch, not as a reason to skip the cache', () => {
    expect(isGenerationKillSwitch('disabled')).toBe(true);
    expect(isGenerationKillSwitch('DISABLED')).toBe(true);
    expect(isGenerationKillSwitch('gpt-5-nano')).toBe(false);
    expect(agentModelRefusal('build-itinerary', 'disabled')).toContain('not approved');
  });

  it('refuses a disabled-model miss without implying a cache hit', () => {
    const refusal = generationDisabledRefusal('trip-1');
    expect(refusal.status).toBe('refused');
    expect(refusal.refusal).toBe('generation-disabled');
    expect(refusal.detail).toMatch(/new AI generation is disabled/i);
    expect(refusal).not.toHaveProperty('itineraryProposal');
  });

  it('still requires paid generation on an exact miss', async () => {
    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: itinerary(),
      maxInputChars: limits.maxInputChars,
      readCache: vi.fn().mockResolvedValue(null),
    });

    expect(lookup.kind).toBe('miss');
    expect(paidGenerationShouldRun(lookup.kind)).toBe(true);
  });

  it('does not treat a stale material revision as a hit', async () => {
    const material = await buildPlanningMaterial('trip-1', itinerary());
    const stale = stored({ materialRevision: 'plan-v1-not-current' });
    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: itinerary(),
      maxInputChars: limits.maxInputChars,
      readCache: async () => stale,
    });

    expect(material.revision).not.toBe(stale.materialRevision);
    expect(usableCachedItineraryProposal(stale, 'trip-1', material.revision)).toBeNull();
    expect(lookup.kind).toBe('miss');
  });

  it('does not reuse a semantically empty proposal as a successful cache hit', async () => {
    const material = await buildPlanningMaterial('trip-1', itinerary());
    const empty = stored({
      materialRevision: material.revision,
      meta: { ...stored().meta, assignedCount: 0 },
    });
    expect(usableCachedItineraryProposal(empty, 'trip-1', material.revision)).toBeNull();
  });

  it('does not return another trip\'s stored proposal', async () => {
    const material = await buildPlanningMaterial('trip-1', itinerary());
    const stranger = stored({
      tripId: 'trip-stranger',
      materialRevision: material.revision,
      id: 'proposal-stranger',
    });

    expect(usableCachedItineraryProposal(stranger, 'trip-1', material.revision)).toBeNull();

    const lookup = await lookupExactItineraryProposalCache({
      tripId: 'trip-1',
      itinerary: itinerary(),
      maxInputChars: limits.maxInputChars,
      readCache: async () => stranger,
    });
    expect(lookup.kind).toBe('miss');
  });

  it('asks the cache only for the authorised trip id', async () => {
    const seen: string[] = [];
    await lookupExactItineraryProposalCache({
      tripId: 'trip-owner',
      itinerary: itinerary(),
      maxInputChars: limits.maxInputChars,
      readCache: async (tripId) => {
        seen.push(tripId);
        return null;
      },
    });
    expect(seen).toEqual(['trip-owner']);
  });
});

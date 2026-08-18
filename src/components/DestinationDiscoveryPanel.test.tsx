// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { CurrencyProvider } from '../contexts/CurrencyContext';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import type { PlaceCandidate } from '../lib/destinationIntelligence';
import { DestinationDiscoveryPanel } from './DestinationDiscoveryPanel';

interface MaterialFixtureOverride {
  matchedStyleTags?: string[];
  indoorOutdoor?: 'indoor' | 'outdoor' | 'both' | null;
  durationRangeMinutes?: [number, number] | null;
  clusterId?: string | null;
  pairableCandidateIds?: string[];
}

const mocks = vi.hoisted(() => ({
  invokeTravelFunction: vi.fn(),
  invokeTravelReasoning: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));

const materialFixture = vi.hoisted(() => ({
  candidate: new Map<string, MaterialFixtureOverride>(),
  planner: new Map<string, MaterialFixtureOverride>(),
}));

const discoveryFixture = vi.hoisted(() => ({
  candidates: null as PlaceCandidate[] | null,
}));

vi.mock('../lib/destinationFixtures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/destinationFixtures')>();
  return {
    ...actual,
    FixturePlaceDiscoveryProvider: class {
      readonly mode = 'fixture' as const;

      async search() {
        return structuredClone(discoveryFixture.candidates ?? actual.OSAKA_PLACE_FIXTURE);
      }

      async details(providerPlaceId: string) {
        const candidate = (discoveryFixture.candidates ?? actual.OSAKA_PLACE_FIXTURE)
          .find((item) => item.providerPlaceId === providerPlaceId);
        if (!candidate) throw new Error(`Fixture place ${providerPlaceId} was not found.`);
        return structuredClone(candidate);
      }
    },
  };
});

vi.mock('../../supabase/functions/_shared/intelligenceMaterial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/intelligenceMaterial')>();
  return {
    ...actual,
    toCandidateIntelligenceMaterial: (candidate: Parameters<typeof actual.toCandidateIntelligenceMaterial>[0]) => {
      const override = materialFixture.candidate.get(candidate.candidateId);
      const fixtureCandidate = override ? {
        ...candidate,
        ...(override.matchedStyleTags !== undefined ? { matchedStyleTags: override.matchedStyleTags } : {}),
        ...(override.indoorOutdoor !== undefined ? { indoorOutdoor: override.indoorOutdoor ?? undefined } : {}),
        ...(override.durationRangeMinutes !== undefined
          ? { durationRangeMinutes: override.durationRangeMinutes ?? undefined }
          : {}),
      } : candidate;
      return actual.toCandidateIntelligenceMaterial(fixtureCandidate);
    },
    toPlannerIntelligenceMaterial: (candidate: Parameters<typeof actual.toPlannerIntelligenceMaterial>[0]) => {
      const override = materialFixture.planner.get(candidate.candidateId);
      const fixtureCandidate = override ? {
        ...candidate,
        ...(override.clusterId !== undefined ? { clusterId: override.clusterId ?? undefined } : {}),
        ...(override.pairableCandidateIds !== undefined
          ? { pairableCandidateIds: override.pairableCandidateIds }
          : {}),
      } : candidate;
      return actual.toPlannerIntelligenceMaterial(fixtureCandidate);
    },
  };
});

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  invokeTravelFunction: mocks.invokeTravelFunction,
  invokeTravelReasoning: mocks.invokeTravelReasoning,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const pendingRequests: Array<Deferred<unknown>> = [];

const profileFor = (over: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-06',
  dayCount: 5,
  styles: ['temples'],
  ...over,
});

const itineraryFor = (profile: TripProfile, over: Partial<Itinerary> = {}): Itinerary => ({
  id: 'destination-intelligence-test',
  name: 'Osaka test trip',
  cities: ['Osaka'],
  description: 'A test trip.',
  tripProfile: profile,
  days: [],
  ...over,
});

const renderPanel = (initialProfile = profileFor(), initialItinerary = itineraryFor(initialProfile)) => {
  const onItineraryChange = vi.fn();
  const view = render(
    <CurrencyProvider>
      <DestinationDiscoveryPanel
        itinerary={initialItinerary}
        profile={initialProfile}
        onItineraryChange={onItineraryChange}
      />
    </CurrencyProvider>,
  );

  return {
    ...view,
    onItineraryChange,
    rerenderPanel: (nextProfile: TripProfile, nextItinerary = itineraryFor(nextProfile)) => {
      view.rerender(
        <CurrencyProvider>
          <DestinationDiscoveryPanel
            itinerary={nextItinerary}
            profile={nextProfile}
            onItineraryChange={onItineraryChange}
          />
        </CurrencyProvider>,
      );
    },
  };
};

const waitForRequest = async (count: number) => {
  await waitFor(() => expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(count));
};

const resolveEmpty = async (index: number) => {
  await act(async () => {
    pendingRequests[index].resolve({ results: [] });
    await pendingRequests[index].promise;
  });
};

const candidateIdsFor = (index: number) => {
  const input = mocks.invokeTravelReasoning.mock.calls[index]?.[1] as {
    candidates?: Array<{ candidateId: string }>;
  } | undefined;
  return input?.candidates?.map(({ candidateId }) => candidateId) || [OSAKA_PLACE_FIXTURE[0].id];
};

const responseFor = (index: number, recommendation: 'must-do' | 'interested' = 'must-do') => {
  const candidateIds = candidateIdsFor(index);
  return {
    results: candidateIds.map((candidateId) => ({
      candidateId,
      status: 'ready',
      intelligence: {
        candidateId,
        personalFitScore: recommendation === 'must-do' ? 90 : 70,
        recommendation,
        reasons: [],
        cautions: [],
        pairWithCandidateIds: [],
        suggestedDurationMinutes: null,
      },
    })),
  };
};

const resolvePayload = async (index: number, payload: unknown) => {
  await act(async () => {
    pendingRequests[index].resolve(payload);
    await pendingRequests[index].promise;
  });
};

const resolveResponse = async (index: number, recommendation: 'must-do' | 'interested') => {
  await resolvePayload(index, responseFor(index, recommendation));
};

const deterministicOnlyResponse = (index: number) => ({
  results: candidateIdsFor(index).map((candidateId) => ({
    candidateId,
    status: 'deterministic-only',
    intelligence: null,
  })),
});

const responseWithPairings = (index: number, validId: string, missingId: string) => ({
  results: candidateIdsFor(index).map((candidateId) => ({
    candidateId,
    status: 'ready',
    intelligence: {
      candidateId,
      personalFitScore: 90,
      recommendation: 'must-do',
      reasons: [],
      cautions: [],
      pairWithCandidateIds: [validId, missingId],
      suggestedDurationMinutes: null,
    },
  })),
});

const setCandidateMaterial = (candidateId: string, override: MaterialFixtureOverride) => {
  materialFixture.candidate.set(candidateId, {
    ...materialFixture.candidate.get(candidateId),
    ...override,
  });
};

const setPlannerMaterial = (candidateId: string, override: MaterialFixtureOverride) => {
  materialFixture.planner.set(candidateId, {
    ...materialFixture.planner.get(candidateId),
    ...override,
  });
};

const deterministicHeading = () => screen.getByRole('heading', { name: /Why it is (?:on your list|#\d+ for you)/ });

const forceMobileReview = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 639px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

const waitForStart = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: /^Start$/ })).toBeInTheDocument());
};

const activeCardLabel = () => document
  .querySelector('.destination-flip-face.is-front')
  ?.getAttribute('aria-label');

const startReview = async (profile = profileFor()) => {
  const panel = renderPanel(profile);
  await waitForStart();
  fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
  await waitForRequest(1);
  return panel;
};

const clickDecision = async (name: 'Skip' | 'Must do' | 'Interested' | 'Details') => {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name }));
};

beforeEach(() => {
  localStorage.clear();
  pendingRequests.length = 0;
  materialFixture.candidate.clear();
  materialFixture.planner.clear();
  discoveryFixture.candidates = null;
  mocks.invokeTravelFunction.mockReset();
  mocks.invokeTravelFunction.mockRejectedValue(new Error('offline in component test'));
  mocks.invokeTravelReasoning.mockReset();
  mocks.invokeTravelReasoning.mockImplementation(() => {
    const next = deferred<unknown>();
    pendingRequests.push(next);
    return next.promise;
  });
  // CurrencyProvider probes its live-rate endpoints on mount. Keep that
  // unrelated network activity deterministic and immediate in this suite.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rates: { MYR: 1, JPY: 33 }, date: '2027-04-02' }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DestinationDiscoveryPanel intelligence request lifecycle', () => {
  it('keeps the first request across equivalent rerenders and decision-only UI changes', async () => {
    const panel = await startReview();
    await resolveEmpty(0);

    // Rebuilt prop objects are still equivalent material. The scalar key may
    // be recomputed, but it must not become a new effect trigger.
    for (let index = 0; index < 50; index += 1) {
      panel.rerenderPanel(profileFor());
    }

    const front = screen.getByRole('button', { name: /Show details for/ });
    fireEvent.click(front);
    fireEvent.click(screen.getByRole('button', { name: /Flip card back/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: /Flip card back/ }));

    await clickDecision('Skip');
    await clickDecision('Details');
    await clickDecision('Interested');
    await clickDecision('Must do');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Back$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);
  });

  it('lets mobile reviewers switch to browse-all and back to the deck', async () => {
    forceMobileReview();
    await startReview();
    await resolveEmpty(0);

    fireEvent.click(screen.getByRole('button', { name: 'Browse all' }));
    expect(screen.getByRole('button', { name: 'One at a time' })).toBeInTheDocument();
    expect(document.querySelector('.destination-review-groups')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'One at a time' }));
    expect(screen.getByRole('button', { name: 'Close place review' })).toBeInTheDocument();
  });

  it('lets a desktop reviewer close an accidental Start without applying', async () => {
    const panel = await startReview();
    await resolveEmpty(0);

    expect(screen.getByRole('heading', { name: /Choose what belongs/ })).toBeInTheDocument();
    const itineraryWritesBeforeClose = panel.onItineraryChange.mock.calls.length;
    const closeButtons = screen.getAllByRole('button', { name: 'Close place review' });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(closeButtons[0]);

    await waitForStart();
    expect(screen.getByRole('heading', { name: /Build (your|a) / })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Choose what belongs/ })).not.toBeInTheDocument();
    expect(panel.onItineraryChange.mock.calls.length).toBe(itineraryWritesBeforeClose);
  });

  it('lets a mobile reviewer close an accidental Start without applying', async () => {
    forceMobileReview();
    const panel = await startReview();
    await resolveEmpty(0);

    expect(screen.getByRole('heading', { name: /Choose places for / })).toBeInTheDocument();
    const itineraryWritesBeforeClose = panel.onItineraryChange.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Close place review' }));

    await waitForStart();
    expect(screen.getByRole('heading', { name: /Build (your|a) / })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Choose places for / })).not.toBeInTheDocument();
    expect(panel.onItineraryChange.mock.calls.length).toBe(itineraryWritesBeforeClose);
  });

  it('keeps non-model trip edits on the existing key, while styles and pace issue new requests', async () => {
    const panel = await startReview();
    const base = profileFor();

    // These edits are intentionally chosen not to alter inferred pace. The
    // intelligence contract sees neither the fields themselves nor a derived
    // change in pace, so none may buy another answer.
    const nonModelProfiles: TripProfile[] = [
      { ...base, tripTypes: ['food'] },
      { ...base, moods: ['festive'] },
      { ...base, budgetTier: 'luxury' },
      { ...base, startDate: '2027-04-03', endDate: '2027-04-07' },
      { ...base, arrivalTime: '18:00', departureTime: '07:00' },
      { ...base, stays: ['hotel'] },
      { ...base, hiddenGems: true },
    ];
    for (const next of nonModelProfiles) panel.rerenderPanel(next);
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);

    panel.rerenderPanel({ ...base, styles: ['museums'] });
    await waitForRequest(2);
    panel.rerenderPanel({ ...base, moods: ['slow-living'] });
    await waitForRequest(3);
  });

  it('does not retry a failed key during rerenders, but permits a later material change', async () => {
    const panel = await startReview();

    await act(async () => {
      pendingRequests[0].reject(new Error('provider unavailable'));
      await pendingRequests[0].promise.catch(() => undefined);
    });

    for (let index = 0; index < 50; index += 1) {
      panel.rerenderPanel(profileFor());
    }
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);

    panel.rerenderPanel(profileFor({ styles: ['museums'] }));
    await waitForRequest(2);
  });

  it('ignores a stale A response after B wins, without moving the active card', async () => {
    const panel = await startReview();

    panel.rerenderPanel(profileFor({ styles: ['museums'] }));
    await waitForRequest(2);
    fireEvent.click(screen.getByRole('button', { name: /Show details for/ }));
    await resolveResponse(1, 'interested');
    await waitFor(() => expect(screen.getByText('Good fit for your trip')).toBeInTheDocument());
    const activeAfterBResolves = activeCardLabel();

    await resolveResponse(0, 'must-do');
    expect(screen.getByText('Good fit for your trip')).toBeInTheDocument();
    expect(screen.queryByText('Strong fit for your trip')).not.toBeInTheDocument();
    expect(activeCardLabel()).toBe(activeAfterBResolves);
  });

  it('reuses held A intelligence after moving A to B and back to A', async () => {
    const panel = await startReview();
    fireEvent.click(screen.getByRole('button', { name: /Show details for/ }));
    await resolveResponse(0, 'must-do');
    await waitFor(() => expect(screen.getByText('Strong fit for your trip')).toBeInTheDocument());

    panel.rerenderPanel(profileFor({ styles: ['museums'] }));
    await waitForRequest(2);
    await resolveResponse(1, 'interested');
    await waitFor(() => expect(screen.getByText('Good fit for your trip')).toBeInTheDocument());

    panel.rerenderPanel(profileFor());
    await waitFor(() => expect(screen.getByText('Strong fit for your trip')).toBeInTheDocument());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(2);
  });

  it('invalidates candidate material at the real panel boundary, but normalises equivalent values', async () => {
    const targetId = OSAKA_PLACE_FIXTURE[0].id;
    materialFixture.candidate.set(targetId, {
      matchedStyleTags: ['baseline-style'],
      indoorOutdoor: 'indoor',
      durationRangeMinutes: [30, 60],
    });

    const panel = await startReview();
    await resolveEmpty(0);

    setCandidateMaterial(targetId, { matchedStyleTags: ['changed-style'] });
    panel.rerenderPanel(profileFor());
    await waitForRequest(2);
    await resolveEmpty(1);

    // Sets are canonical: duplicates do not create a second material state.
    setCandidateMaterial(targetId, { matchedStyleTags: ['changed-style', 'changed-style'] });
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(2);

    setCandidateMaterial(targetId, { indoorOutdoor: 'outdoor' });
    panel.rerenderPanel(profileFor());
    await waitForRequest(3);
    await resolveEmpty(2);

    setCandidateMaterial(targetId, { indoorOutdoor: 'outdoor' });
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(3);

    setCandidateMaterial(targetId, { durationRangeMinutes: [45, 90] });
    panel.rerenderPanel(profileFor());
    await waitForRequest(4);
    await resolveEmpty(3);

    setCandidateMaterial(targetId, { durationRangeMinutes: [45, 90] });
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(4);
  });

  it('invalidates planner relationships from the canonical pool, not the decision-filtered deck', async () => {
    const targetId = OSAKA_PLACE_FIXTURE[0].id;
    const firstPairId = OSAKA_PLACE_FIXTURE[1].id;
    const secondPairId = OSAKA_PLACE_FIXTURE[2].id;
    materialFixture.planner.set(targetId, {
      clusterId: 'cluster-a',
      pairableCandidateIds: [firstPairId, secondPairId],
    });

    const panel = await startReview();
    await resolveEmpty(0);

    setPlannerMaterial(targetId, { clusterId: 'cluster-b' });
    panel.rerenderPanel(profileFor());
    await waitForRequest(2);
    await resolveEmpty(1);

    setPlannerMaterial(targetId, { pairableCandidateIds: [secondPairId, firstPairId] });
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(2);

    setPlannerMaterial(targetId, { pairableCandidateIds: [firstPairId] });
    panel.rerenderPanel(profileFor());
    await waitForRequest(3);
    await resolveEmpty(2);

    // Filtering the pending deck is a UI decision, not new model material.
    await clickDecision('Skip');
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(3);
  });

  it('keeps deterministic rationale when the provider is unavailable', async () => {
    const panel = await startReview();
    await clickDecision('Details');
    await act(async () => {
      pendingRequests[0].reject(new Error('reasoning provider unavailable'));
      await pendingRequests[0].promise.catch(() => undefined);
    });

    expect(deterministicHeading()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);
  });

  it('keeps deterministic rationale when the reasoning response is malformed', async () => {
    const panel = await startReview();
    await clickDecision('Details');
    await resolvePayload(0, { notResults: 'malformed' });

    expect(deterministicHeading()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);
  });

  it('keeps deterministic rationale when every candidate is deterministic-only', async () => {
    const panel = await startReview();
    await clickDecision('Details');
    await resolvePayload(0, deterministicOnlyResponse(0));

    expect(deterministicHeading()).toBeInTheDocument();
    expect(screen.queryByText('Strong fit for your trip')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    panel.rerenderPanel(profileFor());
    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);
  });

  it('augments the active card without changing deck state or itinerary decisions', async () => {
    const panel = await startReview();
    const firstActive = activeCardLabel();

    await clickDecision('Must do');
    await waitFor(() => expect(activeCardLabel()).not.toBe(firstActive));
    await clickDecision('Details');
    const activeBefore = activeCardLabel();
    const progressBefore = document.querySelector('.destination-review-progress')?.getAttribute('aria-label')
      ?? screen.getByText(/of \d+ reviewed/).textContent;
    const historyBefore = document.querySelector('.destination-deck-rail-history')?.textContent;
    const itineraryCallsBefore = panel.onItineraryChange.mock.calls.length;
    const flippedBefore = document.querySelector('.destination-flip-scene.is-flipped') !== null;

    expect(activeBefore).not.toBe(firstActive);
    expect(flippedBefore).toBe(true);

    await resolveResponse(0, 'must-do');
    await waitFor(() => expect(screen.getByText('Strong fit for your trip')).toBeInTheDocument());

    expect(activeCardLabel()).toBe(activeBefore);
    expect(document.querySelector('.destination-flip-scene.is-flipped')).not.toBeNull();
    expect(document.querySelector('.destination-review-progress')?.getAttribute('aria-label')
      ?? screen.getByText(/of \d+ reviewed/).textContent).toBe(progressBefore);
    expect(document.querySelector('.destination-deck-rail-history')?.textContent).toBe(historyBefore);
    expect(panel.onItineraryChange.mock.calls.length).toBe(itineraryCallsBefore);
  });

  it('resolves valid pairings to current names, omits missing IDs, and ignores display-name-only changes', async () => {
    forceMobileReview();
    const panel = await startReview();
    const activeName = activeCardLabel()?.replace(/^Show details for /, '');
    const activeCandidate = OSAKA_PLACE_FIXTURE.find((candidate) => candidate.name === activeName);
    const validCandidate = OSAKA_PLACE_FIXTURE.find((candidate) => candidate.id !== activeCandidate?.id)!;
    const missingId = 'ghost-candidate-id';

    await clickDecision('Details');
    await resolvePayload(0, responseWithPairings(0, validCandidate.id, missingId));
    await waitFor(() => expect(document.querySelector('.destination-detail-note')).not.toBeNull());

    const pairingNote = document.querySelector('.destination-detail-note')?.textContent || '';
    expect(pairingNote).toContain(validCandidate.name);
    expect(pairingNote).not.toContain(missingId);
    expect(document.body.textContent).not.toContain(missingId);

    fireEvent.click(screen.getByRole('button', { name: 'Close place review' }));
    await waitForStart();
    const renamedName = `${activeCandidate?.name || 'Current place'} — corrected name`;
    discoveryFixture.candidates = OSAKA_PLACE_FIXTURE.map((candidate) => (
      candidate.id === activeCandidate?.id ? { ...candidate, name: renamedName } : { ...candidate }
    ));
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    await waitFor(() => expect(screen.getAllByText(renamedName).length).toBeGreaterThan(0));

    expect(mocks.invokeTravelReasoning).toHaveBeenCalledTimes(1);
    expect(panel.onItineraryChange).toHaveBeenCalled();
  });

  it('sends only the v5 model-visible fields from the real panel boundary', async () => {
    await startReview(profileFor({ styles: ['temples', 'history'] }));

    const request = mocks.invokeTravelReasoning.mock.calls[0][1] as {
      trip: Record<string, unknown>;
      candidates: Array<Record<string, unknown>>;
    };
    expect(request.trip).toEqual(expect.objectContaining({ styles: ['history', 'temples'], pace: 'balanced' }));
    expect(request.trip).not.toHaveProperty('interests');
    expect(request.candidates[0]).toEqual(expect.objectContaining({
      candidateId: expect.any(String),
      candidateRevision: expect.any(String),
      plannerRevision: expect.any(String),
      matchedStyleTags: expect.any(Array),
      pairableCandidateIds: [],
    }));
    expect(request.candidates[0]).not.toHaveProperty('matchedInterestTags');
    expect(JSON.stringify(request)).not.toContain('weak-profile-match');
  });
});

describe('saved-place decision binding in review UI', () => {
  const listing: PlaceCandidate = {
    id: 'wikivoyage-Kushida%20Shrine',
    provider: 'wikivoyage',
    providerPlaceId: 'wv:Kushida Shrine',
    name: 'Kushida Shrine',
    city: 'Osaka',
    countryCode: 'JP',
    categories: ['history'],
    experienceTags: ['history'],
    estimatedVisitMinutes: 90,
    indoorOutdoor: 'outdoor',
    reservationStatus: 'not-needed',
    coordinates: [33.5931, 130.4107],
    sourceReferences: [{ label: 'Wikivoyage', url: 'https://en.wikivoyage.org/wiki/Osaka' }],
    sourceConfidence: 'medium',
    lastVerifiedAt: '2026-08-18T00:00:00.000Z',
  } as PlaceCandidate;

  const otherListing: PlaceCandidate = {
    ...listing,
    id: 'wikivoyage-Dotonbori',
    providerPlaceId: 'wv:Dotonbori',
    name: 'Dotonbori',
    coordinates: [34.6687, 135.5013],
  };

  const savedKushida: Activity = {
    id: 'activity-legacy-iwbmuz',
    time: '09:00',
    name: 'Kushida Shrine',
    description: 'Added manually',
    type: 'sight',
    source: 'manual',
    coordinates: [33.59307, 130.4106837],
    locked: false,
    lockedFields: [],
  };

  const savedItinerary = (over: Partial<Itinerary> = {}): Itinerary => ({
    ...itineraryFor(profileFor()),
    cities: ['Osaka'],
    days: [{
      day: 1,
      date: '2026-08-20',
      city: 'Osaka',
      title: 'Day one',
      activities: [savedKushida],
    }],
    ...over,
  });

  const latestDecisions = (panel: { onItineraryChange: ReturnType<typeof vi.fn> }) => {
    const calls = panel.onItineraryChange.mock.calls as Array<[Itinerary]>;
    return calls[calls.length - 1]?.[0]?.discoveryState?.decisions || {};
  };

  const resetIntelligenceQueue = () => {
    pendingRequests.length = 0;
    mocks.invokeTravelReasoning.mockClear();
  };

  const browseAll = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Browse all' }));
    await waitFor(() => expect(document.querySelector('.destination-candidate')).not.toBeNull());
  };

  const startSavedReview = async (itinerary = savedItinerary(), listings: PlaceCandidate[] = [listing, otherListing]) => {
    discoveryFixture.candidates = listings;
    const panel = renderPanel(profileFor(), itinerary);
    await waitForStart();
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    await waitForRequest(1);
    await resolveEmpty(0);
    await browseAll();
    return panel;
  };

  it('uses the saved activity as the decision target for an unmatched manual place', async () => {
    const panel = await startSavedReview();
    const savedCard = document.querySelector('[data-decision-target="activity-legacy-iwbmuz"]');
    const listingCard = document.querySelector('[data-candidate-id="wikivoyage-Kushida%20Shrine"]');
    expect(savedCard).not.toBeNull();
    expect(savedCard?.getAttribute('data-candidate-id')).toBe('activity-legacy-iwbmuz');
    expect(listingCard?.getAttribute('data-decision-target')).toBe('wikivoyage-Kushida%20Shrine');
    expect(document.querySelectorAll('[data-candidate-id="activity-legacy-iwbmuz"]')).toHaveLength(1);
    expect(screen.getAllByText('Must do').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Interested').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skip').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Visited').length).toBeGreaterThan(0);

    const skip = savedCard?.querySelector('input[value="skip"]') as HTMLInputElement;
    fireEvent.click(skip);
    const saved = panel.onItineraryChange.mock.calls.at(-1)?.[0] as Itinerary;
    expect(latestDecisions(panel)['activity-legacy-iwbmuz']).toBe('skip');
    expect(saved.days[0].activities.some((activity) => activity.id === 'activity-legacy-iwbmuz')).toBe(true);
  });

  it('does not write the saved activity when the same-name listing is skipped', async () => {
    const panel = await startSavedReview();
    const listingCard = document.querySelector('[data-candidate-id="wikivoyage-Kushida%20Shrine"]');
    fireEvent.click(listingCard?.querySelector('input[value="skip"]') as HTMLInputElement);
    const decisions = latestDecisions(panel);
    expect(decisions['wikivoyage-Kushida%20Shrine']).toBe('skip');
    expect(decisions['activity-legacy-iwbmuz']).toBeUndefined();
  });

  it('keeps Must do and Interested working on unsaved listings', async () => {
    const panel = await startSavedReview();
    const listingCard = document.querySelector('[data-candidate-id="wikivoyage-Dotonbori"]');
    fireEvent.click(listingCard?.querySelector('input[value="must-do"]') as HTMLInputElement);
    expect(latestDecisions(panel)['wikivoyage-Dotonbori']).toBe('must-do');
    fireEvent.click(listingCard?.querySelector('input[value="interested"]') as HTMLInputElement);
    expect(latestDecisions(panel)['wikivoyage-Dotonbori']).toBe('interested');
  });

  it('persists Skip on the saved activity after reload', async () => {
    const panel = await startSavedReview();
    fireEvent.click(document.querySelector('[data-decision-target="activity-legacy-iwbmuz"] input[value="skip"]') as HTMLInputElement);
    const saved = panel.onItineraryChange.mock.calls.at(-1)?.[0] as Itinerary;
    panel.unmount();

    resetIntelligenceQueue();
    discoveryFixture.candidates = [listing, otherListing];
    renderPanel(profileFor(), saved);
    await waitForStart();
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    await waitForRequest(1);
    await resolveEmpty(0);
    await browseAll();

    const skip = document.querySelector('[data-decision-target="activity-legacy-iwbmuz"] input[value="skip"]') as HTMLInputElement;
    expect(skip?.checked).toBe(true);
    expect(saved.days[0].activities.some((activity) => activity.id === 'activity-legacy-iwbmuz')).toBe(true);
  });

  it('persists Visited on the saved activity after reload', async () => {
    const panel = await startSavedReview();
    fireEvent.click(document.querySelector('[data-decision-target="activity-legacy-iwbmuz"] input[value="visited"]') as HTMLInputElement);
    const saved = panel.onItineraryChange.mock.calls.at(-1)?.[0] as Itinerary;
    panel.unmount();

    resetIntelligenceQueue();
    discoveryFixture.candidates = [listing, otherListing];
    renderPanel(profileFor(), saved);
    await waitForStart();
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    await waitForRequest(1);
    await resolveEmpty(0);
    await browseAll();

    expect((document.querySelector('[data-decision-target="activity-legacy-iwbmuz"] input[value="visited"]') as HTMLInputElement).checked).toBe(true);
  });

  it('writes the discovered-* activity id when a listing is canonically linked', async () => {
    const imported = {
      ...savedKushida,
      id: 'discovered-osm-n3507545614',
      source: 'imported' as const,
      provider: 'osm' as const,
      providerPlaceId: 'n3507545614',
      name: 'Glico Man Sign',
    };
    const osmListing: PlaceCandidate = {
      ...listing,
      id: 'osm-n3507545614',
      provider: 'osm',
      providerPlaceId: 'n3507545614',
      name: 'Glico Man Sign',
    };
    discoveryFixture.candidates = [osmListing, otherListing];
    const panel = renderPanel(profileFor(), savedItinerary({
      days: [{ day: 1, date: '2026-08-20', city: 'Osaka', title: 'Day one', activities: [imported] }],
    }));
    await waitForStart();
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    await waitForRequest(1);
    await resolveEmpty(0);
    await browseAll();

    const card = document.querySelector('[data-candidate-id="osm-n3507545614"]');
    expect(card?.getAttribute('data-decision-target')).toBe('discovered-osm-n3507545614');
    expect(document.querySelector('[data-candidate-id="discovered-osm-n3507545614"]')).toBeNull();
    fireEvent.click(card?.querySelector('input[value="skip"]') as HTMLInputElement);
    const decisions = latestDecisions(panel);
    expect(decisions['discovered-osm-n3507545614']).toBe('skip');
    expect(decisions['osm-n3507545614']).toBe('skip');
  });

  it('re-clicking an already-showing listing Skip writes the linked saved activity', async () => {
    const imported = {
      ...savedKushida,
      id: 'discovered-osm-n3507545614',
      source: 'imported' as const,
      provider: 'osm' as const,
      providerPlaceId: 'n3507545614',
      name: 'Glico Man Sign',
    };
    const osmListing: PlaceCandidate = {
      ...listing,
      id: 'osm-n3507545614',
      provider: 'osm',
      providerPlaceId: 'n3507545614',
      name: 'Glico Man Sign',
    };
    const panel = await startSavedReview(savedItinerary({
      days: [{ day: 1, date: '2026-08-20', city: 'Osaka', title: 'Day one', activities: [imported] }],
      discoveryState: {
        city: 'Osaka',
        mode: 'live',
        candidateIds: [osmListing.id],
        decisions: { 'osm-n3507545614': 'skip' },
        discoveredAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
        stage: 'reviewing',
      },
    }), [osmListing, otherListing]);

    const skip = document.querySelector('[data-candidate-id="osm-n3507545614"] input[value="skip"]') as HTMLInputElement;
    expect(skip.checked).toBe(true);
    fireEvent.click(skip);
    expect(latestDecisions(panel)['discovered-osm-n3507545614']).toBe('skip');
    expect(latestDecisions(panel)['osm-n3507545614']).toBe('skip');
  });

  it('never writes a same-name sibling saved activity', async () => {
    const parkA = { ...savedKushida, id: 'activity-park-a', name: 'Central Park' };
    const parkB = { ...savedKushida, id: 'activity-park-b', name: 'Central Park', time: '11:00' };
    const panel = await startSavedReview(savedItinerary({
      days: [{ day: 1, date: '2026-08-20', city: 'Osaka', title: 'Day one', activities: [parkA, parkB] }],
    }), [otherListing]);

    fireEvent.click(document.querySelector('[data-decision-target="activity-park-a"] input[value="skip"]') as HTMLInputElement);
    const decisions = latestDecisions(panel);
    expect(decisions['activity-park-a']).toBe('skip');
    expect(decisions['activity-park-b']).toBeUndefined();
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { CurrencyProvider } from '../contexts/CurrencyContext';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import { DestinationDiscoveryPanel } from './DestinationDiscoveryPanel';

const mocks = vi.hoisted(() => ({
  invokeTravelFunction: vi.fn(),
  invokeTravelReasoning: vi.fn(),
  isSupabaseConfigured: vi.fn(() => true),
}));

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

const itineraryFor = (profile: TripProfile): Itinerary => ({
  id: 'destination-intelligence-test',
  name: 'Osaka test trip',
  cities: ['Osaka'],
  description: 'A test trip.',
  tripProfile: profile,
  days: [],
});

const renderPanel = (initialProfile = profileFor()) => {
  const onItineraryChange = vi.fn();
  const initialItinerary = itineraryFor(initialProfile);
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

const responseFor = (index: number, recommendation: 'must-do' | 'interested' = 'must-do') => {
  const input = mocks.invokeTravelReasoning.mock.calls[index]?.[1] as {
    candidates?: Array<{ candidateId: string }>;
  } | undefined;
  const candidateIds = input?.candidates?.map(({ candidateId }) => candidateId) || [OSAKA_PLACE_FIXTURE[0].id];
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

const resolveResponse = async (index: number, recommendation: 'must-do' | 'interested') => {
  await act(async () => {
    pendingRequests[index].resolve(responseFor(index, recommendation));
    await pendingRequests[index].promise;
  });
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

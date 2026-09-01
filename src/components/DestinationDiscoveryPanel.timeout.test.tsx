// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { CurrencyProvider } from '../contexts/CurrencyContext';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import { DestinationDiscoveryPanel } from './DestinationDiscoveryPanel';

const mocks = vi.hoisted(() => ({
  discoverPlaces: vi.fn(),
}));

vi.mock('../lib/discoveryRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/discoveryRuntime')>()),
  discoverPlaces: mocks.discoverPlaces,
}));

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  isSupabaseConfigured: () => false,
}));

const profile: TripProfile = {
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-02',
  dayCount: 1,
};

const itinerary: Itinerary = {
  id: 'trip-timeout',
  name: 'Osaka',
  cities: ['Osaka'],
  description: '',
  tripProfile: profile,
  days: [{ day: 1, date: 'Apr 2', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Osaka', activities: [] }],
};

describe('discovery terminal state', () => {
  beforeEach(() => {
    mocks.discoverPlaces.mockReset();
    mocks.discoverPlaces.mockRejectedValue(new Error('Place search timed out.'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { MYR: 1 }, date: '2027-04-02' }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('leaves Loading places, explains the timeout, and retries only on another click', async () => {
    mocks.discoverPlaces
      .mockRejectedValueOnce(new Error('Place search timed out.'))
      .mockResolvedValueOnce({
        candidates: OSAKA_PLACE_FIXTURE.slice(0, 1),
        usingFixture: true,
        queueEvidence: {},
        evidenceSummaries: {},
        trends: {},
        officialHours: {},
        officialAdmissions: {},
        bestTimeWindows: {},
      });
    render(
      <CurrencyProvider>
        <DestinationDiscoveryPanel itinerary={itinerary} profile={profile} onItineraryChange={vi.fn()} />
      </CurrencyProvider>,
    );

    const start = await screen.findByRole('button', { name: 'Start' });
    fireEvent.click(start);

    expect(await screen.findByRole('alert')).toHaveTextContent('Place search timed out.');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(mocks.discoverPlaces).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.discoverPlaces).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText(OSAKA_PLACE_FIXTURE[0].name)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * Leaving the panel must stop the request, not merely ignore its answer.
   * A 45s discovery that nobody is waiting for still costs provider quota.
   */
  it('aborts the request in flight when the panel unmounts', async () => {
    mocks.discoverPlaces.mockReset();
    mocks.discoverPlaces.mockImplementation(() => new Promise(() => {}));

    const view = render(
      <CurrencyProvider>
        <DestinationDiscoveryPanel itinerary={itinerary} profile={profile} onItineraryChange={vi.fn()} />
      </CurrencyProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mocks.discoverPlaces).toHaveBeenCalledTimes(1));

    const options = mocks.discoverPlaces.mock.calls[0][3] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);

    view.unmount();

    expect(options.signal?.aborted).toBe(true);
  });
});

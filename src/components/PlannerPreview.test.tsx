// @vitest-environment jsdom

/**
 * The planner without a surface of its own.
 *
 * "Organise places" used to be a permanent block on the itinerary page — a
 * third planner beside Smart Plan and Ask. These tests fix the two halves of
 * removing it: the block is gone, and every engine it used to reach is still
 * reachable, still through a proposal the traveller has to approve.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { createEmptyProfile, manualDestination } from '../lib/tripProfile';
import { PlannerPreview } from './PlannerPreview';
import { TripIntelligenceUiProvider, useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import type { PlannerCapabilityId } from '../lib/plannerCapabilities';

vi.mock('./DestinationDiscoveryPanel', () => ({
  DestinationDiscoveryPanel: () => <div data-testid="discovery-stub" />,
}));

const profile = () => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
});

/** A trip with two real places on one day, so the planners have something to move. */
const plannedItinerary = (): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-organise-test',
  name: 'Osaka test trip',
  cities: ['Osaka'],
  days: [{
    day: 1,
    date: '2026-09-01',
    title: 'Day one',
    activities: [
      {
        id: 'a1', name: 'Osaka Castle', time: '09:00', durationMinutes: 90,
        type: 'sightseeing', description: '', location: 'Osaka', cost: 0,
      },
      {
        id: 'a2', name: 'Dotonbori', time: '11:00', durationMinutes: 90,
        type: 'sightseeing', description: '', location: 'Osaka', cost: 0,
      },
    ],
  }],
} as unknown as Itinerary);

/** Fires one capability request through the shared channel, as Smart Plan does. */
function CapabilityTrigger({ id }: { id: PlannerCapabilityId }) {
  const intelligence = useTripIntelligenceUi();
  return (
    <button type="button" onClick={() => intelligence?.requestPlannerCapability(id)}>
      fire {id}
    </button>
  );
}

const renderWithChannel = (
  itinerary: Itinerary,
  id: PlannerCapabilityId,
  onItineraryChange = vi.fn(),
) => {
  render(
    <TripIntelligenceUiProvider tripId="trip-organise-test" surface="itinerary">
      <CapabilityTrigger id={id} />
      <PlannerPreview itinerary={itinerary} profile={profile()} onItineraryChange={onItineraryChange} />
    </TripIntelligenceUiProvider>,
  );
  return { onItineraryChange };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the standalone Organise places section is gone', () => {
  it('renders no organise panel, header or adjust-the-plan chips', () => {
    render(<PlannerPreview itinerary={plannedItinerary()} profile={profile()} onItineraryChange={vi.fn()} />);

    expect(document.querySelector('.planner-organise-panel')).toBeNull();
    expect(document.querySelector('.planner-organise-toggle')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Organise places' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Improve plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Adjust the plan')).not.toBeInTheDocument();

    for (const label of [
      'Balance travel', 'Late start · 60 min', 'Rainy-day plan', 'Route delay · 30 min',
      'Less walking', 'More relaxed', 'Lower cost', 'More local · Soon',
    ]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('keeps discovery, which was never part of the removed section', () => {
    render(<PlannerPreview itinerary={plannedItinerary()} profile={profile()} onItineraryChange={vi.fn()} />);
    expect(screen.getByTestId('discovery-stub')).toBeInTheDocument();
  });

  it('shows no permanent Undo button now that nothing is reversible on screen', () => {
    render(<PlannerPreview itinerary={plannedItinerary()} profile={profile()} onItineraryChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
  });
});

describe('capabilities still reach their planners', () => {
  /**
   * Each of these was a chip. The assertion that matters is not which planner
   * ran but that a *proposal* opened: the engine is still behind a preview the
   * traveller has to approve.
   */
  it.each<[PlannerCapabilityId]>([
    ['rebalance-travel'],
    ['more-relaxed'],
    ['less-walking'],
    ['rainy-day'],
    ['late-start'],
    ['route-delay'],
    ['lower-cost'],
    ['fix-conflicts'],
  ])('opens a proposal preview for %s', async (id) => {
    renderWithChannel(plannedItinerary(), id);
    await act(async () => { screen.getByRole('button', { name: `fire ${id}` }).click(); });

    expect(await screen.findByText('Preview before applying')).toBeInTheDocument();
    // Nothing is applied by opening one.
    expect(screen.getByRole('button', { name: /Apply selected/ })).toBeInTheDocument();
  });

  it('never writes the itinerary just by running a capability', async () => {
    const { onItineraryChange } = renderWithChannel(plannedItinerary(), 'rebalance-travel');
    await act(async () => { screen.getByRole('button', { name: /fire/ }).click(); });

    await screen.findByText('Preview before applying');
    expect(onItineraryChange).not.toHaveBeenCalled();
  });

  it('can be cancelled, leaving the trip untouched', async () => {
    const { onItineraryChange } = renderWithChannel(plannedItinerary(), 'more-relaxed');
    await act(async () => { screen.getByRole('button', { name: /fire/ }).click(); });

    await screen.findByText('Preview before applying');
    await act(async () => { screen.getByRole('button', { name: 'Cancel' }).click(); });

    await waitFor(() => expect(screen.queryByText('Preview before applying')).not.toBeInTheDocument());
    expect(onItineraryChange).not.toHaveBeenCalled();
  });
});

describe('undo keeps its existing history path', () => {
  const withHistory = (): Itinerary => ({
    ...plannedItinerary(),
    plannerHistory: [{
      id: 'history-1',
      action: 'optimise-trip',
      appliedAt: '2026-08-21T10:00:00.000Z',
      previous: plannedItinerary(),
    }],
  } as unknown as Itinerary);

  it('reverses the last planner change through the trip it already stored', async () => {
    const { onItineraryChange } = renderWithChannel(withHistory(), 'undo-last');
    await act(async () => { screen.getByRole('button', { name: /fire/ }).click(); });

    await waitFor(() => expect(onItineraryChange).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('The last planner change was undone.')).toBeInTheDocument();
  });

  it('does nothing when there is no reversible change', async () => {
    const { onItineraryChange } = renderWithChannel(plannedItinerary(), 'undo-last');
    await act(async () => { screen.getByRole('button', { name: /fire/ }).click(); });

    expect(onItineraryChange).not.toHaveBeenCalled();
  });
});

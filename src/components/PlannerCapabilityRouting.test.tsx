// @vitest-environment jsdom

/**
 * Two surfaces, one set of capabilities.
 *
 * Smart Plan and Ask are different doors into the same planners. What these
 * tests pin down is that choosing a capability is never itself an expensive or
 * destructive act: a deterministic one reaches the local planner without
 * touching a model, an open-ended one arrives in Ask as typed text rather than
 * a sent question, and neither writes to the itinerary.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?'],
  askPlanitenary,
}));

vi.mock('../lib/planTripProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/planTripProposal')>();
  return { ...actual, planTripProposal: vi.fn() };
});

vi.mock('./DestinationDiscoveryPanel', () => ({
  DestinationDiscoveryPanel: () => <div data-testid="discovery-stub" />,
}));

import { PlanTripProposalPanel } from './PlanTripProposalPanel';
import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';
import { PlannerPreview } from './PlannerPreview';
import { planTripProposal } from '../lib/planTripProposal';
import { TripIntelligenceUiProvider } from '../lib/tripIntelligenceUi';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { createEmptyProfile, manualDestination } from '../lib/tripProfile';
import { plannerCapability } from '../lib/plannerCapabilities';
import type { Itinerary } from '../data';

const mockedPlan = vi.mocked(planTripProposal);

const profile = () => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
});

const plannedTrip = (): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  name: 'Osaka days',
  days: [{
    day: 1,
    date: '2026-09-01',
    title: 'Day one',
    activities: [
      { id: 'a1', name: 'Osaka Castle', time: '09:00', durationMinutes: 90, type: 'sightseeing', description: '', location: 'Osaka', cost: 0 },
      { id: 'a2', name: 'Dotonbori', time: '11:00', durationMinutes: 90, type: 'sightseeing', description: '', location: 'Osaka', cost: 0 },
    ],
  }],
} as unknown as Itinerary);

/** Both planning surfaces plus the planner, in one tree, as the app mounts them. */
const renderSurfaces = (onItineraryChange = vi.fn()) => {
  const itinerary = plannedTrip();
  render(
    <TripIntelligenceUiProvider tripId="trip-1" surface="itinerary">
      <PlanTripProposalPanel tripId="trip-1" tripName="Osaka days" itinerary={itinerary} />
      <AskPlanitenaryPanel tripId="trip-1" tripName="Osaka days" itinerary={itinerary} />
      <PlannerPreview itinerary={itinerary} profile={profile()} onItineraryChange={onItineraryChange} />
    </TripIntelligenceUiProvider>,
  );
  return { onItineraryChange };
};

const openSmartPlan = () => fireEvent.click(screen.getByRole('button', { name: /^Smart plan$/ }));

beforeEach(() => {
  askPlanitenary.mockReset();
  mockedPlan.mockReset();
  localStorage.clear();
});

describe('a deterministic capability stays deterministic', () => {
  /**
   * "Rebalance travel" is exact arithmetic over the traveller's own places.
   * Routing it through a metered model would spend money to reproduce an
   * answer the device already has.
   */
  it('opens a local proposal without calling the model', async () => {
    renderSurfaces();
    openSmartPlan();

    fireEvent.click(await screen.findByRole('button', { name: /Rebalance travel/ }));

    expect(await screen.findByText('Preview before applying')).toBeInTheDocument();
    expect(mockedPlan).not.toHaveBeenCalled();
    expect(askPlanitenary).not.toHaveBeenCalled();
  });

  it('writes nothing to the itinerary by opening one', async () => {
    const { onItineraryChange } = renderSurfaces();
    openSmartPlan();

    fireEvent.click(await screen.findByRole('button', { name: /Make the trip less rushed/ }));
    await screen.findByText('Preview before applying');

    expect(onItineraryChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Apply selected/ })).toBeInTheDocument();
  });
});

describe('an open-ended capability becomes a question, not a request', () => {
  it('pre-types Ask instead of asking', async () => {
    renderSurfaces();
    openSmartPlan();

    fireEvent.click(await screen.findByRole('button', { name: /Find more local places/ }));

    const composer = await screen.findByLabelText('Question for Planitenary');
    expect(composer).toHaveValue(plannerCapability('more-local')?.askExample);
    // Chosen, not sent.
    expect(askPlanitenary).not.toHaveBeenCalled();
    expect(mockedPlan).not.toHaveBeenCalled();
  });

  it('sends only once the traveller presses Send', async () => {
    askPlanitenary.mockResolvedValue({
      status: 'answered', answer: 'Here are some.', citations: [],
      applied: false, steps: [], rejectedClaims: 0, places: [],
    });
    const user = userEvent.setup();
    renderSurfaces();
    openSmartPlan();

    fireEvent.click(await screen.findByRole('button', { name: /Find more local places/ }));
    await screen.findByLabelText('Question for Planitenary');
    expect(askPlanitenary).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(askPlanitenary).toHaveBeenCalledTimes(1);
  });
});

describe('Ask offers the same capabilities as questions', () => {
  const openAsk = async (user: ReturnType<typeof userEvent.setup>) => {
    const trigger = screen
      .getAllByRole('button', { name: /ask planitenary/i })
      .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
    if (!trigger) throw new Error('Ask Planitenary launcher not found');
    await user.click(trigger);
  };

  it('shows capability examples in the empty state and prefills on click', async () => {
    const user = userEvent.setup();
    renderSurfaces();
    await openAsk(user);

    expect(await screen.findByText('You can ask me to…')).toBeInTheDocument();
    const example = plannerCapability('rebalance-travel')?.askExample as string;
    await user.click(screen.getByRole('button', { name: example }));

    expect(screen.getByLabelText('Question for Planitenary')).toHaveValue(example);
    expect(askPlanitenary).not.toHaveBeenCalled();
  });

  /** Once there is a conversation, that space belongs to it. */
  it('hides the starter examples once a thread exists', async () => {
    askPlanitenary.mockResolvedValue({
      status: 'answered', answer: 'Noted.', citations: [],
      applied: false, steps: [], rejectedClaims: 0, places: [],
    });
    const user = userEvent.setup();
    renderSurfaces();
    await openAsk(user);
    await screen.findByText('You can ask me to…');

    await user.type(screen.getByLabelText('Question for Planitenary'), 'Where tonight?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText('Noted.');

    expect(screen.queryByText('You can ask me to…')).not.toBeInTheDocument();
  });

  /**
   * Choosing a capability while a conversation is open must join it, not
   * restart it — the follow-up thread is the reason Ask is worth entering.
   */
  it('does not reset an existing conversation when a capability arrives', async () => {
    askPlanitenary.mockResolvedValue({
      status: 'answered', answer: 'Golden Gai is lively.', citations: [],
      applied: false, steps: [], rejectedClaims: 0, places: [],
    });
    const user = userEvent.setup();
    renderSurfaces();
    await openAsk(user);
    await user.type(screen.getByLabelText('Question for Planitenary'), 'Where tonight?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText('Golden Gai is lively.');

    // Close Ask, choose a capability in Smart Plan, and come back.
    await user.keyboard('{Escape}');
    openSmartPlan();
    fireEvent.click(await screen.findByRole('button', { name: /Find more local places/ }));

    expect(await screen.findByText('Golden Gai is lively.')).toBeInTheDocument();
    expect(screen.getByText('Where tonight?')).toBeInTheDocument();
    expect(screen.getByLabelText('Question for Planitenary'))
      .toHaveValue(plannerCapability('more-local')?.askExample);
    expect(askPlanitenary).toHaveBeenCalledTimes(1);
  });
});

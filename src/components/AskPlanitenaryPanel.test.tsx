// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?', 'Is tomorrow too tiring?'],
  askPlanitenary,
}));

vi.mock('../lib/planTripProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/planTripProposal')>();
  return { ...actual, planTripProposal: vi.fn() };
});

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';
import { PlanTripProposalPanel } from './PlanTripProposalPanel';
import { TripIntelligenceUiProvider } from '../lib/tripIntelligenceUi';
import { planTripProposal } from '../lib/planTripProposal';

const mockedPlan = vi.mocked(planTripProposal);

describe('Ask Planitenary panel', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    mockedPlan.mockReset();
  });

  it('opens as a read-only assistant and sends the current trip id', async () => {
    askPlanitenary.mockResolvedValue({
      status: 'answered',
      answer: 'Keep the museum for the rainy afternoon.',
      citations: ['https://example.org/forecast'],
      proposal: { summary: 'Visit the museum after lunch', day: 2 },
      applied: false,
      steps: [{ tool: 'get_weather', ok: true }],
      rejectedClaims: 0,
    });
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" tripName="Osaka nights" />);

    await user.click(screen.getByRole('button', { name: /ask planitenary/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/cannot change your plan/i);

    await user.click(screen.getByRole('button', { name: 'What should we do tonight?' }));
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(askPlanitenary).toHaveBeenCalledWith({
      tripId: 'trip-42',
      question: 'What should we do tonight?',
      uiContext: undefined,
      conversation: [],
    });
    expect(await screen.findByText('Keep the museum for the rainy afternoon.')).toBeInTheDocument();
    expect(screen.getByText(/Proposal only · nothing changed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /example.org/i })).toHaveAttribute('href', 'https://example.org/forecast');
    expect(screen.getByText('Weather forecast')).toBeInTheDocument();
  });

  it('renders a safe recovery message when the server refuses', async () => {
    askPlanitenary.mockResolvedValue({
      status: 'refused',
      citations: [],
      applied: false,
      steps: [],
      rejectedClaims: 0,
      detail: 'The daily AI request allowance is spent.',
    });
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);

    await user.click(screen.getByRole('button', { name: /ask planitenary/i }));
    await user.type(screen.getByLabelText('Question for Planitenary'), 'Help with tomorrow');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText('The daily AI request allowance is spent.')).toBeInTheDocument();
    expect(screen.queryByText(/Proposal only/)).not.toBeInTheDocument();
  });

  it('sends the current surface as a hint and keeps follow-up conversation', async () => {
    askPlanitenary
      .mockResolvedValueOnce({
        status: 'answered',
        answer: 'Recorded spending is RM420.',
        citations: [],
        applied: false,
        steps: [{ tool: 'get_budget_summary', ok: true }],
        rejectedClaims: 0,
      })
      .mockResolvedValueOnce({
        status: 'answered',
        answer: 'The food category is the largest recorded spend.',
        citations: [],
        applied: false,
        steps: [{ tool: 'get_expenses', ok: true }],
        rejectedClaims: 0,
      });
    const user = userEvent.setup();
    render(
      <TripIntelligenceUiProvider tripId="trip-42" surface="budget">
        <AskPlanitenaryPanel tripId="trip-42" tripName="Flight Acceptance Test" />
      </TripIntelligenceUiProvider>,
    );

    await user.click(screen.getByRole('button', { name: /ask planitenary/i }));
    expect(screen.getByText('Flight Acceptance Test')).toBeInTheDocument();
    expect(screen.getByText('budget')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Where am I spending most?' }));
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(askPlanitenary).toHaveBeenCalledWith({
      tripId: 'trip-42',
      question: 'Where am I spending most?',
      uiContext: expect.objectContaining({ tripId: 'trip-42', surface: 'budget' }),
      conversation: [],
    });

    await user.click(await screen.findByRole('button', { name: 'Ask another question' }));
    await user.type(screen.getByLabelText('Question for Planitenary'), 'Which category?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(askPlanitenary).toHaveBeenLastCalledWith({
      tripId: 'trip-42',
      question: 'Which category?',
      uiContext: expect.objectContaining({ surface: 'budget' }),
      conversation: [{ question: 'Where am I spending most?', answer: 'Recorded spending is RM420.' }],
    });
  });

  it('opens Ask Planitenary from Smart plan without generating a proposal', async () => {
    const user = userEvent.setup();
    render(
      <TripIntelligenceUiProvider tripId="trip-1" surface="itinerary">
        <PlanTripProposalPanel tripId="trip-1" tripName="Osaka days" />
        <AskPlanitenaryPanel tripId="trip-1" tripName="Osaka days" />
      </TripIntelligenceUiProvider>,
    );

    await user.click(screen.getByRole('button', { name: /^Smart plan$/ }));
    await user.click(await screen.findByRole('button', { name: /^Ask anything$/ }));
    expect(mockedPlan).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Ask Planitenary' })).toBeInTheDocument();
  });
});

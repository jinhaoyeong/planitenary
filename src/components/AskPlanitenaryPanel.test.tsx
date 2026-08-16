// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?', 'Is tomorrow too tiring?'],
  askPlanitenary,
}));

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';

describe('Ask Planitenary panel', () => {
  beforeEach(() => askPlanitenary.mockReset());

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
});

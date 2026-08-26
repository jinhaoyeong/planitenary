// @vitest-environment jsdom

/**
 * The assistant panel carries its own slate/rose Tailwind palette. The
 * redesign maps those onto journey tokens through the panel's scope class, so
 * losing the class silently returns the panel to the pre-redesign theme —
 * which is exactly the regression this guards.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?'],
  askPlanitenary: vi.fn(),
}));

vi.mock('../lib/planTripProposal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/planTripProposal')>();
  return { ...actual, planTripProposal: vi.fn() };
});

vi.mock('../contexts/CurrencyContext', () => ({
  useOptionalCurrency: () => ({
    rates: { base: 'MYR', rates: { MYR: 1 }, source: 'live', isLoading: false },
    rateFreshness: { isEstimate: false },
  }),
}));

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';

beforeEach(() => {
  localStorage.clear();
});

describe('Ask Planitenary follows the redesign theme', () => {
  it('scopes the panel so journey tokens can override the legacy palette', async () => {
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-1" tripName="Fukuoka" />);

    await user.click(screen.getByRole('button', { name: /ask planitenary/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('journey-ask-panel');
  });
});

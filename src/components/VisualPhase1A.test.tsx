// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripDashboard } from './TripDashboard';
import { WelcomeScreen } from './WelcomeScreen';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'visual-phase-user' },
    isDemoUser: false,
    isLocalTestUser: true,
  }),
}));

vi.mock('../contexts/CurrencyContext', () => ({
  useCurrency: () => ({ homeCurrency: 'MYR' }),
}));

vi.mock('./TripCreateWizard', () => ({ TripCreateWizard: () => null }));

beforeEach(() => {
  window.localStorage.clear();
});

describe('Visual Phase 1A entry states', () => {
  it('keeps the first-trip CTA primary and reserves the approved 3:2 asset slot', async () => {
    render(<TripDashboard onOpenTrip={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Your first trip starts here.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan a new trip' })).toBeInTheDocument();
    expect(document.querySelector('[data-future-illustration="trip-empty"]')).toBeInTheDocument();
  });

  it('leaves a populated trip shelf free of the empty illustration slot', async () => {
    window.localStorage.setItem('trip-registry-visual-phase-user', JSON.stringify([{
      id: 'trip-one',
      title: 'Osaka in autumn',
      description: 'A quiet week in Kansai.',
      status: 'active',
      updatedAt: '2026-08-23T00:00:00.000Z',
      dayCount: 7,
      cityCount: 2,
    }]));

    render(<TripDashboard onOpenTrip={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(await screen.findByText('Osaka in autumn')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('[data-future-illustration="trip-empty"]')).not.toBeInTheDocument();
    });
  });

  it('keeps Welcome copy and CTA ahead of its secondary artwork slot', () => {
    const { container } = render(<WelcomeScreen onStart={vi.fn()} />);
    const action = screen.getByRole('button', { name: 'Continue to account' });
    const slot = container.querySelector('[data-future-illustration="welcome-field-guide"]');

    expect(screen.getByRole('heading', { name: /Hello,\s*wanderers\./i })).toBeInTheDocument();
    expect(action).toBeInTheDocument();
    expect(slot).toBeInTheDocument();
    expect(action.compareDocumentPosition(slot as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

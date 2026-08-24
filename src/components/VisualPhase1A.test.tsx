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
  it('keeps the first-trip CTA primary and renders the decorative 3:2 illustration only in the empty state', async () => {
    render(<TripDashboard onOpenTrip={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Your first trip starts here.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan a new trip' })).toBeInTheDocument();
    const illustration = document.querySelector<HTMLImageElement>('img[data-illustration="trip-empty"]');
    expect(illustration).toBeInTheDocument();
    expect(illustration).toHaveAttribute('alt', '');
    expect(illustration).toHaveAttribute('aria-hidden', 'true');
    expect(illustration).toHaveAttribute('width', '640');
    expect(illustration).toHaveAttribute('height', '427');
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
      expect(document.querySelector('img[data-illustration="trip-empty"]')).not.toBeInTheDocument();
    });
  });

  it('keeps Welcome copy and CTA ahead of its decorative illustration', () => {
    const { container } = render(<WelcomeScreen onStart={vi.fn()} />);
    const action = screen.getByRole('button', { name: 'Continue to account' });
    const illustration = container.querySelector<HTMLImageElement>('img[data-illustration="welcome-field-guide"]');

    expect(screen.getByRole('heading', { name: /Hello,\s*wanderers\./i })).toBeInTheDocument();
    expect(action).toBeInTheDocument();
    expect(illustration).toBeInTheDocument();
    expect(illustration).toHaveAttribute('alt', '');
    expect(illustration).toHaveAttribute('aria-hidden', 'true');
    expect(illustration).toHaveAttribute('loading', 'eager');
    expect(illustration).toHaveAttribute('width', '960');
    expect(illustration).toHaveAttribute('height', '960');
    expect(action.compareDocumentPosition(illustration as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

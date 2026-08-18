// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productionShapedBudgetFixture } from '../../supabase/functions/_shared/budgetDocument';
import { emptyItinerary } from '../lib/itinerarySanitize';
import type { Itinerary } from '../data';

const { hydrateTripBudget, saveTripBudget } = vi.hoisted(() => ({
  hydrateTripBudget: vi.fn(),
  saveTripBudget: vi.fn(),
}));

vi.mock('../lib/tripBudget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tripBudget')>();
  return {
    ...actual,
    hydrateTripBudget,
    saveTripBudget,
  };
});

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    channel: () => ({
      on: () => ({
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
    }),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-owner' },
    isDemoUser: false,
    isLocalTestUser: false,
  }),
}));

vi.mock('../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'MYR',
    convert: (value: number) => value,
    toBase: (value: number) => value,
    rates: {},
  }),
}));

vi.mock('./CurrencySelector', () => ({
  BudgetCurrencyToggle: () => null,
}));

import { Budget } from './Budget';

const itinerary: Itinerary = {
  ...emptyItinerary,
  id: 'trip-f5262604-cb74-4d39-af90-0d8a233c9906',
  name: 'Flight Acceptance Test',
  cities: ['Fukuoka'],
  days: [{ day: 1, date: '2026-08-20', city: 'Fukuoka', title: 'Arrive', activities: [] }],
};

describe('Budget UI source of truth', () => {
  beforeEach(() => {
    hydrateTripBudget.mockReset();
    saveTripBudget.mockReset();
  });

  it('renders the server-hydrated wallet after loading', async () => {
    hydrateTripBudget.mockResolvedValue({
      ok: true,
      kind: 'server',
      budget: productionShapedBudgetFixture(),
      source: 'server',
      imported: false,
      configured: true,
      updatedAt: '2026-08-19T00:00:00.000Z',
    });
    render(<Budget itinerary={itinerary} />);
    expect(screen.getByText('Loading budget…')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading budget…')).not.toBeInTheDocument());
    expect(hydrateTripBudget).toHaveBeenCalledWith({
      tripId: itinerary.id,
      mode: 'server',
    });
    expect(screen.getByText(/8,200/)).toBeInTheDocument();
    expect(screen.getByText(/85/)).toBeInTheDocument();
  });

  it('shows a quiet import notice without a raw server error', async () => {
    hydrateTripBudget.mockResolvedValue({
      ok: true,
      kind: 'server',
      budget: productionShapedBudgetFixture(),
      source: 'server',
      imported: true,
      configured: true,
      updatedAt: '2026-08-19T00:00:00.000Z',
    });
    render(<Budget itinerary={itinerary} />);
    await waitFor(() => expect(screen.getByText('Budget saved to your trip.')).toBeInTheDocument());
    expect(screen.queryByText(/PGRST|JWT|permission denied/i)).toBeNull();
  });

  it('does not treat a failed save as success', async () => {
    hydrateTripBudget.mockResolvedValue({
      ok: true,
      kind: 'none',
      budget: null,
      source: 'none',
      imported: false,
      configured: false,
    });
    saveTripBudget.mockResolvedValue({ ok: false, message: 'Couldn’t save your budget. Try again.' });
    render(<Budget itinerary={itinerary} />);
    await waitFor(() => expect(screen.getByText(/No trip budget saved yet/)).toBeInTheDocument());
    expect(screen.queryByText(/Couldn’t save your budget/)).toBeNull();
  });
});

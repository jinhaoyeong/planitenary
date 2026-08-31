// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { TripDashboard } from './TripDashboard';

const USER_ID = 'reliability-user';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: USER_ID },
    isDemoUser: false,
    isLocalTestUser: true,
  }),
}));

vi.mock('../contexts/CurrencyContext', () => ({
  useCurrency: () => ({ homeCurrency: 'MYR' }),
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: () => false,
  supabase: {},
}));

vi.mock('./TripCreateWizard', () => ({ TripCreateWizard: () => null }));

const itinerary = (id: string, city: string): Itinerary => ({
  id,
  name: `${city} trip`,
  cities: [city],
  description: `${city} plan`,
  revision: 1,
  days: [{ day: 1, date: 'Apr 2', stayCity: city, activityCities: [], city, title: city, activities: [] }],
});

const seedTrips = () => {
  const bangkok = itinerary('trip-bangkok', 'Bangkok');
  const phuket = itinerary('trip-phuket', 'Phuket');
  localStorage.setItem(`trip-registry-${USER_ID}`, JSON.stringify([
    { id: phuket.id, title: phuket.name, description: phuket.description, status: 'active', updatedAt: '2027-04-03T00:00:00.000Z', dayCount: 1, cityCount: 1, cover: { type: 'generated-surface', selectedAt: '2027-04-03T00:00:00.000Z' } },
    { id: bangkok.id, title: bangkok.name, description: bangkok.description, status: 'active', updatedAt: '2027-04-02T00:00:00.000Z', dayCount: 1, cityCount: 1, cover: { type: 'generated-surface', selectedAt: '2027-04-02T00:00:00.000Z' } },
  ]));
  localStorage.setItem(`itinerary-${USER_ID}-${bangkok.id}`, JSON.stringify(bangkok));
  localStorage.setItem(`itinerary-${USER_ID}-${phuket.id}`, JSON.stringify(phuket));
  localStorage.setItem(`current-trip-${USER_ID}`, bangkok.id);
};

describe('current trip identity', () => {
  beforeEach(() => {
    localStorage.clear();
    seedTrips();
  });

  it('keeps Bangkok current across a reload and Continue planning opens Bangkok by id', async () => {
    const onOpenTrip = vi.fn();
    const first = render(<TripDashboard onOpenTrip={onOpenTrip} onOpenProfile={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.journey-current-trip h2')?.textContent).toBe('Bangkok trip'));
    first.unmount();

    render(<TripDashboard onOpenTrip={onOpenTrip} onOpenProfile={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.journey-current-trip h2')?.textContent).toBe('Bangkok trip'));
    fireEvent.click(screen.getByRole('button', { name: /Continue planning/ }));

    await waitFor(() => expect(onOpenTrip).toHaveBeenCalledTimes(1));
    expect(onOpenTrip.mock.calls[0][0].id).toBe('trip-bangkok');
    expect(onOpenTrip.mock.calls[0][0].cities).toEqual(['Bangkok']);
  });

  it('does not cross-open Phuket data stored under the Bangkok key', async () => {
    localStorage.setItem(`itinerary-${USER_ID}-trip-bangkok`, JSON.stringify(itinerary('trip-phuket', 'Phuket')));
    const onOpenTrip = vi.fn();
    render(<TripDashboard onOpenTrip={onOpenTrip} onOpenProfile={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.journey-current-trip h2')?.textContent).toBe('Bangkok trip'));

    fireEvent.click(screen.getByRole('button', { name: /Continue planning/ }));

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(onOpenTrip).not.toHaveBeenCalled();
  });
});

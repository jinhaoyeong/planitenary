// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { MISSING_FLIGHT_DURATION } from '../lib/flightDuration';
import { ItineraryView } from './ItineraryView';

vi.mock('../lib/photoStorage', () => ({
  getPhotos: vi.fn(async () => []),
  subscribeToPhotoChanges: () => () => {},
  syncAllPhotosFromRemote: vi.fn(async () => {}),
}));

vi.mock('./PlannerPreview', () => ({
  PlannerPreview: () => null,
}));

vi.mock('./ItineraryChangeHistoryPanel', () => ({
  ItineraryChangeHistoryPanel: () => null,
}));

vi.mock('./PhotoGallery', () => ({
  PhotoGallery: () => null,
}));

vi.mock('../contexts/CurrencyContext', () => ({
  useCurrency: () => ({ homeCurrency: 'MYR', rates: {}, currency: 'MYR' }),
}));

const sight: Activity = {
  id: 'castle',
  time: '11:00',
  name: 'Osaka Castle',
  description: 'Keep',
  type: 'sight',
  durationMinutes: 90,
};

const timedFlight: Activity = {
  id: 'flight-1',
  time: '10:00',
  name: 'HND → KIX',
  description: 'Arrival',
  type: 'flight',
  durationMinutes: 150,
};

const trip = (activities: Activity[]): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-add-flight',
  name: 'Flight editor trip',
  cities: ['Osaka'],
  days: [{ day: 1, date: '17 Aug', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Arrival day', activities }],
});

const openDayEditor = (itinerary: Itinerary, onItineraryChange = vi.fn()) => {
  render(<ItineraryView itinerary={itinerary} onItineraryChange={onItineraryChange} />);
  fireEvent.click(screen.getByText('01'));
  fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
  return onItineraryChange;
};

describe('Add Flight in the itinerary editor', () => {
  it('shows duration only after Flight is chosen, and does not require it for Sight', () => {
    openDayEditor(trip([sight]));
    fireEvent.click(screen.getByRole('button', { name: /Add Activity/i }));

    expect(screen.queryByRole('spinbutton', { name: 'Hours' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'flight' } });
    expect(screen.getByRole('group', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sight' } });
    expect(screen.queryByRole('spinbutton', { name: 'Hours' })).toBeNull();
  });

  it('refuses to save a Flight with no duration', () => {
    const onItineraryChange = openDayEditor(trip([sight]));
    fireEvent.click(screen.getByRole('button', { name: /Add Activity/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Visit Museum'), { target: { value: 'HND → KIX' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'flight' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Activity/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(MISSING_FLIGHT_DURATION);
    expect(onItineraryChange).not.toHaveBeenCalled();
  });

  it('persists a positive durationMinutes on a newly added Flight', () => {
    const onItineraryChange = openDayEditor(trip([sight]));
    fireEvent.click(screen.getByRole('button', { name: /Add Activity/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Visit Museum'), { target: { value: 'HND → KIX' } });
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'flight' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hours' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Activity/i }));

    expect(onItineraryChange).toHaveBeenCalled();
    const saved = onItineraryChange.mock.calls[0][0] as Itinerary;
    const flight = saved.days[0].activities.find((activity) => activity.type === 'flight');
    expect(flight).toMatchObject({
      type: 'flight',
      time: '10:00',
      name: 'HND → KIX',
      durationMinutes: 120,
    });
  });

  it('hydrates, preserves, and updates an existing Flight duration', () => {
    const onItineraryChange = openDayEditor(trip([timedFlight, sight]));
    expect(screen.getByText('2 hr 30 min')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit HND → KIX' }));

    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toHaveValue(30);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onItineraryChange).toHaveBeenCalled();
    expect(
      onItineraryChange.mock.calls[0][0].days[0].activities.find((activity: Activity) => activity.id === 'flight-1')?.durationMinutes,
    ).toBe(150);
  });

  it('saves a changed Flight duration', () => {
    const onItineraryChange = openDayEditor(trip([timedFlight]));
    fireEvent.click(screen.getByRole('button', { name: 'Edit HND → KIX' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hours' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onItineraryChange.mock.calls[0][0] as Itinerary;
    expect(saved.days[0].activities[0]).toMatchObject({ id: 'flight-1', durationMinutes: 180 });
  });

  it('leaves ordinary Sight add/edit free of a duration requirement', () => {
    const onItineraryChange = openDayEditor(trip([sight]));
    fireEvent.click(screen.getByRole('button', { name: /Add Activity/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Visit Museum'), { target: { value: 'Dotonbori' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Activity/i }));

    expect(onItineraryChange).toHaveBeenCalled();
    const added = onItineraryChange.mock.calls[0][0].days[0].activities.find((activity: Activity) => activity.name === 'Dotonbori');
    expect(added).toMatchObject({ type: 'sight', name: 'Dotonbori' });
    expect(added?.durationMinutes).toBeUndefined();
  });
});

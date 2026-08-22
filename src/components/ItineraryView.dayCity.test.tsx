// @vitest-environment jsdom

/**
 * Editing a day's city, all the way to storage and back.
 *
 * Introducing `stayCity` gave the day card two city fields and made the older
 * one an alias, and this editor still wrote only the alias. Nothing failed at
 * the time: the change appeared on screen and was saved. It came back wrong on
 * the next load, because the read path takes `stayCity` as the truth and
 * `stayCity` had never moved — so the trip quietly returned to Osaka.
 *
 * The write path is not sanitized (`sanitizeItinerary` runs on load), so a
 * writer that leaves the pair disagreeing is a writer whose edits are thrown
 * away. This test follows the whole cycle rather than the component's own
 * output, because the component's own output was already correct-looking.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary } from '../lib/itinerarySanitize';
import { ItineraryView } from './ItineraryView';

vi.mock('../lib/photoStorage', () => ({
  getPhotos: vi.fn(async () => []),
  subscribeToPhotoChanges: () => () => {},
  syncAllPhotosFromRemote: vi.fn(async () => {}),
}));

vi.mock('./PlannerPreview', () => ({ PlannerPreview: () => null }));
vi.mock('./ItineraryChangeHistoryPanel', () => ({ ItineraryChangeHistoryPanel: () => null }));
vi.mock('./PhotoGallery', () => ({ PhotoGallery: () => null }));
vi.mock('../contexts/CurrencyContext', () => ({
  useCurrency: () => ({ homeCurrency: 'MYR', rates: {}, currency: 'MYR' }),
}));

const trip = (): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-day-city',
  name: 'Kansai',
  cities: ['Osaka', 'Kyoto'],
  days: [{
    day: 1,
    date: '17 Aug',
    stayCity: 'Osaka',
    activityCities: [],
    city: 'Osaka',
    title: 'Arrival day',
    activities: [],
  }],
  tripProfile: {
    version: 1,
    destinations: [{ id: 'd1', city: 'Osaka' }, { id: 'd2', city: 'Kyoto' }],
  },
} as Itinerary);

const tripWithDaySemantics = (overrides: Partial<Itinerary['days'][number]>): Itinerary => ({
  ...trip(),
  days: [{ ...trip().days[0], ...overrides }],
});

/** Enter the editor and move day one to Kyoto, exactly as the card does. */
const editDayCityToKyoto = () => {
  const onItineraryChange = vi.fn();
  render(<ItineraryView itinerary={trip()} onItineraryChange={onItineraryChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
  fireEvent.click(screen.getByText('Osaka'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Day city' }), { target: { value: 'Kyoto' } });
  expect(onItineraryChange).toHaveBeenCalled();
  return onItineraryChange.mock.calls[onItineraryChange.mock.calls.length - 1][0] as Itinerary;
};

describe('moving a day to another city', () => {
  it('writes the base city and its alias together', () => {
    const saved = editDayCityToKyoto();
    expect(saved.days[0].stayCity).toBe('Kyoto');
    expect(saved.days[0].city).toBe('Kyoto');
  });

  it('survives being saved and read back', () => {
    // The failure this exists for. Before the fix the saved trip held
    // stayCity Osaka beside city Kyoto, and this line came back 'Osaka'.
    const reloaded = sanitizeItinerary(editDayCityToKyoto(), emptyItinerary);
    expect(reloaded.days[0].stayCity).toBe('Kyoto');
    expect(reloaded.days[0].city).toBe('Kyoto');
  });

  it('says nothing about where the day’s activities are', () => {
    // Changing where you sleep is not a claim about which cities you visit.
    expect(editDayCityToKyoto().days[0].activityCities).toEqual([]);
  });
});

describe('reading day semantics in the itinerary cards', () => {
  it('shows a recorded Kyoto day trip while keeping Osaka as the stay', () => {
    render(
      <ItineraryView
        itinerary={tripWithDaySemantics({ activityCities: ['Kyoto'] })}
      />,
    );

    const note = screen.getByRole('note', { name: 'Kyoto day trip. Staying in Osaka.' });
    expect(note).toHaveTextContent('Kyoto day trip');
    expect(note).toHaveTextContent('Staying in Osaka');
  });

  it('shows an explicit transfer rather than deriving one from activity cities', () => {
    render(
      <ItineraryView
        itinerary={tripWithDaySemantics({
          stayCity: 'Kyoto',
          city: 'Kyoto',
          activityCities: ['Osaka', 'Kyoto'],
          transfer: { from: 'Osaka', to: 'Kyoto' },
        })}
      />,
    );

    const note = screen.getByRole('note', { name: 'Transfer day from Osaka to Kyoto. Staying in Kyoto tonight.' });
    expect(note).toHaveTextContent('Transfer day');
    expect(note).toHaveTextContent('Staying in Kyoto tonight');
    expect(note).toHaveTextContent('Activities: Osaka · Kyoto');
  });

  it('keeps an ordinary same-city day free of an extra semantic label', () => {
    render(<ItineraryView itinerary={trip()} />);

    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('Osaka')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

/**
 * The saved plan finally offers the link discovery already had.
 *
 * Two rules are defended here. A community map tag is never labelled
 * "Official", and "View tickets" is never reached by borrowing a price that
 * belongs to something else — only this attraction's own published admission
 * may upgrade the wording.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Activity, Itinerary } from '../data';
import { emptyItinerary } from '../lib/itinerarySanitize';
import type { PlaceAdmission } from '../../supabase/functions/_shared/placeCost';
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

const WEBSITE = 'https://www.osakacastle.net/';
const TICKETS = 'https://www.osakacastle.net/tickets/';

/** A fare the venue itself published — the only thing that earns "View". */
const publishedAdmission: PlaceAdmission = {
  class: 'ticketed',
  source: 'official-website',
  sourceUrl: TICKETS,
  fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }],
} as PlaceAdmission;

const castle = (over: Partial<Activity> = {}): Activity => ({
  id: 'castle',
  time: '11:00',
  name: 'Osaka Castle',
  description: 'Keep',
  type: 'sight',
  durationMinutes: 90,
  ...over,
});

const trip = (activities: Activity[]): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-links',
  name: 'Links trip',
  cities: ['Osaka'],
  days: [{ day: 1, date: '17 Aug', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Arrival day', activities }],
});

const openDay = (activities: Activity[], onItineraryChange = vi.fn()) => {
  render(<ItineraryView itinerary={trip(activities)} onItineraryChange={onItineraryChange} />);
  fireEvent.click(screen.getByText('01'));
  return onItineraryChange;
};

describe('the link on a saved attraction', () => {
  it('offers an unverified site as a plain Website', () => {
    openDay([castle({ website: WEBSITE })]);
    const link = screen.getByRole('link', { name: /Website/i });
    expect(link).toHaveAttribute('href', WEBSITE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never calls a community map tag official', () => {
    // The whole point of splitting `website` out of `officialLinks`: nothing
    // about an OSM tag has been tied to the operator.
    openDay([castle({ website: WEBSITE })]);
    expect(screen.queryByRole('link', { name: /Official/i })).toBeNull();
    expect(document.body.textContent).not.toContain('Official website');
  });

  it('asks the traveller to check when no admission price was published', () => {
    openDay([castle({ officialLinks: { tickets: TICKETS } })]);
    const link = screen.getByRole('link', { name: /Check tickets/i });
    expect(link).toHaveAttribute('href', TICKETS);
    expect(screen.queryByRole('link', { name: /View tickets/i })).toBeNull();
  });

  it('invites a view only once this venue published its own fare', () => {
    openDay([castle({ officialLinks: { tickets: TICKETS }, admission: publishedAdmission })]);
    expect(screen.getByRole('link', { name: /View tickets/i })).toHaveAttribute('href', TICKETS);
  });

  it('prefers the ticket page over the website, and shows one link only', () => {
    openDay([castle({ website: WEBSITE, officialLinks: { tickets: TICKETS } })]);
    const links = screen.getAllByRole('link').filter((el) => /tickets|website/i.test(el.textContent || ''));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', TICKETS);
  });

  it('shows nothing at all when the attraction has no links', () => {
    openDay([castle()]);
    expect(screen.queryByRole('link', { name: /Website|tickets/i })).toBeNull();
    // Absence is not an error worth announcing.
    for (const noise of ['No website', 'No tickets', 'No booking provider', 'Unavailable']) {
      expect(document.body.textContent).not.toContain(noise);
    }
    expect(screen.getByText('Osaka Castle')).toBeInTheDocument();
  });

  it('refuses a tampered runtime value rather than labelling it', () => {
    // Persisted URLs are sanitised, but rendering re-runs the guards so an
    // object mutated in memory cannot acquire a ticket label on the way out.
    openDay([castle({
      website: 'https://www.klook.com/en-MY/activity/123-osaka/',
      officialLinks: { tickets: 'http://localhost/admin' },
    })]);
    expect(screen.queryByRole('link', { name: /Website|tickets/i })).toBeNull();
    expect(document.body.textContent).not.toContain('klook');
  });

  it('treats opening the link as navigation, never as a booking', () => {
    const onItineraryChange = openDay([castle({ officialLinks: { tickets: TICKETS } })]);
    fireEvent.click(screen.getByRole('link', { name: /Check tickets/i }));
    // No booking created, no status moved, nothing saved.
    expect(onItineraryChange).not.toHaveBeenCalled();
  });

  it('leaves an activity saved before these fields existed untouched', () => {
    openDay([castle()]);
    expect(screen.getByText('Osaka Castle')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Website|tickets/i })).toBeNull();
  });

  it('names the action in the link itself, not only in an icon', () => {
    openDay([castle({ website: WEBSITE })]);
    expect(screen.getByRole('link', { name: 'Website' })).toBeInTheDocument();
  });
});

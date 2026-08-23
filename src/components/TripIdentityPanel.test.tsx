// @vitest-environment jsdom
/**
 * The first component test in the codebase. Everything before it lived in
 * `src/lib`, which is why the panel wiring — the join between a form control
 * and the profile the planner reads — had no coverage at all.
 *
 * Flight times are the case worth locking: they were verified by hand on
 * 2026-08-06 and the manual check could not tell whether the value reaching the
 * profile was the browser's display string or the `HH:MM` the scheduler parses.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TripIdentityPanel } from './TripIdentityPanel';
import { ThemeProvider } from '../contexts/ThemeContext';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { createEmptyProfile, manualDestination, sanitizeTripProfile, type TripProfile } from '../lib/tripProfile';
import type { PlaceSuggestion } from '../lib/destinations';
import type { Itinerary } from '../data';

vi.mock('./ui/CitySearchInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ui/CitySearchInput')>();
  type Props = Parameters<typeof actual.CitySearchInput>[0];
  return {
    ...actual,
    CitySearchInput: (props: Props) => props.countryName === 'Japan' ? (
      <button
        type="button"
        onClick={() => props.onSelect({
          id: 'place_osaka_jp_provider-variant',
          city: 'Osaka',
          country: 'Japan',
          countryCode: 'JP',
          lat: 34.6937,
          lng: 135.5023,
          provider: 'nominatim',
          providerPlaceId: 'provider-variant',
        } satisfies PlaceSuggestion)}
      >
        Offer Osaka provider variant
      </button>
    ) : <actual.CitySearchInput {...props} />,
  };
});

const melbourneProfile = (overrides: Partial<TripProfile> = {}): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Melbourne', 'Australia')],
  startDate: '2027-01-21',
  endDate: '2027-01-31',
  ...overrides,
});

const melbourneTrip = (profile: TripProfile = melbourneProfile()): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  cities: ['Melbourne'],
  days: [{ day: 1, date: '2027-01-21', stayCity: 'Melbourne', activityCities: [], city: 'Melbourne', title: 'Day one', activities: [] }],
  tripProfile: profile,
});

/**
 * The panel renders `VisualDesignControls`, which reads the theme context and
 * throws without a provider. Wrapping here rather than in each test keeps the
 * requirement in one place for the component tests that follow.
 */
const renderPanel = (itinerary: Itinerary, onItineraryChange: (next: Itinerary) => void) =>
  render(
    <ThemeProvider>
      <TripIdentityPanel itinerary={itinerary} onItineraryChange={onItineraryChange} />
    </ThemeProvider>,
  );

/**
 * `Itinerary.tripProfile` is deliberately `unknown`, so `data.ts` need not
 * depend on the profile type. Reading it back through the sanitiser is exactly
 * what every screen does, which makes this the honest assertion path.
 */
const savedProfile = (onItineraryChange: ReturnType<typeof vi.fn>): TripProfile | null => {
  const saved = onItineraryChange.mock.calls.at(-1)?.[0] as Itinerary | undefined;
  return saved ? sanitizeTripProfile(saved.tripProfile) : null;
};

/**
 * Edits are a draft until the traveller commits them.
 *
 * The panel holds changes in local state and only calls `onItineraryChange`
 * from its save handler, so a test that asserts straight after a `change`
 * event is asking what was saved before anything was. Worth noting that
 * omitting this does not always fail loudly: `savedProfile` returns `null`
 * when nothing was saved, and `null?.field` is `undefined` — so any assertion
 * expecting `undefined` passes whether or not the component works at all.
 */
const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

describe('flight times reach the profile the planner reads', () => {
  it('stores a typed arrival time as HH:MM', () => {
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '19:27' } });
    save();

    expect(savedProfile(onItineraryChange)?.arrivalTime).toBe('19:27');
  });

  it('normalises the seconds some browsers append', () => {
    // The value shown may read "07:27 PM" depending on locale, but the value
    // the element reports is always 24-hour — sometimes with seconds attached.
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/departure time/i), { target: { value: '12:33:00' } });
    save();

    expect(savedProfile(onItineraryChange)?.departureTime).toBe('12:33');
  });

  it('clears the time when the field is emptied rather than keeping the old one', () => {
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(melbourneProfile({ arrivalTime: '19:27' })), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '' } });
    save();

    // Asserted against a save that actually happened, so this cannot pass by
    // reading `undefined` off a null profile that was never written.
    expect(onItineraryChange).toHaveBeenCalled();
    expect(savedProfile(onItineraryChange)?.arrivalTime).toBeUndefined();
  });

  it('shows a stored time back to the traveller', () => {
    renderPanel(
      melbourneTrip(melbourneProfile({ arrivalTime: '19:27', departureTime: '12:33' })),
      vi.fn(),
    );

    expect(screen.getByLabelText(/arrival time/i)).toHaveValue('19:27');
    expect(screen.getByLabelText(/departure time/i)).toHaveValue('12:33');
  });

  it('leaves the dates alone when only a flight time changes', () => {
    // Duration fields route through validation and everything else into the
    // draft; a time must not be able to disturb the date range on save.
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '19:27' } });
    save();

    const profile = savedProfile(onItineraryChange);
    expect(profile?.startDate).toBe('2027-01-21');
    expect(profile?.endDate).toBe('2027-01-31');
  });
});

describe('destinations stay a set, not a route', () => {
  const kansaiProfile = (): TripProfile => ({
    ...createEmptyProfile('MYR'),
    destinations: [manualDestination('Osaka', 'Japan'), manualDestination('Kyoto', 'Japan')],
    startDate: '2027-01-21',
    endDate: '2027-01-27',
    cityStays: [{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }],
    cityStayDayCount: 7,
  });

  const kansaiTrip = (): Itinerary => ({
    ...emptyItinerary,
    id: 'trip-kansai',
    cities: ['Osaka', 'Kyoto'],
    days: [{ day: 1, date: '2027-01-21', stayCity: 'Osaka', activityCities: [], city: 'Osaka', title: 'Day one', activities: [] }],
    tripProfile: kansaiProfile(),
  });

  it('refuses another provider record for Osaka without changing the trip', () => {
    const onItineraryChange = vi.fn();
    renderPanel(kansaiTrip(), onItineraryChange);

    fireEvent.click(screen.getByRole('button', { name: 'Offer Osaka provider variant' }));

    expect(screen.getByText(/Osaka is already on this trip/i)).toHaveTextContent(
      'Osaka is already on this trip. To go back there later, add another stay',
    );
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(onItineraryChange).not.toHaveBeenCalled();
  });
});

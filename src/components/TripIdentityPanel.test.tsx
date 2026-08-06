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
import type { Itinerary } from '../data';

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
  days: [{ day: 1, date: '2027-01-21', city: 'Melbourne', title: 'Day one', activities: [] }],
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

describe('flight times reach the profile the planner reads', () => {
  it('stores a typed arrival time as HH:MM', () => {
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '19:27' } });

    expect(savedProfile(onItineraryChange)?.arrivalTime).toBe('19:27');
  });

  it('normalises the seconds some browsers append', () => {
    // The value shown may read "07:27 PM" depending on locale, but the value
    // the element reports is always 24-hour — sometimes with seconds attached.
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/departure time/i), { target: { value: '12:33:00' } });

    expect(savedProfile(onItineraryChange)?.departureTime).toBe('12:33');
  });

  it('clears the time when the field is emptied rather than keeping the old one', () => {
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(melbourneProfile({ arrivalTime: '19:27' })), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '' } });

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
    // update() routes duration fields through validation and everything else
    // straight to save; a time must not be able to disturb the date range.
    const onItineraryChange = vi.fn();
    renderPanel(melbourneTrip(), onItineraryChange);

    fireEvent.change(screen.getByLabelText(/arrival time/i), { target: { value: '19:27' } });

    const profile = savedProfile(onItineraryChange);
    expect(profile?.startDate).toBe('2027-01-21');
    expect(profile?.endDate).toBe('2027-01-31');
  });
});

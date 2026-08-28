// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DayPlan, Itinerary } from '../data';
import { emptyItinerary } from '../lib/itinerarySanitize';
import { createEmptyProfile, manualDestination } from '../lib/tripProfile';
import type { TravelBooking } from '../lib/travelBooking';
import { JourneyTimelineOverview } from './JourneyTimelineOverview';

const NOW = Date.parse('2027-01-29T12:00:00Z');

const day = (number: number, city: string): DayPlan => ({
  day: number,
  date: `Jan ${20 + number}`,
  stayCity: city,
  city,
  activityCities: [],
  title: `${city} day`,
  activities: [],
});

const tripWith = (bookings: TravelBooking[], startDate: string | undefined): Itinerary => ({
  ...emptyItinerary,
  id: 'trip-1',
  name: 'Kansai',
  cities: ['Kyoto', 'Nara'],
  tripProfile: {
    ...createEmptyProfile(),
    destinations: [manualDestination('Kyoto', 'Japan'), manualDestination('Nara', 'Japan')],
    startDate,
    endDate: '2027-01-24',
  },
  bookings,
  days: [day(1, 'Kyoto'), day(2, 'Kyoto'), day(3, 'Nara'), day(4, 'Nara')],
});

const naraHotel: TravelBooking = {
  id: 'stay-nara',
  type: 'stay',
  status: 'confirmed',
  title: 'Nara Hotel',
  startDate: '2027-01-23',
  endDate: '2027-01-24',
  city: 'Nara',
  price: { amount: 988, currency: 'MYR', source: 'manual', retrievedAt: '2027-01-10T00:00:00Z' },
};

const cancelledRoom: TravelBooking = {
  id: 'stay-cancelled',
  type: 'stay',
  status: 'cancelled',
  title: 'Kyoto Granbell',
  startDate: '2027-01-21',
  city: 'Kyoto',
};

describe('bookings on the journey timeline', () => {
  it('places a booking on the day its date falls on', () => {
    // 2027-01-23 is the third day of a trip starting 2027-01-21.
    const { container } = render(
      <JourneyTimelineOverview itinerary={tripWith([naraHotel], '2027-01-21')} onSelectDay={vi.fn()} bookings={[naraHotel]} now={NOW} />,
    );

    const blocks = Array.from(container.querySelectorAll('.journey-day-block'));
    expect(blocks).toHaveLength(4);
    const dayThree = blocks[2] as HTMLElement;
    expect(within(dayThree).getByText('Day 3')).toBeInTheDocument();
    expect(within(dayThree).getByText('Nara Hotel')).toBeInTheDocument();
    expect(within(dayThree).getByText('MYR 988')).toBeInTheDocument();
    // And nowhere else — a booking belongs to one day, not to its whole stay.
    expect(container.querySelectorAll('.journey-booking-card')).toHaveLength(1);
  });

  it('keeps a booking visible when the trip has no start date to place it by', () => {
    // Dropping it would lose something the traveller actually typed in.
    render(<JourneyTimelineOverview itinerary={tripWith([naraHotel], undefined)} onSelectDay={vi.fn()} bookings={[naraHotel]} now={NOW} />);

    expect(screen.getByText('Not yet on a day')).toBeInTheDocument();
    expect(screen.getByText('Nara Hotel')).toBeInTheDocument();
  });

  it('does not put a cancelled booking on the plan', () => {
    render(<JourneyTimelineOverview itinerary={tripWith([cancelledRoom], '2027-01-21')} onSelectDay={vi.fn()} bookings={[cancelledRoom]} now={NOW} />);
    expect(screen.queryByText('Kyoto Granbell')).toBeNull();
  });

  it('renders a trip with no bookings exactly as before', () => {
    const { container } = render(<JourneyTimelineOverview itinerary={tripWith([], '2027-01-21')} onSelectDay={vi.fn()} now={NOW} />);
    expect(container.querySelectorAll('.journey-booking-card')).toHaveLength(0);
    expect(screen.queryByText('Not yet on a day')).toBeNull();
    // The route and day rows are untouched.
    expect(container.querySelectorAll('.journey-day-row')).toHaveLength(4);
  });

  it('offers booking management only where the itinerary can be changed', () => {
    const onManageBookings = vi.fn();
    const { rerender, container } = render(
      <JourneyTimelineOverview itinerary={tripWith([naraHotel], '2027-01-21')} onSelectDay={vi.fn()} bookings={[naraHotel]} now={NOW} />,
    );
    expect(container.querySelector('.journey-route-actions button')).toBeNull();

    rerender(
      <JourneyTimelineOverview
        itinerary={tripWith([naraHotel], '2027-01-21')}
        onSelectDay={vi.fn()}
        bookings={[naraHotel]}
        onManageBookings={onManageBookings}
        now={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: /bookings \(1\)/i })).toBeInTheDocument();
  });
});

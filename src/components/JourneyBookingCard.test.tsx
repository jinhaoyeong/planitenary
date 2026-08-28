// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TravelBooking } from '../lib/travelBooking';
import { JourneyBookingCard } from './JourneyBookingCard';

const NOW = Date.parse('2027-01-29T12:00:00Z');

const base: TravelBooking = {
  id: 'booking-1',
  type: 'stay',
  status: 'confirmed',
  title: 'Nara Hotel',
  startDate: '2027-01-29',
  endDate: '2027-01-30',
  city: 'Nara',
};

describe('JourneyBookingCard', () => {
  it('says a price was typed in, and offers nothing that could refresh it', () => {
    render(
      <JourneyBookingCard
        booking={{
          ...base,
          price: { amount: 988, currency: 'MYR', source: 'manual', retrievedAt: '2027-01-20T09:00:00Z' },
        }}
        now={NOW}
      />,
    );

    expect(screen.getByText('MYR 988')).toBeInTheDocument();
    expect(screen.getByText('Price entered manually')).toBeInTheDocument();
    // A refresh button here would imply the number had just been re-checked.
    expect(screen.queryByRole('button', { name: /refresh price/i })).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('strikes through a provider price the provider itself expired', () => {
    render(
      <JourneyBookingCard
        booking={{
          ...base,
          provider: 'duffel',
          price: {
            amount: 608,
            currency: 'MYR',
            source: 'provider',
            retrievedAt: new Date(NOW - 40 * 60000).toISOString(),
            expiresAt: new Date(NOW - 60000).toISOString(),
          },
        }}
        now={NOW}
      />,
    );

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('MYR 608').tagName).toBe('S');
    // V1 wires no provider, so the control is present but honestly disabled.
    const refresh = screen.getByRole('button', { name: /refresh price/i });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('title', 'This provider is not connected');
  });

  it('shows how old a live provider price is without flagging it', () => {
    render(
      <JourneyBookingCard
        booking={{
          ...base,
          provider: 'duffel',
          price: {
            amount: 608,
            currency: 'MYR',
            source: 'provider',
            retrievedAt: new Date(NOW - 18 * 60000).toISOString(),
          },
        }}
        now={NOW}
      />,
    );

    expect(screen.getByText('Checked 18 min ago')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Price may have changed')).toBeNull();
  });

  it('renders a booking that has no price at all', () => {
    render(<JourneyBookingCard booking={base} now={NOW} />);
    expect(screen.getByText('Nara Hotel')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh price/i })).toBeNull();
  });

  it('draws a route for anything that moves', () => {
    render(
      <JourneyBookingCard
        booking={{ ...base, type: 'flight', title: 'AK 68', origin: 'KIX', destination: 'KUL', startTime: '10:55' }}
        now={NOW}
      />,
    );
    expect(screen.getByText('KIX')).toBeInTheDocument();
    expect(screen.getByText('KUL')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { createEmptyProfile } from '../lib/tripProfile';
import { JourneyContextBar } from './JourneyContextBar';

const itinerary: Itinerary = {
  id: 'japan-route',
  name: 'Tokyo 2026',
  cities: ['Tokyo', 'Kyoto', 'Nara'],
  description: 'A multi-city trip.',
  tripProfile: {
    ...createEmptyProfile(),
    destinations: [
      { id: 'tokyo', city: 'Tokyo', country: 'Japan', countryCode: 'JP', provider: 'manual' },
      { id: 'kyoto', city: 'Kyoto', country: 'Japan', countryCode: 'JP', provider: 'manual' },
      { id: 'nara', city: 'Nara', country: 'Japan', countryCode: 'JP', provider: 'manual' },
    ],
    startDate: '2026-08-12',
    endDate: '2026-08-16',
    dayCount: 5,
    cityStays: [
      { city: 'Tokyo', days: 2 },
      { city: 'Kyoto', days: 2 },
      { city: 'Nara', days: 1 },
    ],
    cityStayDayCount: 5,
    transport: ['plane', 'train'],
  },
  days: [],
};

describe('JourneyContextBar', () => {
  it('shows dated stop cards and the saved travel modes', () => {
    render(<JourneyContextBar itinerary={itinerary} />);

    expect(screen.getByRole('heading', { name: 'Tokyo 2026' })).toBeInTheDocument();
    expect(screen.getByText('12 Aug – 13 Aug')).toBeInTheDocument();
    expect(screen.getByText('14 Aug – 15 Aug')).toBeInTheDocument();
    expect(screen.getByText('16 Aug')).toBeInTheDocument();
    expect(screen.getByLabelText('Fly')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Train')).toHaveLength(2);
  });
});

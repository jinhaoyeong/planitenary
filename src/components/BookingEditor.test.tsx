// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TravelBooking } from '../lib/travelBooking';
import { BookingEditor } from './BookingEditor';

const flight: TravelBooking = {
  id: 'booking-flight',
  type: 'flight',
  status: 'confirmed',
  title: 'AK 68',
  startDate: '2027-01-21',
  startTime: '10:55',
};

describe('BookingEditor flight relationship', () => {
  it('saves only the flight Activity the traveller explicitly selects', () => {
    const onChange = vi.fn();
    render(
      <BookingEditor
        bookings={[flight]}
        cities={['Osaka']}
        flightActivities={[
          { id: 'activity-flight', day: 1, time: '10:55', name: 'AK 68' },
          { id: 'activity-other', day: 3, time: '12:00', name: 'MH 53' },
        ]}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Existing flight schedule/ }), { target: { value: 'activity-flight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bookings' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'booking-flight', relatedActivityId: 'activity-flight' }),
    ]);
  });
});

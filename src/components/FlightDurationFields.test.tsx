// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlightDurationFields } from './FlightDurationFields';
import { INVALID_FLIGHT_DURATION } from '../lib/flightDuration';

describe('Flight duration UI', () => {
  it('exposes hours and minutes controls, not a durationMinutes field', () => {
    render(
      <FlightDurationFields
        idPrefix="add-flight-duration"
        hours=""
        minutes=""
        onHoursChange={() => {}}
        onMinutesChange={() => {}}
      />,
    );

    expect(screen.getByRole('group', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/durationMinutes/i)).toBeNull();
    expect(screen.queryByText(/durationMinutes/i)).toBeNull();
  });

  it('associates validation copy with the numeric controls', () => {
    render(
      <FlightDurationFields
        idPrefix="add-flight-duration"
        hours="0"
        minutes="0"
        onHoursChange={() => {}}
        onMinutesChange={() => {}}
        error={INVALID_FLIGHT_DURATION}
      />,
    );

    const hours = screen.getByRole('spinbutton', { name: 'Hours' });
    expect(hours).toHaveAttribute('aria-invalid', 'true');
    expect(hours).toHaveAccessibleDescription(INVALID_FLIGHT_DURATION);
    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_FLIGHT_DURATION);
  });

  it('accepts keyboard entry', () => {
    const onHoursChange = vi.fn();
    const onMinutesChange = vi.fn();
    render(
      <FlightDurationFields
        idPrefix="add-flight-duration"
        hours=""
        minutes=""
        onHoursChange={onHoursChange}
        onMinutesChange={onMinutesChange}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Hours' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minutes' }), { target: { value: '30' } });
    expect(onHoursChange).toHaveBeenCalledWith('2');
    expect(onMinutesChange).toHaveBeenCalledWith('30');
  });

  it('fits on a 390px phone without horizontal overflow', () => {
    const { container } = render(
      <div style={{ width: 390 }}>
        <FlightDurationFields
          idPrefix="add-flight-duration"
          hours="2"
          minutes="30"
          onHoursChange={() => {}}
          onMinutesChange={() => {}}
        />
      </div>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });

  it('fits at 900px', () => {
    const { container } = render(
      <div style={{ width: 900 }}>
        <FlightDurationFields
          idPrefix="edit-flight-duration"
          hours="12"
          minutes="5"
          onHoursChange={() => {}}
          onMinutesChange={() => {}}
        />
      </div>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
  });
});

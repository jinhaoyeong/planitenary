// @vitest-environment jsdom
/**
 * The control that asks the traveller where they are sleeping.
 *
 * What matters here is what it refuses to do: it must never move a day the
 * traveller already placed, never balance the plan for them, and never present
 * an incomplete plan as finished.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CityStayPlanner } from './CityStayPlanner';
import type { TripCityStay } from '../../lib/tripProfile';

const KANSAI = ['Osaka', 'Nara', 'Kyoto', 'Kobe'];

const renderPlanner = (value: TripCityStay[] | undefined, dayCount = 8, cities = KANSAI) => {
  const onChange = vi.fn();
  render(
    <CityStayPlanner
      cities={cities}
      dayCount={dayCount}
      startDate="2027-04-02"
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
};

const EVEN_KANSAI: TripCityStay[] = [
  { city: 'Osaka', days: 2 },
  { city: 'Nara', days: 2 },
  { city: 'Kyoto', days: 2 },
  { city: 'Kobe', days: 2 },
];

describe('asking the question', () => {
  it('lists every city on the trip', () => {
    renderPlanner(EVEN_KANSAI);
    for (const city of KANSAI) expect(screen.getByText(city)).toBeInTheDocument();
  });

  it('shows each stay as the dates it actually covers', () => {
    // Day numbers are what the app counts in; dates are what a hotel is booked
    // against. The traveller is deciding a booking.
    renderPlanner(EVEN_KANSAI);
    expect(screen.getByText('2 Apr – 3 Apr')).toBeInTheDocument();
    expect(screen.getByText('8 Apr – 9 Apr')).toBeInTheDocument();
  });

  it('stays out of the way of a single-city trip', () => {
    const { container } = render(
      <CityStayPlanner cities={['Osaka']} dayCount={8} value={undefined} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('what is still undecided', () => {
  it('reports the days left to place', () => {
    renderPlanner([{ city: 'Osaka', days: 3 }]);
    expect(screen.getByRole('status')).toHaveTextContent('5 of 8 days still to place');
  });

  it('says so plainly when the plan is complete', () => {
    renderPlanner(EVEN_KANSAI);
    expect(screen.getByRole('status')).toHaveTextContent('All 8 days placed');
  });

  it('names the cities with nowhere to sleep', () => {
    renderPlanner([{ city: 'Osaka', days: 8 }]);
    expect(screen.getByText(/Nara and Kyoto and Kobe have no days yet/)).toBeInTheDocument();
  });
});

describe('editing, without editing anything else', () => {
  it('adds a day from the unplaced pool', () => {
    const { onChange } = renderPlanner([{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }]);

    fireEvent.click(screen.getByRole('button', { name: 'One more day in Kyoto' }));

    expect(onChange).toHaveBeenCalledWith([
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 4 },
      { city: 'Nara', days: 0 },
      { city: 'Kobe', days: 0 },
    ]);
  });

  it('cannot add a day once the trip is fully placed', () => {
    // The alternative — taking one from a neighbour — would undo a decision the
    // traveller had already made, which is the whole thing this control exists
    // to prevent.
    const { onChange } = renderPlanner(EVEN_KANSAI);

    const add = screen.getByRole('button', { name: 'One more day in Kyoto' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns a removed day to the pool rather than to another city', () => {
    const { onChange } = renderPlanner(EVEN_KANSAI);

    fireEvent.click(screen.getByRole('button', { name: 'One day fewer in Osaka' }));

    expect(onChange).toHaveBeenCalledWith([
      { city: 'Osaka', days: 1 },
      { city: 'Nara', days: 2 },
      { city: 'Kyoto', days: 2 },
      { city: 'Kobe', days: 2 },
    ]);
  });

  it('reorders the route', () => {
    const { onChange } = renderPlanner(EVEN_KANSAI);

    fireEvent.click(screen.getByRole('button', { name: 'Move Kyoto earlier in the trip' }));

    expect(onChange.mock.calls[0][0].map((stay: TripCityStay) => stay.city))
      .toEqual(['Osaka', 'Kyoto', 'Nara', 'Kobe']);
  });

  it('offers an even split as a starting point', () => {
    const { onChange } = renderPlanner(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Split evenly' }));

    expect(onChange).toHaveBeenCalledWith(EVEN_KANSAI);
  });
});

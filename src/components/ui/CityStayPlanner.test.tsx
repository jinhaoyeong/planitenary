// @vitest-environment jsdom

/**
 * Creating a route that comes back.
 *
 * 4A taught the stay plan to hold Osaka → Kyoto → Osaka and 4B taught the
 * planner to build it, but until this surface existed no traveller could
 * make one. These tests are about the two lists staying distinct: destinations
 * are a set of places, the stay plan is a sequence of nights, and the second
 * Osaka belongs to the second list only.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { TripCityStay } from '../../lib/tripProfile';
import { CityStayPlanner } from './CityStayPlanner';

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

/**
 * The complete pre-4C component regression suite remains intact here. The 4C
 * tests below extend it; they do not trade away direct coverage of the ordinary
 * repeat-free planner to make repeated stays pass.
 */
describe('pre-4C planner regressions', () => {
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
    // traveller already made, which is the whole thing this control exists
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

  it('lets the traveller type a day count', () => {
    const { onChange } = renderPlanner([{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }]);

    const field = screen.getByRole('textbox', { name: 'Days in Osaka' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith([
      { city: 'Osaka', days: 5 },
      { city: 'Kyoto', days: 3 },
      { city: 'Nara', days: 0 },
      { city: 'Kobe', days: 0 },
    ]);
  });

  it('clamps a typed count that would overspend the trip', () => {
    const { onChange } = renderPlanner(EVEN_KANSAI);

    const field = screen.getByRole('textbox', { name: 'Days in Osaka' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '99' } });
    fireEvent.blur(field);

    // Osaka already has 2; the other three cities hold 6. The free pool is
    // empty, so typing 99 can only keep Osaka at the days it already owns.
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue('2');
  });
});

const CITIES = ['Osaka', 'Kyoto'];

/** The planner is controlled, so tests drive it through a real owner. */
function Harness({
  cities = CITIES,
  dayCount = 7,
  startDate = '2026-08-11',
  initial,
  onChange,
}: {
  cities?: string[];
  dayCount?: number;
  startDate?: string;
  initial?: TripCityStay[];
  onChange?: (next: TripCityStay[]) => void;
}) {
  const [stays, setStays] = useState<TripCityStay[] | undefined>(initial);
  return (
    <CityStayPlanner
      cities={cities}
      dayCount={dayCount}
      startDate={startDate}
      value={stays}
      onChange={(next) => { setStays(next); onChange?.(next); }}
    />
  );
}

const rows = () => screen.getAllByRole('listitem');
const rowFor = (index: number) => rows()[index];
const cityOf = (index: number) => within(rowFor(index)).getByRole('textbox').getAttribute('aria-label');
const daysOf = (index: number) => (within(rowFor(index)).getByRole('textbox') as HTMLInputElement).value;
const sequence = () => rows().map((_, index) => `${cityOf(index)?.replace('Days in ', '')} ${daysOf(index)}`);

describe('adding a stay the traveller comes back to', () => {
  it('offers the trip’s own cities, and says what each already holds', async () => {
    const user = userEvent.setup();
    render(<Harness cities={['Osaka', 'Kyoto', 'Kobe']} initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);

    await user.click(screen.getByRole('button', { name: '+ Add another stay' }));

    const sheet = screen.getByRole('group', { name: 'Add another stay' });
    expect(sheet).toHaveTextContent('Your destinations don’t change');
    expect(within(sheet).getByRole('button', { name: /Osaka/ })).toHaveTextContent('staying 4 days');
    expect(within(sheet).getByRole('button', { name: /Kobe/ })).toHaveTextContent('no days yet');
  });

  it('moves focus into the choices and returns it when the sheet closes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);

    const trigger = screen.getByRole('button', { name: '+ Add another stay' });
    await user.click(trigger);
    expect(within(screen.getByRole('group', { name: 'Add another stay' })).getByRole('button', { name: /Osaka/ }))
      .toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '+ Add another stay' })).toHaveFocus();
  });

  it('takes a spare day when the trip has one', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ city: 'Osaka', days: 3 }, { city: 'Kyoto', days: 3 }]} />);

    await user.click(screen.getByRole('button', { name: '+ Add another stay' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: /Osaka/ }));

    expect(sequence()).toEqual(['Osaka 3', 'Kyoto 3', 'Osaka 1']);
    expect(screen.getByRole('status')).toHaveTextContent('All 7 days placed.');
  });

  it('funds a return out of the longest stay and says which, when nothing is spare', async () => {
    // The whole trip is spent. Rather than handing back an empty stay and a
    // warning to clear up, the day comes from the stay that can most afford
    // it — named, so the traveller can put it back.
    const user = userEvent.setup();
    render(<Harness initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);

    await user.click(screen.getByRole('button', { name: '+ Add another stay' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: /Osaka/ }));

    expect(sequence()).toEqual(['Osaka 3', 'Kyoto 3', 'Osaka 1']);
    expect(screen.getByText('All 7 days placed.')).toBeInTheDocument();
    expect(screen.getByText(/Moved a day from/)).toHaveTextContent('Moved a day from Osaka to your return stay.');
    expect(screen.queryByText(/has no days yet/)).not.toBeInTheDocument();
  });

  it('puts the borrowed day back when the traveller undoes it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);

    await user.click(screen.getByRole('button', { name: '+ Add another stay' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: /Osaka/ }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(sequence()).toEqual(['Osaka 4', 'Kyoto 3']);
    expect(screen.queryByText(/Moved a day from/)).not.toBeInTheDocument();
  });

  it('lets the traveller move more days across themselves', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);

    await user.click(screen.getByRole('button', { name: '+ Add another stay' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: /Osaka/ }));
    await user.click(within(rowFor(0)).getByRole('button', { name: 'One day fewer in Osaka' }));
    await user.click(within(rowFor(2)).getByRole('button', { name: 'One more day in Osaka' }));

    expect(sequence()).toEqual(['Osaka 2', 'Kyoto 3', 'Osaka 2']);
  });
});

describe('two stays in one city, told apart', () => {
  const route = [
    { city: 'Osaka', days: 3 },
    { city: 'Kyoto', days: 3 },
    { city: 'Osaka', days: 1 },
  ];

  it('says "Coming back" rather than a number', () => {
    render(<Harness initial={route} />);
    expect(rowFor(0)).not.toHaveTextContent('Coming back');
    expect(rowFor(2)).toHaveTextContent('Coming back');
    for (const row of rows()) {
      expect(row).not.toHaveTextContent('#');
      expect(row.textContent ?? '').not.toMatch(/leg|visit index/i);
    }
  });

  it('gives each stay its own dates', () => {
    render(<Harness initial={route} />);
    // 11 Aug start: Osaka 11-13, Kyoto 14-16, and the return on the 17th. The
    // return must never inherit the first Osaka's range.
    expect(rowFor(0)).toHaveTextContent('11 Aug');
    expect(rowFor(1)).toHaveTextContent('14 Aug');
    expect(rowFor(2)).toHaveTextContent('17 Aug');
    expect(rowFor(2)).not.toHaveTextContent('11 Aug');
  });

  it('edits one Osaka without touching the other', async () => {
    const user = userEvent.setup();
    render(<Harness initial={route} dayCount={8} />);

    await user.click(within(rowFor(2)).getByRole('button', { name: 'One more day in Osaka' }));

    expect(sequence()).toEqual(['Osaka 3', 'Kyoto 3', 'Osaka 2']);
  });
});

describe('removing a stay', () => {
  const route = [
    { city: 'Osaka', days: 3 },
    { city: 'Kyoto', days: 3 },
    { city: 'Osaka', days: 1 },
  ];

  it('offers removal on either Osaka, and on neither Kyoto nor a plain route', () => {
    const { unmount } = render(<Harness initial={route} />);
    expect(within(rowFor(0)).getByRole('button', { name: 'Remove this stay in Osaka' })).toBeTruthy();
    expect(within(rowFor(2)).getByRole('button', { name: 'Remove this stay in Osaka' })).toBeTruthy();
    expect(within(rowFor(1)).queryByRole('button', { name: /Remove this stay/ })).toBeNull();
    unmount();

    render(<Harness initial={[{ city: 'Osaka', days: 4 }, { city: 'Kyoto', days: 3 }]} />);
    expect(screen.queryByRole('button', { name: /Remove this stay/ })).toBeNull();
  });

  it('returns the removed days to the pool', async () => {
    const user = userEvent.setup();
    render(<Harness initial={route} />);

    await user.click(within(rowFor(2)).getByRole('button', { name: 'Remove this stay in Osaka' }));

    expect(sequence()).toEqual(['Osaka 3', 'Kyoto 3']);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 7 days still to place.');
  });

  it('can drop the first Osaka and keep the return', async () => {
    const user = userEvent.setup();
    render(<Harness initial={route} />);

    await user.click(within(rowFor(0)).getByRole('button', { name: 'Remove this stay in Osaka' }));

    expect(sequence()).toEqual(['Kyoto 3', 'Osaka 1']);
  });
});

describe('when two stays end up next to each other', () => {
  it('merges them and says so once', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]} />);

    await user.click(within(rowFor(2)).getByRole('button', { name: 'Move Osaka earlier in the trip' }));

    expect(sequence()).toEqual(['Osaka 4', 'Kyoto 3']);
    expect(screen.getByText(/ran back to back/))
      .toHaveTextContent("Two Osaka stays ran back to back, so they're one 4-day stay now.");
  });

  it('clears the notice on the next ordinary edit', async () => {
    const user = userEvent.setup();
    render(<Harness dayCount={8} initial={[
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]} />);

    await user.click(within(rowFor(2)).getByRole('button', { name: 'Move Osaka earlier in the trip' }));
    expect(screen.queryByText(/ran back to back/)).not.toBeNull();

    await user.click(within(rowFor(0)).getByRole('button', { name: 'One more day in Osaka' }));
    expect(screen.queryByText(/ran back to back/)).toBeNull();
  });
});

describe('Split evenly keeps the route', () => {
  it('does not delete a return stay', async () => {
    // The Stage 4C release blocker, through the button that would have caused
    // it: three stays in, three stays out.
    const user = userEvent.setup();
    render(<Harness initial={[
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]} />);

    await user.click(screen.getByRole('button', { name: 'Split evenly' }));

    expect(sequence()).toEqual(['Osaka 3', 'Kyoto 2', 'Osaka 2']);
    expect(screen.getByRole('status')).toHaveTextContent('All 7 days placed.');
  });
});

describe('a trip that never doubles back', () => {
  it('looks the way it always did', () => {
    render(<Harness cities={['Osaka', 'Kyoto', 'Nara']} dayCount={10} initial={[
      { city: 'Osaka', days: 4 },
      { city: 'Kyoto', days: 3 },
      { city: 'Nara', days: 3 },
    ]} />);

    expect(sequence()).toEqual(['Osaka 4', 'Kyoto 3', 'Nara 3']);
    // No remove controls, no "Coming back", no merge notice: nothing about
    // repeated stays intrudes on a trip that has none.
    expect(screen.queryByRole('button', { name: /Remove this stay/ })).toBeNull();
    expect(screen.queryByText(/Coming back/)).toBeNull();
    expect(screen.queryByText(/ran back to back/)).toBeNull();
    // The one new affordance is present but quiet.
    expect(screen.getByRole('button', { name: '+ Add another stay' })).toBeTruthy();
  });

  it('still shows each ordinary stay and its own dates', () => {
    render(<Harness cities={['Osaka', 'Kyoto', 'Nara']} dayCount={8} startDate="2027-04-02" initial={[
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Nara', days: 2 },
    ]} />);

    expect(rows()).toHaveLength(3);
    expect(rowFor(0)).toHaveTextContent('2 Apr – 4 Apr');
    expect(rowFor(2)).toHaveTextContent('8 Apr – 9 Apr');
  });

  it('stays out of the way of a single-city trip', () => {
    const { container } = render(
      <CityStayPlanner cities={['Osaka']} dayCount={8} value={undefined} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps typed counts inside the unallocated pool', async () => {
    const user = userEvent.setup();
    render(<Harness dayCount={8} initial={[
      { city: 'Osaka', days: 2 },
      { city: 'Kyoto', days: 6 },
    ]} />);

    const field = within(rowFor(0)).getByRole('textbox', { name: 'Days in Osaka' });
    await user.click(field);
    await user.keyboard('99');
    await user.tab();

    expect(field).toHaveValue('2');
    expect(sequence()).toEqual(['Osaka 2', 'Kyoto 6']);
  });
});

describe('rendering is inert', () => {
  it('writes nothing and calls nothing on mount', () => {
    const onChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation(() => {
      throw new Error('the stay planner must not reach the network');
    });

    render(<Harness onChange={onChange} initial={[
      { city: 'Osaka', days: 3 },
      { city: 'Kyoto', days: 3 },
      { city: 'Osaka', days: 1 },
    ]} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

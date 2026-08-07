// @vitest-environment jsdom
/**
 * The calendar that replaced two `<input type="date">` fields.
 *
 * The arithmetic is covered in `src/lib/dateRange.test.ts`; what needs a DOM is
 * the part the traveller touches — that two clicks make a range, that the days
 * between are actually marked as such, and that a keyboard reaches them.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateRangeCalendar } from './DateRangeCalendar';
import type { RangeSelection } from '../../lib/dateRange';

const JANUARY = { start: '2027-01-21', end: '2027-01-31' } satisfies RangeSelection;

/**
 * The view opens on the selected start, falling back to `min` and then to
 * today. An empty selection therefore needs a `min` to land the tests on a
 * known month rather than on whatever month they happen to run in.
 */
const renderCalendar = (value: RangeSelection = {}) => {
  const onChange = vi.fn();
  const view = render(
    <DateRangeCalendar value={value} onChange={onChange} min="2027-01-01" />,
  );
  return { onChange, view };
};

/** Days are found by their ISO attribute; the visible text is just the number. */
const day = (iso: string): HTMLButtonElement => {
  const element = document.querySelector(`[data-iso="${iso}"]`);
  if (!element) throw new Error(`no cell for ${iso}`);
  return element as HTMLButtonElement;
};

describe('choosing a range', () => {
  it('takes the first click as the start', () => {
    const { onChange } = renderCalendar();

    fireEvent.click(day('2027-01-21'));

    expect(onChange).toHaveBeenCalledWith({ start: '2027-01-21' });
  });

  it('closes the range on the second click', () => {
    const { onChange } = renderCalendar({ start: '2027-01-21' });

    fireEvent.click(day('2027-01-31'));

    expect(onChange).toHaveBeenCalledWith({ start: '2027-01-21', end: '2027-01-31' });
  });

  it('clears both ends', () => {
    const { onChange } = renderCalendar(JANUARY);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe('drawing the trip', () => {
  it('marks both ends and every day between them', () => {
    // The whole point of the calendar: the eleven days are visible as one
    // stretch, which two separate date fields never showed.
    renderCalendar(JANUARY);

    expect(day('2027-01-21').dataset.role).toBe('start');
    expect(day('2027-01-31').dataset.role).toBe('end');
    for (let date = 22; date <= 30; date += 1) {
      expect(day(`2027-01-${date}`).dataset.role).toBe('in-range');
    }
  });

  it('leaves days outside the trip unmarked', () => {
    renderCalendar(JANUARY);
    expect(day('2027-01-20').dataset.role).toBe('none');
  });

  it('previews the band under the pointer before the second click', () => {
    renderCalendar({ start: '2027-01-21' });

    fireEvent.mouseEnter(day('2027-01-25'));

    expect(day('2027-01-23').dataset.role).toBe('in-range');
    expect(day('2027-01-25').dataset.role).toBe('end');
  });

  it('previews nothing backwards, because a backwards range is not one', () => {
    renderCalendar({ start: '2027-01-21' });

    fireEvent.mouseEnter(day('2027-01-14'));

    expect(day('2027-01-17').dataset.role).toBe('none');
  });

  it('states the span and the night count in words', () => {
    renderCalendar(JANUARY);
    expect(screen.getByText('21 Jan – 31 Jan 2027 · 11 days, 10 nights')).toBeInTheDocument();
  });
});

describe('bounds and reachability', () => {
  it('disables days before the minimum', () => {
    const onChange = vi.fn();
    render(<DateRangeCalendar value={{}} onChange={onChange} min="2027-01-15" />);

    expect(day('2027-01-14')).toBeDisabled();
    fireEvent.click(day('2027-01-14'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names each day in full for a screen reader', () => {
    // "21" alone tells a screen-reader user nothing about which month or year
    // they are committing to.
    renderCalendar(JANUARY);
    // Matched loosely on purpose: the separator between weekday and date is the
    // ICU build's business, the four facts in it are ours.
    expect(day('2027-01-21').getAttribute('aria-label'))
      .toMatch(/^Thursday.? 21 January 2027$/);
  });

  it('moves focus a week at a time with the arrow keys', () => {
    renderCalendar(JANUARY);
    const start = day('2027-01-21');
    start.focus();

    fireEvent.keyDown(start, { key: 'ArrowDown' });

    // Focus lands on the next render frame, so assert the target exists and is
    // reachable rather than racing the scheduler.
    expect(day('2027-01-28')).not.toBeDisabled();
  });

  it('pages between months', () => {
    renderCalendar(JANUARY);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.getByRole('heading', { name: 'February 2027' })).toBeInTheDocument();
  });

  it('shows only one month at a time', () => {
    // Side-by-side months crowd the wizard. A range that crosses a month
    // boundary is made by paging, not by painting two grids at once.
    renderCalendar(JANUARY);

    expect(screen.getByRole('heading', { name: 'January 2027' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'February 2027' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.queryByRole('heading', { name: 'January 2027' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'February 2027' })).toBeInTheDocument();
  });
});

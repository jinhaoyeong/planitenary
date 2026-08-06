import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  describeRange,
  isIsoDate,
  isSelectable,
  monthGrid,
  nextRangeSelection,
  rangeRole,
  toIso,
  toLocalDate,
} from './dateRange';

describe('reading a date without losing a day', () => {
  it('parses at local midnight, not UTC', () => {
    // `new Date('2027-01-21')` is UTC midnight, which is the 20th in the
    // Americas. A trip that starts a day early is the bug this prevents.
    const date = toLocalDate('2027-01-21');
    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(21);
  });

  it('round-trips through the ISO form', () => {
    expect(toIso(toLocalDate('2027-01-21'))).toBe('2027-01-21');
  });

  it('recognises what is and is not a date', () => {
    expect(isIsoDate('2027-01-21')).toBe(true);
    expect(isIsoDate('2027-1-21')).toBe(false);
    expect(isIsoDate('2027-02-30')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe('moving around the calendar', () => {
  it('crosses a month end', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
  });

  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('clamps a month step to the end of a shorter month', () => {
    // `Date.setMonth` would answer 3 March here, silently moving the traveller
    // into the wrong month while paging.
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('steps backwards too', () => {
    expect(addMonths('2027-03-15', -1)).toBe('2027-02-15');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
  });

  it('counts days inclusively, the way a traveller counts a trip', () => {
    expect(daysBetween('2027-01-21', '2027-01-31')).toBe(11);
    expect(daysBetween('2027-01-21', '2027-01-21')).toBe(1);
  });
});

describe('the month grid', () => {
  const grid = monthGrid('2027-01-15');

  it('is always six whole weeks, so the calendar never changes height', () => {
    expect(grid).toHaveLength(6);
    for (const week of grid) expect(week).toHaveLength(7);
  });

  it('starts the week on Monday by default', () => {
    // 1 January 2027 is a Friday, so the grid opens on Monday 28 December.
    expect(grid[0][0].iso).toBe('2026-12-28');
    expect(grid[0][0].inMonth).toBe(false);
  });

  it('starts on Sunday when asked', () => {
    expect(monthGrid('2027-01-15', 0)[0][0].iso).toBe('2026-12-27');
  });

  it('marks which days belong to the month being shown', () => {
    const inMonth = grid.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].iso).toBe('2027-01-01');
    expect(inMonth.at(-1)?.iso).toBe('2027-01-31');
  });

  it('runs continuously with no repeated or skipped day', () => {
    const cells = grid.flat();
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].iso).toBe(addDays(cells[index - 1].iso, 1));
    }
  });
});

describe('choosing a range in one place', () => {
  it('takes the first click as the start', () => {
    expect(nextRangeSelection({}, '2027-01-21')).toEqual({ start: '2027-01-21' });
  });

  it('closes the range on the second click', () => {
    expect(nextRangeSelection({ start: '2027-01-21' }, '2027-01-31'))
      .toEqual({ start: '2027-01-21', end: '2027-01-31' });
  });

  it('allows a one-day trip', () => {
    expect(nextRangeSelection({ start: '2027-01-21' }, '2027-01-21'))
      .toEqual({ start: '2027-01-21', end: '2027-01-21' });
  });

  it('restarts rather than producing a backwards range', () => {
    // Clicking the 14th after the 21st is a changed mind about the start, not
    // a request to travel backwards.
    expect(nextRangeSelection({ start: '2027-01-21' }, '2027-01-14'))
      .toEqual({ start: '2027-01-14' });
  });

  it('starts a new range once one is complete, with no clear step', () => {
    expect(nextRangeSelection({ start: '2027-01-21', end: '2027-01-31' }, '2027-03-02'))
      .toEqual({ start: '2027-03-02' });
  });
});

describe('what each day is drawn as', () => {
  const selection = { start: '2027-01-21', end: '2027-01-31' };

  it('marks both ends', () => {
    expect(rangeRole('2027-01-21', selection)).toBe('start');
    expect(rangeRole('2027-01-31', selection)).toBe('end');
  });

  it('connects everything between them', () => {
    expect(rangeRole('2027-01-22', selection)).toBe('in-range');
    expect(rangeRole('2027-01-30', selection)).toBe('in-range');
  });

  it('leaves days outside the trip alone', () => {
    expect(rangeRole('2027-01-20', selection)).toBe('none');
    expect(rangeRole('2027-02-01', selection)).toBe('none');
  });

  it('connects nothing while only the start is chosen', () => {
    expect(rangeRole('2027-01-25', { start: '2027-01-21' })).toBe('none');
  });

  it('calls a single-day trip its start', () => {
    // Both roles are true; "start" is the one that reads correctly on a card.
    expect(rangeRole('2027-01-21', { start: '2027-01-21', end: '2027-01-21' })).toBe('start');
  });
});

describe('bounds', () => {
  it('refuses a day before the minimum', () => {
    expect(isSelectable('2026-12-31', { min: '2027-01-01' })).toBe(false);
    expect(isSelectable('2027-01-01', { min: '2027-01-01' })).toBe(true);
  });

  it('refuses a day past the maximum', () => {
    expect(isSelectable('2027-02-01', { max: '2027-01-31' })).toBe(false);
  });

  it('allows anything when unbounded', () => {
    expect(isSelectable('1999-01-01')).toBe(true);
  });
});

describe('describing the selection', () => {
  it('says nothing is chosen', () => {
    expect(describeRange({})).toBe('No dates chosen');
  });

  it('asks for the second click once the first is made', () => {
    expect(describeRange({ start: '2027-01-21' })).toBe('21 Jan 2027 — choose the last day');
  });

  it('gives the span, the day count and the nights', () => {
    expect(describeRange({ start: '2027-01-21', end: '2027-01-31' }))
      .toBe('21 Jan – 31 Jan 2027 · 11 days, 10 nights');
  });

  it('names both years when a trip crosses new year', () => {
    expect(describeRange({ start: '2026-12-28', end: '2027-01-03' }))
      .toBe('28 Dec 2026 – 3 Jan 2027 · 7 days, 6 nights');
  });

  it('says one night rather than 1 nights', () => {
    expect(describeRange({ start: '2027-01-21', end: '2027-01-22' }))
      .toBe('21 Jan – 22 Jan 2027 · 2 days, 1 night');
  });
});

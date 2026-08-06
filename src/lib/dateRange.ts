/**
 * The arithmetic behind a two-ended calendar.
 *
 * Picking a trip's dates from two separate `<input type="date">` fields makes
 * the traveller hold the shape of their own trip in their head: they choose a
 * start, the picker closes, they open another one, and nothing ever shows them
 * the eleven days in between. A range calendar shows the trip as a trip.
 *
 * Everything here is pure and works in `YYYY-MM-DD` strings rather than
 * `Date`s wherever it can. Local midnight is the only safe way to read a date
 * in a browser — `new Date('2027-01-21')` is parsed as UTC and can land on the
 * 20th west of Greenwich, which is exactly the class of bug that makes a trip
 * one day short.
 */

/** `YYYY-MM-DD`, the form every date in a `TripProfile` is stored in. */
export type IsoDate = string;

export interface RangeSelection {
  start?: IsoDate;
  end?: IsoDate;
}

export interface CalendarCell {
  iso: IsoDate;
  day: number;
  /** False for the leading and trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
}

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-tripped rather than merely parsed: `2027-02-30` is not `NaN` to a
 * browser, it is 2 March. Only a date that comes back as itself is real.
 */
export const isIsoDate = (value: string | undefined | null): value is IsoDate => {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = toLocalDate(value);
  return !Number.isNaN(parsed.getTime()) && toIso(parsed) === value;
};

/** Local midnight, never UTC. See the note at the top of the file. */
export function toLocalDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00`);
}

export function toIso(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(iso: IsoDate, offset: number): IsoDate {
  const date = toLocalDate(iso);
  date.setDate(date.getDate() + offset);
  return toIso(date);
}

/**
 * Move by whole months, clamping to the end of a shorter one: a month after
 * 31 January is 28 February, not 3 March. `Date.setMonth` does the latter.
 */
export function addMonths(iso: IsoDate, offset: number): IsoDate {
  const date = toLocalDate(iso);
  const targetMonth = date.getMonth() + offset;
  const first = new Date(date.getFullYear(), targetMonth, 1);
  const lastDayOfTarget = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(date.getDate(), lastDayOfTarget));
  return toIso(first);
}

/** Inclusive count, so a Monday-to-Monday trip is eight days rather than seven. */
export function daysBetween(start: IsoDate, end: IsoDate): number {
  const from = toLocalDate(start).getTime();
  const to = toLocalDate(end).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Six weeks of cells for the month containing `iso`.
 *
 * Always six rows, so the grid does not change height as the traveller pages
 * through months — a calendar that resizes under the cursor moves the day they
 * were about to click.
 *
 * @param weekStartsOn 0 for Sunday, 1 for Monday.
 */
export function monthGrid(iso: IsoDate, weekStartsOn: 0 | 1 = 1): CalendarCell[][] {
  const anchor = toLocalDate(iso);
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - offset);

  const weeks: CalendarCell[][] = [];
  const cursor = new Date(gridStart);
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      row.push({
        iso: toIso(cursor),
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === anchor.getMonth(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export type RangeRole = 'start' | 'end' | 'in-range' | 'none';

/**
 * What a given day is to the current selection — which is what decides whether
 * it is drawn as an endpoint, as part of the connecting band, or as neither.
 */
export function rangeRole(iso: IsoDate, selection: RangeSelection): RangeRole {
  const { start, end } = selection;
  if (start && iso === start) return 'start';
  if (end && iso === end) return 'end';
  if (start && end && iso > start && iso < end) return 'in-range';
  return 'none';
}

/**
 * The state machine behind a single click.
 *
 * One click sets the start and clears whatever end was there; the next click
 * closes the range. Clicking *before* the pending start restarts from the new
 * day rather than producing a backwards range — a traveller who clicks the
 * 21st and then the 14th has changed their mind about when the trip begins,
 * not asked to travel backwards through time.
 *
 * A complete range always restarts, so a second trip's worth of clicks never
 * has to be preceded by a "clear".
 */
export function nextRangeSelection(selection: RangeSelection, clicked: IsoDate): RangeSelection {
  const { start, end } = selection;
  if (!start || end) return { start: clicked };
  if (clicked < start) return { start: clicked };
  return { start, end: clicked };
}

/**
 * Whether a day can be chosen at all.
 *
 * `min` exists so a trip cannot start in the past when the caller says so;
 * `max` bounds the far end. Both are inclusive and optional.
 */
export function isSelectable(iso: IsoDate, bounds: { min?: IsoDate; max?: IsoDate } = {}): boolean {
  if (bounds.min && iso < bounds.min) return false;
  if (bounds.max && iso > bounds.max) return false;
  return true;
}

/**
 * A live summary of the selection: "21–31 Jan 2027 · 11 days".
 *
 * Written from the range itself rather than assembled in the component, so the
 * calendar and any caller that needs the same sentence cannot drift apart.
 */
export function describeRange(
  selection: RangeSelection,
  locale = 'en-GB',
): string {
  const { start, end } = selection;
  if (!start) return 'No dates chosen';

  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const full = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  if (!end) return `${full.format(toLocalDate(start))} — choose the last day`;

  const nights = daysBetween(start, end) - 1;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = sameYear ? dayMonth.format(toLocalDate(start)) : full.format(toLocalDate(start));
  return `${from} – ${full.format(toLocalDate(end))} · ${daysBetween(start, end)} days, ${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

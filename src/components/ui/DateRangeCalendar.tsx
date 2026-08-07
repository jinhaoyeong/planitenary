import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  addMonths,
  describeRange,
  isIsoDate,
  isSelectable,
  monthGrid,
  nextRangeSelection,
  rangeRole,
  toIso,
  toLocalDate,
  type IsoDate,
  type RangeSelection,
} from '../../lib/dateRange';

interface DateRangeCalendarProps {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  /** Earliest selectable day, inclusive. */
  min?: IsoDate;
  /** Latest selectable day, inclusive. */
  max?: IsoDate;
  /** Labels the group for assistive technology. */
  label?: string;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const FULL_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A two-ended calendar: click the first day, click the last, and the days
 * between are shown as one connected band.
 *
 * It replaces two `<input type="date">` fields, which never showed the trip as
 * a whole — the traveller chose a start, the picker closed, and the eleven days
 * they had actually committed to were never drawn anywhere.
 *
 * One month is shown at a time on every screen size. Side-by-side months eat
 * the modal and bury the city-stay controls underneath; paging with the
 * previous/next controls is how a range that crosses a month boundary is made.
 *
 * Every day is a real `<button>`. Roving focus would be fewer tab stops, but a
 * month is 31 stops at most, and a plain button is the thing every screen
 * reader, switch device and keyboard already understands.
 */
export function DateRangeCalendar({
  value,
  onChange,
  min,
  max,
  label = 'Trip dates',
}: DateRangeCalendarProps) {
  const today = useMemo(() => toIso(new Date()), []);
  const [cursor, setCursor] = useState<IsoDate>(() => value.start ?? min ?? today);
  /**
   * The day under the pointer while a range is half-made, so the band can be
   * previewed before the second click lands. Cleared on leaving the grid.
   */
  const [hovered, setHovered] = useState<IsoDate | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Follow the selection when it changes from outside — a saved trip loading,
   * or another control editing the same dates — but only when the new start is
   * not already on screen. Paging to a month the traveller is already looking
   * at would yank the grid sideways under their cursor.
   *
   * Adjusted during render rather than in an effect: an effect would paint the
   * wrong month first and correct it a frame later.
   */
  const [seenStart, setSeenStart] = useState(value.start);
  if (value.start !== seenStart) {
    setSeenStart(value.start);
    if (value.start && isIsoDate(value.start)) {
      if (value.start.slice(0, 7) !== cursor.slice(0, 7)) setCursor(value.start);
    }
  }

  const previewSelection: RangeSelection = useMemo(() => {
    if (!value.start || value.end || !hovered) return value;
    // A hover before the start would draw a backwards band; the click itself
    // restarts the range there, so previewing nothing is the honest answer.
    return hovered >= value.start ? { start: value.start, end: hovered } : value;
  }, [value, hovered]);

  const visibleMonth = cursor;
  const visibleMonthKey = visibleMonth.slice(0, 7);

  const bounds = { min, max };
  const canPageBack = !min || addMonths(cursor, -1) >= min.slice(0, 7).concat('-01');
  const canPageForward = !max || visibleMonthKey < max.slice(0, 7);

  const choose = (iso: IsoDate) => {
    if (!isSelectable(iso, bounds)) return;
    onChange(nextRangeSelection(value, iso));
  };

  /**
   * Arrow keys walk the calendar a day or a week at a time, paging the view
   * when they step outside it. Without this a keyboard user would have to tab
   * through every day between the two ends of their trip.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, iso: IsoDate) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = addDays(iso, step);
    if (!isSelectable(target, bounds)) return;
    if (target.slice(0, 7) < visibleMonthKey) setCursor(addMonths(cursor, -1));
    if (target.slice(0, 7) > visibleMonthKey) setCursor(addMonths(cursor, 1));
    // The DOM node may not exist until the paging render lands.
    window.requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${target}"]`)?.focus();
    });
  };

  return (
    <div className="date-range-calendar" role="group" aria-label={label}>
      <div className="date-range-calendar-head">
        <button
          type="button"
          className="date-range-page adaptive-button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          disabled={!canPageBack}
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <p className="date-range-summary" aria-live="polite">{describeRange(value)}</p>
        <button
          type="button"
          className="date-range-page adaptive-button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          disabled={!canPageForward}
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="date-range-months" ref={gridRef} onMouseLeave={() => setHovered(null)}>
        <div className="date-range-month">
          <h4>{MONTH_LABEL.format(toLocalDate(visibleMonth))}</h4>
          <div className="date-range-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((weekday) => <span key={weekday}>{weekday.slice(0, 2)}</span>)}
          </div>
            <div className="date-range-grid">
              {monthGrid(visibleMonth).flat().map((cell) => {
                const role = rangeRole(cell.iso, previewSelection);
                const selectable = cell.inMonth && isSelectable(cell.iso, bounds);
                const spanned =
                  Boolean(previewSelection.start)
                  && Boolean(previewSelection.end)
                  && previewSelection.start !== previewSelection.end;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    data-iso={cell.iso}
                    className="date-range-day"
                    data-role={role}
                    data-bound={role === 'start' || role === 'end' ? (spanned ? 'range' : 'solo') : undefined}
                    data-today={cell.iso === today ? 'true' : undefined}
                    // Padding days belong to the neighbouring month, which has
                    // its own grid. Rendering them keeps the weeks aligned;
                    // hiding them from assistive tech keeps them from being
                    // read twice.
                    aria-hidden={!cell.inMonth}
                    tabIndex={cell.inMonth ? 0 : -1}
                    disabled={!selectable}
                    aria-pressed={role === 'start' || role === 'end'}
                    aria-label={FULL_DATE.format(toLocalDate(cell.iso))}
                    onClick={() => choose(cell.iso)}
                    onKeyDown={(event) => onKeyDown(event, cell.iso)}
                    onMouseEnter={() => setHovered(cell.iso)}
                    onFocus={() => setHovered(cell.iso)}
                  >
                    {cell.inMonth ? cell.day : ''}
                  </button>
                );
              })}
            </div>
        </div>
      </div>

      <div className="date-range-foot">
        <p>
          {!value.start
            ? 'Choose the day you arrive.'
            : !value.end
              ? 'Now choose the day you leave.'
              : 'Click any day to start a new range.'}
        </p>
        {(value.start || value.end) && (
          <button type="button" className="date-range-clear" onClick={() => onChange({})}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

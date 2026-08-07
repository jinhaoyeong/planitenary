/**
 * Reading a place's opening hours, for the scheduler and for the traveller.
 *
 * These were two different understandings of the same data, and only one of
 * them was correct. `humanScheduler` has resolved hours against a real weekday
 * since the Monday-closure fix; the details panel read `periods[0]` and printed
 * it with the raw confidence enum appended — `09:00–17:00 · high confidence` —
 * so a museum published as `Tu-Su 10:00-18:00` looked open on Monday to the
 * person deciding whether to go, while the planner knew perfectly well that it
 * was not.
 *
 * So the resolver moves here and the scheduler imports it back, and the
 * traveller-facing summary is built on the same function rather than beside it.
 * There is now one answer to "when is this open", and it is this file's.
 *
 * What this module will not do: assert a closure it cannot source. A weekly
 * pattern says nothing about a public holiday, and OSM's `PH` clauses are
 * dropped before they ever reach us. Those become caveats — stated gaps — never
 * a confident "closed on 1 January".
 */

import type { DateAwareOpeningHours } from './destinationIntelligence';
import { addDays, isIsoDate, toLocalDate } from './dateRange';

export const MINUTES_PER_DAY = 24 * 60;

export const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

export const toTime = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

export interface OpeningWindow {
  opensAt: number;
  closesAt: number;
  known: boolean;
  /** True when the place has published hours and none cover this weekday. */
  closedToday: boolean;
}

/**
 * The opening window that applies on a specific weekday.
 *
 * Previously this read `periods[0]` and applied it to every day, so a museum
 * published as `Tu-Su 10:00-18:00` looked open on Monday. That produced plans
 * built entirely around closed doors — an error the traveller only discovers
 * once they are standing outside.
 *
 * A place with published hours that name no window for `weekday` is *closed*
 * that day, which is a different answer from "hours unknown" and must not be
 * quietly treated as a generous window.
 */
export function openingWindow(hours: DateAwareOpeningHours | undefined, weekday?: number): OpeningWindow {
  const unknown: OpeningWindow = { opensAt: 0, closesAt: MINUTES_PER_DAY, known: false, closedToday: false };
  const periods = hours?.periods || [];
  if (periods.length === 0) return unknown;

  const usable = periods.filter((period) => period.opensAt && period.closesAt && !period.closed);
  if (usable.length === 0) return unknown;

  // No weekday to reason about (an undated trip): fall back to the first
  // window, which is the old behaviour and the best available answer.
  if (weekday === undefined) {
    const period = usable[0];
    return { opensAt: toMinutes(period.opensAt!), closesAt: toMinutes(period.closesAt!), known: true, closedToday: false };
  }

  const matching = usable.find((period) => !period.daysOfWeek || period.daysOfWeek.includes(weekday));
  if (!matching) {
    // Hours are published and none of them cover today.
    return { opensAt: 0, closesAt: 0, known: true, closedToday: true };
  }
  return {
    opensAt: toMinutes(matching.opensAt!),
    closesAt: toMinutes(matching.closesAt!),
    known: true,
    closedToday: false,
  };
}

// --- Traveller-facing summary ---------------------------------------------

/** Display order. The week starts Monday even though `getDay()` starts Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
/** Position of each weekday in display order, so adjacency is a subtraction. */
const WEEK_POSITION = new Map(WEEK_ORDER.map((weekday, index) => [weekday, index]));
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface OpeningDayGroup {
  /** 'Tue–Sun', 'Monday', 'Mon, Wed–Fri'. */
  label: string;
  /** Every window that day, in order. A place may shut for lunch. */
  windows: string[];
  weekdays: number[];
}

export interface OpeningHoursSummary {
  /** No usable published hours at all. Everything below is empty. */
  unknown: boolean;
  /** 'Open now until 18:00', 'Closed today', 'Opens 10:00'. */
  todayLine?: string;
  /** True when the destination's today has no window. */
  closedToday: boolean;
  weekly: OpeningDayGroup[];
  /** Named weekdays with no window at all, e.g. ['Monday']. */
  closedDays: string[];
  /** Dates within the traveller's own trip when this is shut. */
  closedTripDates: Array<{ date: string; label: string; reason: 'weekday' | 'dated' }>;
  /** Where the hours came from, as a sentence rather than an enum. */
  provenanceLine?: string;
  /** Stated gaps: what the source published that we could not read. */
  caveats: string[];
}

const EMPTY_SUMMARY: OpeningHoursSummary = {
  unknown: true,
  closedToday: false,
  weekly: [],
  closedDays: [],
  closedTripDates: [],
  caveats: [],
};

/**
 * Where the hours came from, said plainly.
 *
 * The panel used to interpolate `sourceConfidence` directly, so a traveller
 * read "· low confidence" with no way to know whether that meant the venue, the
 * map, or a guess. Naming the source answers the question the confidence rating
 * was standing in for.
 */
const PROVENANCE: Record<DateAwareOpeningHours['sourceConfidence'], string> = {
  high: 'Hours published on the venue’s own site',
  medium: 'Hours from the map provider',
  low: 'Community-maintained hours — worth checking on the day',
};

/** `2027-04-13` → `Monday 13 April`. */
function formatTripDate(iso: string): string {
  const date = toLocalDate(iso);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/**
 * The destination's current weekday and clock, not the browser's.
 *
 * A traveller planning Osaka from Kuala Lumpur at 23:30 is asking about a place
 * for which it is already tomorrow. Falling back to local time on an unknown or
 * malformed zone is the honest default: better the viewer's today than a
 * crash.
 */
function zonedNow(now: Date, timeZone?: string): { weekday: number; minutes: number } {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const lookup = (type: string) => parts.find((part) => part.type === type)?.value;
      const weekday = DAY_SHORT.indexOf(lookup('weekday') || '');
      // `hour12: false` yields 24 for midnight in some engines, 00 in others.
      const hour = Number(lookup('hour')) % 24;
      const minute = Number(lookup('minute'));
      if (weekday >= 0 && Number.isFinite(hour) && Number.isFinite(minute)) {
        return { weekday, minutes: hour * 60 + minute };
      }
    } catch {
      // An unrecognised IANA zone. Fall through to local time.
    }
  }
  return { weekday: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
}

/** Every window covering `weekday`, de-duplicated and in clock order. */
function windowsForWeekday(hours: DateAwareOpeningHours, weekday: number): string[] {
  const usable = hours.periods.filter((period) => period.opensAt && period.closesAt && !period.closed && !period.date);
  const windows = usable
    .filter((period) => !period.daysOfWeek || period.daysOfWeek.includes(weekday))
    .map((period) => `${period.opensAt}–${period.closesAt}`);
  return [...new Set(windows)].sort();
}

/**
 * Collapse the week into runs of identical hours.
 *
 * Contiguous runs read as `Tue–Sun`; days that share hours without being
 * adjacent are joined, so a place shut on Wednesday reads `Mon–Tue, Thu–Sun`
 * rather than as six separate lines.
 */
function groupWeek(byWeekday: Map<number, string[]>): OpeningDayGroup[] {
  const runs: Array<{ signature: string; weekdays: number[]; windows: string[] }> = [];
  for (const weekday of WEEK_ORDER) {
    const windows = byWeekday.get(weekday) || [];
    if (windows.length === 0) continue;
    const signature = windows.join('|');
    const previous = runs[runs.length - 1];
    // Only extend a run when the previous day is genuinely the day before, so
    // Sunday never merges into Monday across the wrap.
    const previousPosition = previous ? WEEK_POSITION.get(previous.weekdays[previous.weekdays.length - 1]) : undefined;
    const adjacent = previous
      && previous.signature === signature
      && previousPosition === (WEEK_POSITION.get(weekday) ?? -1) - 1;
    if (adjacent) previous.weekdays.push(weekday);
    else runs.push({ signature, weekdays: [weekday], windows });
  }

  const label = (weekdays: number[]) => (weekdays.length === 1
    ? DAY_NAMES[weekdays[0]]
    : `${DAY_SHORT[weekdays[0]]}–${DAY_SHORT[weekdays[weekdays.length - 1]]}`);

  // Runs that are apart in the week but identical in hours become one line.
  const merged = new Map<string, OpeningDayGroup>();
  for (const run of runs) {
    const existing = merged.get(run.signature);
    if (existing) {
      existing.label = `${existing.label}, ${label(run.weekdays)}`;
      existing.weekdays.push(...run.weekdays);
    } else {
      merged.set(run.signature, { label: label(run.weekdays), windows: run.windows, weekdays: [...run.weekdays] });
    }
  }
  return [...merged.values()];
}

export interface DescribeOpeningHoursOptions {
  /** The trip's own dates, so a closure can be tied to a day being planned. */
  tripStart?: string;
  tripEnd?: string;
  /**
   * The date this is being read *for*. On an itinerary day card that is the day
   * the traveller will be standing there, which is the question being asked —
   * not today.
   */
  onDate?: string;
  now?: Date;
  /** IANA zone of the destination. Without it, "today" is the viewer's today. */
  timezone?: string;
  /** When the hours were last checked, for the provenance line. */
  verifiedAt?: string;
  /** Gaps the parser could not read, carried from extraction. */
  caveats?: string[];
  /** Cap on how many trip closures to report. */
  maxTripClosures?: number;
}

/**
 * Everything a traveller needs to answer "can I actually go, and when".
 *
 * Returns `unknown: true` rather than inventing a window when nothing usable
 * was published — the panel omits the section entirely in that case, which is
 * the house rule for unsourced facts.
 */
export function describeOpeningHours(
  hours: DateAwareOpeningHours | undefined,
  options: DescribeOpeningHoursOptions = {},
): OpeningHoursSummary {
  const caveats = [...new Set(options.caveats || [])];
  const usable = (hours?.periods || []).filter((period) => period.opensAt && period.closesAt && !period.closed);
  if (!hours || usable.length === 0) return { ...EMPTY_SUMMARY, caveats };

  const byWeekday = new Map<number, string[]>();
  for (const weekday of WEEK_ORDER) byWeekday.set(weekday, windowsForWeekday(hours, weekday));

  const weekly = groupWeek(byWeekday);
  const closedDays = WEEK_ORDER
    .filter((weekday) => (byWeekday.get(weekday) || []).length === 0)
    .map((weekday) => DAY_NAMES[weekday]);

  // --- Today (or the day being asked about) -------------------------------
  const now = options.now || new Date();
  const zoned = zonedNow(now, options.timezone || hours.timezone);
  const askingAboutToday = !options.onDate;
  const weekday = options.onDate && isIsoDate(options.onDate)
    ? toLocalDate(options.onDate).getDay()
    : zoned.weekday;
  const todayWindows = byWeekday.get(weekday) || [];
  const closedToday = todayWindows.length === 0;

  let todayLine: string;
  if (closedToday) {
    todayLine = askingAboutToday ? 'Closed today' : 'Closed that day';
  } else if (!askingAboutToday) {
    todayLine = `Open ${todayWindows.join(', ')}`;
  } else {
    // Only "now" reasoning needs the clock, and only when the day is today.
    const open = todayWindows
      .map((window) => window.split('–'))
      .find(([opens, closes]) => zoned.minutes >= toMinutes(opens) && zoned.minutes < toMinutes(closes));
    const upcoming = todayWindows
      .map((window) => window.split('–'))
      .find(([opens]) => zoned.minutes < toMinutes(opens));
    if (open) todayLine = `Open now until ${open[1]}`;
    else if (upcoming) todayLine = `Opens ${upcoming[0]} today`;
    else todayLine = 'Closed for the day';
  }

  // --- Closures that land inside the trip ---------------------------------
  const closedTripDates: OpeningHoursSummary['closedTripDates'] = [];
  const limit = options.maxTripClosures ?? 3;
  if (isIsoDate(options.tripStart) && isIsoDate(options.tripEnd)) {
    // A date-specific closure is the only kind that may be asserted for a named
    // future date. A weekly pattern is evidence about weekdays, not about
    // holidays — and OSM's `PH` clauses never reach us, so a place shut on 1
    // January looks open here. That gap is reported as a caveat, not guessed at.
    const datedClosures = new Set(
      (hours.periods || []).filter((period) => period.closed && period.date).map((period) => period.date as string),
    );
    let cursor = options.tripStart;
    let guard = 0;
    while (cursor <= options.tripEnd && guard < 400) {
      guard += 1;
      if (closedTripDates.length >= limit) break;
      if (datedClosures.has(cursor)) {
        closedTripDates.push({ date: cursor, label: formatTripDate(cursor), reason: 'dated' });
      } else if ((byWeekday.get(toLocalDate(cursor).getDay()) || []).length === 0) {
        closedTripDates.push({ date: cursor, label: formatTripDate(cursor), reason: 'weekday' });
      }
      cursor = addDays(cursor, 1);
    }
  }

  const verified = options.verifiedAt ? formatVerified(options.verifiedAt) : undefined;
  const provenanceLine = `${PROVENANCE[hours.sourceConfidence]}${verified ? ` · checked ${verified}` : ''}`;

  return { unknown: false, todayLine, closedToday, weekly, closedDays, closedTripDates, provenanceLine, caveats };
}

function formatVerified(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A saved itinerary's weekly windows, back into the shape this module reads.
 *
 * `Activity` stores `days` where a candidate stores `daysOfWeek`, and carries
 * no source confidence of its own — so the caller states one rather than a
 * default being quietly presented as fact.
 */
export function activityHoursToDateAware(
  windows: Array<{ opensAt?: string; closesAt?: string; days?: number[] }> | undefined,
  sourceConfidence: DateAwareOpeningHours['sourceConfidence'],
  timezone?: string,
): DateAwareOpeningHours | undefined {
  const usable = (windows || []).filter((window) => window.opensAt && window.closesAt);
  if (usable.length === 0) return undefined;
  return {
    timezone,
    periods: usable.map((window) => ({
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      daysOfWeek: window.days?.length ? window.days : undefined,
    })),
    sourceConfidence,
  };
}

/** Convenience for callers that only have an ISO date and want its weekday. */
export const weekdayOf = (iso: string): number | undefined => (isIsoDate(iso) ? toLocalDate(iso).getDay() : undefined);

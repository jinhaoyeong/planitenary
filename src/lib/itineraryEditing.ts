/**
 * What a traveller may change about a day, and what they may change it to.
 *
 * The day header offers a city and a date. Both were free-text boxes: any
 * string was a city, any string was a date, and "e.g. Apr 23" was the only
 * guidance. So a trip to Tokyo and Osaka could acquire a day in "Toyko", and a
 * ten-day August trip could acquire a day in March — neither of which the rest
 * of the app has any way to make sense of, because every other surface derives
 * cities from the trip profile and days from the trip's own date range.
 *
 * These rules exist once, here, rather than inside the day header. The same
 * constraints have to hold wherever a day is edited, and a rule that lives in a
 * component is a rule the next surface will not have.
 *
 * Nothing here invents structure. Adding a city is a decision about the shape
 * of the trip — how long it is, and which days belong to whom — so it belongs
 * in trip settings, and this module deliberately offers no way to do it.
 */
import type { Itinerary } from '../data';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** `YYYY-MM-DD`, the form every stored day date already uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface TripCityOption {
  /** The configured destination's own id, where the trip has one. */
  id?: string;
  city: string;
}

/**
 * The cities this trip is actually going to.
 *
 * Taken from the trip profile, which is where the traveller set them and where
 * discovery, budgeting and routing all read them from. Days already on the plan
 * are folded in afterwards so an older itinerary whose profile is thinner than
 * its days cannot lose the city it is currently showing — a picker that cannot
 * represent the present value is worse than no picker.
 */
export function tripCityOptions(itinerary: { tripProfile?: unknown }): TripCityOption[] {
  const options: TripCityOption[] = [];
  const seen = new Set<string>();

  const profile = asRecord(itinerary.tripProfile);
  for (const raw of asArray(profile?.destinations)) {
    const destination = asRecord(raw);
    const city = text(destination?.city);
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = text(destination?.id);
    options.push(id ? { id, city } : { city });
  }

  return options;
}

/**
 * A city a day is currently in that the trip does not have.
 *
 * Older plans hold these, and there are two wrong ways to handle one. Dropping
 * it loses where the traveller said they were going; offering it as a choice
 * makes an unconfigured city selectable, so the day could be *moved* somewhere
 * discovery, routing and budget still know nothing about. It is shown instead
 * as the current state, unselectable, with adding it properly one step away.
 */
export function unconfiguredDayCity(
  itinerary: { tripProfile?: unknown },
  city: string | undefined,
): string | undefined {
  const current = text(city);
  if (!current) return undefined;
  const configured = tripCityOptions(itinerary).some(
    (option) => option.city.toLowerCase() === current.toLowerCase(),
  );
  return configured ? undefined : current;
}

/** The trip's own first and last day, when it has them. */
export function tripDateRange(
  itinerary: Pick<Itinerary, 'days'> & { tripProfile?: unknown },
): { start?: string; end?: string } {
  const profile = asRecord(itinerary.tripProfile);
  const start = text(profile?.startDate);
  const end = text(profile?.endDate);
  if (start && end && ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end) return { start, end };

  /**
   * No profile dates: fall back to the span the days themselves occupy. A trip
   * saved before the profile existed still has real dates, and clamping to
   * nothing would leave the old free-text behaviour in place for exactly the
   * itineraries most likely to need the guard.
   */
  const dates = (itinerary.days ?? [])
    .map((day) => day.date)
    .filter((date): date is string => typeof date === 'string' && ISO_DATE.test(date))
    .sort();
  return dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : {};
}

const addDays = (iso: string, count: number): string => {
  const [year, month, day] = iso.split('-').map(Number);
  // UTC throughout: a trip's dates are calendar days, not instants, and local
  // midnight would shift them by one either side of a timezone boundary.
  const at = new Date(Date.UTC(year, month - 1, day + count));
  return at.toISOString().slice(0, 10);
};

/**
 * Every date the trip covers, in order.
 *
 * Offered instead of a calendar so an impossible date is not something the
 * traveller can pick and then be told off for. Bounded because a date range is
 * a trip, not a subscription; a profile claiming ten years is a broken profile
 * and should not render ten years of options.
 */
export const MAX_TRIP_DATE_OPTIONS = 400;

export function tripDateOptions(itinerary: Pick<Itinerary, 'days'> & { tripProfile?: unknown }): string[] {
  const { start, end } = tripDateRange(itinerary);
  if (!start || !end) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length < MAX_TRIP_DATE_OPTIONS; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/**
 * A stored day label that names a month and a day, in any of the shapes this
 * app has used: "AUG 12", "Aug 12", "August 12", "12 Aug".
 */
const parseMonthDay = (value: string): { month: number; day: number } | undefined => {
  const tokens = value.trim().toLowerCase().replace(/[,.]/g, ' ').split(' ').filter(Boolean);
  const month = MONTHS.findIndex((name) => tokens.some((token) => token.startsWith(name)));
  if (month < 0) return undefined;
  const day = Number(tokens.find((token) => /^\d{1,2}$/.test(token)));
  return Number.isInteger(day) && day >= 1 && day <= 31 ? { month: month + 1, day } : undefined;
};

/**
 * The real date a day stands for, whatever it happens to be stored as.
 *
 * Trips created before dates were kept as `YYYY-MM-DD` carry presentation
 * labels — the production trip this was built for reads "AUG 12" — and an
 * earlier version of this module handed those trips back their free-text box.
 * That was exactly backwards: the itineraries most likely to hold a nonsense
 * date were the only ones still allowed to receive one.
 *
 * Resolution is read-only. Nothing is written merely because the traveller
 * opened the plan; the canonical date is persisted when they actually choose
 * one.
 */
export function resolveDayDate(
  itinerary: Pick<Itinerary, 'days'> & { tripProfile?: unknown },
  dayIndex: number,
): string | undefined {
  const { start, end } = tripDateRange(itinerary);
  const raw = text(itinerary.days?.[dayIndex]?.date);
  if (!start || !end) return raw && ISO_DATE.test(raw) ? raw : undefined;

  // 1. Already a real date inside the trip. Nothing to work out.
  if (raw && ISO_DATE.test(raw) && raw >= start && raw <= end) return raw;

  const within = tripDateOptions(itinerary);

  // 2. A month and a day that the trip contains exactly once. "AUG 12" on a
  //    12–22 August trip can only mean one date; on a trip spanning two
  //    Augusts it could mean two, and a guess between them is not a resolution.
  const label = raw ? parseMonthDay(raw) : undefined;
  if (label) {
    const matches = within.filter((iso) => {
      const [, month, day] = iso.split('-').map(Number);
      return month === label.month && day === label.day;
    });
    if (matches.length === 1) return matches[0];
  }

  /**
   * 3. Position. Used only when the label said nothing a date could be read
   *    from, so it cannot contradict something the traveller stored — a day
   *    labelled "Day 3" genuinely carries no date, and its place in the plan
   *    is the only fact available about when it happens.
   */
  return within[Math.min(Math.max(dayIndex, 0), within.length - 1)];
}

/** Whether a date is one the trip actually contains. */
export function isDateWithinTrip(
  itinerary: Pick<Itinerary, 'days'> & { tripProfile?: unknown },
  date: string,
): boolean {
  const { start, end } = tripDateRange(itinerary);
  if (!ISO_DATE.test(date)) return false;
  if (!start || !end) return true;
  return date >= start && date <= end;
}

/**
 * Move one day to another date, and put the plan back in order.
 *
 * Changing a date used to change a label and nothing else, leaving the card
 * sitting between the days it no longer belonged between — "Day 2" dated after
 * "Day 5". Re-sorting here means the day number, the calendar date and the
 * card's position are one fact with one source, so the view cannot disagree
 * with itself.
 *
 * Ties keep their existing order, which matters when two days share a date:
 * the traveller's arrangement is preserved rather than reshuffled by a sort
 * that had no opinion about it.
 */
export function moveDayToDate(itinerary: Itinerary, dayIndex: number, date: string): Itinerary {
  const target = itinerary.days?.[dayIndex];
  if (!target || !isDateWithinTrip(itinerary, date) || target.date === date) return itinerary;

  const moved = { ...itinerary, days: itinerary.days.map((day, index) => (index === dayIndex ? { ...day, date } : day)) };

  /**
   * Ordered by what each day *means*, not by how it is written.
   *
   * A trip holding "AUG 12" beside a freshly chosen "2026-08-16" cannot be
   * sorted as strings, but both resolve to real dates, and resolving is what
   * lets a legacy plan reorder correctly instead of being left alone.
   */
  const resolved = moved.days.map((_, index) => resolveDayDate(moved, index) ?? '');
  const ordered = moved.days
    .map((day, index) => ({ day, index }))
    .sort((a, b) => {
      const byDate = resolved[a.index].localeCompare(resolved[b.index]);
      return byDate !== 0 ? byDate : a.index - b.index;
    })
    .map(({ day }, position) => (day.day === position + 1 ? day : { ...day, day: position + 1 }));

  return { ...itinerary, days: ordered };
}

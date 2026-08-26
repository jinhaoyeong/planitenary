/**
 * The traveller's own division of their trip between cities.
 *
 * `planCityLegs` can infer a division from what was shortlisted, and for a trip
 * that has never been asked the question that is better than stamping every day
 * with the first city. But inferring it is a fallback, not the design: where you
 * sleep on night four is a hotel booking, and the app does not get to decide it.
 * So a multi-city trip is asked, before discovery, and everything downstream
 * follows the answer.
 *
 * This module holds the arithmetic — proposing a starting split, keeping an
 * edited one valid, and turning it into dated legs. It knows nothing about
 * React, and nothing about places.
 */
import type { CityLeg } from './cityLegs';
import { cityKey, orderedCities, routeStops, withLegIdentity } from './cityLegs';
import { addDays, isIsoDate } from './dateRange';
import type { TripCityStay } from './tripProfile';

/**
 * An even split, remainder to the earlier stays.
 *
 * Deliberately not weighted by anything: this is the first thing the traveller
 * sees, and it should look like an obvious starting point they are expected to
 * change, not a recommendation they have to argue with.
 *
 * It splits the **route it is given**, repeats included. Deduplicating here
 * would mean "Split evenly" quietly deleted a return stay: a traveller with
 * Osaka → Kyoto → Osaka would press it and get two stays back, with their
 * last night in Osaka gone and no indication it had ever been there. The
 * caller decides what the route is — a fresh trip passes its destinations,
 * which are unique anyway, and an edited plan passes its own sequence.
 */
export function proposeCityStays(cities: string[], dayCount: number): TripCityStay[] {
  const ordered = routeStops(cities);
  if (ordered.length === 0 || dayCount <= 0) return [];
  if (dayCount <= ordered.length) {
    // Fewer days than cities: one day each for as many as fit. The rest are
    // shown with zero so the traveller can see what does not fit, and move days
    // themselves rather than having a city silently dropped.
    return ordered.map((city, index) => ({ city, days: index < dayCount ? 1 : 0 }));
  }

  const base = Math.floor(dayCount / ordered.length);
  let remainder = dayCount - base * ordered.length;
  return ordered.map((city) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { city, days: base + extra };
  });
}

/**
 * Bring a stored or edited plan back in line with the trip it belongs to.
 *
 * Cities no longer on the trip are dropped; cities added since are appended
 * with zero days. Days are never invented or removed to make a total work —
 * an incomplete plan stays incomplete and {@link cityStayTotal} reports it, so
 * the traveller is the one who resolves it.
 */
export function reconcileCityStays(
  stays: TripCityStay[] | undefined,
  cities: string[],
): TripCityStay[] {
  const ordered = orderedCities(cities);
  if (ordered.length === 0) return [];
  const byCity = new Map((stays ?? []).map((stay) => [stay.city.trim().toLowerCase(), stay]));

  const kept: TripCityStay[] = [];
  // Preserve the traveller's ordering for cities they have already placed, then
  // append anything new at the end, where a newly added city naturally goes.
  //
  // Every stay survives, including a second stay in a city already on the
  // route. Osaka → Kyoto → Osaka is a route, not a duplicate: dropping the
  // repeat here is what used to turn a complete seven-day plan into a
  // six-day one, which the planner then read as unfinished and replaced
  // with its own inference.
  for (const stay of stays ?? []) {
    const match = ordered.find((city) => cityKey(city) === cityKey(stay.city));
    if (!match) continue;
    kept.push({ city: match, days: Math.max(0, Math.floor(stay.days)) });
  }
  for (const city of ordered) {
    if (byCity.has(city.toLowerCase())) continue;
    if (kept.some((entry) => entry.city.toLowerCase() === city.toLowerCase())) continue;
    kept.push({ city, days: 0 });
  }
  return kept;
}

export const cityStayTotal = (stays: TripCityStay[]): number =>
  stays.reduce((total, stay) => total + Math.max(0, stay.days), 0);

export interface CityStayStatus {
  total: number;
  dayCount: number;
  /** Every day of the trip is assigned to exactly one city. */
  complete: boolean;
  /** Days still to place, negative when the plan spends more than the trip has. */
  remaining: number;
  /** Cities the traveller listed but gave no days to. */
  unplaced: string[];
  /**
   * The same stays, named so a repeated city is not ambiguous.
   *
   * "Osaka has no days yet" is unanswerable on a route with two Osaka stays —
   * the traveller cannot tell which row to go and fix. {@link describeStaySlot}
   * says which one.
   */
  unplacedStays: Array<{ index: number; city: string; label: string }>;
}

export function cityStayStatus(stays: TripCityStay[], dayCount: number): CityStayStatus {
  const total = cityStayTotal(stays);
  return {
    total,
    dayCount,
    complete: dayCount > 0 && total === dayCount,
    remaining: dayCount - total,
    unplaced: stays.filter((stay) => stay.days <= 0).map((stay) => stay.city),
    unplacedStays: stays.flatMap((stay, index) => (stay.days > 0
      ? []
      : [{ index, city: stay.city, label: describeStaySlot(stays, index) }])),
  };
}

/**
 * Move `delta` days on or off one stay, without letting the plan exceed the
 * trip. Days come from and go back to the unassigned pool rather than being
 * taken from a neighbour — a traveller adding a night in Kyoto has not said
 * which other city should lose one, and guessing would undo their earlier work.
 *
 * Addressed by position, not by city name. On a route that returns to Osaka
 * there are two Osaka rows, and a name would edit both at once — silently
 * doubling every change the traveller made to either.
 */
export function adjustCityStay(
  stays: TripCityStay[],
  index: number,
  delta: number,
  dayCount: number,
): TripCityStay[] {
  const remaining = dayCount - cityStayTotal(stays);
  return stays.map((stay, position) => {
    if (position !== index) return stay;
    const room = delta > 0 ? Math.min(delta, Math.max(0, remaining)) : delta;
    return { ...stay, days: Math.max(0, stay.days + room) };
  });
}

/**
 * Set one stay's days outright — what typing into the counter does.
 *
 * Same pool rule as {@link adjustCityStay}, and the same addressing: the typed
 * value cannot steal from another stay, and cannot invent days the trip does
 * not have. Anything above what is still free is clamped; anything below zero
 * becomes zero.
 */
export function setCityStayDays(
  stays: TripCityStay[],
  index: number,
  days: number,
  dayCount: number,
): TripCityStay[] {
  const wanted = Number.isFinite(days) ? Math.floor(days) : 0;
  const current = stays[index]?.days ?? 0;
  const others = cityStayTotal(stays) - current;
  const maxForStay = Math.max(0, dayCount - others);
  const next = Math.max(0, Math.min(wanted, maxForStay));
  return stays.map((stay, position) => (position === index ? { ...stay, days: next } : stay));
}

/** Reorder the route by moving one stay up or down. */
export function moveCityStay(stays: TripCityStay[], index: number, direction: -1 | 1): TripCityStay[] {
  const target = index + direction;
  if (index < 0 || index >= stays.length || target < 0 || target >= stays.length) return stays;
  const next = [...stays];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** How many stays this route has in one city. */
const staysIn = (stays: TripCityStay[], city: string): number =>
  stays.filter((stay) => cityKey(stay.city) === cityKey(city)).length;

const ordinalVisit = (visit: number): string => {
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  if (words[visit]) return words[visit];
  const tens = visit % 100;
  const suffix = tens >= 11 && tens <= 13
    ? 'th'
    : visit % 10 === 1
      ? 'st'
      : visit % 10 === 2
        ? 'nd'
        : visit % 10 === 3
          ? 'rd'
          : 'th';
  return `${visit}${suffix}`;
};

/**
 * Add another stay, at the end of the route.
 *
 * The end is where a return almost always belongs — a last night near the
 * airport — and the move controls already handle the rest. It takes a day only
 * if the trip has one spare: a traveller who has already placed all seven
 * nights has not agreed to lose one of them, and quietly shortening an earlier
 * stay to fund this one would undo a decision they made deliberately. With
 * nothing free the stay arrives empty and says so, which is the same state any
 * unplaced city is already shown in.
 */
export function addCityStay(
  stays: TripCityStay[],
  city: string,
  dayCount: number,
): TripCityStay[] {
  const trimmed = city.trim();
  if (!trimmed) return stays;
  const free = Math.max(0, dayCount - cityStayTotal(stays));
  return [...stays, { city: trimmed, days: free > 0 ? 1 : 0 }];
}

export interface AddedCityStay {
  stays: TripCityStay[];
  /** The stay a day was taken from, when the trip had none spare. */
  borrowedFrom?: string;
}

/**
 * Which stay can best give up a day.
 *
 * The mirror of {@link driftTargetIndex}: that one decides who absorbs a spare
 * day, this one decides who can afford to lose one. Same two exclusions, for
 * the same reasons — a terminal one-day return is positioning for departure
 * and must not be emptied, and no stay may be reduced below a single night,
 * because a nought-day stay is the very state this is trying to avoid.
 *
 * Longest wins, ties broken by route order so the answer never depends on
 * sort stability. `-1` when no stay can spare anything.
 */
export function lendingStayIndex(stays: TripCityStay[]): number {
  const eligible = stays
    .map((stay, index) => ({ stay, index }))
    .filter((entry) => entry.stay.days >= 2 && !isTerminalReturnStay(stays, entry.index));
  if (eligible.length === 0) return -1;
  return eligible.reduce((best, entry) => (entry.stay.days > best.stay.days ? entry : best)).index;
}

/**
 * Add a stay that is usable the moment it appears.
 *
 * {@link addCityStay} leaves the new stay empty once every night is placed,
 * which is honest but hands the traveller an invalid plan and a warning to
 * clear up before they can do anything else. Here the day is borrowed from the
 * stay that can most afford it and the caller is told which, so the traveller
 * can undo it. The objection to funding a return from an earlier stay was that
 * doing it *quietly* overrides a deliberate decision; naming the stay and
 * offering the reversal is what answers that.
 *
 * Nothing is borrowed when the city would immediately merge into the stay it
 * follows — that add is a no-op, and a note about moving a day the traveller
 * got straight back would only confuse.
 */
export function addCityStayBorrowingDay(
  stays: TripCityStay[],
  city: string,
  dayCount: number,
): AddedCityStay {
  const trimmed = city.trim();
  if (!trimmed) return { stays };

  const free = Math.max(0, dayCount - cityStayTotal(stays));
  if (free > 0) return { stays: [...stays, { city: trimmed, days: 1 }] };

  const last = stays[stays.length - 1];
  if (last && cityKey(last.city) === cityKey(trimmed)) {
    return { stays: [...stays, { city: trimmed, days: 0 }] };
  }

  const lender = lendingStayIndex(stays);
  if (lender < 0) return { stays: [...stays, { city: trimmed, days: 0 }] };

  const funded = stays.map((stay, index) =>
    (index === lender ? { ...stay, days: stay.days - 1 } : stay));
  return {
    stays: [...funded, { city: trimmed, days: 1 }],
    borrowedFrom: stays[lender].city,
  };
}

/**
 * Whether this stay can be removed here.
 *
 * Only when the same city is stayed in somewhere else on the route. Removing
 * the *only* stay in a city is removing the city from the trip, which is a
 * destination decision and belongs to the destination editor — doing it from
 * here would delete a place's whole deck as a side effect of editing nights.
 *
 * Deliberately not "is this a later visit": on Osaka → Kyoto → Osaka either
 * Osaka may go, because either way Osaka is still somewhere the traveller
 * sleeps. A traveller who decides to start in Kyoto should not have to delete
 * their return and rebuild it at the front.
 */
export function canRemoveCityStay(stays: TripCityStay[], index: number): boolean {
  const stay = stays[index];
  return Boolean(stay) && staysIn(stays, stay.city) > 1;
}

/**
 * Drop one stay from the route. Its days return to the unplaced pool rather
 * than moving to a neighbour — same rule as every other edit here.
 */
export function removeCityStay(stays: TripCityStay[], index: number): TripCityStay[] {
  if (!canRemoveCityStay(stays, index)) return stays;
  return stays.filter((_, position) => position !== index);
}

/**
 * Merge stays that have ended up next to each other in the same city.
 *
 * There is no Osaka → Osaka move, so two adjacent Osaka rows are one stay
 * written twice. The legs already merge them; doing it in the plan as well
 * keeps the rows the traveller edits and the stay they actually get from
 * drifting apart, and means the dates under each row stay honest.
 *
 * Only ever triggered by adding, removing or reordering — never by typing a
 * night count, which cannot change what is adjacent to what.
 */
export function collapseAdjacentStays(stays: TripCityStay[]): TripCityStay[] {
  const merged: TripCityStay[] = [];
  for (const stay of stays) {
    const previous = merged[merged.length - 1];
    if (previous && cityKey(previous.city) === cityKey(stay.city)) {
      merged[merged.length - 1] = { ...previous, days: previous.days + Math.max(0, stay.days) };
      continue;
    }
    merged.push({ ...stay });
  }
  return merged;
}

/**
 * How the traveller would refer to one row, when a bare city name is ambiguous.
 *
 * "Osaka" on a route that only visits Osaka once. "Your return stay in Osaka"
 * when there are two and this is the last of them. Never a number the app made
 * up: a traveller has stays, not indices.
 */
export function describeStaySlot(stays: TripCityStay[], index: number): string {
  const stay = stays[index];
  if (!stay) return '';
  const total = staysIn(stays, stay.city);
  if (total < 2) return stay.city;

  const occurrence = stays
    .slice(0, index + 1)
    .filter((entry) => cityKey(entry.city) === cityKey(stay.city)).length;
  if (occurrence === 1) return `your first stay in ${stay.city}`;
  if (occurrence === total) return `your return stay in ${stay.city}`;
  return `your ${ordinalVisit(occurrence)} stay in ${stay.city}`;
}

/**
 * Whether the final stay is a return to somewhere the route has already been,
 * for a single day — the shape of an airport night before a morning flight.
 *
 * Structural, not lexical: nothing here looks for the word "airport". What
 * makes this stay different is that it is last, it is one day, and its city
 * already had a real stay earlier in the trip. A traveller who ends where they
 * began, for one night, is positioning for departure.
 */
export function isTerminalReturnStay(stays: TripCityStay[], index: number): boolean {
  const placed = stays.filter((stay) => stay.days > 0);
  const stay = stays[index];
  if (!stay || stay.days !== 1) return false;
  if (placed.length < 2 || stays[index] !== placed[placed.length - 1]) return false;
  return placed
    .slice(0, placed.length - 1)
    .some((earlier) => cityKey(earlier.city) === cityKey(stay.city));
}

/**
 * Which stay should absorb days a lengthened trip has spare.
 *
 * The last stay is the usual answer and stays the default — a trip extension
 * normally means more time at the end. It is the wrong answer when the last
 * stay is a one-day return to a city already visited: growing that turns a
 * night by the airport into a three-day stay nobody asked for, in a city the
 * traveller had already finished with.
 *
 * So a terminal return stay is skipped and the days go to the **longest**
 * remaining stay, ties broken by route order so the result never depends on
 * sort stability. Returns `-1` for a plan with nothing to grow.
 */
export function driftTargetIndex(stays: TripCityStay[]): number {
  const indices = stays
    .map((stay, index) => ({ stay, index }))
    .filter((entry) => entry.stay.days > 0);
  if (indices.length === 0) return -1;

  const last = indices[indices.length - 1];
  if (!isTerminalReturnStay(stays, last.index)) return last.index;

  const eligible = indices.slice(0, indices.length - 1);
  if (eligible.length === 0) return last.index;

  return eligible.reduce((best, entry) => (entry.stay.days > best.stay.days ? entry : best)).index;
}

/**
 * Stretch or trim a plan to a trip whose length has changed.
 *
 * Adding a day to a trip that already has a stay plan must not throw the plan
 * away — the traveller placed those nights deliberately, and one extra day is
 * not a reason to re-decide the other eight. The extra days go to whichever
 * stay {@link driftTargetIndex} names — normally the last, but never a one-day
 * return to a city the trip already finished with. Shortening still takes days
 * off the end, because a shortened trip really does lose its final nights.
 *
 * This is a fallback for a plan the traveller has not revisited yet, not a
 * substitute for asking: the planner still says what it did, and the stay
 * planner still shows the change as theirs to adjust.
 */
export function fitCityStays(stays: TripCityStay[], dayCount: number): TripCityStay[] {
  const placed = stays.filter((stay) => stay.days > 0);
  if (placed.length === 0 || dayCount <= 0) return [];

  const total = cityStayTotal(placed);
  if (total === dayCount) return placed;

  if (total < dayCount) {
    const grown = [...placed];
    const target = driftTargetIndex(grown);
    if (target < 0) return placed;
    grown[target] = { ...grown[target], days: grown[target].days + (dayCount - total) };
    return grown;
  }

  // Too long: take from the end, dropping any stay that reaches zero.
  let excess = total - dayCount;
  const trimmed = [...placed];
  for (let index = trimmed.length - 1; index >= 0 && excess > 0; index -= 1) {
    const take = Math.min(excess, trimmed[index].days);
    trimmed[index] = { ...trimmed[index], days: trimmed[index].days - take };
    excess -= take;
  }
  return trimmed.filter((stay) => stay.days > 0);
}

/**
 * Turn a stay plan into legs with real day numbers, dropping cities given no
 * days. Returns `[]` for a plan that does not cover the trip, so a caller can
 * fall back rather than build days from a half-answered question.
 *
 * A city the traveller returns to becomes a second leg with its own identity.
 * Two stays *in a row* in the same city do not: there is no Osaka → Osaka
 * hotel move, and splitting them would invent a transfer day the traveller
 * never makes and a second leg that never moves anywhere. They merge into one
 * stay of the combined length, which is unambiguously what was meant.
 */
export function legsFromCityStays(stays: TripCityStay[], dayCount: number): CityLeg[] {
  if (!cityStayStatus(stays, dayCount).complete) return [];
  const bare: Array<Omit<CityLeg, 'legId' | 'visitIndex'>> = [];
  let day = 1;
  for (const stay of stays) {
    if (stay.days <= 0) continue;
    const previous = bare[bare.length - 1];
    if (previous && cityKey(previous.city) === cityKey(stay.city)) {
      previous.endDay += stay.days;
      previous.days += stay.days;
      day += stay.days;
      continue;
    }
    bare.push({ city: stay.city, startDay: day, endDay: day + stay.days - 1, days: stay.days });
    day += stay.days;
  }
  return withLegIdentity(bare);
}

/**
 * "2–5 Apr" for a leg, given the trip's start date. Dates are what a traveller
 * books against; day numbers are what the app counts in.
 */
export function describeStayDates(
  leg: { startDay: number; endDay: number },
  startDate: string | undefined,
  locale = 'en-GB',
): string {
  const dayRange = leg.startDay === leg.endDay
    ? `Day ${leg.startDay}`
    : `Days ${leg.startDay}–${leg.endDay}`;
  if (!startDate || !isIsoDate(startDate)) return dayRange;

  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const from = new Date(`${addDays(startDate, leg.startDay - 1)}T00:00:00`);
  const to = new Date(`${addDays(startDate, leg.endDay - 1)}T00:00:00`);
  return leg.startDay === leg.endDay
    ? `${format.format(from)}`
    : `${format.format(from)} – ${format.format(to)}`;
}

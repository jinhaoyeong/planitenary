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
import { orderedCities } from './cityLegs';
import { addDays, isIsoDate } from './dateRange';
import type { TripCityStay } from './tripProfile';

/**
 * An even split, remainder to the earlier cities.
 *
 * Deliberately not weighted by anything: this is the first thing the traveller
 * sees, and it should look like an obvious starting point they are expected to
 * change, not a recommendation they have to argue with.
 */
export function proposeCityStays(cities: string[], dayCount: number): TripCityStay[] {
  const ordered = orderedCities(cities);
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
  for (const stay of stays ?? []) {
    const match = ordered.find((city) => city.toLowerCase() === stay.city.trim().toLowerCase());
    if (match && !kept.some((entry) => entry.city === match)) {
      kept.push({ city: match, days: Math.max(0, Math.floor(stay.days)) });
    }
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
}

export function cityStayStatus(stays: TripCityStay[], dayCount: number): CityStayStatus {
  const total = cityStayTotal(stays);
  return {
    total,
    dayCount,
    complete: dayCount > 0 && total === dayCount,
    remaining: dayCount - total,
    unplaced: stays.filter((stay) => stay.days <= 0).map((stay) => stay.city),
  };
}

/**
 * Move `delta` days on or off one city, without letting the plan exceed the
 * trip. Days come from and go back to the unassigned pool rather than being
 * taken from a neighbour — a traveller adding a night in Kyoto has not said
 * which other city should lose one, and guessing would undo their earlier work.
 */
export function adjustCityStay(
  stays: TripCityStay[],
  city: string,
  delta: number,
  dayCount: number,
): TripCityStay[] {
  const remaining = dayCount - cityStayTotal(stays);
  return stays.map((stay) => {
    if (stay.city !== city) return stay;
    const room = delta > 0 ? Math.min(delta, Math.max(0, remaining)) : delta;
    return { ...stay, days: Math.max(0, stay.days + room) };
  });
}

/** Reorder the route by moving one stay up or down. */
export function moveCityStay(stays: TripCityStay[], index: number, direction: -1 | 1): TripCityStay[] {
  const target = index + direction;
  if (index < 0 || index >= stays.length || target < 0 || target >= stays.length) return stays;
  const next = [...stays];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Stretch or trim a plan to a trip whose length has changed.
 *
 * Adding a day to a trip that already has a stay plan must not throw the plan
 * away — the traveller placed those nights deliberately, and one extra day is
 * not a reason to re-decide the other eight. The extra days go to the **last**
 * stay, which is where a trip extension usually lands, and the caller says so.
 * Shortening takes days off the end for the same reason, and never below zero.
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
    grown[grown.length - 1] = {
      ...grown[grown.length - 1],
      days: grown[grown.length - 1].days + (dayCount - total),
    };
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
 */
export function legsFromCityStays(stays: TripCityStay[], dayCount: number): CityLeg[] {
  if (!cityStayStatus(stays, dayCount).complete) return [];
  const legs: CityLeg[] = [];
  let day = 1;
  for (const stay of stays) {
    if (stay.days <= 0) continue;
    legs.push({ city: stay.city, startDay: day, endDay: day + stay.days - 1, days: stay.days });
    day += stay.days;
  }
  return legs;
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

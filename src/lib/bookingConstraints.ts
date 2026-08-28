/**
 * What a booking does to the day around it.
 *
 * This is the part that makes booking integration planning rather than
 * advertising. A confirmed flight at 10:55 is not a card to look at; it is a
 * wall the day has to end before. A room that opens at three is not a price; it
 * is the reason the afternoon cannot assume a shower.
 *
 * Everything here is deterministic. No model is asked whether a museum fits
 * before a train — the arithmetic is arithmetic, and a planner that had to ask
 * would be guessing at the one class of fact the traveller can already prove.
 *
 * ## Reusing the timing that already exists
 *
 * The airport buffers are **not** redefined here. `ARRIVAL_SETTLING_MINUTES`
 * and `DEPARTURE_LEAD_MINUTES` are product rules the destination planner and
 * the flight-aware proposal engine already share, and a second copy would drift
 * from them the first time either changed. Likewise the shape this returns is
 * the shape `shapeTripEdge` already returns, so a booking-derived day and an
 * edge-derived day reach `simulateDay` through the same door.
 */
import {
  ARRIVAL_SETTLING_MINUTES,
  DEPARTURE_LEAD_MINUTES,
} from '../../supabase/functions/_shared/itineraryEdgeTiming';
import { toMinutes, toTime } from './openingHours';
import {
  bookingDayNumber,
  isCommittedBooking,
  type TravelBooking,
} from './travelBooking';

/** How a day differs from the normal pace because of what is booked on it. */
export interface BookingDayShape {
  /** Earliest the day's own plan may begin, `HH:MM`. */
  startTimeOverride?: string;
  /** Latest the traveller can still be out, `HH:MM`. */
  returnTimeOverride?: string;
  /** Fewer main stops than the pace would otherwise allow. */
  maxMainOverride?: number;
  /** Windows that are already spoken for, in minutes from midnight. */
  fixedWindows: Array<{ startMinutes: number; endMinutes: number; label: string }>;
  /** Sentences explaining each override, for the traveller and for tests. */
  notes: string[];
}

const EMPTY_SHAPE: BookingDayShape = { fixedWindows: [], notes: [] };

/** A default check-out, used only when a stay booking names no time. */
const ASSUMED_CHECKOUT = '11:00';
/** A default check-in, used only when a stay booking names no time. */
const ASSUMED_CHECKIN = '15:00';

const clockMinutes = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const minutes = toMinutes(value);
  return Number.isFinite(minutes) ? minutes : undefined;
};

/**
 * The bookings that land on one trip day.
 *
 * Committed ones only. A `planned` booking is a note to self — the traveller
 * has not agreed to be anywhere — and letting one narrow the day would mean an
 * idea they typed at midnight silently shortened their sightseeing.
 */
export function committedBookingsForDay(
  bookings: TravelBooking[],
  dayNumber: number,
  tripStartDate: string | undefined,
  dayCount: number,
): TravelBooking[] {
  return bookings.filter((booking) => {
    if (!isCommittedBooking(booking)) return false;
    return bookingDayNumber(booking, tripStartDate, dayCount) === dayNumber;
  });
}

/**
 * The constraints a day inherits from what is booked on it.
 *
 * Returns only what differs from the normal pace, so a day with nothing booked
 * passes through untouched — the same contract `shapeTripEdge` keeps.
 */
export function bookingDayShape(dayBookings: TravelBooking[]): BookingDayShape {
  if (dayBookings.length === 0) return EMPTY_SHAPE;

  const shape: BookingDayShape = { fixedWindows: [], notes: [] };
  const narrowStart = (minutes: number, note: string) => {
    const current = clockMinutes(shape.startTimeOverride);
    if (current === undefined || minutes > current) {
      shape.startTimeOverride = toTime(Math.min(minutes, 24 * 60 - 1));
      shape.notes.push(note);
    }
  };
  const narrowEnd = (minutes: number, note: string) => {
    const current = clockMinutes(shape.returnTimeOverride);
    if (current === undefined || minutes < current) {
      shape.returnTimeOverride = toTime(Math.max(0, minutes));
      shape.notes.push(note);
    }
  };
  const capMain = (value: number) => {
    shape.maxMainOverride = Math.min(shape.maxMainOverride ?? Number.POSITIVE_INFINITY, value);
  };

  for (const booking of dayBookings) {
    if (booking.type === 'flight') {
      const departure = clockMinutes(booking.startTime);
      if (departure !== undefined) {
        // The existing product rule, not a new one: leaving for the airport is
        // check-in, security, and not running for it.
        narrowEnd(
          departure - DEPARTURE_LEAD_MINUTES,
          `Ends in time to leave for the ${booking.startTime} departure.`,
        );
        capMain(1);
        shape.fixedWindows.push({
          startMinutes: Math.max(0, departure - DEPARTURE_LEAD_MINUTES),
          endMinutes: departure,
          label: `Leave for ${booking.origin || 'the airport'}`,
        });
      }
      // A flight that lands on this day opens the day rather than closing it.
      const landing = booking.endDate && booking.endDate !== booking.startDate
        ? undefined
        : clockMinutes(booking.endTime);
      if (landing !== undefined) {
        narrowStart(
          landing + ARRIVAL_SETTLING_MINUTES,
          `Starts after the ${booking.endTime} arrival, with time to clear the airport.`,
        );
        capMain(1);
      }
      continue;
    }

    if (booking.type === 'rail' || booking.type === 'transfer') {
      const departure = clockMinutes(booking.startTime);
      const arrival = clockMinutes(booking.endTime);
      if (departure !== undefined && arrival !== undefined && arrival > departure) {
        shape.fixedWindows.push({
          startMinutes: departure,
          endMinutes: arrival,
          label: booking.origin && booking.destination
            ? `${booking.origin} → ${booking.destination}`
            : booking.title,
        });
      } else if (departure !== undefined) {
        shape.fixedWindows.push({
          startMinutes: departure,
          endMinutes: departure,
          label: booking.title,
        });
      }
      continue;
    }

    if (booking.type === 'activity-ticket') {
      const start = clockMinutes(booking.startTime);
      if (start === undefined) continue;
      const end = clockMinutes(booking.endTime) ?? start;
      shape.fixedWindows.push({
        startMinutes: start,
        endMinutes: Math.max(start, end),
        label: booking.title,
      });
      continue;
    }

    if (booking.type === 'stay') {
      // Check-in is not a constraint on sightseeing — a traveller can be out
      // all afternoon and collect the key at six. It is recorded as a window so
      // conflicts can say why a plan that assumed the room was ready is wrong,
      // and nothing more.
      const checkIn = clockMinutes(booking.startTime) ?? clockMinutes(ASSUMED_CHECKIN);
      if (checkIn !== undefined) {
        shape.fixedWindows.push({
          startMinutes: checkIn,
          endMinutes: checkIn,
          label: `${booking.title} check-in`,
        });
      }
    }
  }

  if (shape.maxMainOverride === Number.POSITIVE_INFINITY) delete shape.maxMainOverride;
  return shape;
}

/**
 * Check-out on the day a stay ends.
 *
 * Separate from {@link bookingDayShape} because a stay's end date is a
 * different day from its start, and folding both into one pass would have made
 * the check-out of a three-night booking land on the night the traveller
 * arrived.
 */
export function checkoutShapeForDay(
  bookings: TravelBooking[],
  dayNumber: number,
  tripStartDate: string | undefined,
  dayCount: number,
): { checkoutTime?: string; note?: string } {
  for (const booking of bookings) {
    if (booking.type !== 'stay' || !isCommittedBooking(booking)) continue;
    if (!booking.endDate) continue;
    const endDay = bookingDayNumber({ startDate: booking.endDate }, tripStartDate, dayCount);
    if (endDay !== dayNumber) continue;
    const checkout = booking.endTime || ASSUMED_CHECKOUT;
    return {
      checkoutTime: checkout,
      note: `${booking.title} checks out at ${checkout}.`,
    };
  }
  return {};
}

export interface BookingConflict {
  dayNumber: number;
  bookingId: string;
  /** A sentence a traveller can act on, not a category. */
  message: string;
}

const activityEndMinutes = (time: string | undefined, durationMinutes: number | undefined): number | undefined => {
  const start = clockMinutes(time);
  if (start === undefined) return undefined;
  return start + Math.max(0, durationMinutes ?? 0);
};

/**
 * Where the plan and the bookings disagree, said plainly.
 *
 * Deterministic and arithmetic. Nothing here asks a model whether two times
 * overlap, because the answer is subtraction and a model that got it wrong
 * would be wrong about the only facts the traveller can already verify.
 */
export function bookingConflicts(
  day: { day: number; activities: Array<{ id?: string; name: string; time: string; durationMinutes?: number }> },
  bookings: TravelBooking[],
  tripStartDate: string | undefined,
  dayCount: number,
): BookingConflict[] {
  const conflicts: BookingConflict[] = [];
  const dayBookings = committedBookingsForDay(bookings, day.day, tripStartDate, dayCount);
  const checkout = checkoutShapeForDay(bookings, day.day, tripStartDate, dayCount);
  const checkoutMinutes = clockMinutes(checkout.checkoutTime);

  for (const booking of dayBookings) {
    if (booking.type === 'flight') {
      const departure = clockMinutes(booking.startTime);
      if (departure === undefined) continue;
      const mustLeaveBy = departure - DEPARTURE_LEAD_MINUTES;
      for (const activity of day.activities) {
        const ends = activityEndMinutes(activity.time, activity.durationMinutes);
        if (ends === undefined || ends <= mustLeaveBy) continue;
        conflicts.push({
          dayNumber: day.day,
          bookingId: booking.id,
          message: `${activity.name} runs to ${toTime(ends)}, but a ${booking.startTime} departure means leaving by ${toTime(Math.max(0, mustLeaveBy))}.`,
        });
      }
      continue;
    }

    if (booking.type === 'activity-ticket' || booking.type === 'rail' || booking.type === 'transfer') {
      const start = clockMinutes(booking.startTime);
      if (start === undefined) continue;
      for (const activity of day.activities) {
        const activityStart = clockMinutes(activity.time);
        const ends = activityEndMinutes(activity.time, activity.durationMinutes);
        if (activityStart === undefined || ends === undefined) continue;
        if (ends <= start || activityStart >= (clockMinutes(booking.endTime) ?? start)) continue;
        const what = booking.type === 'activity-ticket' ? 'reservation' : 'departure';
        conflicts.push({
          dayNumber: day.day,
          bookingId: booking.id,
          message: `${activity.name} overlaps your ${booking.startTime} ${booking.title} ${what}.`,
        });
      }
    }
  }

  if (checkoutMinutes !== undefined) {
    for (const activity of day.activities) {
      const activityStart = clockMinutes(activity.time);
      if (activityStart === undefined || activityStart >= checkoutMinutes) continue;
      const ends = activityEndMinutes(activity.time, activity.durationMinutes);
      if (ends === undefined || ends <= checkoutMinutes) continue;
      conflicts.push({
        dayNumber: day.day,
        bookingId: 'checkout',
        message: `${checkout.note} ${activity.name} currently ends at ${toTime(ends)}.`,
      });
    }
  }

  return conflicts;
}

/**
 * Where a hotel reservation and the route disagree about the same night.
 *
 * These are two different facts and each owns its own half. The stay plan is
 * authority for **where the traveller sleeps** — it is what builds legs, day
 * base cities and `activityCities`. A `stay` booking is authority for **which
 * hotel is reserved**, its reference, its price and its check-in hour.
 *
 * Neither may overwrite the other. A booking that could move the route would
 * let a mistyped city silently relocate a whole leg; a route change that
 * rewrote the booking would edit a reservation the hotel has not agreed to.
 * So a disagreement is surfaced and left for the traveller to settle.
 *
 * Compared by night, not by leg. A city can be visited twice — `osaka#1` and
 * `osaka#2` — and matching on the city name alone would happily attach a
 * January hotel to a March stay. The date is what separates the two visits.
 */
export function stayRouteConflicts(
  bookings: TravelBooking[],
  days: Array<{ day: number; stayCity?: string }>,
  tripStartDate: string | undefined,
): BookingConflict[] {
  const conflicts: BookingConflict[] = [];
  const dayCount = days.length;
  const byNumber = new Map(days.map((day) => [day.day, day]));

  for (const booking of bookings) {
    if (booking.type !== 'stay' || !isCommittedBooking(booking)) continue;
    if (!booking.cityKey) continue;

    const firstNight = bookingDayNumber(booking, tripStartDate, dayCount);
    if (firstNight === undefined) continue;
    // A stay covers the nights from check-in up to but not including check-out:
    // a room booked the 20th to the 23rd is three nights, not four.
    const lastNight = booking.endDate
      ? (bookingDayNumber({ startDate: booking.endDate }, tripStartDate, dayCount) ?? firstNight) - 1
      : firstNight;

    for (let night = firstNight; night <= Math.max(firstNight, lastNight); night += 1) {
      const day = byNumber.get(night);
      const routeCity = day?.stayCity?.trim();
      if (!routeCity) continue;
      if (routeCity.toLowerCase() === booking.cityKey) continue;
      conflicts.push({
        dayNumber: night,
        bookingId: booking.id,
        message: `Day ${night} is planned in ${routeCity}, but ${booking.title} is booked in ${booking.city || booking.cityKey}.`,
      });
    }
  }

  return conflicts;
}

/**
 * The fields a committed booking owns, which no plan revision may rewrite.
 *
 * Times, dates and identity — the facts a confirmation email would contradict.
 * Notes and status are deliberately absent: a traveller cancelling their own
 * hotel is an edit, not a violation.
 */
const OWNED_FIELDS = ['type', 'startDate', 'startTime', 'endDate', 'endTime', 'reference', 'title', 'relatedActivityId'] as const;

export interface BookingMutation {
  bookingId: string;
  field: string;
  before: string | undefined;
  after: string | undefined;
}

/**
 * What a plan revision did to the bookings it was not allowed to touch.
 *
 * Smart Plan may plan around a confirmed flight, explain that it does not fit,
 * and suggest moving the sightseeing. It may not quietly move the flight. This
 * returns the evidence when it did, so the caller can refuse the revision
 * rather than discovering the change at the airport.
 *
 * A removal counts. Dropping a confirmed hotel is the most damaging possible
 * silent edit and would otherwise be invisible to a field-by-field diff.
 */
export function committedBookingMutations(
  before: TravelBooking[],
  after: TravelBooking[],
): BookingMutation[] {
  const mutations: BookingMutation[] = [];
  const afterById = new Map(after.map((booking) => [booking.id, booking]));

  for (const original of before) {
    if (!isCommittedBooking(original)) continue;
    const next = afterById.get(original.id);
    if (!next) {
      mutations.push({ bookingId: original.id, field: 'removed', before: original.title, after: undefined });
      continue;
    }
    for (const field of OWNED_FIELDS) {
      const was = original[field];
      const now = next[field];
      if (was !== now) {
        mutations.push({
          bookingId: original.id,
          field,
          before: was === undefined ? undefined : String(was),
          after: now === undefined ? undefined : String(now),
        });
      }
    }
  }

  return mutations;
}

/**
 * The revision's bookings, with every committed record restored to what the
 * traveller actually holds.
 *
 * Used at the boundary where a planner result becomes state. Preferring repair
 * over rejection keeps a useful revision usable: the sightseeing the planner
 * moved is kept, and only the facts it had no authority over are put back.
 */
export function preserveCommittedBookings(
  before: TravelBooking[],
  after: TravelBooking[],
): TravelBooking[] {
  const afterById = new Map(after.map((booking) => [booking.id, booking]));
  const restored: TravelBooking[] = [];
  const seen = new Set<string>();

  for (const original of before) {
    if (isCommittedBooking(original)) {
      restored.push(original);
      seen.add(original.id);
      continue;
    }
    const next = afterById.get(original.id);
    if (next) {
      restored.push(next);
      seen.add(original.id);
    }
  }

  for (const booking of after) {
    if (seen.has(booking.id)) continue;
    restored.push(booking);
  }

  return restored;
}

export { ARRIVAL_SETTLING_MINUTES, DEPARTURE_LEAD_MINUTES };

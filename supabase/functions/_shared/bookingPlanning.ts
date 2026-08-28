/**
 * Scheduling-only projection of persisted TravelBookings.
 *
 * This module intentionally never returns a booking reference, provider ID,
 * price, private note, or the raw booking object. The planner gets only the
 * calendar, clock, place, status, and explicit Activity relationship required
 * to protect the traveller's day.
 */
import { elapsedMinutes, isTimeZone } from './timeZoneMath.ts';

export type BookingConstraintStatus = 'confirmed' | 'requested';
export type BookingFixedRole = 'arrival' | 'departure' | 'transfer' | 'fixed';
export type BookingFixedKind = 'flight' | 'transport' | 'reservation';

export interface BookingPlanningDay {
  day: number;
  calendarDate?: string;
  stayCity: string;
}

export interface PersistedFlightSchedule {
  id: string;
  day: number;
  startTime: string;
  durationMinutes: number;
  name: string;
}

export interface BookingFixedEventSeed {
  id: string;
  day: number;
  name: string;
  startTime: string;
  endTime: string;
  start: number;
  end: number;
  transportKind: BookingFixedKind;
  roleHint?: BookingFixedRole;
  constraintStatus: BookingConstraintStatus;
  elapsedMinutes?: number;
  /** Booking-derived events never authorize a route/base mutation. */
  authorizesTransfer: false;
}

export interface BookingPlanningConflict {
  code: 'booking-date-unplaced' | 'flight-booking-mismatch' | 'stay-booking-conflict' | 'booking-schedule-invalid';
  severity: 'error';
  message: string;
  day?: number;
}

export interface BookingConstraintTrace {
  bookingConstraintsApplied: number;
  confirmedBookingsApplied: number;
  requestedBookingsProtected: number;
  bookingConflicts: number;
}

export interface BookingPlanningResult {
  events: BookingFixedEventSeed[];
  conflicts: BookingPlanningConflict[];
  linkedActivityIds: string[];
  trace?: BookingConstraintTrace;
}

type BookingType = 'flight' | 'stay' | 'rail' | 'transfer' | 'activity-ticket';

interface ActiveBooking {
  index: number;
  type: BookingType;
  status: BookingConstraintStatus;
  title: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  city?: string;
  origin?: string;
  destination?: string;
  originTimeZone?: string;
  destinationTimeZone?: string;
  serviceNumber?: string;
  relatedActivityId?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BOOKING_TYPES = new Set<BookingType>(['flight', 'stay', 'rail', 'transfer', 'activity-ticket']);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const text = (value: unknown, limit = 160): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result ? result.slice(0, limit) : undefined;
};

const clock = (value: unknown): string | undefined => {
  const result = text(value, 5);
  return result && CLOCK.test(result) ? result : undefined;
};

const minutes = (value: string | undefined): number | undefined => {
  if (!value || !CLOCK.test(value)) return undefined;
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
};

const parseActiveBookings = (value: unknown): ActiveBooking[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry, index): ActiveBooking[] => {
    const raw = asRecord(entry);
    if (!raw || !BOOKING_TYPES.has(raw.type as BookingType)) return [];
    if (raw.status !== 'confirmed' && raw.status !== 'requested') return [];
    const startDate = text(raw.startDate, 10);
    if (!startDate || !DATE.test(startDate)) return [];
    const endDate = text(raw.endDate, 10);
    return [{
      index,
      type: raw.type as BookingType,
      status: raw.status,
      title: text(raw.title) ?? 'Booking',
      startDate,
      startTime: clock(raw.startTime),
      endDate: endDate && DATE.test(endDate) && endDate >= startDate ? endDate : undefined,
      endTime: clock(raw.endTime),
      city: text(raw.city, 120),
      origin: text(raw.origin, 120),
      destination: text(raw.destination, 120),
      originTimeZone: isTimeZone(raw.originTimeZone) ? raw.originTimeZone : undefined,
      destinationTimeZone: isTimeZone(raw.destinationTimeZone) ? raw.destinationTimeZone : undefined,
      serviceNumber: text(raw.serviceNumber, 40),
      relatedActivityId: text(raw.relatedActivityId, 120),
    }];
  });
};

const statusLead = (status: BookingConstraintStatus): string =>
  status === 'requested' ? 'Requested (pending)' : 'Confirmed';

const safeEventName = (booking: ActiveBooking): string => {
  const lead = statusLead(booking.status);
  const route = booking.origin && booking.destination ? ` ${booking.origin} to ${booking.destination}` : '';
  const service = booking.serviceNumber ? ` ${booking.serviceNumber}` : '';
  if (booking.type === 'flight') return `${lead} flight${service}${route}`;
  if (booking.type === 'rail') return `${lead} train${service}${route}`;
  if (booking.type === 'transfer') return `${lead} transfer${route}`;
  if (booking.type === 'activity-ticket') return `${lead} ticket: ${booking.title}`;
  return `${lead} stay check-out`;
};

const eventId = (booking: ActiveBooking, segment: string): string =>
  `booking-constraint-${booking.type}-${booking.startDate}-${booking.startTime ?? 'date'}-${booking.index}-${segment}`;

const cityKey = (value: string | undefined): string => value?.trim().toLowerCase() ?? '';

/** Convert active bookings into bounded planner events and deterministic errors. */
export function buildBookingPlanningConstraints(input: {
  bookings: unknown;
  days: BookingPlanningDay[];
  persistedFlights: PersistedFlightSchedule[];
}): BookingPlanningResult {
  const bookings = parseActiveBookings(input.bookings);
  if (bookings.length === 0) return { events: [], conflicts: [], linkedActivityIds: [] };

  const dayByDate = new Map(input.days.flatMap((day) => day.calendarDate ? [[day.calendarDate, day] as const] : []));
  const flightById = new Map(input.persistedFlights.map((flight) => [flight.id, flight]));
  const events: BookingFixedEventSeed[] = [];
  const conflicts: BookingPlanningConflict[] = [];
  const linkedActivityIds = new Set<string>();
  const applied = new Set<number>();

  const addEvent = (
    booking: ActiveBooking,
    day: BookingPlanningDay | undefined,
    segment: string,
    startTime: string,
    endTime: string,
    kind: BookingFixedKind,
    roleHint?: BookingFixedRole,
    actualElapsed?: number,
  ) => {
    if (!day) return;
    const start = minutes(startTime);
    const end = minutes(endTime);
    if (start === undefined || end === undefined || end < start) return;
    events.push({
      id: eventId(booking, segment),
      day: day.day,
      name: safeEventName(booking),
      startTime,
      endTime,
      start,
      end,
      transportKind: kind,
      roleHint,
      constraintStatus: booking.status,
      elapsedMinutes: actualElapsed,
      authorizesTransfer: false,
    });
    applied.add(booking.index);
  };

  for (const booking of bookings) {
    const startDay = dayByDate.get(booking.startDate);
    const endDay = dayByDate.get(booking.endDate ?? booking.startDate);

    if (booking.type === 'stay') {
      let comparedNight = false;
      if (booking.city) {
        for (const day of input.days) {
          if (!day.calendarDate) continue;
          const inStay = day.calendarDate >= booking.startDate
            && day.calendarDate < (booking.endDate ?? `${booking.startDate}~`);
          if (!inStay) continue;
          comparedNight = true;
          if (cityKey(day.stayCity) !== cityKey(booking.city)) {
            conflicts.push({
              code: 'stay-booking-conflict',
              severity: 'error',
              day: day.day,
              message: `${statusLead(booking.status)} stay ${booking.title} is in ${booking.city}, but Day ${day.day}'s overnight base is ${day.stayCity}.`,
            });
          }
        }
      }
      if (comparedNight) applied.add(booking.index);
      // Check-in is intentionally not a day-start constraint. An explicit
      // check-out is a zero-duration boundary: activities may sit before or
      // after it, but must not run through the moment the room is surrendered.
      if (booking.endDate && booking.endTime) {
        addEvent(booking, endDay, 'checkout', booking.endTime, booking.endTime, 'reservation', 'fixed');
      }
      continue;
    }

    const actualElapsed = elapsedMinutes(booking);
    const start = booking.startTime;
    const end = booking.endTime;
    const sameCalendarDay = (booking.endDate ?? booking.startDate) === booking.startDate;

    if (booking.type === 'flight' && booking.relatedActivityId) {
      const linked = flightById.get(booking.relatedActivityId);
      if (linked) {
        const disagreements: string[] = [];
        if (!startDay || linked.day !== startDay.day) disagreements.push('date');
        if (start && linked.startTime !== start) disagreements.push('departure time');
        if (actualElapsed !== undefined && linked.durationMinutes !== actualElapsed) disagreements.push('elapsed duration');
        if (disagreements.length > 0) {
          conflicts.push({
            code: 'flight-booking-mismatch',
            severity: 'error',
            day: startDay?.day ?? linked.day,
            message: `${statusLead(booking.status)} flight disagrees with ${linked.name}'s persisted Activity ${disagreements.join(', ')}.`,
          });
        }
        if (start || end) linkedActivityIds.add(linked.id);
      } else {
        conflicts.push({
          code: 'flight-booking-mismatch',
          severity: 'error',
          day: startDay?.day,
          message: `${statusLead(booking.status)} flight is linked to a flight Activity that no longer exists.`,
        });
      }
    }

    const kind: BookingFixedKind = booking.type === 'flight'
      ? 'flight'
      : booking.type === 'activity-ticket' ? 'reservation' : 'transport';

    if (booking.type === 'flight') {
      if (start && end && sameCalendarDay) {
        const startMinutes = minutes(start)!;
        const endMinutes = minutes(end)!;
        if (endMinutes > startMinutes) {
          addEvent(booking, startDay, 'journey', start, end, kind, undefined, actualElapsed);
        } else if (actualElapsed !== undefined) {
          // One local calendar date whose arrival clock runs behind departure
          // cannot be placed on the planner's single clock axis. Blocking the
          // day is conservative and truthful; pretending the clocks were one
          // dial would schedule through the flight.
          addEvent(booking, startDay, 'date-line', '00:00', '23:59', kind, 'fixed', actualElapsed);
        } else {
          conflicts.push({
            code: 'booking-schedule-invalid', severity: 'error', day: startDay?.day,
            message: `${statusLead(booking.status)} flight has local clocks the planner cannot order without both timezones.`,
          });
        }
      } else {
        if (start) addEvent(booking, startDay, 'departure', start, '23:59', kind, 'departure', actualElapsed);
        if (booking.endDate && booking.endDate > booking.startDate) {
          for (const transitDay of input.days) {
            if (!transitDay.calendarDate
              || transitDay.calendarDate <= booking.startDate
              || transitDay.calendarDate >= booking.endDate) continue;
            // Crossing the date line can erase a local calendar date even
            // when the actual flight is only twelve hours. That date cannot
            // safely receive sightseeing just because neither airport clock
            // lands on it.
            addEvent(
              booking,
              transitDay,
              `transit-${transitDay.calendarDate}`,
              '00:00',
              '23:59',
              kind,
              'fixed',
              actualElapsed,
            );
          }
        }
        if (end) addEvent(booking, endDay, 'arrival', '00:00', end, kind, 'arrival', actualElapsed);
      }
    } else if (start && end && sameCalendarDay && minutes(end)! > minutes(start)!) {
      addEvent(booking, startDay, 'window', start, end, kind, 'fixed', actualElapsed);
    } else if (start) {
      // A time with no provable duration is still a factual point. No duration
      // is invented; the scheduler simply cannot run another item through it.
      addEvent(booking, startDay, 'point', start, start, kind, 'fixed', actualElapsed);
      if (end && sameCalendarDay && minutes(end)! <= minutes(start)!) {
        conflicts.push({
          code: 'booking-schedule-invalid', severity: 'error', day: startDay?.day,
          message: `${statusLead(booking.status)} ${booking.type} ends before it starts on the same local date.`,
        });
      }
    }

    const dateRelevant = Boolean(start || end);
    if (dateRelevant && !applied.has(booking.index)) {
      conflicts.push({
        code: 'booking-date-unplaced',
        severity: 'error',
        message: `${statusLead(booking.status)} ${booking.type} falls outside the trip's dated days, so Smart Plan cannot safely place its constraint.`,
      });
    }
  }

  const trace: BookingConstraintTrace | undefined = applied.size > 0 || conflicts.length > 0
    ? {
        bookingConstraintsApplied: applied.size,
        confirmedBookingsApplied: bookings.filter((booking) => booking.status === 'confirmed' && applied.has(booking.index)).length,
        requestedBookingsProtected: bookings.filter((booking) => booking.status === 'requested' && applied.has(booking.index)).length,
        bookingConflicts: conflicts.length,
      }
    : undefined;

  return { events, conflicts, linkedActivityIds: [...linkedActivityIds], trace };
}

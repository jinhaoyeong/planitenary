/**
 * Traveller-facing flight duration is hours + minutes.
 * Persistence is the existing activity field `durationMinutes`.
 *
 * Missing duration stays missing. This module will not invent 60 minutes,
 * or any other default, for a flight the traveller has not timed.
 */

export const MISSING_FLIGHT_DURATION = 'Add the flight duration.';
export const INVALID_FLIGHT_DURATION = 'Flight duration must be longer than 0 minutes.';
export const FLIGHT_DURATION_TOO_LONG = 'Flight duration must be 24 hours or less.';

/** Same upper bound the itinerary sanitizer already applies to durationMinutes. */
export const MAX_FLIGHT_DURATION_MINUTES = 24 * 60;

export interface DurationFields {
  hours: string;
  minutes: string;
}

export type FlightDurationResult =
  | { ok: true; durationMinutes: number }
  | { ok: false; error: string };

const parseCount = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
};

export const durationFieldsFromMinutes = (durationMinutes: number | undefined): DurationFields => {
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { hours: '', minutes: '' };
  }
  const total = Math.round(durationMinutes);
  return {
    hours: String(Math.floor(total / 60)),
    minutes: String(total % 60),
  };
};

export const durationMinutesFromFields = (hours: string, minutes: string): FlightDurationResult => {
  const bothEmpty = hours.trim() === '' && minutes.trim() === '';
  if (bothEmpty) return { ok: false, error: MISSING_FLIGHT_DURATION };

  const parsedHours = parseCount(hours);
  const parsedMinutes = parseCount(minutes);
  if (parsedHours === undefined || parsedMinutes === undefined || parsedMinutes > 59) {
    return { ok: false, error: INVALID_FLIGHT_DURATION };
  }

  const durationMinutes = parsedHours * 60 + parsedMinutes;
  if (durationMinutes <= 0) return { ok: false, error: INVALID_FLIGHT_DURATION };
  if (durationMinutes > MAX_FLIGHT_DURATION_MINUTES) return { ok: false, error: FLIGHT_DURATION_TOO_LONG };
  return { ok: true, durationMinutes };
};

/** Card copy. Empty when there is nothing honest to show. */
export const formatFlightDuration = (durationMinutes: number | undefined): string | undefined => {
  if (typeof durationMinutes !== 'number' || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return undefined;
  }
  const total = Math.round(durationMinutes);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${minutes} min`;
};

export const applyActivityDuration = <T extends { type?: string; durationMinutes?: number }>(
  activity: T,
  hours: string,
  minutes: string,
): { ok: true; activity: T } | { ok: false; error: string } => {
  if (activity.type !== 'flight') return { ok: true, activity };
  const parsed = durationMinutesFromFields(hours, minutes);
  if (!parsed.ok) return parsed;
  return { ok: true, activity: { ...activity, durationMinutes: parsed.durationMinutes } };
};

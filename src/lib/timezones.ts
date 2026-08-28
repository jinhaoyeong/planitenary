/**
 * How far the destination's clock is from home.
 *
 * The planner uses this to ease off the first days of a long-haul trip. It is
 * computed rather than asked for: the browser already knows where the traveller
 * is, and the destination carries its own zone, so making them answer a
 * question we can answer ourselves would be rude.
 */

import { timezoneOffsetMinutes } from '../../supabase/functions/_shared/timeZoneMath';

export { timezoneOffsetMinutes };

/** The traveller's own zone, or undefined where the runtime will not say. */
export function homeTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hours the destination is ahead of home, signed and rounded.
 *
 * Returns undefined rather than zero when either zone is unknown, so the
 * planner can tell "no difference" apart from "no idea" — the first means
 * plan normally, the second means we should not be adjusting anything.
 */
export function timezoneShiftHours(
  destinationTimezone: string | undefined,
  at: Date = new Date(),
  home = homeTimezone(),
): number | undefined {
  const destinationOffset = timezoneOffsetMinutes(destinationTimezone, at);
  const homeOffset = timezoneOffsetMinutes(home, at);
  if (destinationOffset === null || homeOffset === null) return undefined;
  return Math.round((destinationOffset - homeOffset) / 60);
}

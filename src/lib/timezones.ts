/**
 * How far the destination's clock is from home.
 *
 * The planner uses this to ease off the first days of a long-haul trip. It is
 * computed rather than asked for: the browser already knows where the traveller
 * is, and the destination carries its own zone, so making them answer a
 * question we can answer ourselves would be rude.
 */

/**
 * Minutes a zone is ahead of UTC on a given date, or null when the zone is
 * unknown or the runtime cannot answer.
 *
 * Uses the date rather than a fixed offset because zones move: Melbourne is
 * +10 in July and +11 in January, and a trip planned across a daylight-saving
 * boundary would otherwise be an hour out.
 */
export function timezoneOffsetMinutes(timeZone: string | undefined, at: Date = new Date()): number | null {
  if (!timeZone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!formatted) return null;
    // "GMT" alone means UTC; otherwise "GMT+09:00" or "GMT-05:30".
    if (/^GMT$/i.test(formatted.trim())) return 0;
    const match = formatted.match(/GMT([+-])(\d{1,2}):?(\d{2})?/i);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    // An invalid zone name, or a runtime without `longOffset`. Either way the
    // honest answer is "unknown", which the planner treats as no jet lag.
    return null;
  }
}

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

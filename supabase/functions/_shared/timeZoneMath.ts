/**
 * Time-zone arithmetic shared by the browser booking model and Edge planning.
 *
 * Wall clocks at two airports are not a duration. These helpers turn named
 * local clocks into instants without consulting the browser/server's own zone,
 * and refuse the calculation when either IANA zone is missing or invalid.
 */

export interface ZonedTimeRange {
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  originTimeZone?: string;
  destinationTimeZone?: string;
}

/** Minutes a named zone is ahead of UTC at one instant, including DST. */
export function timezoneOffsetMinutes(timeZone: string | undefined, at: Date = new Date()): number | null {
  if (!timeZone) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!formatted) return null;
    if (/^GMT$/i.test(formatted.trim())) return 0;
    const match = formatted.match(/GMT([+-])(\d{1,2}):?(\d{2})?/i);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    return null;
  }
}

/** A zone this runtime actually recognises. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Resolve local wall time to an instant; the second pass settles DST edges. */
function zonedInstant(date: string, clock: string, timeZone: string): number | undefined {
  const naive = Date.parse(`${date}T${clock}:00Z`);
  if (!Number.isFinite(naive)) return undefined;
  const firstOffset = timezoneOffsetMinutes(timeZone, new Date(naive));
  if (firstOffset === null) return undefined;
  const corrected = naive - firstOffset * 60_000;
  const secondOffset = timezoneOffsetMinutes(timeZone, new Date(corrected));
  if (secondOffset === null) return undefined;
  return naive - secondOffset * 60_000;
}

/**
 * Actual elapsed minutes, or `undefined` when the clocks cannot be compared.
 *
 * With no zones, only a same-date journey is safe to subtract. With one zone,
 * nothing is safe. With two zones, both named offsets participate.
 */
export function elapsedMinutes(value: ZonedTimeRange): number | undefined {
  const { startDate, startTime, endTime, originTimeZone, destinationTimeZone } = value;
  if (!startTime || !endTime) return undefined;
  const endDate = value.endDate || startDate;

  if (originTimeZone && destinationTimeZone) {
    if (!isTimeZone(originTimeZone) || !isTimeZone(destinationTimeZone)) return undefined;
    const departure = zonedInstant(startDate, startTime, originTimeZone);
    const arrival = zonedInstant(endDate, endTime, destinationTimeZone);
    if (departure === undefined || arrival === undefined) return undefined;
    const minutes = Math.round((arrival - departure) / 60_000);
    return minutes > 0 ? minutes : undefined;
  }

  if (originTimeZone || destinationTimeZone) return undefined;
  if (endDate !== startDate) return undefined;
  const departure = Date.parse(`${startDate}T${startTime}:00Z`);
  const arrival = Date.parse(`${endDate}T${endTime}:00Z`);
  if (!Number.isFinite(departure) || !Number.isFinite(arrival)) return undefined;
  const minutes = Math.round((arrival - departure) / 60_000);
  return minutes > 0 ? minutes : undefined;
}

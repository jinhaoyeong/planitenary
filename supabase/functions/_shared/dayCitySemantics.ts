/** Shared, deterministic rules for persisted day-city semantics. */
export interface DayTransfer {
  from: string;
  to: string;
}

export const cleanCity = (value: unknown, max = 120): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

export const sameCity = (left: string | undefined, right: string | undefined): boolean => {
  const cleanLeft = cleanCity(left);
  const cleanRight = cleanCity(right);
  if (!cleanLeft || !cleanRight) return !cleanLeft && !cleanRight;
  return cleanLeft.toLowerCase() === cleanRight.toLowerCase();
};

/**
 * Keep the ordered, authoritative activity cities a producer actually knows.
 * A same-city-only day needs no distinction; a mixed day keeps every city,
 * including the stay, because both activity locations are meaningful.
 */
export function activityCitiesFrom(
  values: readonly unknown[],
  stayCity: string,
  limit = 6,
): string[] {
  const cities: string[] = [];
  for (const value of values) {
    const city = cleanCity(value);
    if (!city || cities.some((held) => sameCity(held, city))) continue;
    cities.push(city);
    if (cities.length >= limit) break;
  }
  return cities.length === 1 && sameCity(cities[0], stayCity) ? [] : cities;
}

/** A transfer is valid only when it ends at that day's overnight base. */
export function parseDayTransfer(value: unknown, stayCity: string): DayTransfer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const from = cleanCity(raw.from);
  const to = cleanCity(raw.to);
  if (!from || !to || sameCity(from, to) || !sameCity(to, stayCity)) return undefined;
  return { from, to };
}

/**
 * Whether an activity is the kind of fixed transport that can vouch for a
 * change of overnight base.
 *
 * The same test the planning material already applies: a flight or a
 * traveller-entered transport row, timed, with a real duration. An untimed row
 * is a note about intending to travel, not evidence that the traveller does.
 */
export function isFixedTransportActivity(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  const type = typeof raw.type === 'string' ? raw.type : '';
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (type !== 'flight' && kind !== 'transport') return false;
  const time = typeof raw.time === 'string' ? raw.time : '';
  const duration = typeof raw.durationMinutes === 'number' ? raw.durationMinutes : Number.NaN;
  return /^\d{2}:\d{2}$/.test(time) && Number.isFinite(duration) && duration > 0;
}

/**
 * The transfer a day's own fixed transport authorizes, if any.
 *
 * A stay plan says where the traveller sleeps. It does not, by itself, say
 * that they were carried between two cities — and `transfer` means the second
 * thing. Keeping them separate is what stops every ordinary multi-city plan
 * from sprouting transfers nobody booked, and is the same line the proposal
 * boundary already holds: a base change needs transport that authorizes it.
 *
 * So a leg boundary is necessary but not sufficient. The day must also carry
 * the transport, and it must be transport that survives onto the saved day —
 * a claim whose evidence is about to be discarded is not a claim worth making.
 */
export function authorizedDayTransfer(
  activities: readonly unknown[],
  from: string | undefined,
  to: string,
): DayTransfer | undefined {
  if (!from || sameCity(from, to)) return undefined;
  if (!activities.some(isFixedTransportActivity)) return undefined;
  return parseDayTransfer({ from, to }, to);
}

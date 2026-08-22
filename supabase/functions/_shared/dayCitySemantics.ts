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

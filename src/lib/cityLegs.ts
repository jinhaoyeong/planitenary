/**
 * How a multi-city trip divides into legs.
 *
 * A trip through Osaka, Nara, Kyoto and Kobe is not eight days in Osaka, and it
 * is not eight days split evenly four ways either. It is a sequence of stays,
 * each as long as that city can actually fill, in the order the traveller
 * intends to travel. Everything downstream — which places a day may draw from,
 * which city a day card names, whether a stop can move to a lighter day —
 * depends on getting this division right first.
 *
 * The division is deliberately explicit rather than emergent. Clustering by
 * distance would eventually separate Kyoto from Kobe, but it would also happily
 * hand day three a Kyoto morning and a Kobe afternoon, which is a train ride the
 * traveller never agreed to.
 */

/** One continuous stay in one city. Day numbers are 1-indexed and inclusive. */
export interface CityLeg {
  city: string;
  startDay: number;
  endDay: number;
  /** Nights this leg covers. The last leg of a trip ends on a departure day. */
  days: number;
}

export interface CityLegPlan {
  legs: CityLeg[];
  /**
   * Cities that could not be given a day. Never silently discarded: a traveller
   * who chose four cities for three days has to be told which one fell out.
   */
  dropped: string[];
}

/**
 * How much of the trip each city has earned.
 *
 * Weight is normally the number of places shortlisted there — the traveller's
 * own signal, and a better one than any editorial ranking of cities. A city with
 * twelve accepted places wants more days than one with two, whatever their
 * relative fame.
 */
export type CityWeights = Record<string, number>;

/** Every city in the traveller's order, deduplicated, blanks dropped. */
export function orderedCities(cities: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of cities) {
    const city = (raw || '').trim();
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(city);
  }
  return ordered;
}

/**
 * Divide `dayCount` days between `cities`, in order.
 *
 * Largest-remainder apportionment over the weights, with a floor of one day per
 * city: a city on the list is a city being visited, and a stay of zero days is
 * not a stay. When there are more cities than days the *lowest-weighted* cities
 * are dropped rather than the last ones — a traveller who shortlisted twelve
 * places in Kyoto and one in Kobe meant to spend the trip in Kyoto, whichever
 * order they typed them in. Order is preserved among the survivors.
 */
export function planCityLegs(
  cities: string[],
  dayCount: number,
  weights: CityWeights = {},
): CityLegPlan {
  const ordered = orderedCities(cities);
  if (ordered.length === 0 || dayCount <= 0) return { legs: [], dropped: [] };

  const weightOf = (city: string) => Math.max(0, weights[city] ?? 0);

  // More cities than days: keep the best-supported, in their original order.
  let kept = ordered;
  let dropped: string[] = [];
  if (ordered.length > dayCount) {
    const ranked = [...ordered].sort((a, b) => weightOf(b) - weightOf(a));
    const survivors = new Set(ranked.slice(0, dayCount).map((city) => city.toLowerCase()));
    kept = ordered.filter((city) => survivors.has(city.toLowerCase()));
    dropped = ordered.filter((city) => !survivors.has(city.toLowerCase()));
  }

  const totalWeight = kept.reduce((total, city) => total + weightOf(city), 0);
  /**
   * With no weights at all — nothing shortlisted yet — an even split is the
   * only honest answer. It is a starting point, not a recommendation.
   */
  const shares = kept.map((city) => (totalWeight > 0
    ? (weightOf(city) / totalWeight) * dayCount
    : dayCount / kept.length));

  // Floor of one, then hand out what is left by largest fractional remainder.
  const allocation = shares.map((share) => Math.max(1, Math.floor(share)));
  let remaining = dayCount - allocation.reduce((total, days) => total + days, 0);

  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder);

  let cursor = 0;
  while (remaining > 0 && byRemainder.length > 0) {
    allocation[byRemainder[cursor % byRemainder.length].index] += 1;
    cursor += 1;
    remaining -= 1;
  }
  /**
   * The floor can overshoot: five cities across five days is exactly one each,
   * but five cities across five days where one deserved three still has to give
   * days back. Take them from the largest stays first, never below one.
   */
  while (remaining < 0) {
    let largest = 0;
    for (let index = 1; index < allocation.length; index += 1) {
      if (allocation[index] > allocation[largest]) largest = index;
    }
    if (allocation[largest] <= 1) break;
    allocation[largest] -= 1;
    remaining += 1;
  }

  const legs: CityLeg[] = [];
  let day = 1;
  kept.forEach((city, index) => {
    const days = allocation[index];
    if (days <= 0) return;
    legs.push({ city, startDay: day, endDay: day + days - 1, days });
    day += days;
  });

  return { legs, dropped };
}

/** Which city day `dayNumber` belongs to, or `''` when the trip has no legs. */
export function cityForDay(legs: CityLeg[], dayNumber: number): string {
  const leg = legs.find((entry) => dayNumber >= entry.startDay && dayNumber <= entry.endDay);
  return leg?.city ?? '';
}

/**
 * A traveller-facing summary of the division: "Osaka 3 days · Kyoto 3 · Nara 1".
 *
 * Written out because the allocation is a judgement the app made on the
 * traveller's behalf, and a judgement made silently cannot be disagreed with.
 */
export function describeCityLegs(legs: CityLeg[]): string {
  return legs
    .map((leg) => `${leg.city} ${leg.days} ${leg.days === 1 ? 'day' : 'days'}`)
    .join(' · ');
}

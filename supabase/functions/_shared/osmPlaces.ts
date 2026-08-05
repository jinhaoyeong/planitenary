/**
 * OpenStreetMap → PlaceCandidate mapping.
 *
 * This module has NO imports and no Deno APIs on purpose, so the same code is
 * exercised by the Node/vitest suite — the precedent set by `cacheKeys.ts`.
 *
 * The shift from a paid search API to OSM is not only about cost. A text search
 * returns whatever the ranking model thinks "top attractions" means; OSM returns
 * objects that carry their own classification. A museum is tagged a museum. So
 * the category, whether it is indoors, whether it charges, and when it opens all
 * come from the record itself rather than being inferred from a name.
 *
 * What OSM does not have is a rating, and that is deliberate here: see
 * {@link osmNotability} for the substitute and why it is arguably better.
 */

export interface OsmTags {
  [key: string]: string | undefined;
}

export interface OsmElement {
  type?: 'node' | 'way' | 'relation';
  id?: number;
  lat?: number;
  lon?: number;
  /** Ways and relations carry their centroid here, via `out center`. */
  center?: { lat?: number; lon?: number };
  tags?: OsmTags;
}

/**
 * Tag → the app's category vocabulary, most specific rule first.
 *
 * Each entry is `[key, value-pattern, categories]`. A missing pattern matches
 * any value for that key, which is how `historic=*` works: the specific kind of
 * historic thing rarely changes how a day is planned.
 */
const CATEGORY_RULES: Array<[string, RegExp | null, string[]]> = [
  ['tourism', /^attraction$/, ['essential']],
  ['tourism', /^museum$/, ['museum']],
  ['tourism', /^(gallery|artwork)$/, ['art']],
  ['tourism', /^viewpoint$/, ['view']],
  ['tourism', /^zoo$/, ['wildlife']],
  ['tourism', /^aquarium$/, ['aquarium']],
  ['tourism', /^theme_park$/, ['theme-park']],
  ['historic', null, ['history']],
  ['amenity', /^place_of_worship$/, ['temple']],
  ['amenity', /^marketplace$/, ['market']],
  ['amenity', /^(arts_centre|theatre)$/, ['art', 'evening']],
  ['amenity', /^nightclub$/, ['nightlife']],
  ['amenity', /^(bar|pub)$/, ['evening']],
  ['amenity', /^cafe$/, ['cafes', 'food']],
  ['amenity', /^fast_food$/, ['street-food', 'food']],
  ['amenity', /^restaurant$/, ['food']],
  ['leisure', /^garden$/, ['garden', 'park']],
  ['leisure', /^park$/, ['park']],
  ['leisure', /^nature_reserve$/, ['nature']],
  ['natural', /^beach$/, ['beaches']],
  ['natural', /^(peak|volcano)$/, ['nature', 'view']],
  ['natural', /^(wood|water|bay)$/, ['nature']],
  ['shop', /^(mall|department_store)$/, ['shopping']],
  ['man_made', /^(pier|lighthouse)$/, ['waterfront']],
];

/** Places that are infrastructure rather than somewhere you go for the day. */
const EXCLUDED = [
  ['tourism', /^(hotel|hostel|motel|guest_house|apartment|information|camp_site|caravan_site)$/],
  ['amenity', /^(parking|toilets|bench|waste_basket|atm|bank|pharmacy|fuel|bicycle_parking)$/],
  ['historic', /^(boundary_stone|milestone|wayside_cross)$/],
] as const;

export function isExcludedOsmPlace(tags: OsmTags): boolean {
  return EXCLUDED.some(([key, pattern]) => {
    const value = tags[key];
    return typeof value === 'string' && pattern.test(value);
  });
}

/**
 * Categories for one element. Returns `['essential']` only when the element is
 * genuinely tagged as an attraction — an unclassifiable place returns an empty
 * list and the caller drops it, rather than being labelled a headline sight
 * because nothing else matched.
 */
export function osmCategories(tags: OsmTags): string[] {
  const categories: string[] = [];
  for (const [key, pattern, mapped] of CATEGORY_RULES) {
    const value = tags[key];
    if (typeof value !== 'string') continue;
    if (pattern && !pattern.test(value)) continue;
    categories.push(...mapped);
  }
  // A named heritage listing is a sight even when its primary tag is ordinary.
  if (tags.heritage && !categories.includes('history')) categories.push('history');
  return [...new Set(categories)];
}

/**
 * Indoors, outdoors, or genuinely both.
 *
 * The Google path hardcoded every place to `'mixed'`, which made the wet-weather
 * preference in the scheduler inert — there was nothing to sort by. OSM's tags
 * answer this directly, so bad-weather days can finally prefer indoor places.
 */
export function osmIndoorOutdoor(tags: OsmTags): 'indoor' | 'outdoor' | 'mixed' {
  const categories = osmCategories(tags);
  const indoor = ['museum', 'art', 'aquarium', 'shopping', 'cafes'];
  const outdoor = ['park', 'garden', 'nature', 'beaches', 'view', 'waterfront'];
  if (categories.some((category) => indoor.includes(category))) return 'indoor';
  if (categories.some((category) => outdoor.includes(category))) return 'outdoor';
  // A roofed market is indoors; an open-air one is not. The tag says which.
  if (tags.covered === 'yes' || tags.building) return 'indoor';
  return 'mixed';
}

/**
 * Notability, 0–1 — the replacement for a star rating.
 *
 * A star average is a lifetime number dominated by old visits, and
 * `currentQuality()` already discounts it for that reason. What actually
 * signals "this is central to understanding the place" is whether the wider
 * world has bothered to document it: an encyclopedia article, a heritage
 * listing, a translated name.
 *
 * Every input here comes from tags already present in the search response, so
 * this costs no extra request. That matters: a per-place notability lookup
 * would recreate exactly the fan-out that made the previous provider expensive.
 */
export function osmNotability(tags: OsmTags): number {
  let score = 0;
  // Someone wrote an encyclopedia article about it. The strongest single signal.
  if (tags.wikidata) score += 0.4;
  if (tags.wikipedia) score += 0.2;
  // Formally recognised as worth preserving.
  if (tags.heritage || tags['heritage:operator']) score += 0.15;
  if (tags.tourism === 'attraction') score += 0.15;
  // A translated name means someone expected non-locals to look for it.
  if (Object.keys(tags).some((key) => key.startsWith('name:'))) score += 0.05;
  if (tags.website || tags['contact:website']) score += 0.05;
  return Math.min(1, score);
}

/** Prefer a name the traveller can read, but never lose the local one. */
export function osmNames(tags: OsmTags, language = 'en'): { name?: string; localName?: string } {
  const local = tags.name;
  const translated = tags[`name:${language}`];
  if (translated && local && translated !== local) return { name: translated, localName: local };
  return { name: translated || local, localName: undefined };
}

/**
 * `fee=no` is a real, useful fact: free entry. `fee=yes` without a `charge` tag
 * says only that it costs something, which is not a price level — so it returns
 * undefined rather than guessing a number.
 */
export function osmPriceLevel(tags: OsmTags): number | undefined {
  if (tags.fee === 'no') return 0;
  return undefined;
}

const TIME_RANGE = /\b([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)\b/;
const pad = (value: string) => value.padStart(2, '0');

/** OSM day abbreviation → JavaScript `Date.getDay()`. */
const DAY_INDEX: Record<string, number> = {
  su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6,
};
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** One opening window and the weekdays it applies to. */
export interface OpeningRule {
  /** `Date.getDay()` values: 0 is Sunday. */
  daysOfWeek: number[];
  opensAt: string;
  closesAt: string;
}

/**
 * Expand an OSM day selector — `Mo`, `Mo-Fr`, `Mo,We,Fr`, `Sa-Su` — into day
 * numbers. A range that wraps the week (`Fr-Mo`) is walked forwards from the
 * start day, which is what the notation means.
 */
function expandDays(selector: string): number[] {
  const days = new Set<number>();
  for (const part of selector.split(',')) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    const range = token.match(/^([a-z]{2})\s*-\s*([a-z]{2})$/);
    if (range) {
      const from = DAY_INDEX[range[1]];
      const to = DAY_INDEX[range[2]];
      if (from === undefined || to === undefined) continue;
      for (let day = from; ; day = (day + 1) % 7) {
        days.add(day);
        if (day === to) break;
      }
      continue;
    }
    const single = DAY_INDEX[token];
    if (single !== undefined) days.add(single);
  }
  return [...days];
}

/**
 * Read weekly opening rules out of an OSM `opening_hours` string.
 *
 * This is the fix for the weekly-closure gap. Many museums close on Mondays and
 * write it as `Tu-Su 10:00-18:00`; reading only the first time range and
 * applying it to every day builds a plan around a closed door, which is the
 * kind of error a traveller discovers on the pavement.
 *
 * The full grammar is large and this does not implement all of it — no month
 * ranges, no public holidays, no `sunrise`/`sunset`, no week numbers. Anything
 * it cannot read confidently yields no rule at all, which the scheduler handles
 * honestly as "hours unknown" and reports as reduced confidence. Guessing would
 * be worse than admitting ignorance.
 *
 * Later rules override earlier ones for the days they name, matching OSM
 * semantics — which is what makes `Mo-Su 09:00-18:00; Mo off` work.
 */
export function parseOsmOpeningRules(value?: string): OpeningRule[] {
  if (!value) return [];
  const text = value.trim();
  if (!text || /^(closed|off)$/i.test(text)) return [];
  if (/^24\/7$/.test(text)) {
    return [{ daysOfWeek: ALL_DAYS, opensAt: '00:00', closesAt: '23:59' }];
  }

  const byDay = new Map<number, { opensAt: string; closesAt: string }>();
  let understoodAnything = false;

  for (const segment of text.split(';')) {
    const clause = segment.trim();
    if (!clause) continue;
    // Public holidays and school holidays are a separate calendar the planner
    // has no access to, so they are skipped rather than applied to a weekday.
    if (/^(ph|sh)\b/i.test(clause)) continue;

    const daySelector = clause.match(/^((?:[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?)(?:\s*,\s*[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?)*)\b/);
    const days = daySelector ? expandDays(daySelector[1]) : ALL_DAYS;
    if (days.length === 0) continue;

    const rest = daySelector ? clause.slice(daySelector[0].length) : clause;
    if (/\b(off|closed)\b/i.test(rest)) {
      for (const day of days) byDay.delete(day);
      understoodAnything = true;
      continue;
    }

    const match = rest.match(TIME_RANGE);
    if (!match) continue;
    const opensAt = `${pad(match[1])}:${match[2]}`;
    const closesAt = `${pad(match[3])}:${match[4]}`;
    // A window that closes before it opens crosses midnight; the scheduler has
    // no representation for that, so it is left unknown rather than inverted.
    if (opensAt >= closesAt) continue;
    for (const day of days) byDay.set(day, { opensAt, closesAt });
    understoodAnything = true;
  }

  if (!understoodAnything || byDay.size === 0) return [];

  // Collapse identical windows so a normal week is a rule or two, not seven.
  const grouped = new Map<string, OpeningRule>();
  for (const [day, window] of byDay) {
    const key = `${window.opensAt}-${window.closesAt}`;
    const existing = grouped.get(key);
    if (existing) existing.daysOfWeek.push(day);
    else grouped.set(key, { daysOfWeek: [day], opensAt: window.opensAt, closesAt: window.closesAt });
  }
  return [...grouped.values()].map((rule) => ({ ...rule, daysOfWeek: rule.daysOfWeek.sort((a, b) => a - b) }));
}

/** Typical visit length by category — a default only, overridden by evidence. */
const VISIT_MINUTES: Record<string, number> = {
  museum: 120,
  art: 90,
  'theme-park': 300,
  aquarium: 150,
  wildlife: 180,
  park: 75,
  garden: 60,
  nature: 120,
  beaches: 120,
  market: 90,
  shopping: 90,
  essential: 100,
  temple: 60,
  history: 75,
  view: 40,
  waterfront: 45,
  nightlife: 120,
  evening: 90,
  food: 70,
  cafes: 45,
  'street-food': 45,
};

export function osmVisitMinutes(categories: string[]): number {
  const known = categories.map((category) => VISIT_MINUTES[category]).filter((value): value is number => Boolean(value));
  return known.length > 0 ? Math.max(...known) : 90;
}

export const osmElementCoordinates = (element: OsmElement): [number, number] | undefined => {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  return typeof lat === 'number' && typeof lon === 'number' ? [lat, lon] : undefined;
};

/** Stable id across runs: OSM ids are permanent per object type. */
export const osmPlaceId = (element: OsmElement): string | undefined =>
  element.type && element.id !== undefined ? `${element.type[0]}${element.id}` : undefined;

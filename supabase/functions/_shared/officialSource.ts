/**
 * Reading a place's own website — the only source allowed to state an
 * operational fact.
 *
 * `SOURCE_AUTHORITY` gives `official-website` a weight of 1.0, and
 * `claimIsPresentableAsFact` lets only sources at 0.85+ establish that a venue
 * has closed. An operator's own page is the thing that can correct a stale
 * opening time or a wrong closure rumour, and it needs no credentials at all.
 *
 * Two deliberate constraints:
 *
 *   - **Structured data first.** Venue sites commonly embed schema.org JSON-LD
 *     with real opening hours. That is parsed precisely. Prose is only scanned
 *     for closure notices, where a phrase is unambiguous.
 *   - **The URL is untrusted.** It arrives from an OpenStreetMap tag, which
 *     anyone on earth can edit, so it is a server-side request to an
 *     attacker-influenceable address. See {@link isSafePublicUrl}.
 *
 * No imports and no Deno APIs, so the vitest suite exercises this directly.
 */

import type { OpeningRule } from './osmPlaces.ts';

/**
 * Whether a URL is safe for the server to fetch.
 *
 * Place websites come from community-edited map data, so this is a
 * server-side request forgery surface: an edited tag pointing at
 * `http://169.254.169.254/` or `http://10.0.0.5/` would make our server read
 * something the traveller could never reach.
 *
 * Rejected: anything not HTTPS, embedded credentials, non-standard ports,
 * loopback and link-local names, internal-only suffixes, and IP literals in
 * private or reserved ranges.
 *
 * Residual risk: a public hostname whose DNS resolves to a private address
 * still passes, because resolution happens after this check. Closing that
 * needs resolve-then-pin, which the Edge runtime does not expose. The
 * consequence is bounded — the response is only ever parsed for opening hours
 * and never returned to the traveller verbatim.
 */
export function isSafePublicUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost') return false;
  if (/\.(local|internal|localdomain|home\.arpa)$/.test(host)) return false;

  // IPv6 literals arrive bracketed; no legitimate venue publishes one.
  if (host.startsWith('[')) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    // Link-local, including the cloud metadata endpoint at 169.254.169.254.
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }
  return true;
}

/** schema.org day names → `Date.getDay()`. Accepts bare names and full URLs. */
const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const dayNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;
  const name = value.split('/').pop()?.trim().toLowerCase() || '';
  return DAY_NAMES[name];
};

const asArray = <T,>(value: T | T[] | undefined): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)/;
const normaliseTime = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(TIME);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : undefined;
};

/**
 * Every JSON-LD object embedded in a page, flattened.
 *
 * Sites nest these inconsistently — a bare object, an array, or a `@graph` —
 * so all three shapes are walked rather than assuming one.
 */
export function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      // A malformed block is skipped; one bad script must not lose the others.
      continue;
    }
    const queue = [parsed];
    while (queue.length > 0 && nodes.length < 50) {
      const item = queue.shift();
      if (Array.isArray(item)) { queue.push(...item); continue; }
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record['@graph']) queue.push(...asArray(record['@graph']));
      nodes.push(record);
    }
  }
  return nodes;
}

/**
 * Opening rules from schema.org markup, in the same shape the OSM parser
 * produces so the scheduler has one representation to read.
 *
 * Handles both forms sites use: `openingHoursSpecification` objects, and the
 * `openingHours` text form ("Mo-Fr 09:00-17:00"), which is delegated to the
 * OSM parser because the syntax is the same.
 */
export function openingRulesFromJsonLd(
  nodes: Array<Record<string, unknown>>,
  parseTextRules: (value?: string) => OpeningRule[],
): OpeningRule[] {
  const byDay = new Map<number, { opensAt: string; closesAt: string }>();

  for (const node of nodes) {
    for (const spec of asArray(node.openingHoursSpecification as Record<string, unknown>[] | undefined)) {
      if (!spec || typeof spec !== 'object') continue;
      const opensAt = normaliseTime(spec.opens);
      const closesAt = normaliseTime(spec.closes);
      if (!opensAt || !closesAt || opensAt >= closesAt) continue;
      const days = asArray(spec.dayOfWeek as string | string[] | undefined)
        .map(dayNumber)
        .filter((day): day is number => day !== undefined);
      // A specification with no day list applies to every day.
      for (const day of days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]) {
        byDay.set(day, { opensAt, closesAt });
      }
    }

    for (const text of asArray(node.openingHours as string | string[] | undefined)) {
      for (const rule of parseTextRules(typeof text === 'string' ? text : undefined)) {
        for (const day of rule.daysOfWeek) {
          byDay.set(day, { opensAt: rule.opensAt, closesAt: rule.closesAt });
        }
      }
    }
  }

  if (byDay.size === 0) return [];
  const grouped = new Map<string, OpeningRule>();
  for (const [day, window] of byDay) {
    const key = `${window.opensAt}-${window.closesAt}`;
    const existing = grouped.get(key);
    if (existing) existing.daysOfWeek.push(day);
    else grouped.set(key, { daysOfWeek: [day], opensAt: window.opensAt, closesAt: window.closesAt });
  }
  return [...grouped.values()].map((rule) => ({ ...rule, daysOfWeek: rule.daysOfWeek.sort((a, b) => a - b) }));
}

/**
 * Visible text, with the parts of a page that are not prose removed first.
 *
 * Scripts and styles are stripped before tags, or their contents would become
 * "text" and a stray word inside a analytics snippet could read as a claim.
 */
export function visibleText(html: string, limit = 20_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Closure and renovation notices, which are the operational facts only an
 * official page may establish.
 *
 * Deliberately narrow. A site saying "closed on Mondays" is describing normal
 * hours, not a closure, and matching it would delete a working venue from every
 * plan — so weekday phrasing is excluded explicitly.
 */
const CLOSURE_PATTERNS: Array<{ type: 'closed' | 'renovation'; pattern: RegExp; summary: string }> = [
  { type: 'closed', pattern: /\b(permanently closed|now closed for good|has permanently closed|ceased operations?)\b/i, summary: 'The official site reports this place as permanently closed' },
  { type: 'renovation', pattern: /\b(closed for (renovation|refurbishment|restoration|maintenance)|under (renovation|refurbishment|restoration))\b/i, summary: 'The official site reports a closure for works' },
  { type: 'closed', pattern: /\b(temporarily closed|closed until further notice)\b/i, summary: 'The official site reports this place as temporarily closed' },
];

/** A weekday closure is a normal opening pattern, never a shutdown. */
const WEEKDAY_CLOSURE = /\bclosed\s+(on\s+)?(mon|tue|wed|thu|fri|sat|sun)/i;

export interface OfficialNotice {
  type: 'closed' | 'renovation';
  summary: string;
  excerpt: string;
}

export function closureNotices(text: string): OfficialNotice[] {
  if (!text) return [];
  const notices: OfficialNotice[] = [];
  for (const rule of CLOSURE_PATTERNS) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const index = match.index ?? 0;
    const excerpt = text.slice(Math.max(0, index - 60), index + 120).trim();
    // "Closed Mondays" next to the phrase means normal hours, not a closure.
    if (WEEKDAY_CLOSURE.test(excerpt)) continue;
    notices.push({ type: rule.type, summary: rule.summary, excerpt });
  }
  return notices;
}

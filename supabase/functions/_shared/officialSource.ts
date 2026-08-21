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
 * No Deno APIs, so the vitest suite exercises this directly.
 */

import type { OpeningRule } from './osmPlaces.ts';
import { parseAdmissionText, resolveCurrency, type AdmissionFare, type PlaceAdmission } from './placeCost.ts';

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
    const sourceJson = block[1].trim();
    const queue: Array<{ value: unknown; sourceJson: string }> = [{ value: parsed, sourceJson }];
    while (queue.length > 0 && nodes.length < 50) {
      const current = queue.shift()!;
      const item = current.value;
      if (Array.isArray(item)) {
        queue.push(...item.map((value) => ({ value, sourceJson: current.sourceJson })));
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      // Keep the original JSON-LD block out of the public shape while making
      // it available for verbatim claim excerpts later.
      Object.defineProperty(record, '__sourceJson', {
        configurable: true,
        value: current.sourceJson,
      });
      if (record['@graph']) {
        queue.push(...asArray(record['@graph']).map((value) => ({ value, sourceJson: current.sourceJson })));
      }
      nodes.push(record);
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Admission offers
// ---------------------------------------------------------------------------

/** A structured price claim that can be persisted beside the official page. */
export interface OfficialPriceClaim {
  summary: string;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  audience?: string;
  excerpt?: string;
}

const PRICE_SYMBOL = /[\p{Sc}]/u;

const numericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  if (!match) return undefined;
  const amount = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : undefined;
};

const normaliseAudience = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (/adult|general|regular/.test(lower)) return 'adult';
  if (/child|kid|infant|youth/.test(lower)) return 'child';
  if (/student/.test(lower)) return 'student';
  if (/senior|elderly/.test(lower)) return 'senior';
  if (/concession|discount/.test(lower)) return 'concession';
  if (/group/.test(lower)) return 'group';
  if (/family/.test(lower)) return 'family';
  return value.trim();
};

const audienceFromOffer = (offer: Record<string, unknown>): string => {
  for (const key of ['audience', 'eligibleCustomerType', 'category']) {
    const value = offer[key];
    const text = typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof (value as Record<string, unknown>).name === 'string'
        ? String((value as Record<string, unknown>).name)
        : undefined;
    const audience = normaliseAudience(text);
    if (audience) return audience;
  }
  return 'adult';
};

const sourceJson = (node: Record<string, unknown>): string | undefined => {
  const value = (node as Record<string, unknown> & { __sourceJson?: unknown }).__sourceJson;
  return typeof value === 'string' ? value : undefined;
};

/** Return a small exact substring of the JSON-LD block, never a paraphrase. */
const jsonLdExcerpt = (nodes: Array<Record<string, unknown>>, tokens: string[]): string | undefined => {
  const wanted = tokens.filter(Boolean);
  if (wanted.length === 0) return undefined;
  for (const node of nodes) {
    const source = sourceJson(node);
    if (!source) continue;
    const searchable = source.toLowerCase();
    const positions = wanted.map((token) => searchable.indexOf(token.toLowerCase()));
    const present = positions.filter((position) => position >= 0);
    if (present.length === wanted.length) {
      const start = Math.max(0, Math.min(...present) - 60);
      const end = Math.min(source.length, Math.max(...present) + 100);
      return source.slice(start, end).trim();
    }
  }
  return undefined;
};

const priceText = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : undefined;
};

interface StructuredFare {
  fare: AdmissionFare;
}

const structuredFare = (
  offer: Record<string, unknown>,
  parent: Record<string, unknown>,
  countryCode?: string,
): StructuredFare | undefined => {
  const priceValue = offer.price ?? offer.lowPrice;
  const text = priceText(priceValue);
  const amount = numericValue(priceValue);
  if (amount === undefined || !text) return undefined;

  const explicitCurrency = typeof offer.priceCurrency === 'string'
    ? offer.priceCurrency
    : typeof parent.priceCurrency === 'string' ? parent.priceCurrency : undefined;
  const symbol = text.match(PRICE_SYMBOL)?.[0];
  const currency = resolveCurrency(explicitCurrency, symbol, countryCode);
  if (!currency) return undefined;

  const audience = audienceFromOffer(offer);
  const high = numericValue(offer.highPrice);
  const rangeNote = high !== undefined && high > amount
    ? `from ${amount} to ${high} ${currency}`
    : undefined;
  const productName = typeof offer.name === 'string' && offer.name.trim()
    ? offer.name.trim().slice(0, 80)
    : undefined;
  const validFrom = typeof offer.validFrom === 'string' && offer.validFrom.trim()
    ? offer.validFrom.trim().slice(0, 30)
    : undefined;
  const validThrough = typeof offer.validThrough === 'string' && offer.validThrough.trim()
    ? offer.validThrough.trim().slice(0, 30)
    : undefined;
  const validity = validFrom || validThrough
    ? `valid ${validFrom ?? 'now'}${validThrough ? ` to ${validThrough}` : ''}`
    : undefined;
  const note = [productName, rangeNote, validity].filter(Boolean).join('; ') || undefined;
  return {
    fare: {
      audience,
      amount,
      ...(high !== undefined && high > amount ? { minAmount: amount, maxAmount: high } : {}),
      currency,
      note,
    },
  };
};

/**
 * Read admission from schema.org JSON-LD already present on an official page.
 * Structured offers outrank a category expectation, but an unparseable number
 * never becomes a guessed fare.
 */
export function admissionFromJsonLd(
  nodes: Array<Record<string, unknown>>,
  countryCode?: string,
): PlaceAdmission | undefined {
  const fares: AdmissionFare[] = [];
  const fareKeys = new Set<string>();
  let sawOffer = false;
  let explicitFree = false;
  let explicitPaid = false;
  let rawText: string | undefined;

  const addFare = (candidate: StructuredFare | undefined) => {
    if (!candidate) return;
    const key = `${candidate.fare.audience}|${candidate.fare.currency}|${candidate.fare.amount}|${candidate.fare.maxAmount ?? ''}`;
    if (fareKeys.has(key)) return;
    fareKeys.add(key);
    fares.push(candidate.fare);
  };

  for (const node of nodes) {
    if (node.isAccessibleForFree === true) explicitFree = true;
    if (node.isAccessibleForFree === false) explicitPaid = true;

    for (const offerValue of asArray(node.offers as unknown)) {
      if (!offerValue || typeof offerValue !== 'object') continue;
      const offer = offerValue as Record<string, unknown>;
      sawOffer = true;
      addFare(structuredFare(offer, node, countryCode));

      const range = typeof offer.priceRange === 'string' ? offer.priceRange.trim() : undefined;
      if (range) {
        const parsed = parseAdmissionText(range, countryCode, 'official-website');
        if (parsed?.fares?.[0]) {
          const fare = parsed.fares[0];
          if (parsed.rawText && !rawText) rawText = parsed.rawText;
          addFare({ fare: { ...fare, audience: audienceFromOffer(offer) } });
        } else if (!rawText) {
          rawText = range;
        }
      }
    }

    if (typeof node.priceRange === 'string' && node.priceRange.trim()) {
      const range = node.priceRange.trim();
      const parsed = parseAdmissionText(range, countryCode, 'official-website');
      if (parsed?.fares?.[0]) {
        if (parsed.rawText && !rawText) rawText = parsed.rawText;
        addFare({ fare: parsed.fares[0] });
      }
      else if (!rawText) rawText = range;
    }
  }

  if (fares.length > 0) {
    /**
     * Every published fare is zero, so the operator is saying entry costs
     * nothing — whether or not they also set `isAccessibleForFree`, which is
     * optional and widely omitted. Requiring both signals classified these as
     * ticketed and the card read "JP¥0 · adult ticket".
     *
     * `every` rather than `some`: a museum with a free child ticket beside a
     * paid adult one is not a free museum.
     */
    if (fares.every((fare) => fare.amount === 0)) {
      return { class: 'free', source: 'official-website', confidence: 'high', rawText };
    }
    return { class: 'ticketed', fares, source: 'official-website', confidence: 'high', rawText };
  }
  if (explicitFree) return { class: 'free', source: 'official-website', confidence: 'high', rawText };
  if (sawOffer || explicitPaid) {
    return { class: 'ticketed', fares: [], source: 'official-website', confidence: 'high', rawText };
  }
  if (rawText) return { class: 'unknown', rawText, source: 'official-website', confidence: 'low' };
  return undefined;
}

/** Turn the structured result into claims that survive the evidence cache. */
export function officialAdmissionClaims(
  nodes: Array<Record<string, unknown>>,
  admission: PlaceAdmission | undefined,
  fallbackExcerpt?: string,
): OfficialPriceClaim[] {
  if (!admission) return [];
  if (admission.class === 'free') {
    return [{
      summary: 'The official site says admission is free',
      excerpt: jsonLdExcerpt(nodes, ['isAccessibleForFree', 'true']),
    }];
  }
  if (admission.class !== 'ticketed') return [];

  const fares = admission.fares || [];
  if (fares.length === 0) {
    return [{
      summary: 'The official site says a ticket is required but publishes no machine-readable price',
      excerpt: jsonLdExcerpt(nodes, ['offers']) || jsonLdExcerpt(nodes, ['isAccessibleForFree', 'false']),
    }];
  }
  return fares.map((fare) => ({
    summary: `The official site lists ${fare.audience} admission at ${fare.currency} ${fare.amount}${fare.note ? ` (${fare.note})` : ''}`,
    amount: fare.amount,
    minAmount: fare.minAmount,
    maxAmount: fare.maxAmount,
    currency: fare.currency,
    audience: fare.audience,
    excerpt: jsonLdExcerpt(nodes, [String(fare.amount), fare.currency]) || fallbackExcerpt,
  }));
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
 * Read a fare from a short, visible fragment of the operator's own page.
 * A whole homepage contains dates, phone numbers and coordinates, so a
 * fragment must name a ticket/admission concept and carry an explicit
 * currency marker before its numbers can be treated as fares.
 */
export function admissionFromVisibleText(
  text: string,
  countryCode?: string,
): PlaceAdmission | undefined {
  if (!text.trim()) return undefined;
  const fragments = [...text.matchAll(/.{0,180}\b(?:admission|entrance|entry|ticket|tickets|passport|studio pass|price|料金|チケット)\b.{0,240}/gi)]
    .map((match) => match[0].trim())
    .slice(0, 12);
  for (const fragment of fragments) {
    // Bare prose numbers are too noisy to receive the country fallback that
    // structured JSON-LD may use. The page must state its currency here.
    if (!(/[\p{Sc}]|\b(?:JPY|CNY|KRW|TWD|HKD|SGD|MYR|USD|AUD|CAD|EUR|GBP|yen|yuan|won|dollars?|ringgit)\b/iu.test(fragment))) continue;
    const parsed = parseAdmissionText(fragment, countryCode, 'official-website');
    if (parsed?.fares?.length || parsed?.class === 'free' || parsed?.class === 'ticketed') {
      return parsed ? { ...parsed, rawText: parsed.rawText || fragment.slice(0, 500) } : parsed;
    }
  }
  return undefined;
}

/**
 * Candidate ticket/admission pages on the same official origin. Links are
 * discovered from the retrieved page, capped tightly, and never leave the
 * origin supplied by the canonical place record.
 */
export function officialTicketLinks(html: string, baseUrl: string, max = 3): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  const links = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    if (found.length >= max) break;
    const label = visibleText(match[2], 240);
    const href = match[1].trim();
    if (!/(ticket|admission|entrance|entry|passport|studio[- ]?pass|price|料金|チケット)/i.test(`${href} ${label}`)) continue;
    let candidate: URL;
    try {
      candidate = new URL(href, base);
    } catch {
      continue;
    }
    candidate.hash = '';
    if (candidate.protocol !== 'https:' || candidate.origin !== base.origin || !isSafePublicUrl(candidate.toString())) continue;
    if (/\.(?:pdf|jpg|jpeg|png|gif|zip)(?:$|\?)/i.test(candidate.pathname)) continue;
    const normalised = candidate.toString();
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    found.push(normalised);
  }
  return found;
}

/** Known map, guide and reseller hosts are not official operator sources. */
export function isLikelyResellerUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return true; }
  return [
    'booking.com', 'expedia.com', 'getyourguide.com', 'klook.com', 'viator.com',
    'tripadvisor.com', 'rakutentravel.com', 'kkday.com', 'traveloka.com',
    'google.com', 'google.co.jp', 'maps.google.com', 'amap.com', 'baidu.com',
    'wikivoyage.org', 'wikipedia.org',
  ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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

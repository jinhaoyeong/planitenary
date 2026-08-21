/**
 * What a place costs to get into.
 *
 * The panel said "Cost unknown" on almost every card, and it was telling the
 * truth about what it had: `osmPriceLevel` answers exactly one question — is
 * entry free — and returns nothing otherwise. Meanwhile Wikivoyage's price
 * string was already parsed and thrown away, and OSM's `charge` tag was already
 * in the Overpass payload and discarded. The data was there; nothing carried it.
 *
 * Two rules shape everything here.
 *
 * **A category is not a price.** Knowing a place is a museum does not mean
 * knowing it charges, and knowing it is a market does not mean money changes
 * hands at the door — a shopping street may be free to walk into, a food market
 * may hand out samples, a club may charge. So `class` is only ever set by a
 * source that spoke about money. Categories set `expectation`, which the UI
 * renders in visibly hedged language, and `expectation` is never promoted.
 *
 * **A number without a currency is not a price.** `600` means JPY only if you
 * know the country, and `¥` is JPY or CNY depending on which side of a sea you
 * are on. Currency is resolved here, once, server-side, where the country code
 * is known; anything that cannot be resolved keeps its `rawText` and yields no
 * amount at all. The alternative is the bug that printed `'¥'.repeat(n)` for
 * every country on earth.
 *
 * No imports, on purpose: loaded by the Deno Edge Functions and by the
 * Node/vitest suite alike, the same precedent as `osmPlaces.ts`.
 */

export type AdmissionClass = 'free' | 'ticketed' | 'spend-based' | 'unknown';

/**
 * What a category suggests, when no source said anything about money. Never a
 * claim that it *is* so — only what kind of place this usually is.
 */
export type AdmissionExpectation = 'usually-ticketed' | 'often-free' | 'spending-inside';

export type AdmissionSource = 'official-website' | 'provider' | 'osm-tag' | 'wikivoyage' | 'category';

export interface AdmissionFare {
  /** As the source labelled it: adult, child, student, senior, concession. */
  audience: string;
  /** The lower bound when the operator publishes a date/product range. */
  amount: number;
  minAmount?: number;
  maxAmount?: number;
  /** ISO 4217. Always explicit — a fare without one is not emitted. */
  currency: string;
  note?: string;
}

export interface PlaceAdmission {
  class: AdmissionClass;
  /** For `ticketed`. Empty means a ticket is required but no price was published. */
  fares?: AdmissionFare[];
  /** For `spend-based`, where a provider published a typical per-head spend. */
  typicalSpend?: AdmissionFare;
  expectation?: AdmissionExpectation;
  /** The source's own words, kept whenever parsing was partial or failed. */
  rawText?: string;
  source: AdmissionSource;
  sourceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
  retrievedAt?: string;
}

/**
 * The small subset of a cached official claim needed to rebuild admission.
 * Kept structural so the Edge cache module does not have to import the client
 * evidence model (and so this remains safe to exercise in vitest).
 */
export interface OfficialAdmissionClaim {
  type?: string;
  summary?: string;
  value?: number;
  unit?: string;
  appliesTo?: { currency?: string; audience?: string; minAmount?: number; maxAmount?: number };
}

/** Validate an admission map before an untrusted Edge response reaches UI state. */
export function isPlaceAdmission(value: unknown): value is PlaceAdmission {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  const classes: AdmissionClass[] = ['free', 'ticketed', 'spend-based', 'unknown'];
  const sources: AdmissionSource[] = ['official-website', 'provider', 'osm-tag', 'wikivoyage', 'category'];
  const confidence = ['high', 'medium', 'low'];
  if (!classes.includes(entry.class as AdmissionClass)) return false;
  if (!sources.includes(entry.source as AdmissionSource)) return false;
  if (!confidence.includes(String(entry.confidence))) return false;
  const validFare = (fare: unknown): boolean => {
    if (!fare || typeof fare !== 'object') return false;
    const row = fare as Record<string, unknown>;
    if (
      typeof row.audience !== 'string'
      || typeof row.currency !== 'string'
      || typeof row.amount !== 'number'
      || !Number.isFinite(row.amount)
    ) return false;
    for (const key of ['minAmount', 'maxAmount']) {
      if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key] as number))) return false;
    }
    if (typeof row.minAmount === 'number' && typeof row.maxAmount === 'number' && row.minAmount > row.maxAmount) return false;
    return true;
  };
  if (entry.fares !== undefined && (!Array.isArray(entry.fares) || entry.fares.some((fare) => !validFare(fare)))) return false;
  if (entry.typicalSpend !== undefined) {
    if (!entry.typicalSpend || typeof entry.typicalSpend !== 'object') return false;
    const spend = entry.typicalSpend as Record<string, unknown>;
    if (
      !spend
      || typeof spend.audience !== 'string'
      || typeof spend.currency !== 'string'
      || !validFare(spend)
    ) return false;
  }
  return true;
}

/**
 * Rebuild an official admission record from the claims stored beside a cached
 * source document. This is deliberately conservative: a numeric claim without
 * both an explicit currency and audience is not turned into a fare.
 */
export function admissionFromOfficialClaims(
  claims: OfficialAdmissionClaim[],
  sourceUrl?: string,
  retrievedAt?: string,
): PlaceAdmission | undefined {
  const priceClaims = claims.filter((claim) => claim.type === 'price');
  if (priceClaims.length === 0) return undefined;

  const free = priceClaims.some((claim) => /\badmission is free\b|\bfree entry\b/i.test(claim.summary || ''));
  if (free) {
    return { class: 'free', source: 'official-website', confidence: 'high', sourceUrl, retrievedAt };
  }

  const fares: AdmissionFare[] = [];
  const seen = new Set<string>();
  for (const claim of priceClaims) {
    if (
      typeof claim.value !== 'number'
      || !Number.isFinite(claim.value)
      || !claim.appliesTo?.currency
      || !claim.appliesTo.audience
    ) continue;
    const key = `${claim.appliesTo.audience}|${claim.appliesTo.currency}|${claim.value}|${claim.appliesTo.maxAmount ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const noteMatch = claim.summary?.match(/\(([^)]+)\)\s*$/);
    const minAmount = typeof claim.appliesTo.minAmount === 'number' && Number.isFinite(claim.appliesTo.minAmount)
      ? claim.appliesTo.minAmount
      : claim.value;
    const maxAmount = typeof claim.appliesTo.maxAmount === 'number' && Number.isFinite(claim.appliesTo.maxAmount)
      ? claim.appliesTo.maxAmount
      : claim.value;
    fares.push({
      audience: claim.appliesTo.audience,
      amount: minAmount,
      ...(minAmount !== maxAmount ? { minAmount, maxAmount } : {}),
      currency: claim.appliesTo.currency,
      note: noteMatch?.[1],
    });
  }
  if (fares.length > 0) {
    return { class: 'ticketed', fares, source: 'official-website', confidence: 'high', sourceUrl, retrievedAt };
  }

  if (priceClaims.some((claim) => /ticket|required|price/i.test(claim.summary || ''))) {
    return { class: 'ticketed', fares: [], source: 'official-website', confidence: 'high', sourceUrl, retrievedAt };
  }
  return undefined;
}

// --- Currency --------------------------------------------------------------

/**
 * The currency a bare number is denominated in, by country.
 *
 * Only used when a source published a number with no unit at all, which is
 * common in guidebook prose written for people already in the country.
 */
export const COUNTRY_CURRENCY: Record<string, string> = {
  JP: 'JPY', CN: 'CNY', KR: 'KRW', TW: 'TWD', HK: 'HKD', MO: 'MOP', SG: 'SGD',
  MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP', IN: 'INR', LK: 'LKR',
  NP: 'NPR', KH: 'KHR', LA: 'LAK', MM: 'MMK', BD: 'BDT', PK: 'PKR',
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', PE: 'PEN',
  CO: 'COP', GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
  PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', GR: 'EUR', FI: 'EUR', EE: 'EUR',
  LV: 'EUR', LT: 'EUR', SK: 'EUR', SI: 'EUR', HR: 'EUR', CY: 'EUR', MT: 'EUR',
  LU: 'EUR', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', IS: 'ISK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY', RU: 'RUB', UA: 'UAH',
  AU: 'AUD', NZ: 'NZD', FJ: 'FJD', ZA: 'ZAR', EG: 'EGP', MA: 'MAD', KE: 'KES',
  TZ: 'TZS', NG: 'NGN', AE: 'AED', SA: 'SAR', QA: 'QAR', IL: 'ILS', JO: 'JOD',
};

/** Symbols that can only mean one thing. */
const UNAMBIGUOUS_SYMBOLS: Record<string, string> = {
  '€': 'EUR', '£': 'GBP', '₩': 'KRW', '฿': 'THB', '₹': 'INR', '₫': 'VND',
  '₱': 'PHP', '₺': 'TRY', '₪': 'ILS', '₴': 'UAH', '₽': 'RUB',
};

/**
 * Symbols shared by several currencies. `¥` is the important one: it is JPY in
 * Osaka and CNY in Shanghai, and a traveller shown the wrong one is being told
 * a price roughly twenty times out.
 */
const AMBIGUOUS_SYMBOLS: Record<string, string[]> = {
  '¥': ['JPY', 'CNY'],
  '￥': ['JPY', 'CNY'],
  $: ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'TWD', 'MXN', 'CLP', 'ARS', 'COP', 'FJD'],
};

/** Words people write instead of a code. */
const CURRENCY_WORDS: Record<string, string> = {
  yen: 'JPY', yuan: 'CNY', rmb: 'CNY', won: 'KRW', baht: 'THB', ringgit: 'MYR',
  rupiah: 'IDR', peso: 'PHP', pesos: 'PHP', euro: 'EUR', euros: 'EUR',
  pound: 'GBP', pounds: 'GBP', rupee: 'INR', rupees: 'INR', dong: 'VND',
  'nt$': 'TWD', rm: 'MYR', rp: 'IDR',
};

const ISO_CODE = /^[A-Z]{3}$/;

/**
 * Resolve a currency, or return undefined and let the caller keep the raw text.
 *
 * Order is deliberate and never guesses past the end of it: an explicit code
 * beats a symbol, a symbol is disambiguated only by a known country, and a bare
 * number needs a country. Nothing here falls back to "probably USD".
 */
export function resolveCurrency(
  token: string | undefined,
  symbol: string | undefined,
  countryCode?: string,
): string | undefined {
  const country = countryCode?.trim().toUpperCase();
  const countryCurrency = country ? COUNTRY_CURRENCY[country] : undefined;

  if (token) {
    // Words are checked before codes: "yen" is three letters and would
    // otherwise pass as the ISO code `YEN`, which does not exist.
    const word = CURRENCY_WORDS[token.toLowerCase()];
    if (word) return word;
    const upper = token.toUpperCase();
    if (ISO_CODE.test(upper)) return upper;
  }

  if (symbol) {
    const only = UNAMBIGUOUS_SYMBOLS[symbol];
    if (only) return only;
    const options = AMBIGUOUS_SYMBOLS[symbol];
    // A shared symbol is only readable against a country that actually uses it.
    if (options) return countryCurrency && options.includes(countryCurrency) ? countryCurrency : undefined;
  }

  return countryCurrency;
}

// --- Fare parsing ----------------------------------------------------------

const FREE_PATTERN = /\b(free\s+(admission|entry|entrance|of\s+charge)|admission\s+free|entry\s+free|free|no\s+charge|no\s+entry\s+fee|gratis|kostenlos)\b/i;

/**
 * One money mention: an optional symbol, a number, an optional trailing code or
 * word. Thousands separators are allowed; a decimal tail is capped at two
 * digits so a date or a coordinate cannot read as a price.
 */
const MONEY = /([¥￥€£$₩฿₹₫₱₺₪₴₽]|\bNT\$|\bRM\b|\bRp\b)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*([A-Za-z]{2,6}\$?)?/g;

const AUDIENCE_PATTERN = /\b(adults?|children|child|kids?|students?|seniors?|elderly|concessions?|groups?|families|family|infants?)\b/gi;

/** Canonical audience names, so two sources phrasing it differently agree. */
function canonicalAudience(word: string): string {
  const lower = word.toLowerCase();
  if (lower.startsWith('adult')) return 'adult';
  if (lower.startsWith('child') || lower.startsWith('kid') || lower.startsWith('infant')) return 'child';
  if (lower.startsWith('student')) return 'student';
  if (lower.startsWith('senior') || lower === 'elderly') return 'senior';
  if (lower.startsWith('concession')) return 'concession';
  if (lower.startsWith('group')) return 'group';
  if (lower.startsWith('famil')) return 'family';
  return lower;
}

/**
 * The audience word nearest a price — behind it first, then ahead.
 *
 * Both windows are bounded by the neighbouring prices, which is not a detail:
 * in `6.00 EUR;3.00 EUR concession` an unbounded look-ahead finds "concession"
 * from the *first* fare and labels the adult ticket a concession, then drops
 * the real concession as a duplicate. The label belongs to the price it sits
 * next to, and nothing may reach across another price to claim it.
 */
function audienceNear(text: string, bounds: { start: number; end: number; from: number; to: number }): string | undefined {
  const before = text.slice(Math.max(bounds.from, bounds.start - 32), bounds.start);
  const behind = [...before.matchAll(AUDIENCE_PATTERN)].pop();
  if (behind) return canonicalAudience(behind[1]);
  const after = text.slice(bounds.end, Math.min(bounds.to, bounds.end + 24));
  const ahead = [...after.matchAll(AUDIENCE_PATTERN)][0];
  return ahead ? canonicalAudience(ahead[1]) : undefined;
}

/**
 * Read an admission price out of a source's own words.
 *
 * Handles the two shapes that actually occur: OSM's semi-structured `charge`
 * (`6.00 EUR;3.00 EUR concession`) and Wikivoyage's editor prose (`Adults ¥600,
 * children ¥300`). Anything else keeps its `rawText` and reports what little it
 * can — that a ticket exists, or nothing at all.
 */
export function parseAdmissionText(
  text: string | undefined,
  countryCode?: string,
  source: AdmissionSource = 'wikivoyage',
): PlaceAdmission | undefined {
  const raw = text?.trim();
  if (!raw) return undefined;

  const fares: AdmissionFare[] = [];
  const seenAudiences = new Set<string>();
  let sawUnresolvedAmount = false;
  let droppedFigure = false;

  MONEY.lastIndex = 0;
  const matches = [...raw.matchAll(MONEY)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const [whole, symbol, digits, trailing] = match;
    const start = match.index ?? 0;
    const end = start + whole.length;

    // A trailing token is only a currency if it reads like one; "600 people"
    // must not become six hundred of anything.
    const token = trailing && (ISO_CODE.test(trailing.toUpperCase()) || CURRENCY_WORDS[trailing.toLowerCase()])
      ? trailing
      : undefined;
    const currency = resolveCurrency(token, symbol?.trim(), countryCode);
    const amount = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;

    if (!currency) {
      // A number we cannot denominate is not a price. Recorded so the caller
      // knows the text held one, but never emitted as a fare.
      sawUnresolvedAmount = true;
      continue;
    }

    const audience = audienceNear(raw, {
      start,
      end,
      from: index === 0 ? 0 : (matches[index - 1].index ?? 0) + matches[index - 1][0].length,
      to: matches[index + 1]?.index ?? raw.length,
    }) ?? 'adult';

    // A range ("¥600–¥1,000") repeats an audience; the first figure is the one
    // a traveller budgets against, and `rawText` still carries the full text.
    if (seenAudiences.has(audience)) {
      const existing = fares.find((fare) => fare.audience === audience && fare.currency === currency);
      if (existing) {
        const minAmount = Math.min(existing.minAmount ?? existing.amount, amount);
        const maxAmount = Math.max(existing.maxAmount ?? existing.amount, amount);
        existing.amount = minAmount;
        existing.minAmount = minAmount;
        existing.maxAmount = maxAmount;
        existing.note = `from ${minAmount} to ${maxAmount} ${currency}`;
        droppedFigure = true;
      } else {
        droppedFigure = true;
      }
      continue;
    }
    seenAudiences.add(audience);
    fares.push({ audience, amount, currency });
    if (fares.length >= 4) {
      droppedFigure = droppedFigure || index < matches.length - 1;
      break;
    }
  }

  if (fares.length > 0) {
    return {
      class: 'ticketed',
      fares,
      // Keep the original whenever we did not represent all of it.
      rawText: sawUnresolvedAmount || droppedFigure ? raw : undefined,
      source,
      confidence: source === 'official-website' ? 'high' : 'medium',
    };
  }

  // "Free" is only free when there is no price beside it — "free for children
  // under 6" on a paid attraction is handled above, because the fare parsed.
  if (FREE_PATTERN.test(raw)) {
    return { class: 'free', source, confidence: source === 'official-website' ? 'high' : 'medium' };
  }

  if (sawUnresolvedAmount) {
    // There is a number, so something is charged; we just cannot say what.
    return { class: 'ticketed', fares: [], rawText: raw, source, confidence: 'low' };
  }

  return { class: 'unknown', rawText: raw, source, confidence: 'low' };
}

// --- OpenStreetMap ---------------------------------------------------------

type Tags = Record<string, string | undefined>;

/**
 * Admission from OSM tags.
 *
 * `fee=no` is a real fact and the one thing the old `osmPriceLevel` could
 * report. `charge` is the one it ignored, despite it already being in the
 * Overpass response — it is where the actual number lives. `fee=yes` with no
 * readable charge still beats silence: "a ticket is required, no source
 * published the price" is a useful answer, and it is what "Cost unknown" should
 * have said all along.
 */
export function osmAdmission(tags: Tags, countryCode?: string): PlaceAdmission | undefined {
  const fee = tags.fee?.trim().toLowerCase();
  const charge = tags.charge?.trim() || tags['charge:adult']?.trim() || tags['fee:amount']?.trim();
  const admission = tags.admission?.trim().toLowerCase();
  const conditional = tags['fee:conditional']?.trim();

  const freeTagged = fee === 'no' || admission === 'free' || charge?.toLowerCase() === 'free';
  if (freeTagged) {
    return {
      class: 'free',
      source: 'osm-tag',
      confidence: 'medium',
      // "free @ (Su)" changes the answer on some days; carrying it is the
      // difference between a fact and a half-fact.
      rawText: conditional || undefined,
    };
  }

  if (charge) {
    const parsed = parseAdmissionText(charge, countryCode, 'osm-tag');
    if (parsed) {
      return {
        ...parsed,
        // A `charge` tag is itself a statement that entry costs something, so an
        // unreadable value is still `ticketed` rather than unknown.
        class: parsed.class === 'unknown' ? 'ticketed' : parsed.class,
        fares: parsed.fares ?? [],
        rawText: parsed.rawText || (conditional ? `${charge} (${conditional})` : charge),
        source: 'osm-tag',
      };
    }
  }

  if (fee === 'yes') {
    return { class: 'ticketed', fares: [], rawText: conditional || undefined, source: 'osm-tag', confidence: 'medium' };
  }

  return undefined;
}

// --- Category expectation --------------------------------------------------

const USUALLY_TICKETED = ['museum', 'museums', 'art', 'aquarium', 'wildlife', 'theme-park', 'gallery', 'zoo', 'observatory'];
const SPENDING_INSIDE = ['market', 'food', 'food-district', 'cafes', 'street-food', 'shopping', 'nightlife', 'evening'];
const OFTEN_FREE = ['park', 'garden', 'nature', 'temple', 'shrine', 'waterfront', 'view', 'local-character'];

/**
 * What kind of place this is, where no source spoke about money.
 *
 * This is the whole of what a category may contribute. It cannot become a
 * `class`, and the copy it drives is hedged on purpose: an unpriced market
 * reads "No admission price published · spending happens inside", which
 * separates *admission* from *spending* without claiming either.
 */
export function admissionExpectation(categories: string[]): AdmissionExpectation | undefined {
  const tags = new Set(categories.map((category) => category.toLowerCase()));
  if (USUALLY_TICKETED.some((category) => tags.has(category))) return 'usually-ticketed';
  if (SPENDING_INSIDE.some((category) => tags.has(category))) return 'spending-inside';
  if (OFTEN_FREE.some((category) => tags.has(category))) return 'often-free';
  return undefined;
}

/** An expectation on its own, ready to be merged behind any real price. */
export function categoryAdmission(categories: string[]): PlaceAdmission | undefined {
  const expectation = admissionExpectation(categories);
  if (!expectation) return undefined;
  return { class: 'unknown', expectation, source: 'category', confidence: 'low' };
}

// --- Precedence ------------------------------------------------------------

const SOURCE_RANK: Record<AdmissionSource, number> = {
  'official-website': 4,
  provider: 3,
  'osm-tag': 2,
  wikivoyage: 2,
  category: 0,
};

/**
 * Combine what several sources said, deterministically.
 *
 * The operator's own site outranks a map provider, which outranks a
 * community-maintained tag, which outranks a guidebook editor's prose only on a
 * tie — and a category outranks nothing, ever. Where two sources tie, the one
 * that produced actual fares wins, because a number is more use than a class.
 *
 * The result always carries the best available `expectation`, even when a
 * priced source won, so the UI can still say what kind of place it is.
 */
export function mergeAdmission(...inputs: Array<PlaceAdmission | undefined>): PlaceAdmission | undefined {
  const candidates = inputs.filter((entry): entry is PlaceAdmission => Boolean(entry));
  if (candidates.length === 0) return undefined;

  const expectation = candidates.find((entry) => entry.expectation)?.expectation;
  const spoke = candidates.filter((entry) => entry.source !== 'category' && entry.class !== 'unknown');

  if (spoke.length === 0) {
    // Nobody said anything about money. Report the kind of place it is and be
    // explicit that this is not a price.
    return {
      class: 'unknown',
      expectation,
      rawText: candidates.find((entry) => entry.rawText)?.rawText,
      source: 'category',
      confidence: 'low',
    };
  }

  const fareCount = (entry: PlaceAdmission) => entry.fares?.length ?? 0;
  const best = [...spoke].sort((a, b) => (
    SOURCE_RANK[b.source] - SOURCE_RANK[a.source]
    || fareCount(b) - fareCount(a)
    // A structured tag beats free prose when both are otherwise equal.
    || (a.source === 'osm-tag' ? -1 : b.source === 'osm-tag' ? 1 : 0)
  ))[0];

  return { ...best, expectation: best.expectation ?? expectation };
}

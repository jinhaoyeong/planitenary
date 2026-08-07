/**
 * The model tier, and the rules that decide what it is allowed to say.
 *
 * Everything else in this codebase reads a source and reports it. This is the
 * one module where a sentence a human never wrote can reach a traveller's
 * screen, so it is written the other way round from normal code: the
 * validators come first and the network call is an afterthought bolted to the
 * end of them.
 *
 * The contract is deliberately not "the model was told not to lie". A system
 * prompt is a request. What is enforced here is mechanical: **every displayed
 * sentence must carry a `sourceUrl` we supplied and an `excerpt` that is a
 * literal substring of the text we supplied for that URL.** A sentence that
 * cannot produce one is dropped, and the rest are kept — one bad sentence is
 * not a reason to lose four good ones, but it is never a reason to show the
 * bad one.
 *
 * Why the substring rule is the real guarantee, and the digit check only a
 * pre-filter: "the finest garden in Kansai" contains no digits at all. Any
 * check that only looks at numbers cannot see an invented *qualitative* claim,
 * and those are the ones a traveller acts on. Requiring quotable evidence
 * makes the brief auditable rather than merely plausible.
 *
 * No import of `providers.ts` or the Supabase client, so vitest can exercise
 * every rule here directly — the same discipline `placeCost.ts` keeps, and the
 * reason the validators are cheap to test at all.
 */

import type { AdmissionFare } from './placeCost.ts';
import { COUNTRY_CURRENCY, parseAdmissionText } from './placeCost.ts';

/** One source we handed the model, and the exact text we handed it. */
export interface BriefSource {
  sourceUrl: string;
  /** The text supplied for this URL. An excerpt must be found inside it. */
  text: string;
}

/** A sentence that survived every rule below. */
export interface BriefSentence {
  text: string;
  sourceUrl: string;
  excerpt: string;
}

export type BriefRejection =
  /** Not the shape asked for — a missing field, or a non-string. */
  | 'malformed'
  /** Cited a URL we never supplied. */
  | 'unknown-source'
  /** The excerpt is not in that source's text. The core rule. */
  | 'excerpt-not-in-source'
  /** An excerpt so short it would be a substring of almost anything. */
  | 'excerpt-too-short'
  /** A number in the sentence appears nowhere in the source. */
  | 'invented-number'
  /** Brochure phrasing that asserts a judgement no source made. */
  | 'marketing-language'
  /** Hours, closures or prices — owned by the deterministic pipeline. */
  | 'reserved-subject';

export interface BriefValidation {
  sentences: BriefSentence[];
  rejected: Array<{ text: string; reason: BriefRejection }>;
}

/**
 * Phrasing that states a verdict rather than a fact.
 *
 * These are not banned because they are ugly. Each one asserts a judgement
 * ("worth your time", "undiscovered") that no retrieved source established,
 * and each survives the substring rule easily because it lives in the
 * sentence rather than in the excerpt.
 */
export const BANNED_PHRASES = [
  'must-see', 'must see', 'hidden gem', 'nestled', 'boasts',
  'a stone\'s throw', 'bucket list', 'no trip is complete',
] as const;

/**
 * Subjects the brief may not touch, however well cited.
 *
 * Opening hours and admission prices already arrive from OSM, the operator's
 * own JSON-LD and the provider APIs, and they are rendered from structured
 * fields with their own provenance. A brief that also mentions them can only
 * agree — in which case it is noise — or disagree, in which case the card
 * shows a traveller two different answers to the same question and no way to
 * tell which is current. The deterministic pipeline owns these.
 */
const RESERVED_SUBJECT = /\b(?:open(?:s|ing)?|close[sd]?|closure|hours?|admission|entry fee|ticket price|costs?\s+(?:[¥$€£]|\d)|\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*[–—-]\s*\d{1,2}[:.]\d{2})\b/i;

/**
 * Whitespace is collapsed before comparing, because the text we supply has
 * been through HTML extraction and a model re-typing an excerpt will not
 * reproduce the original run of newlines. Case is ignored for the same reason:
 * an excerpt differing only in capitalisation is the same quotation, and
 * failing it would reject honest sentences without catching a single invented
 * one. Nothing else is normalised — in particular no punctuation stripping,
 * which is where a paraphrase could start passing as a quotation.
 */
const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * An excerpt shorter than this is not evidence.
 *
 * Without a floor the rule is trivially satisfiable: "the" is a literal
 * substring of virtually any page, so a model could attach it to a wholly
 * invented sentence and pass. The number is a judgement — long enough that a
 * match means something, short enough to admit a genuine short quotation.
 */
export const MIN_EXCERPT_CHARS = 16;

/**
 * The same floor, for a fare, would refuse almost every real price line.
 *
 * Operators write `Adults $10`. Ten characters. The brief's floor exists
 * because a short substring could launder an invented *sentence*; a fare has a
 * stronger guard available — the excerpt must contain the figure itself — so
 * this only needs to be high enough to reject a bare `$10` offered as a
 * quotation.
 */
export const MIN_FARE_EXCERPT_CHARS = 6;

/** Currencies this codebase can resolve. Membership is the ISO check. */
const KNOWN_CURRENCIES = new Set(Object.values(COUNTRY_CURRENCY));

/** Every distinct run of digits in a string, as written. */
const numbersIn = (value: string): string[] => (value.match(/\d[\d,.]*/g) || [])
  .map((raw) => raw.replace(/[.,]$/, ''))
  .filter(Boolean);

/**
 * Validate one model response against the sources it was given.
 *
 * Returns the survivors and, separately, what was thrown away and why —
 * callers report the rejection rate as a counter, because a validator whose
 * reject rate nobody watches is a validator nobody knows has stopped working.
 */
export function validateBriefSentences(
  raw: unknown,
  sources: BriefSource[],
): BriefValidation {
  const sentences: BriefSentence[] = [];
  const rejected: BriefValidation['rejected'] = [];

  const byUrl = new Map<string, string>();
  for (const source of sources) {
    if (!source?.sourceUrl || typeof source.text !== 'string') continue;
    // A URL supplied twice contributes both texts; the excerpt need only be in
    // one of them, and concatenating is simpler than tracking a list.
    byUrl.set(source.sourceUrl, `${byUrl.get(source.sourceUrl) || ''} ${source.text}`);
  }

  const list = Array.isArray((raw as { sentences?: unknown })?.sentences)
    ? (raw as { sentences: unknown[] }).sentences
    : Array.isArray(raw) ? raw : [];

  for (const entry of list) {
    const item = entry as Partial<BriefSentence> | null;
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    const sourceUrl = typeof item?.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
    const excerpt = typeof item?.excerpt === 'string' ? item.excerpt.trim() : '';

    const reject = (reason: BriefRejection) => rejected.push({ text: text || '(no text)', reason });

    if (!text || !sourceUrl || !excerpt) { reject('malformed'); continue; }
    if (!byUrl.has(sourceUrl)) { reject('unknown-source'); continue; }
    if (excerpt.length < MIN_EXCERPT_CHARS) { reject('excerpt-too-short'); continue; }

    const haystack = normalise(byUrl.get(sourceUrl) || '');
    if (!haystack.includes(normalise(excerpt))) { reject('excerpt-not-in-source'); continue; }

    /**
     * Subject and tone are judged before the digit pre-filter, because the
     * dangerous version of a sentence about opening hours is the one whose
     * numbers *are* in the source — it would sail through a numeric check and
     * land beside the structured hours, disagreeing with them.
     */
    const lower = text.toLowerCase();
    if (BANNED_PHRASES.some((phrase) => lower.includes(phrase))) { reject('marketing-language'); continue; }
    if (RESERVED_SUBJECT.test(text)) { reject('reserved-subject'); continue; }

    // Cheap pre-filter. Catches an invented price or year; cannot catch an
    // invented adjective, which is why it supplements the substring rule
    // rather than standing in for it.
    const unsupported = numbersIn(text).filter((number) => !haystack.includes(number.toLowerCase()));
    if (unsupported.length > 0) { reject('invented-number'); continue; }

    sentences.push({ text, sourceUrl, excerpt });
  }

  return { sentences, rejected };
}

export interface AdmissionReadInput {
  /** Visible text of the official page. The only text a fare may come from. */
  pageText: string;
  countryCode?: string;
}

export interface AdmissionReadValidation {
  fares: AdmissionFare[];
  rejected: Array<{ reason: string }>;
}

/**
 * Validate model-read fares against the operator's own page.
 *
 * Stricter than the brief, because a price is the one model output that would
 * be rendered as a bare fact rather than as prose: the amount must appear as a
 * digit substring on the page, the currency must be a real ISO code that the
 * page or the country supports, and the excerpt must be verbatim. A fare
 * failing any of these is dropped individually — losing a concession beats
 * losing the adult fare with it.
 */
export function validateAdmissionFares(
  raw: unknown,
  input: AdmissionReadInput,
): AdmissionReadValidation {
  const fares: AdmissionFare[] = [];
  const rejected: AdmissionReadValidation['rejected'] = [];
  const haystack = normalise(input.pageText);

  const list = Array.isArray((raw as { fares?: unknown })?.fares)
    ? (raw as { fares: unknown[] }).fares
    : Array.isArray(raw) ? raw : [];

  for (const entry of list) {
    const item = entry as Record<string, unknown> | null;
    const amount = typeof item?.amount === 'number' ? item.amount : Number(item?.amount);
    const audience = typeof item?.audience === 'string' && item.audience.trim()
      ? item.audience.trim().toLowerCase()
      : 'adult';
    const currencyRaw = typeof item?.currency === 'string' ? item.currency.trim().toUpperCase() : '';
    const excerpt = typeof item?.excerpt === 'string' ? item.excerpt.trim() : '';

    if (!Number.isFinite(amount) || amount < 0) { rejected.push({ reason: 'amount-not-a-number' }); continue; }

    /**
     * A fare excerpt is judged differently from a brief's, and the difference
     * cost a production outage: the brief's 16-character floor was applied
     * here unchanged, so `Adults $10` — ten characters, and exactly how
     * operators write it — was refused, silently, on every page. Every result
     * came back empty and got cached, and the symptom was indistinguishable
     * from the model failing.
     *
     * The floor stays, much lower, only to stop a bare `$10` being offered as
     * a quotation. The real rule is the next one.
     */
    if (excerpt.length < MIN_FARE_EXCERPT_CHARS) { rejected.push({ reason: 'excerpt-too-short' }); continue; }
    if (!haystack.includes(normalise(excerpt))) { rejected.push({ reason: 'excerpt-not-on-page' }); continue; }

    // The figure itself, as digits. `1,500` and `1500` are the same price
    // written two ways, so both spellings are tried before a fare is refused.
    const plain = String(amount);
    const grouped = amount.toLocaleString('en-US').toLowerCase();
    const amountIn = (text: string) => text.includes(plain) || text.includes(grouped);

    if (!amountIn(haystack)) { rejected.push({ reason: 'amount-not-on-page' }); continue; }
    /**
     * Stronger than any length floor, and what actually ties a quotation to
     * the fare it is offered for: the excerpt must contain this fare's figure.
     * Otherwise a sentence from elsewhere on the page — genuinely present, and
     * about something else entirely — could vouch for an amount it never
     * mentions.
     */
    if (!amountIn(normalise(excerpt))) { rejected.push({ reason: 'excerpt-missing-the-amount' }); continue; }

    /**
     * Real ISO code **and** either on the page or the country's — not merely
     * a code we recognise. Accepting any member of the country table let a
     * model put `EUR` on a US page and be believed; `USD` on a Cambodian page
     * is fine, but only because the page says so. `YEN` still fails, as it
     * must: three letters are not proof of a currency, which is a bug this
     * project already fixed once on the deterministic path.
     */
    const countryCurrency = COUNTRY_CURRENCY[(input.countryCode || '').toUpperCase()];
    const isKnownCode = KNOWN_CURRENCIES.has(currencyRaw);
    const supported = currencyRaw === countryCurrency || haystack.includes(currencyRaw.toLowerCase());
    /**
     * The fallback reads the excerpt with the same parser every deterministic
     * price in this codebase goes through, rather than calling `resolveCurrency`
     * directly — that takes `(token, symbol, countryCode)`, and passing an
     * excerpt plus a country code silently filled the *symbol* slot with `'JP'`
     * and left the country undefined, so the branch could never resolve
     * anything and a `€6.50` line on a page with no country was simply dropped.
     * `parseAdmissionText` already does the tokenising and symbol
     * disambiguation properly.
     */
    const currency = currencyRaw && isKnownCode && supported
      ? currencyRaw
      : parseAdmissionText(excerpt, input.countryCode, 'official-website')?.fares?.[0]?.currency
        || countryCurrency;
    if (!currency) { rejected.push({ reason: 'currency-unresolvable' }); continue; }

    fares.push({ audience, amount, currency });
  }

  return { fares, rejected };
}

/**
 * What a run of the model tier cost and produced, for observability.
 *
 * `rejectedReasons` exists because of a real incident: a validator refusing
 * every fare and a provider returning nothing produce the *same* visible
 * outcome — an empty result, cached, with no error. Distinguishing them
 * mattered and could not be done from the counters as they stood, so the
 * diagnosis started from a guess. A count without its reason is not
 * observability.
 */
export interface ReasoningCounters {
  skipped: number;
  cacheHits: number;
  succeeded: number;
  rejectedSentences: number;
  failed: number;
  /** Rejection reason → how many, this request. Empty when nothing was refused. */
  rejectedReasons: Record<string, number>;
}

export const emptyCounters = (): ReasoningCounters => ({
  skipped: 0, cacheHits: 0, succeeded: 0, rejectedSentences: 0, failed: 0, rejectedReasons: {},
});

/** Fold a validator's rejections into the counters, keeping their reasons. */
export function countRejections(
  counters: ReasoningCounters,
  rejections: Array<{ reason: string }>,
): void {
  counters.rejectedSentences += rejections.length;
  for (const { reason } of rejections) {
    counters.rejectedReasons[reason] = (counters.rejectedReasons[reason] || 0) + 1;
  }
}

/** Hard ceilings on what may be sent, enforced rather than hoped for. */
export const MAX_SOURCE_CHARS = 6_000;
export const MAX_SOURCES = 8;
export const REQUEST_TIMEOUT_MS = 8_000;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Injected so tests never reach the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const SYSTEM = `You are a travel evidence interpreter. You may summarise, classify, translate, and explain only the source-backed input you receive. Never invent a place, opening hour, price, route, queue, review, closure, or availability. Every sentence you return must quote a verbatim excerpt from the supplied text for the source URL you cite. Return valid JSON only.`;

interface GeminiPayload {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * One request, one attempt, one timeout.
 *
 * No retry: this is the only metered provider in the system, and a failed
 * brief is a missing brief — a card is decidable without one. Retrying would
 * convert a provider wobble into a bill.
 */
export async function callGemini(
  operation: string,
  input: unknown,
  options: GeminiOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const model = options.model || 'gemini-2.5-flash';
    const response = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': options.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            role: 'user',
            parts: [{ text: `Operation: ${operation}\nSource-backed input:\n${JSON.stringify(input)}` }],
          }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return undefined;
    const payload = await response.json() as GeminiPayload;
    const text = (payload.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text?.trim() || '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A stable fingerprint of the material a brief was derived from.
 *
 * This is what makes a cached answer safe to reuse: the same evidence gives
 * the same revision and the cached brief still describes the place, while
 * changed evidence gives a different one and the brief is recomputed. Time
 * alone would not do — a description does not become wrong because a week
 * passed, it becomes wrong because what we read changed.
 *
 * Content-addressed rather than counted: the URLs *and* their text both feed
 * the hash, so re-reading the same page with new wording invalidates the
 * answer even though the source list is identical. Sorted first, because the
 * order sources come back in is not meaningful and must not churn the key.
 */
/**
 * Bumped whenever a validation rule changes.
 *
 * Without this, a fix to the validators cannot reach production: the cache key
 * is a hash of the *source material*, which a rule change does not alter, so
 * every wrong answer already stored — including every wrongly-empty one —
 * keeps being served. Caching the null result is what makes this necessary;
 * it is also what makes the cache worth having.
 *
 * `discoveryCityKey` carries a schema version for the same reason, and this is
 * the same failure mode one layer up.
 *
 * v2: the fare excerpt floor was refusing every ordinary price line
 * ("Adults $10"), and the currency check accepted any known code regardless of
 * the page. Both are fixed, so every v1 answer must be re-derived.
 */
export const VALIDATOR_VERSION = 'v2';

export function evidenceRevision(sources: BriefSource[]): string {
  // The delimiter between a source's address and its text is a newline, which
  // cannot occur inside a URL, so the boundary is unambiguous. Written as a
  // real line break rather than a control character — an earlier version used
  // a NUL byte, which works and quietly makes this file read as binary to
  // `grep` and `file`.
  const canonical = sources
    .map((source) => `${source.sourceUrl}
${source.text}`)
    .sort()
    .join('');

  // FNV-1a, 32-bit, rendered hex. Not a security boundary — the worst case for
  // a collision is one stale description — and it must run identically in Deno
  // and in vitest without pulling in a crypto import.
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // The validator version is part of the key, not merely part of the payload:
  // a rule change has to invalidate the answers that rule produced.
  return `${VALIDATOR_VERSION}-${hash.toString(16).padStart(8, '0')}-${sources.length}`;
}

/** Trim sources to the enforced ceiling before anything is sent. */
export function boundSources(sources: BriefSource[]): BriefSource[] {
  return sources
    .filter((source) => source?.sourceUrl && source.text?.trim())
    .slice(0, MAX_SOURCES)
    .map((source) => ({ sourceUrl: source.sourceUrl, text: source.text.slice(0, MAX_SOURCE_CHARS) }));
}

/**
 * Read a fare out of an operator's own prose.
 *
 * The narrowest of the three operations and the only one whose output renders
 * as a bare fact rather than as prose, so it runs on **official-site visible
 * text only** — never a review, a forum post or a video description, whose
 * authority could never carry a price anyway.
 *
 * Returns `null` for "asked, nothing survived validation", distinct from
 * `undefined` for "did not ask". The caller caches both, because a page the
 * model could not read a price from will not become readable tomorrow.
 */
export async function requestAdmissionRead(
  input: AdmissionReadInput,
  options: GeminiOptions,
): Promise<{ fares: AdmissionFare[] | null; rejections: Array<{ reason: string }> }> {
  const pageText = input.pageText.slice(0, MAX_SOURCE_CHARS);
  if (!pageText.trim()) return { fares: null, rejections: [] };

  const raw = await callGemini('admission-read', {
    instruction: 'Read admission prices from this page text. For each fare give audience, amount as a number, currency as an ISO code, and a verbatim excerpt from the text. Return no fare you cannot quote.',
    pageText,
    countryCode: input.countryCode,
  }, options);

  const { fares, rejected } = validateAdmissionFares(raw, { ...input, pageText });
  return { fares: fares.length > 0 ? fares : null, rejections: rejected };
}

/**
 * Decide what an operator's page finally says about admission.
 *
 * Pure, and separate from `officialEvidence`, because that function reaches
 * for `Deno` and cannot be loaded by vitest — and the precedence rule here is
 * exactly the kind of thing that must not go untested. Encodes two decisions:
 *
 * 1. **Structured pricing always wins.** A machine-readable `Offer` is the
 *    operator stating a price in a form with one meaning; a number located in
 *    a paragraph is the same operator read less reliably. When JSON-LD gave a
 *    fare, the model's answer is discarded even if it disagrees — and
 *    `shouldReadAdmission` means it was never asked in the first place.
 * 2. **A model-read fare is demoted, not disguised.** The source stays
 *    `official-website`, because the price genuinely is published there, while
 *    confidence drops to medium. Leaving it at high would make a number found
 *    in prose indistinguishable from one the operator marked up.
 */
export function resolveOfficialAdmission(input: {
  structured?: PlaceAdmissionLike;
  readFares?: AdmissionFare[] | null;
  sourceUrl: string;
  retrievedAt: string;
}): PlaceAdmissionLike | undefined {
  /**
   * A declared-free place is settled, and `free` carries no `fares` array — so
   * a rule that only looked at fare *count* treated "the operator says entry is
   * free" identically to "we know nothing". A free municipal museum whose page
   * also lists a guided tour or a gift-shop price would come back reclassified
   * as ticketed at that price. The operator's own machine-readable declaration
   * outranks anything read out of their prose.
   */
  if (input.structured?.class === 'free') return input.structured;

  const structuredFares = input.structured?.fares || [];
  if (structuredFares.length > 0) return input.structured;
  if (!input.readFares || input.readFares.length === 0) return input.structured;

  return {
    class: 'ticketed',
    fares: input.readFares,
    source: 'official-website',
    confidence: 'medium',
    sourceUrl: input.sourceUrl,
    retrievedAt: input.retrievedAt,
  };
}

/**
 * Whether the prose is worth a metered call at all.
 *
 * `free` is a settled answer even though it carries no `fares` — asking anyway
 * would spend money to look for a price on a page that has just told us there
 * isn't one, and risk finding a gift-shop figure instead.
 */
export const shouldReadAdmission = (structured?: PlaceAdmissionLike): boolean =>
  structured?.class !== 'free' && (structured?.fares || []).length === 0;

/** The subset of `PlaceAdmission` this module needs, kept structural. */
export interface PlaceAdmissionLike {
  class: string;
  fares?: AdmissionFare[];
  source: string;
  confidence: string;
  sourceUrl?: string;
  retrievedAt?: string;
  [key: string]: unknown;
}

export interface PlaceBrief {
  sentences: BriefSentence[];
  /** How many distinct sources the surviving sentences rest on. */
  sourceCount: number;
}

/**
 * Ask for a description, and return one only if it survives validation.
 *
 * Zero surviving sentences means no brief at all — the same outcome as having
 * no API key. There is no partial-credit path where a card shows an
 * unattributable sentence because the rest were fine.
 */
export async function requestPlaceBrief(
  place: { name: string; city: string; categories: string[] },
  sources: BriefSource[],
  options: GeminiOptions,
): Promise<{ brief?: PlaceBrief; rejections: Array<{ reason: string }> }> {
  const bounded = boundSources(sources);
  if (bounded.length === 0) return { rejections: [] };

  const raw = await callGemini('place-brief', {
    place,
    instruction: 'Describe this place in at most three sentences a traveller would find useful. Every sentence must cite one sourceUrl and quote a verbatim excerpt from that source. Do not mention opening hours, closures or prices.',
    sources: bounded,
  }, options);

  const { sentences, rejected } = validateBriefSentences(raw, bounded);
  if (sentences.length === 0) return { rejections: rejected };

  return {
    brief: { sentences, sourceCount: new Set(sentences.map((s) => s.sourceUrl)).size },
    rejections: rejected,
  };
}

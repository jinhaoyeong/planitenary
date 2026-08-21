import { priceFactsFromValue, type AskPriceFact } from './askPriceFacts.ts';
import type { ToolOutcome } from './agentRuntime.ts';
import { MAX_PRICE_HINTS, type ExactLookupTelemetry } from './exactPlaceLookup.ts';

export interface TrustedPlaceHintResolution {
  hint: string;
  status: 'resolved' | 'ambiguous' | 'missing';
  place?: { id: string; name: string; city?: string; provider?: string; providerPlaceId?: string };
}

export const ASK_PRICE_RESEARCH_UNMET = 'I could not complete an official admission-price lookup for that request.';

export interface AskPriceResearchTrace {
  hint: string;
  status: 'resolved' | 'ambiguous' | 'missing' | 'researched';
  searchedCities: string[];
  resolvedName?: string;
  resolvedCity?: string;
}

export interface AskPriceResearchResult {
  attempted: true;
  priceFacts: AskPriceFact[];
  findings: Array<{ tool: string; ok: boolean; result?: unknown; detail?: string }>;
  trace: AskPriceResearchTrace[];
  unresolved: string[];
  /** What the lookups actually cost, so this path is never guessed at again. */
  lookups: ExactLookupTelemetry[];
  /**
   * Per-attraction outcome of the official fare research.
   *
   * Diagnostics, never traveller-facing. Without it every failure reaching
   * production looked identical — a page that could not be read, a reseller
   * domain and an operator publishing no machine-readable fare all arrived as
   * "priceFacts: 0", which is three different problems wearing one face.
   */
  admissions: AskAdmissionDiagnostic[];
}

export interface AskAdmissionDiagnostic {
  name: string;
  status: string;
  attemptedUrl?: string;
  sourceUrl?: string;
  fetched?: boolean;
  documentCount?: number;
  note?: string;
}

export interface AskPriceResearchDeps {
  resolveTrustedPlaceHints: (hints: string[]) => TrustedPlaceHintResolution[];
  /**
   * One bounded identity lookup for one name.
   *
   * Replaces a per-city discovery search. That version ran the recommendation
   * pipeline once per (hint x candidate city) — roughly seven provider round
   * trips for two attractions — and exhausted the Edge worker. Identity is a
   * single indexed question and now costs a single request.
   */
  lookupExactPlaceByName: (hint: string) => Promise<{
    place?: { id: string; name: string; city?: string; provider?: string; providerPlaceId?: string };
    status: 'resolved' | 'ambiguous' | 'missing' | 'timeout';
    telemetry: ExactLookupTelemetry;
  }>;
  researchAdmissionPrices: (placeIds: string[]) => Promise<ToolOutcome>;
}

const normalise = (value: string): string => value.trim().replace(/\s+/g, ' ');

/**
 * Pull bounded attraction-name hints out of an already-classified price Ask.
 * Names remain hints: only the trusted index may turn one into an identity.
 */
export function extractAdmissionPlaceHints(question: string): string[] {
  let value = normalise(question)
    .replace(/[?!]+$/g, '')
    .replace(/^how much\s+(?:(?:is|are|does|do)\s+)?/i, '')
    .replace(/^what\s+(?:(?:is|are)\s+)?(?:the\s+)?(?:current\s+)?(?:ticket|admission|entry|entrance)?\s*(?:price|cost|fee)s?\s+(?:for|of)\s+/i, '')
    .replace(/\b(?:tickets?|admission|entry fees?|entrance fees?)\b/gi, ' ')
    .replace(/\s+(?:cost|price)s?\b/gi, ' ')
    .replace(/\s+for\s+(?:one|two|three|four|five|six|\d+)\s+(?:adult|child|person|people|traveller|traveler)s?.*$/i, '')
    .replace(/\s+in\s+my\s+selected\s+currency.*$/i, ' ');
  value = normalise(value);

  if (!value || /^(?:both|these|those|them|it|this|that|the first one|the second one)$/i.test(value)) return [];
  return [...new Set(value
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((entry) => normalise(entry.replace(/^(?:for|at)\s+/i, '')))
    .filter((entry) => entry.length >= 3 && entry.length <= 160)
    .map((entry) => entry.replace(/^(?:the\s+)?(?:current\s+)?/i, '')))]
    .slice(0, 6);
}

const referentialPriceQuestion = (question: string): boolean =>
  /\b(?:both|these|those|them|the first one|the second one)\b/i.test(question);

/** Server-owned identity resolution followed by one batched official lookup. */
export async function researchAskAdmissionPrices(input: {
  question: string;
  tripCities: string[];
  recentPlaces?: Array<{ alias: string; name: string; city?: string }>;
}, deps: AskPriceResearchDeps): Promise<AskPriceResearchResult> {
  const findings: AskPriceResearchResult['findings'] = [];
  const trace: AskPriceResearchTrace[] = [];
  const lookups: ExactLookupTelemetry[] = [];
  const resolvedIds: string[] = [];

  const recent = input.recentPlaces ?? [];
  if (referentialPriceQuestion(input.question) && recent.length > 0) {
    for (const place of recent.slice(0, 6)) {
      resolvedIds.push(place.alias);
      trace.push({
        hint: place.name,
        status: 'resolved',
        searchedCities: [],
        resolvedName: place.name,
        resolvedCity: place.city,
      });
    }
  } else {
    /**
     * At most two hints, and at most one provider request each.
     *
     * The budget is enforced by the shape of this loop rather than checked
     * inside it: there is no city list to iterate and no retry, so a question
     * naming six attractions costs two lookups and refuses the rest instead of
     * quietly costing six. Exceeding the budget is not something this can do.
     */
    for (const hint of extractAdmissionPlaceHints(input.question).slice(0, MAX_PRICE_HINTS)) {
      // An identity the trip already holds needs no lookup at all.
      const known = deps.resolveTrustedPlaceHints([hint])[0];
      if (known?.status === 'resolved' && known.place) {
        if (!resolvedIds.includes(known.place.id)) resolvedIds.push(known.place.id);
        trace.push({
          hint,
          status: 'resolved',
          searchedCities: [],
          resolvedName: known.place.name,
          resolvedCity: known.place.city,
        });
        continue;
      }
      if (known?.status === 'ambiguous') {
        trace.push({ hint, status: 'ambiguous', searchedCities: [] });
        continue;
      }

      const found = await deps.lookupExactPlaceByName(hint);
      lookups.push(found.telemetry);
      findings.push(found.status === 'resolved'
        ? { tool: 'search_places', ok: true, result: { places: [found.place] } }
        : { tool: 'search_places', ok: false, detail: `No single trusted place is named ${hint}.` });

      if (found.status === 'resolved' && found.place) {
        if (!resolvedIds.includes(found.place.id)) resolvedIds.push(found.place.id);
        trace.push({
          hint,
          status: 'resolved',
          searchedCities: [],
          resolvedName: found.place.name,
          resolvedCity: found.place.city,
        });
      } else {
        trace.push({
          hint,
          status: found.status === 'ambiguous' ? 'ambiguous' : 'missing',
          searchedCities: [],
        });
      }
    }
  }

  if (resolvedIds.length === 0) {
    return {
      attempted: true,
      priceFacts: [],
      findings,
      trace,
      lookups,
      admissions: [],
      unresolved: trace.filter((entry) => entry.status !== 'resolved').map((entry) => entry.hint),
    };
  }

  const admission = await deps.researchAdmissionPrices(resolvedIds.slice(0, 6));
  findings.push(admission.ok
    ? { tool: 'get_admission_prices', ok: true, result: admission.result }
    : { tool: 'get_admission_prices', ok: false, detail: admission.detail });
  const priceFacts = admission.ok ? priceFactsFromValue(admission.result) : [];
  /**
   * Read off the same result the model is given, rather than a second pass:
   * these are the researcher's own reported outcomes, not a re-derivation.
   */
  const admissions: AskAdmissionDiagnostic[] = (() => {
    const result = admission.ok ? admission.result as Record<string, unknown> : null;
    const places = Array.isArray(result?.places) ? result.places : [];
    return places.slice(0, 6).map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const text = (value: unknown, max: number) =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
      return {
        name: text(row.name, 120) ?? 'unknown',
        status: text(row.status, 40) ?? 'unknown',
        attemptedUrl: text(row.attemptedUrl, 300),
        sourceUrl: text(row.sourceUrl, 300),
        ...(typeof row.fetched === 'boolean' ? { fetched: row.fetched } : {}),
        ...(typeof row.documentCount === 'number' ? { documentCount: row.documentCount } : {}),
        note: text(row.note, 200),
      };
    });
  })();
  for (const entry of trace) {
    if (entry.status === 'resolved') entry.status = 'researched';
  }
  return {
    attempted: true,
    priceFacts,
    findings,
    trace,
    lookups,
    admissions,
    unresolved: trace.filter((entry) => entry.status === 'ambiguous' || entry.status === 'missing')
      .map((entry) => entry.hint),
  };
}

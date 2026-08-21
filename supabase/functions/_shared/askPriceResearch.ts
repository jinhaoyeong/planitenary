import { priceFactsFromValue, type AskPriceFact } from './askPriceFacts.ts';
import type { ToolOutcome } from './agentRuntime.ts';

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
}

export interface AskPriceResearchDeps {
  resolveTrustedPlaceHints: (hints: string[]) => TrustedPlaceHintResolution[];
  searchExactPlaces: (city: string, name: string, limit?: number) => Promise<ToolOutcome>;
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

const cityQualifiedHint = (hint: string): string | undefined => {
  const parenthetical = /\(([^()]{2,50})\)\s*$/.exec(hint)?.[1];
  if (parenthetical) return normalise(parenthetical);
  const branded = /^(.{2,50}?)\s+(?:Disneyland|DisneySea|Disney Resort)\b/i.exec(hint)?.[1];
  return branded ? normalise(branded) : undefined;
};

const searchCitiesForHint = (hint: string, savedCities: string[]): string[] => {
  const candidates = [
    cityQualifiedHint(hint),
    ...savedCities.filter((city) => new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hint)),
    ...savedCities,
  ].filter((city): city is string => Boolean(city));
  const seen = new Set<string>();
  return candidates.filter((city) => {
    const key = city.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
};

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
    for (const hint of extractAdmissionPlaceHints(input.question)) {
      let resolution = deps.resolveTrustedPlaceHints([hint])[0];
      const searchedCities: string[] = [];
      if (resolution?.status === 'missing') {
        for (const city of searchCitiesForHint(hint, input.tripCities)) {
          searchedCities.push(city);
          const search = await deps.searchExactPlaces(city, hint, 5);
          findings.push(search.ok
            ? { tool: 'search_places', ok: true, result: search.result }
            : { tool: 'search_places', ok: false, detail: search.detail });
          resolution = deps.resolveTrustedPlaceHints([hint])[0];
          if (resolution?.status !== 'missing') break;
        }
      }

      if (resolution?.status === 'resolved' && resolution.place) {
        if (!resolvedIds.includes(resolution.place.id)) resolvedIds.push(resolution.place.id);
        trace.push({
          hint,
          status: 'resolved',
          searchedCities,
          resolvedName: resolution.place.name,
          resolvedCity: resolution.place.city,
        });
      } else {
        trace.push({
          hint,
          status: resolution?.status === 'ambiguous' ? 'ambiguous' : 'missing',
          searchedCities,
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
      unresolved: trace.filter((entry) => entry.status !== 'resolved').map((entry) => entry.hint),
    };
  }

  const admission = await deps.researchAdmissionPrices(resolvedIds.slice(0, 6));
  findings.push(admission.ok
    ? { tool: 'get_admission_prices', ok: true, result: admission.result }
    : { tool: 'get_admission_prices', ok: false, detail: admission.detail });
  const priceFacts = admission.ok ? priceFactsFromValue(admission.result) : [];
  for (const entry of trace) {
    if (entry.status === 'resolved') entry.status = 'researched';
  }
  return {
    attempted: true,
    priceFacts,
    findings,
    trace,
    unresolved: trace.filter((entry) => entry.status === 'ambiguous' || entry.status === 'missing')
      .map((entry) => entry.hint),
  };
}

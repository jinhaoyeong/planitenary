/**
 * Finding the one object a traveller named, within one Edge invocation.
 *
 * ## Why this exists rather than another discovery search
 *
 * The first attempt at by-name lookup reused `travel-discover` once per
 * (hint × candidate city). Two attractions across four cities became roughly
 * seven sequential provider round trips — each an Overpass query, Wikivoyage
 * listings, ranking, canonicalisation and cache writes — and the worker died
 * with `WORKER_RESOURCE_LIMIT`. The logic was right and the cost was not.
 *
 * The mistake was reaching for the *recommendation* pipeline to answer an
 * *identity* question. Discovery asks "what is worth seeing near here", which
 * is inherently broad. This asks "which object is called this", which is a
 * single indexed lookup. Nominatim answers it in one request — measured at
 * ~450 ms per name against the live service — and returns exactly the fields
 * identity needs and nothing else.
 *
 * The budget is therefore structural rather than advisory: one request per
 * hint, at most {@link MAX_PRICE_HINTS} hints, and no fallback that can turn
 * one lookup into several. There is no city loop here to run away.
 *
 * ## Retrieval is broad; acceptance is strict
 *
 * Nominatim ranks by relevance, so asking for "Tokyo Disneyland" also returns
 * Tokyo Disneyland *Hotel* and Tokyo Disneyland *Station*. Ranking finds
 * candidates; it never authorises one. A candidate is accepted only when a
 * name its own mappers published normalises exactly to what was asked, which
 * is what excludes those two — and would exclude them however highly the
 * provider ranked them.
 *
 * Nothing here grants canonical authority. It selects a provider object; the
 * `(provider, providerPlaceId)` → canonical link is revalidated downstream
 * exactly as before.
 */

/** Attractions one question may price. Two is a question; six is a crawl. */
export const MAX_PRICE_HINTS = 2;

/** One retrieval per hint, so an Ask cannot exceed this however it is worded. */
export const MAX_LOOKUPS_PER_ASK = MAX_PRICE_HINTS;

/**
 * Provider ceiling for one lookup.
 *
 * Short on purpose: an identity lookup that has not answered in eight seconds
 * is not going to rescue the request, and the previous failure was caused by
 * accumulated waiting rather than any single slow call. A timeout resolves to
 * `missing`, which fails closed — never to a retry.
 */
export const LOOKUP_TIMEOUT_MS = 8_000;

/** Candidates examined per lookup. Beyond this, relevance has given up. */
const MAX_CANDIDATES = 8;

export interface ExactPlaceCandidate {
  /** `n123` / `w456` / `r789`, matching `osmPlaceId`. */
  providerPlaceId: string;
  provider: 'osm';
  /** The display name, English preferred, as the traveller would read it. */
  name: string;
  /** Every name this object's own mappers published for it. */
  aliases: string[];
  coordinates?: [number, number];
  /** Wikidata's identifier for the subject, when the object carries one. */
  wikidata?: string;
  /** Settlement the object sits in. `canonical_places.city` is NOT NULL. */
  city?: string;
  countryCode?: string;
  /**
   * The site the object's mappers published for it.
   *
   * Carried, never trusted: it is a lead for the official-source path, which
   * applies its own reachability, reseller and authority rules before any fare
   * read from it is shown. Nothing here decides that a URL is official.
   */
  website?: string;
}

export type ExactPlaceOutcome =
  | { status: 'resolved'; place: ExactPlaceCandidate; examined: number }
  | { status: 'ambiguous'; examined: number }
  | { status: 'missing'; examined: number };

/** Normalisation shared with the rest of place identity: NFKC, case, symbols. */
export const normaliseLookupName = (value: string): string => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/**
 * The name keys Nominatim returns in `namedetails`, and which of them count.
 *
 * Same set the OSM path accepts, for the same reason: each is an assertion by
 * the mappers who named the object. `loc_name` and `nickname` stay out — a
 * colloquialism is not an identity, and one must not be able to select a place
 * whose ticket price is about to be quoted.
 */
const ALIAS_KEYS = ['name', 'name:en', 'int_name', 'official_name', 'short_name', 'alt_name'] as const;

const splitNameList = (value: string): string[] =>
  value.split(';').map((entry) => entry.trim()).filter(Boolean);

/** One bounded request. No `q`-shaped injection: everything is URL-encoded. */
export function exactPlaceLookupUrl(name: string, countryCode?: string): string {
  const params = new URLSearchParams({
    q: name.trim().slice(0, 160),
    format: 'jsonv2',
    limit: String(MAX_CANDIDATES),
    namedetails: '1',
    extratags: '1',
    // The canonical record requires a settlement, so ask in the same request
    // rather than paying for a second lookup to find one.
    addressdetails: '1',
  });
  const country = (countryCode || '').trim().toLowerCase();
  // Scoping to the trip's country keeps the index search tight and stops a
  // same-named place on another continent from being considered at all.
  if (/^[a-z]{2}$/.test(country)) params.set('countrycodes', country);
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Nominatim rows → the few fields identity needs. Everything else is dropped. */
export function parseExactPlaceCandidates(payload: unknown): ExactPlaceCandidate[] {
  if (!Array.isArray(payload)) return [];
  const candidates: ExactPlaceCandidate[] = [];
  for (const row of payload.slice(0, MAX_CANDIDATES)) {
    const hit = asRecord(row);
    if (!hit) continue;
    const type = typeof hit.osm_type === 'string' ? hit.osm_type : '';
    const id = hit.osm_id;
    if (!type || (typeof id !== 'number' && typeof id !== 'string')) continue;
    const providerPlaceId = `${type[0]}${id}`;

    const names = asRecord(hit.namedetails) ?? {};
    const aliases: string[] = [];
    for (const key of ALIAS_KEYS) {
      const value = names[key];
      if (typeof value !== 'string') continue;
      for (const entry of splitNameList(value)) {
        if (entry.length > 0 && entry.length <= 160 && !aliases.includes(entry)) aliases.push(entry);
      }
    }
    if (aliases.length === 0) continue;

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    const extra = asRecord(hit.extratags) ?? {};
    const address = asRecord(hit.address) ?? {};
    const settlement = ['city', 'town', 'village', 'municipality', 'county']
      .map((key) => address[key])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const country = typeof address.country_code === 'string' ? address.country_code.trim().toUpperCase() : undefined;
    const site = [extra.website, extra['contact:website']]
      .find((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value.trim()));
    const wikidata = typeof extra.wikidata === 'string' && /^Q\d+$/.test(extra.wikidata.trim())
      ? extra.wikidata.trim()
      : undefined;

    candidates.push({
      providerPlaceId,
      provider: 'osm',
      // Prefer the English name for display; fall back to whatever was published.
      name: typeof names['name:en'] === 'string' && names['name:en']
        ? names['name:en']
        : aliases[0],
      aliases: aliases.slice(0, 12),
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { coordinates: [lat, lng] as [number, number] } : {}),
      ...(wikidata ? { wikidata } : {}),
      ...(settlement ? { city: settlement.trim() } : {}),
      ...(country && /^[A-Z]{2}$/.test(country) ? { countryCode: country } : {}),
      ...(site ? { website: site.trim().slice(0, 500) } : {}),
    });
  }
  return candidates;
}

/**
 * Prefer the object that represents the whole place.
 *
 * Only ever used to choose between candidates already proven to be the *same*
 * subject, so this decides representation and never identity. A relation
 * models a site made of many pieces and is the better answer for "the park";
 * a way is the next best; a node is a point someone dropped.
 */
const REPRESENTATION_ORDER = ['r', 'w', 'n'];
const preferRepresentation = (left: ExactPlaceCandidate, right: ExactPlaceCandidate): number => {
  /**
   * Among candidates already proven to be one subject, prefer the record that
   * carries a site. Universal Studios Japan is mapped as a relation and a way;
   * only the relation publishes usj.co.jp, and choosing the other one would
   * canonicalise the same place with nothing for the official-source path to
   * read. Representation order breaks the remaining ties.
   */
  const bySite = Number(Boolean(right.website)) - Number(Boolean(left.website));
  if (bySite !== 0) return bySite;
  return REPRESENTATION_ORDER.indexOf(left.providerPlaceId[0]) - REPRESENTATION_ORDER.indexOf(right.providerPlaceId[0]);
};

/**
 * Which candidate, if any, is the place that was asked for.
 *
 * Two rules, and the second is the one real data forced. Universal Studios
 * Japan is mapped twice — as a relation and as a way — and both publish the
 * same `name:en` and the same Wikidata id. Refusing that as ambiguous would
 * fail closed on a place there is no genuine doubt about, so candidates
 * agreeing on a Wikidata subject are treated as one identity and the fullest
 * representation is chosen.
 *
 * Wikidata is doing identity work here, not similarity work: it is a published
 * claim that two objects describe one subject. Where that claim is absent, two
 * distinct objects sharing a name remain ambiguous and are refused — which is
 * the safe direction, because the cost of guessing is a price quoted for the
 * wrong attraction.
 */
export function selectExactIdentity(
  candidates: readonly ExactPlaceCandidate[],
  wantedName: string,
): ExactPlaceOutcome {
  const wanted = normaliseLookupName(wantedName);
  const examined = candidates.length;
  if (!wanted) return { status: 'missing', examined };

  const matched = candidates.filter((candidate) =>
    candidate.aliases.some((alias) => normaliseLookupName(alias) === wanted));
  if (matched.length === 0) return { status: 'missing', examined };
  if (matched.length === 1) return { status: 'resolved', place: matched[0], examined };

  const subjects = new Set(matched.map((candidate) => candidate.wikidata ?? `unknown:${candidate.providerPlaceId}`));
  if (subjects.size !== 1) return { status: 'ambiguous', examined };

  const [chosen] = [...matched].sort(preferRepresentation);
  return { status: 'resolved', place: chosen, examined };
}

export interface ExactLookupTelemetry {
  hint: string;
  providerRequests: number;
  elapsedMs: number;
  candidates: number;
  aliasSurvivors: number;
  status: ExactPlaceOutcome['status'] | 'timeout';
}

export interface ExactLookupResult {
  outcome: ExactPlaceOutcome | { status: 'timeout'; examined: 0 };
  telemetry: ExactLookupTelemetry;
}

/**
 * One name, one request, one answer.
 *
 * `fetchPayload` is injected so the caller owns the HTTP concern and the
 * timeout, and so this stays exercisable without a network. It is called
 * exactly once: there is deliberately no second attempt, no widening and no
 * city fallback, because every one of those is how the previous version turned
 * a lookup into an outage.
 */
export async function lookupExactPlace(
  hint: string,
  countryCode: string | undefined,
  fetchPayload: (url: string) => Promise<unknown>,
  now: () => number = () => Date.now(),
): Promise<ExactLookupResult> {
  const startedAt = now();
  let payload: unknown;
  try {
    payload = await fetchPayload(exactPlaceLookupUrl(hint, countryCode));
  } catch {
    return {
      outcome: { status: 'timeout', examined: 0 },
      telemetry: { hint, providerRequests: 1, elapsedMs: now() - startedAt, candidates: 0, aliasSurvivors: 0, status: 'timeout' },
    };
  }

  const candidates = parseExactPlaceCandidates(payload);
  const outcome = selectExactIdentity(candidates, hint);
  const wanted = normaliseLookupName(hint);
  const aliasSurvivors = candidates.filter((candidate) =>
    candidate.aliases.some((alias) => normaliseLookupName(alias) === wanted)).length;

  return {
    outcome,
    telemetry: {
      hint,
      providerRequests: 1,
      elapsedMs: now() - startedAt,
      candidates: candidates.length,
      aliasSurvivors,
      status: outcome.status,
    },
  };
}

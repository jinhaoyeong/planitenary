/**
 * Identity lookup, and the budget it has to fit inside.
 *
 * The previous attempt was logically correct and killed the Edge worker: two
 * attractions across four candidate cities became roughly seven full discovery
 * calls. Every test then passed, because every test stubbed `fetch` and so
 * measured behaviour while ignoring cost. These assert the cost too — the call
 * count is as much a requirement as the answer.
 *
 * The fixtures are trimmed copies of what nominatim.openstreetmap.org actually
 * returned when this was benched, including the two things invented data would
 * not have contained: the distractors ranked alongside Tokyo Disneyland, and
 * Universal Studios Japan being mapped twice under one Wikidata subject.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LOOKUP_TIMEOUT_MS,
  MAX_LOOKUPS_PER_ASK,
  MAX_PRICE_HINTS,
  exactPlaceLookupUrl,
  lookupExactPlace,
  parseExactPlaceCandidates,
  selectExactIdentity,
} from '../../supabase/functions/_shared/exactPlaceLookup';

/** As returned for "Tokyo Disneyland": the park, its hotel, its station. */
const DISNEYLAND_PAYLOAD = [
  {
    osm_type: 'way', osm_id: 1282875870, lat: '35.6326586', lon: '139.8814172',
    namedetails: { name: '東京ディズニーランド', 'name:en': 'Tokyo Disneyland' },
    extratags: { wikidata: 'Q843997' },
  },
  {
    osm_type: 'way', osm_id: 218553057, lat: '35.6368248', lon: '139.8782719',
    namedetails: { name: '東京ディズニーランドホテル', 'name:en': 'Tokyo Disneyland Hotel' },
    extratags: { wikidata: 'Q195423' },
  },
  {
    osm_type: 'node', osm_id: 8073893293, lat: '35.6359285', lon: '139.8786741',
    namedetails: { name: '東京ディズニーランド・ステーション', 'name:en': 'Tokyo Disneyland Station' },
    extratags: { wikidata: 'Q5367499' },
  },
];

/** As returned for "Universal Studios Japan": one subject, mapped twice. */
const USJ_PAYLOAD = [
  {
    osm_type: 'relation', osm_id: 5695002, lat: '34.6656393', lon: '135.4324527',
    namedetails: { name: 'ユニバーサル・スタジオ・ジャパン', 'name:en': 'Universal Studios Japan' },
    extratags: { wikidata: 'Q1375103' },
  },
  {
    osm_type: 'way', osm_id: 32560852, lat: '34.6656393', lon: '135.4324527',
    namedetails: { name: 'ユニバーサル・スタジオ・ジャパン', 'name:en': 'Universal Studios Japan' },
    extratags: { wikidata: 'Q1375103' },
  },
];

describe('the request itself stays bounded', () => {
  it('asks for the name details identity needs, in one scoped request', () => {
    const url = exactPlaceLookupUrl('Tokyo Disneyland', 'JP');
    expect(url).toContain('namedetails=1');
    expect(url).toContain('extratags=1');
    expect(url).toContain('countrycodes=jp');
    expect(url).toContain('q=Tokyo+Disneyland');
  });

  it('encodes the name, so it cannot alter the query', () => {
    const url = exactPlaceLookupUrl('Foo & Bar?limit=999', 'JP');
    expect(url).not.toContain('&limit=999');
    expect(url).toContain('limit=8');
  });

  it('omits a country scope it cannot trust rather than sending nonsense', () => {
    expect(exactPlaceLookupUrl('Somewhere', 'not-a-code')).not.toContain('countrycodes');
    expect(exactPlaceLookupUrl('Somewhere', undefined)).not.toContain('countrycodes');
  });

  it('keeps the budget small enough that an Ask cannot fan out', () => {
    expect(MAX_PRICE_HINTS).toBeLessThanOrEqual(2);
    expect(MAX_LOOKUPS_PER_ASK).toBe(MAX_PRICE_HINTS);
    expect(LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('retrieval finds candidates; only an authoritative name accepts one', () => {
  it('bridges an English query to a Japanese-named object through name:en', () => {
    const outcome = selectExactIdentity(parseExactPlaceCandidates(DISNEYLAND_PAYLOAD), 'Tokyo Disneyland');
    expect(outcome.status).toBe('resolved');
    expect(outcome.status === 'resolved' && outcome.place.providerPlaceId).toBe('w1282875870');
  });

  /**
   * The distractors are the point. Nominatim ranks the hotel and the station
   * alongside the park; neither publishes "Tokyo Disneyland" as a name, so
   * neither can be priced as if it were, however highly it ranked.
   */
  it('refuses the hotel and the station that rank alongside the park', () => {
    const candidates = parseExactPlaceCandidates(DISNEYLAND_PAYLOAD);
    expect(candidates).toHaveLength(3);
    const resolved = selectExactIdentity(candidates, 'Tokyo Disneyland');
    expect(resolved.status === 'resolved' && resolved.place.name).toBe('Tokyo Disneyland');
    // And asking for the hotel selects the hotel, never the park.
    const hotel = selectExactIdentity(candidates, 'Tokyo Disneyland Hotel');
    expect(hotel.status === 'resolved' && hotel.place.providerPlaceId).toBe('w218553057');
  });

  /**
   * Real data forced this rule. Universal Studios Japan is mapped as both a
   * relation and a way, both publishing the same name and the same Wikidata
   * subject. Refusing it as ambiguous would fail closed on a place there is no
   * genuine doubt about.
   */
  it('treats one Wikidata subject mapped twice as one identity, not an ambiguity', () => {
    const outcome = selectExactIdentity(parseExactPlaceCandidates(USJ_PAYLOAD), 'Universal Studios Japan');
    expect(outcome.status).toBe('resolved');
    // The relation models the whole site, so it is the better representation.
    expect(outcome.status === 'resolved' && outcome.place.providerPlaceId).toBe('r5695002');
  });

  it('still refuses two different subjects that share a name', () => {
    const rival = [
      { osm_type: 'way', osm_id: 1, namedetails: { name: 'Adventure World' }, extratags: { wikidata: 'Q1' } },
      { osm_type: 'way', osm_id: 2, namedetails: { name: 'Adventure World' }, extratags: { wikidata: 'Q2' } },
    ];
    expect(selectExactIdentity(parseExactPlaceCandidates(rival), 'Adventure World').status).toBe('ambiguous');
  });

  it('refuses two same-named objects when neither claims a subject', () => {
    const rival = [
      { osm_type: 'way', osm_id: 1, namedetails: { name: 'Adventure World' } },
      { osm_type: 'node', osm_id: 2, namedetails: { name: 'Adventure World' } },
    ];
    expect(selectExactIdentity(parseExactPlaceCandidates(rival), 'Adventure World').status).toBe('ambiguous');
  });

  it('refuses a near neighbour that never published the requested name', () => {
    const resort = [{
      osm_type: 'relation', osm_id: 9, namedetails: { name: '東京ディズニーリゾート', 'name:en': 'Tokyo Disney Resort' },
    }];
    expect(selectExactIdentity(parseExactPlaceCandidates(resort), 'Tokyo Disneyland').status).toBe('missing');
  });

  it('reads the semicolon list OSM packs into alt_name', () => {
    const withAlt = [{ osm_type: 'way', osm_id: 4, namedetails: { name: 'X', alt_name: 'USJ;Universal Studios Japan' } }];
    expect(selectExactIdentity(parseExactPlaceCandidates(withAlt), 'Universal Studios Japan').status).toBe('resolved');
  });

  it('ignores rows with no published name at all', () => {
    expect(parseExactPlaceCandidates([{ osm_type: 'way', osm_id: 5 }])).toEqual([]);
    expect(parseExactPlaceCandidates(null)).toEqual([]);
    expect(parseExactPlaceCandidates({ not: 'an array' })).toEqual([]);
  });
});

describe('the cost, which is as much a requirement as the answer', () => {
  const payloadFor = (url: string) => (url.includes('Disneyland') ? DISNEYLAND_PAYLOAD : USJ_PAYLOAD);

  it('spends exactly one provider request per hint', async () => {
    const fetchPayload = vi.fn(async (url: string) => payloadFor(url));
    const result = await lookupExactPlace('Tokyo Disneyland', 'JP', fetchPayload);
    expect(fetchPayload).toHaveBeenCalledTimes(1);
    expect(result.telemetry.providerRequests).toBe(1);
    expect(result.outcome.status).toBe('resolved');
  });

  /**
   * The regression that killed the worker, as an assertion. Four plausible
   * cities used to mean four full discovery calls for one name; the lookup no
   * longer knows what a city is.
   */
  it('does not multiply requests by candidate cities', async () => {
    const fetchPayload = vi.fn(async (url: string) => payloadFor(url));
    for (const hint of ['Tokyo Disneyland', 'Universal Studios Japan']) {
      await lookupExactPlace(hint, 'JP', fetchPayload);
    }
    expect(fetchPayload).toHaveBeenCalledTimes(MAX_LOOKUPS_PER_ASK);
  });

  it('does not retry or widen when the provider fails', async () => {
    const fetchPayload = vi.fn(async () => { throw new Error('aborted'); });
    const result = await lookupExactPlace('Tokyo Disneyland', 'JP', fetchPayload);
    expect(fetchPayload).toHaveBeenCalledTimes(1);
    expect(result.outcome.status).toBe('timeout');
    expect(result.telemetry.status).toBe('timeout');
  });

  it('reports what it examined, so cost is visible rather than inferred', async () => {
    let clock = 1_000;
    const result = await lookupExactPlace(
      'Tokyo Disneyland',
      'JP',
      async () => DISNEYLAND_PAYLOAD,
      () => (clock += 120),
    );
    expect(result.telemetry).toMatchObject({
      hint: 'Tokyo Disneyland',
      providerRequests: 1,
      candidates: 3,
      aliasSurvivors: 1,
      status: 'resolved',
    });
    expect(result.telemetry.elapsedMs).toBeGreaterThan(0);
  });

  it('examines nothing further when the provider returns no candidates', async () => {
    const result = await lookupExactPlace('Nowhere At All', 'JP', async () => []);
    expect(result.outcome.status).toBe('missing');
    expect(result.telemetry.candidates).toBe(0);
    expect(result.telemetry.aliasSurvivors).toBe(0);
  });
});

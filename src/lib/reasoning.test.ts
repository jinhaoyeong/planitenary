/**
 * What the model is allowed to say.
 *
 * Every other suite in this project checks that we read a source correctly.
 * This one checks the opposite direction: that a sentence nobody sourced
 * cannot reach a traveller. The rules under test are mechanical on purpose —
 * a system prompt asking a model not to invent things is a request, and this
 * is the enforcement.
 *
 * The suite never touches the network. `callGemini` takes an injected fetch,
 * so the only thing exercised here is the contract.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BANNED_PHRASES,
  MIN_EXCERPT_CHARS,
  VALIDATOR_VERSION,
  boundSources,
  callGemini,
  callModel,
  MAX_BRIEF_BATCH,
  requestPlaceBriefBatch,
  validateBriefBatch,
  DEFAULT_OPENAI_MODEL,
  isReasoningOperation,
  OPENAI_MAX_OUTPUT_TOKENS,
  openaiModelRefusal,
  REASONING_OPERATIONS,
  countRejections,
  emptyCounters,
  evidenceRevision,
  requestAdmissionRead,
  requestPlaceBrief,
  resolveOfficialAdmission,
  shouldReadAdmission,
  validateAdmissionFares,
  validateBriefSentences,
  MAX_SOURCES,
  MAX_SOURCE_CHARS,
} from '../../supabase/functions/_shared/reasoning';
import { lookupAiBrief } from '../../supabase/functions/_shared/cacheKeys';

const OFFICIAL = 'https://osakacastle.example/en/';
const GUIDE = 'https://guide.example/osaka';

const sources = [
  {
    sourceUrl: OFFICIAL,
    text: 'The main keep was rebuilt in 1931 in ferro-concrete and now houses the castle museum across eight floors.',
  },
  {
    sourceUrl: GUIDE,
    text: 'The surrounding park covers a wide moated precinct and is a well known spot for cherry blossom in spring.',
  },
];

const sentence = (over: Record<string, unknown> = {}) => ({
  text: 'The main keep was rebuilt in ferro-concrete and houses the castle museum.',
  sourceUrl: OFFICIAL,
  excerpt: 'rebuilt in 1931 in ferro-concrete',
  ...over,
});

describe('the rule that makes a brief auditable', () => {
  it('keeps a sentence whose excerpt is literally in the cited source', () => {
    const { sentences, rejected } = validateBriefSentences({ sentences: [sentence()] }, sources);
    expect(sentences).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  /**
   * The core case. A plausible, well-written, entirely unsupported sentence —
   * the failure mode a digit check cannot see and a reader cannot detect.
   */
  it('drops a sentence whose excerpt appears in no supplied source', () => {
    const { sentences, rejected } = validateBriefSentences({
      sentences: [sentence({ excerpt: 'the finest castle interior in all of Kansai' })],
    }, sources);
    expect(sentences).toHaveLength(0);
    expect(rejected[0].reason).toBe('excerpt-not-in-source');
  });

  it('drops a sentence citing a source we never supplied', () => {
    const { rejected } = validateBriefSentences({
      sentences: [sentence({ sourceUrl: 'https://somewhere-else.example/' })],
    }, sources);
    expect(rejected[0].reason).toBe('unknown-source');
  });

  /**
   * An excerpt that is genuinely present in the source but too short to mean
   * anything. Without a floor the substring rule is satisfiable by "the", and
   * the whole guarantee collapses.
   */
  it('refuses an excerpt short enough to be a substring of anything', () => {
    const { rejected } = validateBriefSentences({
      sentences: [sentence({ excerpt: 'the' })],
    }, sources);
    expect(rejected[0].reason).toBe('excerpt-too-short');
    expect('the'.length).toBeLessThan(MIN_EXCERPT_CHARS);
  });

  it('matches an excerpt across reflowed whitespace and casing', () => {
    const { sentences } = validateBriefSentences({
      sentences: [sentence({ excerpt: 'REBUILT   IN 1931\n  in ferro-concrete' })],
    }, sources);
    expect(sentences).toHaveLength(1);
  });

  it('does not accept a paraphrase as a quotation', () => {
    const { rejected } = validateBriefSentences({
      sentences: [sentence({ excerpt: 'rebuilt during 1931 using ferro-concrete' })],
    }, sources);
    expect(rejected[0].reason).toBe('excerpt-not-in-source');
  });

  it('drops a number that appears nowhere in the source', () => {
    const { rejected } = validateBriefSentences({
      sentences: [sentence({ text: 'The keep has 47 floors of exhibits.' })],
    }, sources);
    expect(rejected[0].reason).toBe('invented-number');
  });

  it('keeps a number the source actually states', () => {
    const { sentences } = validateBriefSentences({
      sentences: [sentence({ text: 'The keep was rebuilt in 1931.' })],
    }, sources);
    expect(sentences).toHaveLength(1);
  });

  it.each(BANNED_PHRASES)('rejects brochure phrasing: %s', (phrase) => {
    const { rejected } = validateBriefSentences({
      sentences: [sentence({ text: `The castle museum is ${phrase} for visitors.` })],
    }, sources);
    expect(rejected[0].reason).toBe('marketing-language');
  });

  /**
   * Hours and prices have their own pipeline, their own provenance line and
   * their own currency handling. A brief repeating them can only agree — which
   * is noise — or disagree, which puts two answers to one question on a single
   * card with no way to tell which is current.
   */
  it('refuses to let the brief talk about hours, closures or prices', () => {
    for (const text of [
      'The museum is open daily from the morning.',
      'The keep is closed during the New Year period.',
      'Admission is charged at the gate.',
      'The site runs 09:00–17:00 for visitors.',
    ]) {
      const { rejected } = validateBriefSentences({ sentences: [sentence({ text })] }, sources);
      expect(rejected[0]?.reason, text).toBe('reserved-subject');
    }
  });

  it('drops the bad sentence and keeps the good ones', () => {
    const { sentences, rejected } = validateBriefSentences({
      sentences: [
        sentence(),
        sentence({ excerpt: 'a claim nobody published anywhere at all' }),
        sentence({ sourceUrl: GUIDE, text: 'The park is known for cherry blossom.', excerpt: 'well known spot for cherry blossom' }),
      ],
    }, sources);
    expect(sentences).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it('yields nothing at all when every sentence fails', () => {
    const { sentences } = validateBriefSentences({
      sentences: [sentence({ excerpt: 'invented one' }), sentence({ sourceUrl: 'https://nope.example/' })],
    }, sources);
    expect(sentences).toEqual([]);
  });

  it('survives a response that is not the shape asked for', () => {
    for (const raw of [null, undefined, 42, 'text', {}, { sentences: 'no' }, { sentences: [null, 7] }]) {
      expect(() => validateBriefSentences(raw, sources)).not.toThrow();
      expect(validateBriefSentences(raw, sources).sentences).toEqual([]);
    }
  });
});

describe('fares read from an operator page', () => {
  const pageText = 'Adult admission 600 yen. Students pay 400 yen on presentation of a card.';
  const fare = (over: Record<string, unknown> = {}) => ({
    audience: 'adult', amount: 600, currency: 'JPY',
    excerpt: 'Adult admission 600 yen', ...over,
  });

  it('accepts a fare whose amount and quotation are both on the page', () => {
    const { fares } = validateAdmissionFares({ fares: [fare()] }, { pageText, countryCode: 'JP' });
    expect(fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY' }]);
  });

  it('drops a fare whose amount is nowhere on the page', () => {
    const { fares, rejected } = validateAdmissionFares(
      { fares: [fare({ amount: 950, excerpt: 'Adult admission 600 yen' })] },
      { pageText, countryCode: 'JP' },
    );
    expect(fares).toEqual([]);
    expect(rejected[0].reason).toBe('amount-not-on-page');
  });

  it('drops a fare whose excerpt is not verbatim', () => {
    const { rejected } = validateAdmissionFares(
      { fares: [fare({ excerpt: 'adults are charged six hundred yen' })] },
      { pageText, countryCode: 'JP' },
    );
    expect(rejected[0].reason).toBe('excerpt-not-on-page');
  });

  it('refuses a three-letter string that only looks like a currency', () => {
    const { fares } = validateAdmissionFares(
      { fares: [fare({ currency: 'YEN' })] },
      { pageText, countryCode: 'JP' },
    );
    // Falls back to the country's real currency rather than trusting `YEN`.
    expect(fares[0].currency).toBe('JPY');
  });

  /**
   * A bare number, no symbol, no currency word, no country. This is the case
   * the whole `placeCost` currency discipline exists for — a figure nobody can
   * attach a unit to is not a price, and showing it would be a guess.
   */
  it('refuses a fare it cannot attach a currency to at all', () => {
    const { fares, rejected } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 600, currency: '', excerpt: 'Adult admission 600' }] },
      { pageText: 'Adult admission 600 per person.' },
    );
    expect(fares).toEqual([]);
    expect(rejected[0].reason).toBe('currency-unresolvable');
  });

  /**
   * The counterpart, and the behaviour the argument-order bug was hiding: the
   * excerpt says "yen" in words, so it resolves even with no country to read
   * it against. `resolveCurrency` was always able to do this — it was being
   * called with the country code in the *symbol* slot, so the branch could
   * never resolve anything and this fell through to the country default.
   */
  it('reads a currency the excerpt states in words, with no country at all', () => {
    const { fares } = validateAdmissionFares(
      { fares: [fare({ currency: '' })] },
      { pageText },
    );
    expect(fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY' }]);
  });

  it('drops one bad fare without losing the adult one beside it', () => {
    const { fares } = validateAdmissionFares({
      fares: [fare(), fare({ audience: 'student', amount: 999, excerpt: 'Students pay 400 yen' })],
    }, { pageText, countryCode: 'JP' });
    expect(fares).toHaveLength(1);
    expect(fares[0].audience).toBe('adult');
  });

  /**
   * The case that failed in production and looked like a credential problem.
   *
   * A fare quotation is naturally short — "Adults $10" is ten characters — and
   * the brief's 16-character excerpt floor was being applied to it unchanged.
   * Every ordinary price line on an operator's page was therefore refused,
   * silently, and the empty result cached. The symptom was indistinguishable
   * from the model returning nothing.
   */
  it('accepts a price line as short as operators actually write them', () => {
    const usPage = 'Admission: Adults $10, children free. Open all year.';
    const { fares, rejected } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 10, currency: 'USD', excerpt: 'Adults $10' }] },
      { pageText: usPage, countryCode: 'US' },
    );
    expect(rejected).toEqual([]);
    expect(fares).toEqual([{ audience: 'adult', amount: 10, currency: 'USD' }]);
  });

  /**
   * What replaces the length floor, and it is a stronger rule: the quotation
   * has to contain the figure it is being offered as evidence for. A quotation
   * from elsewhere on the page cannot vouch for this fare.
   */
  it('refuses an excerpt that does not contain the fare it is quoted for', () => {
    const { fares, rejected } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 600, currency: 'JPY', excerpt: 'Open every day of the year' }] },
      { pageText: 'Open every day of the year. Adult admission 600 yen.', countryCode: 'JP' },
    );
    expect(fares).toEqual([]);
    expect(rejected[0].reason).toBe('excerpt-missing-the-amount');
  });

  it('still refuses a bare figure with no context around it', () => {
    const { rejected } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 10, currency: 'USD', excerpt: '$10' }] },
      { pageText: 'Admission: Adults $10, children free.', countryCode: 'US' },
    );
    expect(rejected[0].reason).toBe('excerpt-too-short');
  });

  /**
   * The currency rule the plan actually specified: real ISO code *and* either
   * on the page or the country's. Accepting any code from the country table
   * regardless of context let a model put EUR on a US page.
   */
  it('refuses a currency that is neither on the page nor the country’s', () => {
    const { fares, rejected } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 10, currency: 'EUR', excerpt: 'Adults $10' }] },
      { pageText: 'Admission: Adults $10, children free.', countryCode: 'US' },
    );
    // Falls back to what the page and country can actually support.
    expect(rejected).toEqual([]);
    expect(fares[0].currency).toBe('USD');
  });

  it('accepts a currency the page states outright even when it is not the country’s', () => {
    const { fares } = validateAdmissionFares(
      { fares: [{ audience: 'adult', amount: 20, currency: 'USD', excerpt: 'Entry costs USD 20' }] },
      { pageText: 'Entry costs USD 20 for visitors.', countryCode: 'KH' },
    );
    expect(fares[0].currency).toBe('USD');
  });

  it('matches a grouped figure written without its separator', () => {
    const { fares } = validateAdmissionFares(
      { fares: [fare({ amount: 1500, excerpt: 'General admission is 1,500 yen' })] },
      { pageText: 'General admission is 1,500 yen for adults.', countryCode: 'JP' },
    );
    expect(fares[0].amount).toBe(1500);
  });
});

/**
 * The cache key. The daily cap stops runaway spend; this stops waste — a place
 * the model had nothing to say about must not be asked again tomorrow, and a
 * place whose evidence changed must not keep a description of the old
 * evidence.
 */
describe('deciding when a cached answer is still the right one', () => {
  it('gives the same revision for the same evidence', () => {
    expect(evidenceRevision(sources)).toBe(evidenceRevision([...sources]));
  });

  it('does not churn when the same sources arrive in a different order', () => {
    expect(evidenceRevision(sources)).toBe(evidenceRevision([...sources].reverse()));
  });

  it('changes when a source is added or removed', () => {
    expect(evidenceRevision(sources)).not.toBe(evidenceRevision([sources[0]]));
  });

  /**
   * The case a source *count* would miss: the same page, re-read, now saying
   * something different. The brief describes the old wording and has to go.
   */
  it('changes when the same page comes back with different text', () => {
    const reworded = [{ ...sources[0], text: 'The main keep was rebuilt in 1997 and now houses a gift shop.' }, sources[1]];
    expect(evidenceRevision(sources)).not.toBe(evidenceRevision(reworded));
  });
});

/**
 * The distinction the cache exists for. `lookupAiBrief` returns `undefined`
 * for a miss and `null` for "we asked about exactly this evidence and nothing
 * survived validation". Collapsing the two — by testing truthiness instead of
 * presence — would re-ask the metered provider about every silent place, every
 * day, forever, which is the waste the table was added to stop.
 */
describe('a cached empty answer is still an answer', () => {
  const hits = new Map<string, unknown | null>([
    ['place-a place-brief rev1', null],
    ['place-b place-brief rev1', { sentences: [], sourceCount: 1 }],
  ]);

  it('reports a cached empty answer as a hit, not a miss', () => {
    expect(lookupAiBrief(hits, 'place-a', 'place-brief', 'rev1')).toBeNull();
    expect(lookupAiBrief(hits, 'place-a', 'place-brief', 'rev1')).not.toBeUndefined();
  });

  it('reports a genuine miss as undefined', () => {
    expect(lookupAiBrief(hits, 'place-c', 'place-brief', 'rev1')).toBeUndefined();
  });

  it('treats a different evidence revision as a miss, so the answer is recomputed', () => {
    expect(lookupAiBrief(hits, 'place-a', 'place-brief', 'rev2')).toBeUndefined();
  });

  it('does not let one operation answer for another', () => {
    expect(lookupAiBrief(hits, 'place-a', 'admission-read', 'rev1')).toBeUndefined();
  });
});

/**
 * Which answer wins when the operator's page says a price two ways. The rule
 * is not a preference: a marked-up `Offer` has one meaning, a number found in
 * a paragraph has as many as the paragraph does.
 */
describe('asking the model to read a fare', () => {
  const reply = (body: unknown) => vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }),
  } as never);

  it('returns validated fares when the page backs them', async () => {
    const fetchImpl = reply({ fares: [{ audience: 'adult', amount: 600, currency: 'JPY', excerpt: 'Adult admission 600 yen' }] });
    const { fares } = await requestAdmissionRead(
      { pageText: 'Adult admission 600 yen for the main keep.', countryCode: 'JP' },
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY' }]);
  });

  /**
   * `null`, not an empty array: the caller caches this, and "asked, nothing
   * survived" has to be distinguishable from "did not ask".
   */
  it('returns null when nothing survives validation', async () => {
    const fetchImpl = reply({ fares: [{ audience: 'adult', amount: 9999, currency: 'JPY', excerpt: 'Adult admission 600 yen' }] });
    const { fares, rejections } = await requestAdmissionRead(
      { pageText: 'Adult admission 600 yen for the main keep.', countryCode: 'JP' },
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(fares).toBeNull();
    expect(rejections.map((r) => r.reason)).toEqual(['amount-not-on-page']);
  });

  it('does not call out at all for a page with no text', async () => {
    const fetchImpl = vi.fn();
    const { fares } = await requestAdmissionRead({ pageText: '   ' }, { apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(fares).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('structured pricing outranks anything read from prose', () => {
  const structured = {
    class: 'ticketed',
    fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }],
    source: 'official-website',
    confidence: 'high',
  };
  const readFares = [{ audience: 'adult', amount: 900, currency: 'JPY' }];
  const at = { sourceUrl: 'https://museum.example/', retrievedAt: '2027-04-10T00:00:00.000Z' };

  it('keeps the JSON-LD fare even when the model disagrees', () => {
    const resolved = resolveOfficialAdmission({ structured, readFares, ...at });
    expect(resolved?.fares?.[0].amount).toBe(600);
    expect(resolved?.confidence).toBe('high');
  });

  it('never even asks when structured data already published a fare', () => {
    expect(shouldReadAdmission(structured)).toBe(false);
  });

  it('asks when the page marked up no price at all', () => {
    expect(shouldReadAdmission(undefined)).toBe(true);
    expect(shouldReadAdmission({ class: 'ticketed', fares: [], source: 'official-website', confidence: 'high' })).toBe(true);
  });

  /**
   * The demotion. The price really is on the operator's page, so the source is
   * honest — but a number a model located in prose is weaker evidence than a
   * field designed to be parsed, and the card has to be able to tell them
   * apart.
   */
  it('accepts a model-read fare but marks it as weaker evidence', () => {
    const resolved = resolveOfficialAdmission({ structured: undefined, readFares, ...at });
    expect(resolved?.fares?.[0].amount).toBe(900);
    expect(resolved?.source).toBe('official-website');
    expect(resolved?.confidence).toBe('medium');
  });

  /**
   * `free` carries no `fares` array, so a rule that counted fares treated "the
   * operator declared entry free" the same as "we know nothing". A free
   * municipal museum whose page also lists a guided tour would come back
   * reclassified as ticketed at the tour price.
   */
  it('never lets a prose price override a declared-free place', () => {
    const declaredFree = { class: 'free', source: 'official-website', confidence: 'high' };
    expect(shouldReadAdmission(declaredFree)).toBe(false);
    const resolved = resolveOfficialAdmission({
      structured: declaredFree,
      readFares: [{ audience: 'adult', amount: 800, currency: 'JPY' }],
      ...at,
    });
    expect(resolved).toBe(declaredFree);
  });

  it('changes nothing when the model found no fare', () => {
    expect(resolveOfficialAdmission({ structured: undefined, readFares: null, ...at })).toBeUndefined();
    const feeOnly = { class: 'ticketed', fares: [], source: 'official-website', confidence: 'high' };
    expect(resolveOfficialAdmission({ structured: feeOnly, readFares: null, ...at })).toBe(feeOnly);
  });
});

/**
 * The lesson from the incident, encoded.
 *
 * A validator refusing everything and a provider returning nothing produced
 * the same visible outcome — empty result, cached, no error — so diagnosing it
 * started from a guess. A count without its reason is not observability.
 */
describe('telling a refusal apart from an outage', () => {
  it('records why things were refused, not just how many', () => {
    const counters = emptyCounters();
    countRejections(counters, [
      { reason: 'excerpt-too-short' },
      { reason: 'excerpt-too-short' },
      { reason: 'amount-not-on-page' },
    ]);
    expect(counters.rejectedSentences).toBe(3);
    expect(counters.rejectedReasons).toEqual({ 'excerpt-too-short': 2, 'amount-not-on-page': 1 });
  });

  it('leaves the breakdown empty when a provider simply returned nothing', () => {
    const counters = emptyCounters();
    countRejections(counters, []);
    expect(counters.rejectedSentences).toBe(0);
    expect(counters.rejectedReasons).toEqual({});
  });

  /**
   * A rule change has to invalidate the answers that rule produced. The key is
   * a hash of the *source material*, which a rule change does not alter — so
   * without this, fixing a validator could not reach anything already cached,
   * including every wrongly-empty result.
   */
  it('changes the cache key when the validation rules change', () => {
    expect(evidenceRevision(sources)).toContain(VALIDATOR_VERSION);
  });
});

describe('what may be sent, and what a failure costs', () => {
  it('enforces the source and size ceilings before anything is sent', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      sourceUrl: `https://example.com/${i}`,
      text: 'x'.repeat(MAX_SOURCE_CHARS * 2),
    }));
    const bounded = boundSources(many);
    expect(bounded).toHaveLength(MAX_SOURCES);
    expect(bounded.every((s) => s.text.length <= MAX_SOURCE_CHARS)).toBe(true);
  });

  it('makes exactly one attempt and never retries a metered call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as never);
    const result = await callGemini('place-brief', {}, { apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown request as a missing brief rather than an error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    await expect(callGemini('place-brief', {}, { apiKey: 'k', fetchImpl: fetchImpl as never }))
      .resolves.toBeUndefined();
  });

  it('returns no brief when every sentence is rejected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ sentences: [sentence({ excerpt: 'not in any source text' })] }) }] } }],
      }),
    } as never);
    const result = await requestPlaceBrief(
      { name: 'Osaka Castle Museum', city: 'Osaka', categories: ['museum'] },
      sources,
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(result.brief).toBeUndefined();
    expect(result.rejections).toHaveLength(1);
  });

  it('counts the distinct sources a surviving brief rests on', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ sentences: [
          sentence(),
          sentence({ sourceUrl: GUIDE, text: 'The park is a cherry blossom spot.', excerpt: 'well known spot for cherry blossom' }),
        ] }) }] } }],
      }),
    } as never);
    const result = await requestPlaceBrief(
      { name: 'Osaka Castle Museum', city: 'Osaka', categories: ['museum'] },
      sources,
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(result.brief?.sourceCount).toBe(2);
  });

  it('asks for no brief at all when there are no sources to ground one in', async () => {
    const fetchImpl = vi.fn();
    const result = await requestPlaceBrief(
      { name: 'Nowhere', city: 'Osaka', categories: [] },
      [],
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(result.brief).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * Which vendor gets called, and what is sent to it.
 *
 * These are cheap tests for an expensive mistake. The two providers disagree
 * about everything that matters at the wire — where the request goes, how the
 * credential is carried, where the text comes back — so a wrong `provider`
 * does not degrade, it fails outright. And an accidental failover would spend
 * real money at the vendor nobody selected, which is the failure this project
 * was rebuilt around.
 */
describe('model provider selection', () => {
  const okOpenAi = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  it('sends an OpenAI request to OpenAI, with the key as a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('{"ok":true}') as never);
    const result = await callModel('place-brief', { a: 1 }, {
      apiKey: 'sk-test', provider: 'openai', model: 'gpt-5-nano', fetchImpl: fetchImpl as never,
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    // The key must never travel as a query parameter, where it would be logged
    // by every proxy between here and the provider.
    expect(String(url)).not.toContain('sk-test');
    expect(JSON.parse(init.body as string).model).toBe('gpt-5-nano');
  });

  /**
   * The accepted values differ per model — `gpt-5-nano` rejects `none` while
   * `gpt-5.4-nano` defaults to it — so an unset effort must be *absent*, not
   * defaulted to a guess. A wrong value is an opaque 400 from the provider.
   */
  it('omits reasoning_effort entirely when none was configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('{}') as never);
    await callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).not.toHaveProperty('reasoning_effort');
  });

  it('passes reasoning_effort through when one was configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('{}') as never);
    await callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', reasoningEffort: 'minimal', fetchImpl: fetchImpl as never,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).reasoning_effort).toBe('minimal');
  });

  /**
   * `response_format: json_object` is a request, in the same way a system
   * prompt is. A model that wraps its JSON in a markdown fence anyway must not
   * cost us the answer — retrying is forbidden here, so the parse has to cope.
   */
  it('reads JSON back out of a fenced OpenAI reply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('```json\n{"sentences":[]}\n```') as never);
    await expect(callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never,
    })).resolves.toEqual({ sentences: [] });
  });

  it('treats an unparseable OpenAI reply as a missing answer, not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi('sorry, I cannot help with that') as never);
    await expect(callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never,
    })).resolves.toBeUndefined();
  });

  it('treats an OpenAI error response as a missing answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as never);
    await expect(callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never,
    })).resolves.toBeUndefined();
  });

  /**
   * The whole point of having no `'auto'`. A failing OpenAI call must return
   * nothing — never reach for Gemini, which would turn an outage or an
   * exhausted budget into spending at a vendor the deployment did not choose.
   */
  it('does not fall back to the other provider when the selected one fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as never);
    await callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('googleapis');
  });

  it('sends a Gemini request to Gemini, with the key in a header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }),
    } as never);
    await callModel('place-brief', {}, {
      apiKey: 'g-key', provider: 'gemini', fetchImpl: fetchImpl as never,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
  });

  /** The compatibility alias must keep meaning Gemini, whatever the default is. */
  it('keeps callGemini pinned to Gemini', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
    } as never);
    await callGemini('place-brief', {}, { apiKey: 'k', fetchImpl: fetchImpl as never });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('generativelanguage.googleapis.com');
  });

  /** Grounding is provider-independent: the same rules, whoever answered. */
  it('validates an OpenAI brief against the same substring rule', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okOpenAi(JSON.stringify({
      sentences: [sentence(), sentence({ excerpt: 'a phrase that appears in no supplied source' })],
    })) as never);
    const result = await requestPlaceBrief(
      { name: 'Osaka Castle Museum', city: 'Osaka', categories: ['museum'] },
      sources,
      { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never },
    );
    expect(result.brief?.sentences).toHaveLength(1);
    expect(result.rejections).toContainEqual({
      text: expect.any(String), reason: 'excerpt-not-in-source',
    });
  });
});

/**
 * The model allowlist.
 *
 * The call limit protects the *number* of requests; this protects what each
 * one costs. They are not interchangeable: swapping the model for a frontier
 * tier leaves the call count untouched while multiplying the bill per call,
 * which makes this the only guard standing between a one-line config edit and
 * a genuinely expensive mistake.
 *
 * These rules live in `reasoning.ts` rather than beside the env lookups in
 * `providers.ts` precisely so this suite can reach them — that module imports
 * `Deno` and vitest cannot load it.
 */
describe('model allowlist', () => {
  it('defaults to the cheapest approved model', () => {
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-5-nano');
    for (const operation of REASONING_OPERATIONS) {
      expect(openaiModelRefusal(operation, DEFAULT_OPENAI_MODEL)).toBeUndefined();
    }
  });

  it.each(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.4-nano'])(
    'refuses %s, which is not approved for any operation yet',
    (model) => {
      for (const operation of REASONING_OPERATIONS) {
        expect(openaiModelRefusal(operation, model)).toContain('not approved');
      }
    },
  );

  it('refuses a model name it has never heard of', () => {
    expect(openaiModelRefusal('place-brief', 'totally-made-up')).toContain('not approved');
  });

  /**
   * The refusal has to name both halves. "Model not allowed" sends someone to
   * read the source; naming what was set and what is permitted does not.
   */
  it('names the offending model and the allowed set', () => {
    const refusal = openaiModelRefusal('candidate-intelligence', 'gpt-5.6-sol');
    expect(refusal).toContain('gpt-5.6-sol');
    expect(refusal).toContain('gpt-5-nano');
    expect(refusal).toContain('candidate-intelligence');
  });

  /**
   * The single most important property here. A silent downgrade to nano would
   * make a deployment that asked for an expensive model indistinguishable from
   * one that chose the cheap one deliberately — so the mistake pointing the
   * *other* way, at a model nobody meant to pay for, would also be invisible.
   */
  it('never corrects a refused model to the default', () => {
    expect(openaiModelRefusal('place-brief', 'gpt-5.6-sol')).toBeDefined();
    // The refusal is a string to report, not a substituted model name.
    expect(openaiModelRefusal('place-brief', 'gpt-5.6-sol')).not.toBe(DEFAULT_OPENAI_MODEL);
  });

  it('rejects an operation that is not on the allowlist', () => {
    expect(isReasoningOperation('place-brief')).toBe(true);
    expect(isReasoningOperation('anything-i-want')).toBe(false);
    expect(isReasoningOperation('')).toBe(false);
    expect(isReasoningOperation(undefined)).toBe(false);
    expect(isReasoningOperation({ toString: () => 'place-brief' })).toBe(false);
  });

  /** Every operation must have a ceiling; a missing one would read as no cap. */
  it('bounds the output of every operation', () => {
    for (const operation of REASONING_OPERATIONS) {
      expect(OPENAI_MAX_OUTPUT_TOKENS[operation]).toBeGreaterThan(0);
      expect(OPENAI_MAX_OUTPUT_TOKENS[operation]).toBeLessThanOrEqual(2_000);
    }
  });

  it('caps the reply when a ceiling is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    } as never);
    await callModel('place-brief', {}, {
      apiKey: 'k', provider: 'openai', maxOutputTokens: 1_200, fetchImpl: fetchImpl as never,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    // `max_completion_tokens`, not `max_tokens`: the GPT-5 generation rejects
    // the older name, and counts reasoning tokens against the reply too.
    expect(body.max_completion_tokens).toBe(1_200);
    expect(body).not.toHaveProperty('max_tokens');
  });
});

/**
 * Batched briefs.
 *
 * Batching is a transport optimisation and must not become a correctness
 * change. These tests hold that line: identity is carried rather than
 * positional, one bad entry costs only itself, and a place can never be
 * grounded in another place's sources merely because they shared a request.
 *
 * The mis-attribution case is worth the most. A wrong answer cached under the
 * right key is permanent and invisible, because every later lookup is a hit.
 */
describe('batched place briefs', () => {
  const CASTLE = 'https://castle.example/';
  const SHRINE = 'https://shrine.example/';

  const items = [
    {
      candidateId: 'place-castle',
      evidenceRevision: 'rev-castle',
      place: { name: 'Osaka Castle Museum', city: 'Osaka', categories: ['museum'] },
      sources: [{ sourceUrl: CASTLE, text: 'The main keep was rebuilt in 1931 in ferro-concrete and houses a museum.' }],
    },
    {
      candidateId: 'place-shrine',
      evidenceRevision: 'rev-shrine',
      place: { name: 'Ebisu Shrine', city: 'Osaka', categories: ['shrine'] },
      sources: [{ sourceUrl: SHRINE, text: 'The shrine holds a January festival that draws large crowds each year.' }],
    },
  ];

  const reply = (places: Record<string, unknown>) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ places }) } }] }),
  });

  const castleSentence = {
    text: 'The keep houses a museum.',
    sourceUrl: CASTLE,
    excerpt: 'rebuilt in 1931 in ferro-concrete',
  };

  it('returns one independently validated brief per place from a single call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-castle': { evidenceRevision: 'rev-castle', sentences: [castleSentence] },
      'place-shrine': {
        evidenceRevision: 'rev-shrine',
        sentences: [{ text: 'A January festival draws crowds.', sourceUrl: SHRINE, excerpt: 'January festival that draws large crowds' }],
      },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    // The whole point: two places, one provider request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.briefs.get('place-castle')?.sentences).toHaveLength(1);
    expect(result.briefs.get('place-shrine')?.sentences).toHaveLength(1);
  });

  /**
   * The expensive mistake this design exists to prevent. Both texts were in
   * the same request, so nothing but per-place source scoping stops a sentence
   * about the castle being cached against the shrine — where it would then be
   * served as a cache hit for as long as the evidence is unchanged.
   */
  it('refuses a sentence grounded in another place from the same batch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-shrine': { evidenceRevision: 'rev-shrine', sentences: [castleSentence] },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    expect(result.briefs.get('place-shrine')).toBeNull();
    // Sentence-level rejections carry the offending text alongside the reason.
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'unknown-source' }));
  });

  it('keeps the good entries when one place in the batch is invalid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-castle': { evidenceRevision: 'rev-castle', sentences: [castleSentence] },
      'place-shrine': {
        evidenceRevision: 'rev-shrine',
        sentences: [{ text: 'A wholly invented claim.', sourceUrl: SHRINE, excerpt: 'no such text appears here at all' }],
      },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    expect(result.briefs.get('place-castle')?.sentences).toHaveLength(1);
    expect(result.briefs.get('place-shrine')).toBeNull();
  });

  /**
   * A revision that does not match is an answer about evidence other than what
   * it would be filed under — a stale cache entry created at write time rather
   * than drifting into one.
   */
  it('discards an answer whose evidenceRevision does not match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-castle': { evidenceRevision: 'some-other-revision', sentences: [castleSentence] },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    expect(result.briefs.get('place-castle')).toBeNull();
    expect(result.rejections).toContainEqual({ reason: 'revision-mismatch' });
  });

  it('ignores a place nobody asked about', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-invented': { evidenceRevision: 'x', sentences: [] },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    expect(result.briefs.has('place-invented')).toBe(false);
    expect(result.rejections).toContainEqual({ reason: 'unknown-candidate' });
  });

  /**
   * We paid for the call, so an unanswered place is an answer: nothing
   * survived, from this exact evidence. Caching it stops the place being
   * re-asked every day forever — the reasoning the single-place path already
   * uses for its own null.
   */
  it('records an omitted place as a cacheable empty answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({
      'place-castle': { evidenceRevision: 'rev-castle', sentences: [castleSentence] },
    }) as never);

    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    expect(result.briefs.has('place-shrine')).toBe(true);
    expect(result.briefs.get('place-shrine')).toBeNull();
  });

  it('never sends more than the batch ceiling in one request', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...items[0], candidateId: `place-${index}`, evidenceRevision: `rev-${index}`,
    }));
    const fetchImpl = vi.fn().mockResolvedValue(reply({}) as never);

    await requestPlaceBriefBatch(many, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });

    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    const payload = JSON.parse(sent.messages[1].content.split('Source-backed input:\n')[1]);
    expect(payload.places).toHaveLength(MAX_BRIEF_BATCH);
  });

  it('spends nothing when no place in the batch has sources to quote', async () => {
    const fetchImpl = vi.fn();
    const result = await requestPlaceBriefBatch(
      [{ ...items[0], sources: [] }],
      { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.briefs.size).toBe(0);
  });

  it('loses the batch, not the cache, when the reply is unparseable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as never);
    const result = await requestPlaceBriefBatch(items, { apiKey: 'k', provider: 'openai', fetchImpl: fetchImpl as never });
    // Every place recorded as empty rather than left ambiguous.
    expect(result.briefs.get('place-castle')).toBeNull();
    expect(result.briefs.get('place-shrine')).toBeNull();
  });

  /** The validator is reachable without the network, and judged on its own. */
  it('validates a batch payload directly', () => {
    const result = validateBriefBatch(
      { places: { 'place-castle': { evidenceRevision: 'rev-castle', sentences: [castleSentence] } } },
      items,
    );
    expect(result.briefs.get('place-castle')?.sourceCount).toBe(1);
    expect(result.briefs.get('place-shrine')).toBeNull();
  });
});

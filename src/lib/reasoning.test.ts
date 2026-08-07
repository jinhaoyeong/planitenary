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
  boundSources,
  callGemini,
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

  it('refuses a fare it cannot attach a currency to at all', () => {
    const { fares, rejected } = validateAdmissionFares(
      { fares: [fare({ currency: '' })] },
      { pageText },
    );
    expect(fares).toEqual([]);
    expect(rejected[0].reason).toBe('currency-unresolvable');
  });

  it('drops one bad fare without losing the adult one beside it', () => {
    const { fares } = validateAdmissionFares({
      fares: [fare(), fare({ audience: 'student', amount: 999, excerpt: 'Students pay 400 yen' })],
    }, { pageText, countryCode: 'JP' });
    expect(fares).toHaveLength(1);
    expect(fares[0].audience).toBe('adult');
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
    const { fares, rejected } = await requestAdmissionRead(
      { pageText: 'Adult admission 600 yen for the main keep.', countryCode: 'JP' },
      { apiKey: 'k', fetchImpl: fetchImpl as never },
    );
    expect(fares).toBeNull();
    expect(rejected).toBe(1);
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

  it('changes nothing when the model found no fare', () => {
    expect(resolveOfficialAdmission({ structured: undefined, readFares: null, ...at })).toBeUndefined();
    const feeOnly = { class: 'ticketed', fares: [], source: 'official-website', confidence: 'high' };
    expect(resolveOfficialAdmission({ structured: feeOnly, readFares: null, ...at })).toBe(feeOnly);
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
    expect(result.rejected).toBe(1);
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

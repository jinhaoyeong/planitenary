import { describe, expect, it, vi } from 'vitest';
import {
  extractAdmissionPlaceHints,
  researchAskAdmissionPrices,
  type TrustedPlaceHintResolution,
} from '../../supabase/functions/_shared/askPriceResearch';
import { isAskPriceQuestion } from '../../supabase/functions/_shared/askGrounding';

const fare = (name: string, amount: number, sourceUrl: string) => ({
  name,
  admission: {
    fares: [{ audience: 'adult', amount, currency: 'JPY' }],
    source: 'official-website',
    sourceUrl,
    retrievedAt: '2026-08-21T00:00:00.000Z',
  },
});

const missing = (hint: string): TrustedPlaceHintResolution => ({ hint, status: 'missing' });

const telemetry = (hint: string, status: 'resolved' | 'ambiguous' | 'missing' | 'timeout') => ({
  hint, providerRequests: 1, elapsedMs: 12, candidates: status === 'resolved' ? 3 : 0,
  aliasSurvivors: status === 'resolved' ? 1 : 0, status,
});

/** One bounded lookup per name, as the Edge budget requires. */
const lookupStub = (found: Record<string, { id: string; city?: string }>, log?: string[]) =>
  vi.fn(async (hint: string) => {
    log?.push(`lookup:${hint}`);
    const place = found[hint];
    return place
      ? { status: 'resolved' as const, place: { id: place.id, name: hint, city: place.city }, telemetry: telemetry(hint, 'resolved') }
      : { status: 'missing' as const, telemetry: telemetry(hint, 'missing') };
  });

describe('server-owned Ask admission research', () => {
  it('extracts a single named attraction and researches it before any model exists', async () => {
    const events: string[] = [];
    const result = await researchAskAdmissionPrices({
      question: 'How much is Tokyo Disneyland?',
      tripCities: ['Osaka'],
    }, {
      resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
      lookupExactPlaceByName: lookupStub({ 'Tokyo Disneyland': { id: 'google:tdl', city: 'Tokyo' } }, events),
      researchAdmissionPrices: vi.fn(async (ids) => {
        events.push(`fare:${ids.join(',')}`);
        return { ok: true as const, result: { places: [fare('Tokyo Disneyland', 10_900, 'https://www.tokyodisneyresort.jp/en/ticket/')] } };
      }),
    });

    expect(extractAdmissionPlaceHints('How much is Tokyo Disneyland?')).toEqual(['Tokyo Disneyland']);
    expect(events).toEqual(['lookup:Tokyo Disneyland', 'fare:google:tdl']);
    expect(result.priceFacts).toHaveLength(1);
  });

  it('resolves Tokyo Disneyland and USJ independently instead of sharing one trip city', async () => {
    const lookupExactPlaceByName = lookupStub({
      'Tokyo Disneyland': { id: 'google:tdl', city: 'Tokyo' },
      'Universal Studios Japan': { id: 'google:usj', city: 'Osaka' },
    });
    const resolveTrustedPlaceHints = ([hint]: string[]): TrustedPlaceHintResolution[] => [missing(hint)];
    const researchAdmissionPrices = vi.fn(async () => ({
      ok: true as const,
      result: { places: [
        fare('Tokyo Disneyland', 10_900, 'https://www.tokyodisneyresort.jp/en/ticket/'),
        fare('Universal Studios Japan', 8_600, 'https://www.usj.co.jp/web/en/us/tickets'),
      ] },
    }));

    const result = await researchAskAdmissionPrices({
      question: 'How much are Tokyo Disneyland and Universal Studios Japan tickets?',
      tripCities: ['Osaka', 'Kyoto', 'Nara'],
    }, { resolveTrustedPlaceHints, lookupExactPlaceByName, researchAdmissionPrices });

    expect(extractAdmissionPlaceHints('How much are Tokyo Disneyland and Universal Studios Japan tickets?'))
      .toEqual(['Tokyo Disneyland', 'Universal Studios Japan']);
    // One bounded lookup per attraction, and no city fan-out: the lookup does
    // not take a city at all, which is what keeps this inside one invocation.
    expect(lookupExactPlaceByName).toHaveBeenCalledTimes(2);
    expect(lookupExactPlaceByName).toHaveBeenCalledWith('Tokyo Disneyland');
    expect(lookupExactPlaceByName).toHaveBeenCalledWith('Universal Studios Japan');
    expect(result.lookups.every((entry) => entry.providerRequests === 1)).toBe(true);
    expect(researchAdmissionPrices).toHaveBeenCalledWith(['google:tdl', 'google:usj']);
    expect(result.trace.map((entry) => [entry.hint, entry.resolvedCity])).toEqual([
      ['Tokyo Disneyland', 'Tokyo'],
      ['Universal Studios Japan', 'Osaka'],
    ]);
    expect(result.priceFacts.map((fact) => fact.name)).toEqual([
      'Tokyo Disneyland',
      'Universal Studios Japan',
    ]);
  });

  it('retains one verified fare when the other official lookup is unavailable', async () => {
    const resolveTrustedPlaceHints = (hints: string[]): TrustedPlaceHintResolution[] => hints.map((hint, index) => ({
      hint,
      status: 'resolved',
      place: { id: index === 0 ? 'google:tdl' : 'google:usj', name: hint },
    }));
    const result = await researchAskAdmissionPrices({
      question: 'How much are Tokyo Disneyland and Universal Studios Japan tickets?',
      tripCities: ['Osaka'],
    }, {
      resolveTrustedPlaceHints,
      lookupExactPlaceByName: vi.fn(),
      researchAdmissionPrices: vi.fn(async () => ({
        ok: true as const,
        result: { places: [
          fare('Tokyo Disneyland', 10_900, 'https://www.tokyodisneyresort.jp/en/ticket/'),
          { id: 'google:usj', name: 'Universal Studios Japan', status: 'unavailable', note: 'No official source.' },
        ] },
      })),
    });

    expect(result.priceFacts.map((fact) => fact.name)).toEqual(['Tokyo Disneyland']);
    expect(result.findings.at(-1)).toMatchObject({ tool: 'get_admission_prices', ok: true });
  });

  it('does the research even if a future model would emit zero tool calls or refuse tools', async () => {
    const researchAdmissionPrices = vi.fn(async () => ({
      ok: true as const,
      result: { places: [fare('Tokyo Disneyland', 10_900, 'https://www.tokyodisneyresort.jp/en/ticket/')] },
    }));
    const result = await researchAskAdmissionPrices({
      question: 'How much is Tokyo Disneyland?',
      tripCities: ['Tokyo'],
    }, {
      resolveTrustedPlaceHints: ([hint]) => [{
        hint,
        status: 'resolved',
        place: { id: 'google:tdl', name: hint, city: 'Tokyo' },
      }],
      lookupExactPlaceByName: vi.fn(),
      researchAdmissionPrices,
    });

    expect(researchAdmissionPrices).toHaveBeenCalledTimes(1);
    expect(result.priceFacts).toHaveLength(1);
  });

  it('fails closed on an ambiguous exact name without researching an invented identity', async () => {
    const researchAdmissionPrices = vi.fn();
    const result = await researchAskAdmissionPrices({
      question: 'How much is Adventure World?',
      tripCities: ['Osaka'],
    }, {
      resolveTrustedPlaceHints: ([hint]) => [{ hint, status: 'ambiguous' }],
      lookupExactPlaceByName: vi.fn(),
      researchAdmissionPrices,
    });

    expect(result.priceFacts).toEqual([]);
    expect(result.unresolved).toEqual(['Adventure World']);
    expect(researchAdmissionPrices).not.toHaveBeenCalled();
  });

  it('does not classify ordinary Ask or affordability questions as fare research', () => {
    expect(isAskPriceQuestion('What should I do after lunch?')).toBe(false);
    expect(isAskPriceQuestion('Can I afford both with my remaining budget?')).toBe(false);
    expect(isAskPriceQuestion('How much are the tickets?')).toBe(true);
  });

  it('reuses signed recent-place aliases for a selected-currency follow-up without searching', async () => {
    const lookupExactPlaceByName = vi.fn();
    const researchAdmissionPrices = vi.fn(async () => ({
      ok: true as const,
      result: { places: [
        fare('Tokyo Disneyland', 10_900, 'https://www.tokyodisneyresort.jp/en/ticket/'),
        fare('Universal Studios Japan', 8_600, 'https://www.usj.co.jp/web/en/us/tickets'),
      ] },
    }));
    await researchAskAdmissionPrices({
      question: 'How much are both in my selected currency?',
      tripCities: ['Osaka'],
      recentPlaces: [
        { alias: 'recent-place-1', name: 'Tokyo Disneyland', city: 'Tokyo' },
        { alias: 'recent-place-2', name: 'Universal Studios Japan', city: 'Osaka' },
      ],
    }, {
      resolveTrustedPlaceHints: vi.fn(),
      lookupExactPlaceByName,
      researchAdmissionPrices,
    });

    expect(lookupExactPlaceByName).not.toHaveBeenCalled();
    expect(researchAdmissionPrices).toHaveBeenCalledWith(['recent-place-1', 'recent-place-2']);
  });
});

/**
 * Why a fare is missing, visible from production.
 *
 * Four different failures were arriving as one symptom — `priceFacts: 0` — so
 * the only way to tell "the page could not be read" from "the operator
 * publishes no machine-readable fare" was to guess. These assert that each
 * outcome survives all the way to something an operator can read, while the
 * traveller still sees the same fail-closed sentence.
 */
describe('per-attraction research outcomes are observable', () => {
  const lookupTwo = () => lookupStub({
    'Tokyo Disneyland': { id: 'osm-w1', city: 'Urayasu' },
    'Universal Studios Japan': { id: 'osm-r2', city: 'Osaka' },
  });

  const researchWith = (places: unknown[]) => researchAskAdmissionPrices({
    question: 'How much are Tokyo Disneyland and Universal Studios Japan tickets?',
    tripCities: ['Osaka'],
  }, {
    resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
    lookupExactPlaceByName: lookupTwo(),
    researchAdmissionPrices: vi.fn(async () => ({ ok: true as const, result: { places } })),
  });

  it('reports a verified fare with its source', async () => {
    const result = await researchWith([{
      name: 'Tokyo Disneyland', status: 'verified', fetched: true, documentCount: 2,
      attemptedUrl: 'https://www.tokyodisneyresort.jp/tdl/',
      sourceUrl: 'https://www.tokyodisneyresort.jp/tdl/ticket/',
      admission: { fares: [{ audience: 'adult', amount: 10_900, currency: 'JPY' }], source: 'official-website', sourceUrl: 'https://www.tokyodisneyresort.jp/tdl/ticket/', retrievedAt: '2026-08-22T00:00:00.000Z' },
      note: 'Admission evidence was read from the operator source.',
    }]);
    expect(result.admissions[0]).toMatchObject({ status: 'verified', fetched: true, documentCount: 2 });
    expect(result.admissions[0].sourceUrl).toContain('tokyodisneyresort.jp');
  });

  /** The page was read; the operator simply published nothing machine-readable. */
  it('distinguishes a page that was read but published no fare', async () => {
    const result = await researchWith([{
      name: 'Universal Studios Japan', status: 'no-price', fetched: true, documentCount: 0,
      attemptedUrl: 'https://www.usj.co.jp/',
      note: 'The current official fare could not be verified from the operator source.',
    }]);
    expect(result.admissions[0]).toMatchObject({ status: 'no-price', fetched: true, documentCount: 0 });
    expect(result.admissions[0].attemptedUrl).toBe('https://www.usj.co.jp/');
    expect(result.priceFacts).toEqual([]);
  });

  /** A page that could not be read is not evidence that there is no fare. */
  it('distinguishes a page that could not be read at all', async () => {
    const result = await researchWith([{
      name: 'Tokyo Disneyland', status: 'fetch-error', fetched: false, documentCount: 0,
      attemptedUrl: 'https://www.tokyodisneyresort.jp/tdl/',
      note: 'The operator page could not be read this run.',
    }]);
    expect(result.admissions[0]).toMatchObject({ status: 'fetch-error', fetched: false });
  });

  it('distinguishes no stored source from a rejected one', async () => {
    const none = await researchWith([{ name: 'A', status: 'unavailable', fetched: false, note: 'No safe official website is stored.' }]);
    expect(none.admissions[0].status).toBe('unavailable');
    const reseller = await researchWith([{ name: 'B', status: 'rejected-source', fetched: false, attemptedUrl: 'https://tickets.example/resell', note: 'reseller domain' }]);
    expect(reseller.admissions[0]).toMatchObject({ status: 'rejected-source', attemptedUrl: 'https://tickets.example/resell' });
  });

  it('keeps two attractions’ outcomes independent', async () => {
    const result = await researchWith([
      { name: 'Tokyo Disneyland', status: 'no-price', fetched: true, documentCount: 0 },
      { name: 'Universal Studios Japan', status: 'fetch-error', fetched: false, documentCount: 0 },
    ]);
    expect(result.admissions.map((entry) => `${entry.name}:${entry.status}`))
      .toEqual(['Tokyo Disneyland:no-price', 'Universal Studios Japan:fetch-error']);
  });

  /** The whole point: observable even though the traveller gets nothing. */
  it('is present when priceFacts is empty', async () => {
    const result = await researchWith([{ name: 'A', status: 'no-price', fetched: true, documentCount: 0 }]);
    expect(result.priceFacts).toEqual([]);
    expect(result.admissions).toHaveLength(1);
  });

  it('is empty rather than absent when no identity was resolved', async () => {
    const result = await researchAskAdmissionPrices({
      question: 'How much is Somewhere Unfindable?',
      tripCities: ['Osaka'],
    }, {
      resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
      lookupExactPlaceByName: lookupStub({}),
      researchAdmissionPrices: vi.fn(),
    });
    expect(result.admissions).toEqual([]);
  });

  it('bounds what it reports and never carries a payload', async () => {
    const result = await researchWith([{
      name: 'x'.repeat(500), status: 'no-price', note: 'y'.repeat(500),
      attemptedUrl: 'https://example.test/' + 'z'.repeat(500),
      html: '<html>enormous</html>',
    }]);
    expect(result.admissions[0].name.length).toBeLessThanOrEqual(120);
    expect(result.admissions[0].note!.length).toBeLessThanOrEqual(200);
    expect(result.admissions[0].attemptedUrl!.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(result.admissions)).not.toContain('enormous');
  });
});

/**
 * The two failures that looked alike, told apart.
 *
 * `fetch-error` collapsed every unreadable page into one word, and the
 * probe-cache branch reported `fetched: true` meaning "was checked", which
 * read as "read just now" and hid that today's outcome is unknown. Both cost
 * a diagnostic round to notice.
 */
describe('an unreadable page and an unread one are different answers', () => {
  const research = (places: unknown[]) => researchAskAdmissionPrices({
    question: 'How much is Tokyo Disneyland?',
    tripCities: ['Osaka'],
  }, {
    resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
    lookupExactPlaceByName: lookupStub({ 'Tokyo Disneyland': { id: 'osm-w1', city: 'Urayasu' } }),
    researchAdmissionPrices: vi.fn(async () => ({ ok: true as const, result: { places } })),
  });

  it('carries the reason a page could not be read', async () => {
    const result = await research([{
      name: 'Tokyo Disneyland', status: 'fetch-error', fetched: false, documentCount: 0,
      attemptedUrl: 'https://www.tokyodisneyresort.jp/tdl/',
      note: 'The operator page could not be read this run (http-403), so no fare could be established either way.',
    }]);
    expect(result.admissions[0].status).toBe('fetch-error');
    expect(result.admissions[0].note).toContain('http-403');
  });

  /** A suppressed re-fetch is not a finding about the operator. */
  it('reports a suppressed re-read as probe-cached, not as no-price', async () => {
    const result = await research([{
      name: 'Universal Studios Japan', status: 'probe-cached', fetched: false, documentCount: 0,
      attemptedUrl: 'https://www.usj.co.jp/',
      note: 'A previous run checked this source within the freshness window and found no fare; it was not re-read.',
    }]);
    expect(result.admissions[0].status).toBe('probe-cached');
    // The distinction that matters: nothing was read now.
    expect(result.admissions[0].fetched).toBe(false);
    expect(result.admissions[0].status).not.toBe('no-price');
  });

  it('still reports a genuine no-price as a fact about the operator', async () => {
    const result = await research([{
      name: 'Somewhere', status: 'no-price', fetched: true, documentCount: 3,
      attemptedUrl: 'https://example.test/',
    }]);
    expect(result.admissions[0]).toMatchObject({ status: 'no-price', fetched: true, documentCount: 3 });
  });
});

/**
 * Where to look, when we could not look ourselves.
 *
 * Two of the biggest attractions in Japan cannot be read by a server fetch at
 * all: tokyodisneyresort.jp does not answer one, and usj.co.jp returns a
 * JavaScript shell with no fare in the HTML. Neither is a bug to fix, and
 * inventing a number for them is the one thing this app must never do — so the
 * useful, honest answer is the operator's own address.
 */
describe('offering the operator’s own page when no fare could be verified', () => {
  const research = (places: unknown[]) => researchAskAdmissionPrices({
    question: 'How much is Universal Studios Japan?',
    tripCities: ['Osaka'],
  }, {
    resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
    lookupExactPlaceByName: lookupStub({ 'Universal Studios Japan': { id: 'osm-r1', city: 'Osaka' } }),
    researchAdmissionPrices: vi.fn(async () => ({ ok: true as const, result: { places } })),
  });

  it('offers the site when the page could not be read', async () => {
    const result = await research([{
      name: 'Universal Studios Japan', status: 'fetch-error', fetched: false,
      officialUrl: 'https://www.usj.co.jp/', attemptedUrl: 'https://www.usj.co.jp/',
    }]);
    expect(result.officialSources).toEqual([{ name: 'Universal Studios Japan', url: 'https://www.usj.co.jp/' }]);
    expect(result.priceFacts).toEqual([]);
  });

  it('offers it for a page read that published no fare, and for a suppressed re-read', async () => {
    for (const status of ['no-price', 'probe-cached']) {
      const result = await research([{ name: 'USJ', status, officialUrl: 'https://www.usj.co.jp/' }]);
      expect(result.officialSources).toHaveLength(1);
    }
  });

  /** A verified fare makes the link redundant — the panel already answered. */
  it('offers nothing once a fare is verified', async () => {
    const result = await research([{
      name: 'USJ', status: 'verified', officialUrl: 'https://www.usj.co.jp/',
      admission: { fares: [{ audience: 'adult', amount: 8_600, currency: 'JPY' }], source: 'official-website', sourceUrl: 'https://www.usj.co.jp/tickets', retrievedAt: '2026-08-22T00:00:00.000Z' },
    }]);
    expect(result.officialSources).toEqual([]);
  });

  /**
   * The safety half. `unavailable` means the stored address failed the safety
   * check and `rejected-source` means it was a reseller — neither may be
   * handed to a traveller as "the official site", so neither sets officialUrl
   * upstream and neither can appear here.
   */
  it('never offers an unsafe address or a reseller', async () => {
    const unsafe = await research([{ name: 'A', status: 'unavailable', attemptedUrl: 'http://10.0.0.1/' }]);
    expect(unsafe.officialSources).toEqual([]);
    const reseller = await research([{ name: 'B', status: 'rejected-source', attemptedUrl: 'https://www.klook.com/usj' }]);
    expect(reseller.officialSources).toEqual([]);
  });

  it('refuses a link that is not https', async () => {
    const result = await research([{ name: 'C', status: 'fetch-error', officialUrl: 'http://insecure.example/' }]);
    expect(result.officialSources).toEqual([]);
  });

  it('is empty rather than absent when nothing was researched', async () => {
    const result = await researchAskAdmissionPrices({
      question: 'How much is Somewhere Unfindable?',
      tripCities: ['Osaka'],
    }, {
      resolveTrustedPlaceHints: ([hint]) => [missing(hint)],
      lookupExactPlaceByName: lookupStub({}),
      researchAdmissionPrices: vi.fn(),
    });
    expect(result.officialSources).toEqual([]);
  });
});

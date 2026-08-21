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

/**
 * Admission cost extraction, imported straight from the Deno `_shared` module
 * (which has no Deno APIs) — the same precedent as `osmPlaces.test.ts`.
 *
 * Two invariants are worth more than all the parsing cases below, and most of
 * this file exists to hold them:
 *
 * 1. A category never determines what something costs.
 * 2. A number without a resolvable currency is never shown as a price.
 */
import { describe, expect, it } from 'vitest';
import {
  admissionExpectation,
  admissionFromOfficialClaims,
  categoryAdmission,
  COUNTRY_CURRENCY,
  mergeAdmission,
  osmAdmission,
  parseAdmissionText,
  resolveCurrency,
  isPlaceAdmission,
  type PlaceAdmission,
} from '../../supabase/functions/_shared/placeCost';
import { OSAKA_PLACE_FIXTURE } from './destinationFixtures';
import { admissionFor } from './destinationIntelligence';
import { rankWithIntelligence } from './destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from './tripProfile';

describe('free entry', () => {
  it('reads fee=no as free', () => {
    expect(osmAdmission({ fee: 'no' }, 'JP')).toMatchObject({ class: 'free', source: 'osm-tag' });
  });

  it('reads the other ways a mapper writes it', () => {
    expect(osmAdmission({ admission: 'free' }, 'JP')?.class).toBe('free');
    expect(osmAdmission({ charge: 'free' }, 'JP')?.class).toBe('free');
  });

  it('keeps a conditional, because it changes the answer on some days', () => {
    // "free @ (Su)" means free on Sundays and charged otherwise. Dropping the
    // condition would turn a half-fact into a confident wrong one.
    const admission = osmAdmission({ fee: 'no', 'fee:conditional': 'yes @ (Sa,Su)' }, 'JP');
    expect(admission?.class).toBe('free');
    expect(admission?.rawText).toBe('yes @ (Sa,Su)');
  });

  it('reads free out of prose', () => {
    expect(parseAdmissionText('Free admission', 'JP')?.class).toBe('free');
    expect(parseAdmissionText('No charge', 'GB')?.class).toBe('free');
    expect(parseAdmissionText('Entry free', 'IT')?.class).toBe('free');
  });
});

describe('a ticket with no published price', () => {
  it('says a ticket is required rather than saying nothing', () => {
    // This is the case that produced "Cost unknown" for most of a shortlist.
    // "A ticket is required, no source published the price" is the same amount
    // of knowledge, stated usefully.
    const admission = osmAdmission({ fee: 'yes' }, 'JP');
    expect(admission).toMatchObject({ class: 'ticketed', fares: [] });
  });

  it('treats an unreadable charge as still charging', () => {
    // The presence of a `charge` tag is itself a statement that entry costs
    // something, even when its value defeats the parser.
    const admission = osmAdmission({ charge: 'varies by exhibition' }, 'JP');
    expect(admission?.class).toBe('ticketed');
    expect(admission?.fares).toEqual([]);
    expect(admission?.rawText).toBe('varies by exhibition');
  });

  it('reports nothing at all when no tag mentions money', () => {
    expect(osmAdmission({ tourism: 'museum' }, 'JP')).toBeUndefined();
    expect(osmAdmission({}, 'JP')).toBeUndefined();
  });
});

describe('reading a charge', () => {
  it('reads the OSM charge tag the old code threw away', () => {
    expect(osmAdmission({ charge: '600 JPY' }, 'JP')).toMatchObject({
      class: 'ticketed',
      fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }],
    });
  });

  it('reads a semicolon-separated concession fare', () => {
    const admission = osmAdmission({ charge: '6.00 EUR;3.00 EUR concession' }, 'IT');
    expect(admission?.fares).toEqual([
      { audience: 'adult', amount: 6, currency: 'EUR' },
      { audience: 'concession', amount: 3, currency: 'EUR' },
    ]);
  });

  it('falls back to charge:adult and fee:amount', () => {
    expect(osmAdmission({ 'charge:adult': '12 GBP' }, 'GB')?.fares?.[0]).toMatchObject({ amount: 12, currency: 'GBP' });
    expect(osmAdmission({ 'fee:amount': '5 EUR' }, 'FR')?.fares?.[0]).toMatchObject({ amount: 5, currency: 'EUR' });
  });
});

describe('mixed fares in prose', () => {
  it('separates adult from child', () => {
    expect(parseAdmissionText('Adults ¥600, children ¥300', 'JP')?.fares).toEqual([
      { audience: 'adult', amount: 600, currency: 'JPY' },
      { audience: 'child', amount: 300, currency: 'JPY' },
    ]);
  });

  it('reads students and seniors, normalised', () => {
    const fares = parseAdmissionText('Adults £12, students £8, seniors £9', 'GB')?.fares;
    expect(fares?.map((fare) => fare.audience)).toEqual(['adult', 'student', 'senior']);
    expect(fares?.every((fare) => fare.currency === 'GBP')).toBe(true);
  });

  it('handles a thousands separator', () => {
    expect(parseAdmissionText('¥1,200', 'JP')?.fares?.[0]).toMatchObject({ amount: 1200, currency: 'JPY' });
  });

  it('takes the first figure of a range and keeps the text', () => {
    // "¥600–¥1,000" is one audience twice. The lower figure is what a traveller
    // budgets against, and the full text stays available.
    const admission = parseAdmissionText('¥600–¥1,000', 'JP');
    expect(admission?.fares).toEqual([{ audience: 'adult', amount: 600, currency: 'JPY' }]);
    expect(admission?.rawText).toBe('¥600–¥1,000');
  });

  it('defaults an unlabelled price to the adult fare', () => {
    expect(parseAdmissionText('¥600', 'JP')?.fares?.[0].audience).toBe('adult');
  });

  it('a free concession does not make a paid attraction free', () => {
    const admission = parseAdmissionText('Adults ¥600, children free', 'JP');
    expect(admission?.class).toBe('ticketed');
    expect(admission?.fares?.[0]).toMatchObject({ amount: 600 });
  });
});

describe('the ¥ problem', () => {
  it('is JPY in Japan and CNY in China', () => {
    // Twenty-fold error if this is wrong, and nothing on the card would show it.
    expect(parseAdmissionText('¥600', 'JP')?.fares?.[0].currency).toBe('JPY');
    expect(parseAdmissionText('¥600', 'CN')?.fares?.[0].currency).toBe('CNY');
  });

  it('refuses to guess with no country to read it against', () => {
    const admission = parseAdmissionText('¥600', undefined);
    expect(admission?.fares ?? []).toEqual([]);
    expect(admission?.rawText).toBe('¥600');
  });

  it('refuses when the country does not use that symbol at all', () => {
    // `¥` in a French listing is somebody else's currency; we cannot say whose.
    expect(parseAdmissionText('¥600', 'FR')?.fares ?? []).toEqual([]);
  });

  it('lets an explicit code beat the symbol and the country', () => {
    expect(parseAdmissionText('600 CNY', 'JP')?.fares?.[0].currency).toBe('CNY');
  });

  it('reads the dollar sign only against a country that uses one', () => {
    expect(parseAdmissionText('$25', 'AU')?.fares?.[0].currency).toBe('AUD');
    expect(parseAdmissionText('$25', 'US')?.fares?.[0].currency).toBe('USD');
    expect(parseAdmissionText('$25', 'JP')?.fares ?? []).toEqual([]);
  });

  it('reads currency words', () => {
    expect(parseAdmissionText('600 yen', 'JP')?.fares?.[0].currency).toBe('JPY');
    expect(parseAdmissionText('50 baht', 'TH')?.fares?.[0].currency).toBe('THB');
  });
});

describe('a bare number', () => {
  it('is denominated by the country when there is one', () => {
    expect(parseAdmissionText('Adults 500', 'JP')?.fares?.[0]).toMatchObject({ amount: 500, currency: 'JPY' });
  });

  it('yields no amount at all without one', () => {
    // The rule the old `'¥'.repeat(n)` broke: never print a number you cannot
    // denominate.
    const admission = parseAdmissionText('Adults 500', undefined);
    expect(admission?.fares ?? []).toEqual([]);
    expect(admission?.rawText).toBe('Adults 500');
  });
});

describe('text that is not a price', () => {
  it('keeps unparsable text rather than discarding it', () => {
    const admission = parseAdmissionText('Donation appreciated', 'JP');
    expect(admission?.class).toBe('unknown');
    expect(admission?.rawText).toBe('Donation appreciated');
    expect(admission?.fares).toBeUndefined();
  });

  it('reports nothing for empty input', () => {
    expect(parseAdmissionText('', 'JP')).toBeUndefined();
    expect(parseAdmissionText(undefined, 'JP')).toBeUndefined();
    expect(parseAdmissionText('   ', 'JP')).toBeUndefined();
  });
});

describe('a category is not a price', () => {
  it('never sets a class', () => {
    // The invariant. A shopping street may be free to walk into, a food market
    // may hand out samples, a club may charge at the door — the category proves
    // none of it.
    for (const categories of [['museum'], ['market'], ['park'], ['theme-park'], ['nightlife']]) {
      expect(categoryAdmission(categories)?.class).toBe('unknown');
    }
  });

  it('says what kind of place it is, hedged', () => {
    expect(admissionExpectation(['museum'])).toBe('usually-ticketed');
    expect(admissionExpectation(['aquarium'])).toBe('usually-ticketed');
    expect(admissionExpectation(['market', 'food'])).toBe('spending-inside');
    expect(admissionExpectation(['shopping'])).toBe('spending-inside');
    expect(admissionExpectation(['park'])).toBe('often-free');
    expect(admissionExpectation(['temple'])).toBe('often-free');
  });

  it('says nothing about a category it has no expectation for', () => {
    expect(admissionExpectation(['transport-hub'])).toBeUndefined();
    expect(categoryAdmission(['transport-hub'])).toBeUndefined();
  });

  it('leaves an unpriced market unknown, with spending noted separately', () => {
    // The rendered line is "No admission price published · spending happens
    // inside" — which distinguishes admission from spending instead of
    // asserting either.
    const merged = mergeAdmission(categoryAdmission(['market', 'food']));
    expect(merged).toMatchObject({ class: 'unknown', expectation: 'spending-inside' });
  });
});

describe('precedence', () => {
  const fare = (source: PlaceAdmission['source'], amount: number): PlaceAdmission => ({
    class: 'ticketed',
    fares: [{ audience: 'adult', amount, currency: 'JPY' }],
    source,
    confidence: 'medium',
  });

  it('lets the operator’s own site win', () => {
    const merged = mergeAdmission(fare('osm-tag', 600), fare('official-website', 800), fare('provider', 700));
    expect(merged?.source).toBe('official-website');
    expect(merged?.fares?.[0].amount).toBe(800);
  });

  it('puts a map provider above a community tag', () => {
    expect(mergeAdmission(fare('osm-tag', 600), fare('provider', 700))?.source).toBe('provider');
  });

  it('prefers the source that produced actual fares on a tie', () => {
    const bare: PlaceAdmission = { class: 'ticketed', fares: [], source: 'osm-tag', confidence: 'medium' };
    expect(mergeAdmission(bare, fare('wikivoyage', 600))?.fares?.[0].amount).toBe(600);
  });

  it('prefers the structured tag when both sides parsed equally well', () => {
    expect(mergeAdmission(fare('wikivoyage', 500), fare('osm-tag', 600))?.source).toBe('osm-tag');
  });

  it('is deterministic regardless of argument order', () => {
    const inputs = [fare('osm-tag', 600), fare('official-website', 800), categoryAdmission(['museum'])];
    const forward = mergeAdmission(...inputs);
    const backward = mergeAdmission(...[...inputs].reverse());
    expect(forward).toEqual(backward);
  });

  it('never lets a category outrank a price, in either direction', () => {
    const priced = fare('osm-tag', 600);
    const guess = categoryAdmission(['museum']);
    expect(mergeAdmission(guess, priced)?.class).toBe('ticketed');
    expect(mergeAdmission(priced, guess)?.class).toBe('ticketed');
  });

  it('carries the category expectation through even when a price won', () => {
    // A free museum is still a museum; the UI may still want to say so.
    const merged = mergeAdmission(categoryAdmission(['museum']), { class: 'free', source: 'osm-tag', confidence: 'medium' });
    expect(merged).toMatchObject({ class: 'free', expectation: 'usually-ticketed' });
  });

  it('reports nothing when there is nothing to report', () => {
    expect(mergeAdmission()).toBeUndefined();
    expect(mergeAdmission(undefined, undefined)).toBeUndefined();
  });
});

describe('what the card actually resolves to', () => {
  it('fills in the expectation for a fixture that carries no admission', () => {
    // Fixtures, Google and pre-existing cache rows all reach the UI without a
    // server-resolved admission. A museum must not fall back to silence.
    const market = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Kuromon Ichiba Market')!;
    expect(market.admission).toBeUndefined();
    expect(admissionFor(market)).toMatchObject({ class: 'unknown', expectation: 'spending-inside' });
  });

  it('shows the published fare when there is one', () => {
    const castle = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Osaka Castle Museum')!;
    expect(admissionFor(castle)).toMatchObject({
      class: 'ticketed',
      fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }],
    });
  });

  it('never lets the fallback overwrite a real answer', () => {
    const park = OSAKA_PLACE_FIXTURE.find((entry) => entry.name === 'Osaka Castle Park')!;
    // Categorised `park` — expectation "often-free" — and separately *known* to
    // be free. The known answer must survive, and stay a class not a guess.
    expect(admissionFor(park)?.class).toBe('free');
  });

  it('says nothing for a place with neither price nor a recognised category', () => {
    expect(admissionFor({ categories: ['transport-hub'] } as never)).toBeUndefined();
  });

  it('can only ever add an expectation, for every category it knows', () => {
    // The invariant stated as a property rather than an example: whatever the
    // category, a candidate with no sourced price can never come back with a
    // class, a fare or a spend figure.
    const categories = [
      'museum', 'art', 'aquarium', 'wildlife', 'theme-park', 'gallery', 'zoo', 'observatory',
      'market', 'food', 'food-district', 'cafes', 'street-food', 'shopping', 'nightlife', 'evening',
      'park', 'garden', 'nature', 'temple', 'shrine', 'waterfront', 'view', 'local-character',
    ];
    for (const category of categories) {
      const resolved = admissionFor({ categories: [category], admission: undefined } as never);
      expect(resolved?.class).toBe('unknown');
      expect(resolved?.source).toBe('category');
      expect(resolved?.fares).toBeUndefined();
      expect(resolved?.typicalSpend).toBeUndefined();
      expect(resolved?.expectation).toBeDefined();
    }
  });
});

describe('scoring never guesses a price', () => {
  const profile = (): TripProfile => ({
    ...createEmptyProfile('MYR'),
    destinations: [manualDestination('Osaka', 'Japan')],
    startDate: '2026-10-01',
    endDate: '2026-10-11',
    dayCount: 11,
    styles: ['history'],
    transport: ['public-transport'],
  });

  const fitFor = (name: string) => {
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, profile());
    return ranked.find((entry) => entry.candidate.name === name)!.breakdown.budgetFit;
  };

  it('scores known-free entry as a perfect fit for any budget', () => {
    expect(fitFor('Osaka Castle Park')).toBe(1);
  });

  it('does not score an unknown cost as a confident mid-price', () => {
    // `priceLevel ?? 2` treated "we have no idea" as "moderately priced", which
    // is the same silent guess the panel was making with "Cost unknown".
    const unpriced = OSAKA_PLACE_FIXTURE.find((entry) => entry.priceLevel === undefined);
    if (!unpriced) return;
    const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, profile());
    const fit = ranked.find((entry) => entry.candidate.id === unpriced.id)!.breakdown.budgetFit;
    expect(fit).not.toBe(1);
    expect(fit).toBeLessThan(1);
  });
});

describe('currency resolution in isolation', () => {
  it('follows a strict order and stops rather than guessing', () => {
    expect(resolveCurrency('JPY', '¥', 'CN')).toBe('JPY');
    expect(resolveCurrency(undefined, '€', undefined)).toBe('EUR');
    expect(resolveCurrency(undefined, '¥', 'JP')).toBe('JPY');
    expect(resolveCurrency(undefined, '¥', undefined)).toBeUndefined();
    expect(resolveCurrency(undefined, undefined, 'MY')).toBe('MYR');
    expect(resolveCurrency(undefined, undefined, undefined)).toBeUndefined();
    expect(resolveCurrency(undefined, undefined, 'ZZ')).toBeUndefined();
  });

  it('covers the destinations the app actually ships fixtures for', () => {
    for (const country of ['JP', 'KR', 'IT', 'MY']) {
      expect(COUNTRY_CURRENCY[country]).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe('official admission cache round trip', () => {
  it('rebuilds fares from the persisted price claims', () => {
    const admission = admissionFromOfficialClaims([
      {
        type: 'price',
        summary: 'The official site lists adult admission at JPY 600 (from 600 to 1000 JPY)',
        value: 600,
        unit: 'currency',
        appliesTo: { currency: 'JPY', audience: 'adult' },
      },
      {
        type: 'price',
        summary: 'The official site lists student admission at JPY 300',
        value: 300,
        unit: 'currency',
        appliesTo: { currency: 'JPY', audience: 'student' },
      },
    ], 'https://museum.example/admission', '2026-08-07T00:00:00.000Z');
    expect(admission).toMatchObject({
      class: 'ticketed',
      source: 'official-website',
      sourceUrl: 'https://museum.example/admission',
      fares: [
        { audience: 'adult', amount: 600, currency: 'JPY' },
        { audience: 'student', amount: 300, currency: 'JPY' },
      ],
    });
    expect(admission?.fares?.[0].note).toBe('from 600 to 1000 JPY');
  });

  it('rebuilds free admission without inventing a currency', () => {
    expect(admissionFromOfficialClaims([
      { type: 'price', summary: 'The official site says admission is free' },
    ])).toMatchObject({ class: 'free', source: 'official-website' });
  });

  it('rejects malformed wire admissions before they reach the card', () => {
    expect(isPlaceAdmission({ class: 'ticketed', source: 'official-website', confidence: 'high', fares: [{ amount: '600' }] })).toBe(false);
    expect(isPlaceAdmission({ class: 'ticketed', source: 'official-website', confidence: 'high', fares: [{ amount: 600, currency: 'JPY', audience: 'adult' }] })).toBe(true);
  });
});

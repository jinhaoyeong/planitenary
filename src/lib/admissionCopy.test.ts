/**
 * What a price reads as.
 *
 * The complaint that started this was one string: "Cost unknown", shown on
 * nearly every card. It was standing in for three different situations a
 * traveller would act on differently — nobody published a price, you pay per
 * item once inside, and a ticket is definitely required — and it distinguished
 * none of them. The first test here is that the string is gone.
 */
import { describe, expect, it } from 'vitest';
import type { PlaceAdmission } from '../../supabase/functions/_shared/placeCost';
import { admissionChip, admissionLine, describeAdmission } from './admissionCopy';

const admission = (over: Partial<PlaceAdmission>): PlaceAdmission => ({
  class: 'unknown',
  source: 'category',
  confidence: 'low',
  ...over,
});

describe('the string that started all this', () => {
  it('never appears, whatever it is handed', () => {
    const cases: Array<PlaceAdmission | undefined> = [
      undefined,
      admission({}),
      admission({ class: 'free', source: 'osm-tag' }),
      admission({ class: 'ticketed', fares: [], source: 'osm-tag' }),
      admission({ class: 'ticketed', fares: [{ audience: 'adult', amount: 600, currency: 'JPY' }], source: 'osm-tag' }),
      admission({ class: 'spend-based', typicalSpend: { audience: 'person', amount: 80, currency: 'CNY' }, source: 'provider' }),
      admission({ expectation: 'spending-inside' }),
      admission({ expectation: 'usually-ticketed' }),
      admission({ expectation: 'often-free' }),
    ];
    for (const value of cases) {
      expect(admissionLine(value).toLowerCase()).not.toContain('cost unknown');
      expect(admissionLine(value).toLowerCase()).not.toContain('price level');
      expect(admissionLine(value).length).toBeGreaterThan(0);
    }
  });
});

describe('a sourced fare', () => {
  const ticket = (fares: PlaceAdmission['fares']) =>
    admission({ class: 'ticketed', fares, source: 'official-website', confidence: 'high' });

  it('shows the exact amount in the currency it was published in', () => {
    const display = describeAdmission(ticket([{ audience: 'adult', amount: 600, currency: 'JPY' }]));
    expect(display.headline).toContain('600');
    expect(display.note).toContain('adult ticket');
    expect(display.sourced).toBe(true);
  });

  it('lists the other fares separately rather than hiding them', () => {
    const display = describeAdmission(ticket([
      { audience: 'adult', amount: 1500, currency: 'JPY' },
      { audience: 'student', amount: 1100, currency: 'JPY' },
      { audience: 'child', amount: 0, currency: 'JPY' },
    ]));
    expect(display.fares.map((fare) => fare.label)).toEqual(['Student', 'Child']);
    // A zero fare is free entry for that audience, not "¥0".
    expect(display.fares[1].value).toBe('Free');
  });

  it('says which audience a non-adult headline fare is for', () => {
    // Presenting a concession as though it were the standard price would
    // understate the trip.
    const display = describeAdmission(ticket([{ audience: 'concession', amount: 300, currency: 'JPY' }]));
    expect(display.note).toContain('concession ticket');
  });

  it('offers a home-currency figure only as an approximation', () => {
    const display = describeAdmission(
      ticket([{ audience: 'adult', amount: 600, currency: 'JPY' }]),
      { toHomeCurrency: (amount, currency) => (currency === 'JPY' ? `RM ${(amount / 33).toFixed(0)}` : undefined) },
    );
    // The published figure leads; the conversion is explicitly approximate.
    expect(display.headline).toContain('600');
    expect(display.note).toContain('≈ RM 18');
  });

  it('shows only the published figure when there are no rates', () => {
    const display = describeAdmission(ticket([{ audience: 'adult', amount: 600, currency: 'JPY' }]));
    expect(display.note).not.toContain('≈');
  });
});

describe('a ticket with no published price', () => {
  it('says so, because we know it costs something', () => {
    const display = describeAdmission(admission({ class: 'ticketed', fares: [], source: 'osm-tag', confidence: 'medium' }));
    expect(display.headline).toBe('Ticket required');
    expect(display.note).toBe('no price published');
    expect(admissionLine(admission({ class: 'ticketed', fares: [], source: 'osm-tag' })))
      .toBe('Ticket required · no price published');
  });
});

describe('a market nobody published a price for', () => {
  it('separates admission from spending', () => {
    // The traveller's own framing: for a marketplace it is fine to be vague,
    // because what you spend is up to you. What is not fine is implying an
    // entry fee exists, or that we know one does not.
    expect(admissionLine(admission({ expectation: 'spending-inside' })))
      .toBe('No admission price published · spending happens inside');
  });

  it('is not presented as sourced', () => {
    const display = describeAdmission(admission({ expectation: 'spending-inside' }));
    expect(display.sourced).toBe(false);
    expect(display.provenance).toContain('No source published a price');
  });

  it('hedges a museum and a park differently', () => {
    expect(admissionLine(admission({ expectation: 'usually-ticketed' })))
      .toBe('No admission price published · usually needs a ticket');
    expect(admissionLine(admission({ expectation: 'often-free' })))
      .toBe('No admission price published · usually free to enter');
  });

  it('still says something with no expectation at all', () => {
    expect(admissionLine(admission({}))).toBe('No admission price published');
    expect(admissionLine(undefined)).toBe('No admission price published');
  });
});

describe('free entry', () => {
  it('is stated plainly and marked as sourced', () => {
    const display = describeAdmission(admission({ class: 'free', source: 'osm-tag', confidence: 'medium' }));
    expect(display.headline).toBe('Free entry');
    expect(display.sourced).toBe(true);
    expect(display.provenance).toContain('community-maintained map data');
  });

  /**
   * Zero is a price a source can publish — OSM `charge=0`, a schema.org
   * `Offer` with `price: "0"` — so a place can arrive here classified
   * `ticketed` and costing nothing. Both surfaces have to agree that this
   * reads as free rather than as `JP¥0`.
   */
  it('reads a zero fare as free rather than as a price', () => {
    const zeroFare = admission({
      class: 'ticketed',
      fares: [{ audience: 'adult', amount: 0, currency: 'JPY' }],
      source: 'official-website',
      confidence: 'high',
    });
    expect(describeAdmission(zeroFare).headline).toBe('Free entry');
    expect(admissionChip(zeroFare)).toBe('Free entry');
    expect(admissionLine(zeroFare)).not.toMatch(/0/);
  });

  it('still charges for a place whose child ticket alone is free', () => {
    const mixed = admission({
      class: 'ticketed',
      fares: [
        { audience: 'adult', amount: 1500, currency: 'JPY' },
        { audience: 'child', amount: 0, currency: 'JPY' },
      ],
      source: 'official-website',
      confidence: 'high',
    });
    expect(describeAdmission(mixed).headline).toBe('JP¥1,500');
    expect(describeAdmission(mixed).fares).toContainEqual({ label: 'Child', value: 'Free' });
  });
});

describe('spend-based', () => {
  it('reads as a typical spend, not a fare', () => {
    const display = describeAdmission(admission({
      class: 'spend-based',
      typicalSpend: { audience: 'person', amount: 80, currency: 'CNY' },
      source: 'provider',
      confidence: 'medium',
    }));
    expect(display.headline).toMatch(/^About /);
    expect(display.note).toContain('typical spend');
  });
});

describe('provenance is a sentence, not an enum', () => {
  it('names the source for each kind', () => {
    const sources: Array<[PlaceAdmission['source'], RegExp]> = [
      ['official-website', /venue’s own site/],
      ['provider', /map provider/],
      ['osm-tag', /community-maintained/],
      ['wikivoyage', /Wikivoyage/],
    ];
    for (const [source, pattern] of sources) {
      const display = describeAdmission(admission({ class: 'free', source }));
      expect(display.provenance).toMatch(pattern);
      expect(display.provenance).not.toMatch(/confidence/i);
    }
  });

  it('does not claim a source for a price it does not have', () => {
    // An OSM record whose charge text defeated the parser is `unknown`. Saying
    // "price from community-maintained map data" beside "no price published"
    // would be attributing a price that was never extracted.
    const display = describeAdmission(admission({ class: 'unknown', source: 'osm-tag', rawText: 'varies' }));
    expect(display.provenance).toBeUndefined();
    expect(display.rawText).toBe('varies');
  });
});

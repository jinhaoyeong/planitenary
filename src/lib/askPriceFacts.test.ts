import { describe, expect, it } from 'vitest';
import { parseAskPriceFacts, priceFactsFromValue } from '../../supabase/functions/_shared/askPriceFacts';

describe('Ask official price facts', () => {
  it('keeps a verified source, retrieval date and variable fare range', () => {
    const facts = parseAskPriceFacts([{
      name: 'Tokyo Disneyland',
      kind: 'admission',
      fares: [{ audience: 'adult', amount: 7_900, minAmount: 7_900, maxAmount: 10_900, currency: 'JPY' }],
      source: 'official-website',
      sourceUrl: 'https://example.org/tickets',
      retrievedAt: '2026-08-21T00:00:00.000Z',
    }]);
    expect(facts[0]).toMatchObject({
      source: 'official-website',
      sourceUrl: 'https://example.org/tickets',
      retrievedAt: '2026-08-21T00:00:00.000Z',
      fares: [{ amount: 7_900, minAmount: 7_900, maxAmount: 10_900 }],
    });
  });

  it('extracts only saved admission facts from a tool result', () => {
    const facts = priceFactsFromValue({
      places: [{
        id: 'usj',
        name: 'Universal Studios Japan',
        status: 'unavailable',
        note: 'No verified fare was found.',
      }],
    });
    expect(facts).toEqual([]);
  });
});

/**
 * Tests for the sentence attached to a stored price.
 *
 * The rule under test is that every branch says something true and specific,
 * and that a missing price never acquires an amount — not zero, not "Free",
 * not a hedge that reads like one.
 */
import { describe, expect, it } from 'vitest';
import { bookingCtaLabel, describePriceState } from './activityCommerceCopy';
import type { ActivityBookingLink } from './activityCommerce';
import type { FreshnessPolicy, PriceSnapshot } from './travelBooking';

const NOW = Date.parse('2027-01-29T12:00:00Z');

const snapshot = (over: Partial<PriceSnapshot> = {}): PriceSnapshot => ({
  amount: 35,
  currency: 'MYR',
  source: 'provider',
  retrievedAt: '2027-01-29T11:42:00Z',
  ...over,
});

describe('what a price reads as', () => {
  it('offers an instruction, not a figure, when there is no price', () => {
    const display = describePriceState(undefined, NOW);
    expect(display.state).toBe('unknown');
    expect(display.note).toBe('Check current price');
    expect(display.amount).toBeUndefined();
    expect(display.current).toBe(false);
  });

  it('never turns a missing price into zero or free', () => {
    const display = describePriceState(undefined, NOW);
    for (const forbidden of ['0', 'RM 0', 'MYR 0', 'Free', 'Free entry', 'Price unavailable']) {
      expect(display.amount ?? '').not.toContain(forbidden);
      expect(display.note).not.toContain(forbidden);
    }
  });

  it('shows an unsourced amount without vouching for it', () => {
    const display = describePriceState(snapshot({ source: 'unspecified' }), NOW);
    expect(display.note).toBe('Source not recorded');
    expect(display.amount).toBe('MYR 35');
    expect(display.current).toBe(false);
    expect(display.note).not.toBe('Entered manually');
  });

  it('attributes a manual price to the traveller and nobody else', () => {
    const display = describePriceState(snapshot({ source: 'manual' }), NOW);
    expect(display.note).toBe('Entered manually');
    expect(display.current).toBe(false);
  });

  it("calls a venue's own figure official, and a provider's merely checked", () => {
    expect(describePriceState(snapshot({ source: 'official-website' }), NOW).note).toBe('Official price');
    expect(describePriceState(snapshot({ source: 'provider' }), NOW).note).toBe('Checked price');
    expect(describePriceState(snapshot({ source: 'provider' }), NOW).current).toBe(true);
  });

  it('does not present an aged price as current', () => {
    const ageing: FreshnessPolicy = { mode: 'age-based', staleAfterMinutes: 5 };
    const display = describePriceState(snapshot(), NOW, ageing);
    expect(display.state).toBe('stale');
    expect(display.note).toBe('Price may have changed');
    expect(display.current).toBe(false);
  });

  it('only calls a price current where the provider guaranteed it', () => {
    const live = describePriceState(snapshot({ expiresAt: '2027-01-29T12:30:00Z' }), NOW);
    expect(live.state).toBe('live');
    expect(live.note).toBe('Current price');
    expect(live.current).toBe(true);
  });

  it('does not present a withdrawn price as current', () => {
    const display = describePriceState(snapshot({ expiresAt: '2027-01-29T11:30:00Z' }), NOW);
    expect(display.state).toBe('expired');
    expect(display.note).toBe('Check current price');
    expect(display.current).toBe(false);
    // The amount travels for surfaces with a safe historical place for it, but
    // it is never marked current.
    expect(display.amount).toBe('MYR 35');
  });

  it('marks exactly the two states a traveller may read as today’s price', () => {
    const cases: Array<[string, PriceSnapshot | undefined]> = [
      ['unknown', undefined],
      ['unsourced', snapshot({ source: 'unspecified' })],
      ['manual', snapshot({ source: 'manual' })],
      ['checked', snapshot()],
      ['live', snapshot({ expiresAt: '2027-01-29T12:30:00Z' })],
      ['expired', snapshot({ expiresAt: '2027-01-29T11:30:00Z' })],
    ];
    const current = cases.filter(([, price]) => describePriceState(price, NOW).current).map(([name]) => name);
    expect(current).toEqual(['checked', 'live']);
  });
});

describe('what the button says', () => {
  const link = (authority: ActivityBookingLink['authority']): ActivityBookingLink =>
    ({ url: 'https://www.example.org/', authority });

  it('says nothing when there is nowhere to go', () => {
    expect(bookingCtaLabel(undefined, false)).toBeUndefined();
    expect(bookingCtaLabel(undefined, true)).toBeUndefined();
  });

  it('names the operator’s site for what it is', () => {
    expect(bookingCtaLabel(link('website'), false)).toBe('Website');
    expect(bookingCtaLabel(link('website'), true)).toBe('Website');
  });

  it('asks the traveller to check when no price is known', () => {
    expect(bookingCtaLabel(link('official-ticket'), false)).toBe('Check tickets');
    expect(bookingCtaLabel(link('provider'), false)).toBe('Check tickets');
  });

  it('invites a view once a figure is already on the card', () => {
    expect(bookingCtaLabel(link('official-ticket'), true)).toBe('View tickets');
    expect(bookingCtaLabel(link('provider'), true)).toBe('View tickets');
  });

  it('never promises a booking flow we do not operate', () => {
    for (const authority of ['official-ticket', 'website', 'provider'] as const) {
      for (const known of [true, false]) {
        expect(bookingCtaLabel(link(authority), known)).not.toMatch(/book now/i);
      }
    }
  });
});

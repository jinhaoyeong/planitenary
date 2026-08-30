/**
 * Tests for the provider-independent commerce contract.
 *
 * The rule being defended: an attraction with no commerce provider is a normal,
 * fully usable part of a plan, and no absence of provider data may become an
 * invented commercial claim — including the quiet kind, where a marketplace
 * page is captioned as the venue's own website.
 */
import { describe, expect, it } from 'vitest';
import { activityBookingLink, activityCommerceState } from './activityCommerce';
import type { PriceSnapshot } from './travelBooking';

const OFFICIAL = 'https://www.petronastwintowers.com.my/';
const OFFICIAL_TICKETS = 'https://www.petronastwintowers.com.my/tickets';

const price = (source: PriceSnapshot['source'], over: Partial<PriceSnapshot> = {}): PriceSnapshot => ({
  amount: 98,
  currency: 'MYR',
  source,
  retrievedAt: '2027-01-29T11:40:00Z',
  ...over,
});

describe('what we can honestly say about buying a ticket', () => {
  it('reports nothing to say, without treating it as a failure', () => {
    expect(activityCommerceState({})).toBe('no-commerce-data');
    expect(activityBookingLink({})).toBeUndefined();
  });

  it('reports an honest link when there is no amount', () => {
    expect(activityCommerceState({ websiteUrl: OFFICIAL })).toBe('link-only');
  });

  it("separates an operator's published price from a provider's quote", () => {
    expect(activityCommerceState({ price: price('official-website') })).toBe('official-price');
    expect(activityCommerceState({ price: price('provider'), provider: 'tiqets' })).toBe('marketplace-enriched');
  });

  it("does not let a traveller's own figure look like sourced commerce data", () => {
    // A manual price is the traveller's note to themselves. It is reported as
    // `manual` by priceFreshness and must not promote the commerce state.
    expect(activityCommerceState({ price: price('manual') })).toBe('no-commerce-data');
    expect(activityCommerceState({ price: price('manual'), websiteUrl: OFFICIAL })).toBe('link-only');
  });
});

describe('the booking link ladder', () => {
  it("prefers the operator's own ticket page over everything", () => {
    expect(activityBookingLink({
      officialTicketUrl: OFFICIAL_TICKETS,
      websiteUrl: OFFICIAL,
      providerUrl: 'https://www.tiqets.com/en/x?partner=planitenary',
      provider: 'tiqets',
    })).toEqual({ url: OFFICIAL_TICKETS, authority: 'official-ticket' });
  });

  it("falls back to the operator's website before any marketplace", () => {
    expect(activityBookingLink({
      websiteUrl: OFFICIAL,
      providerUrl: 'https://www.tiqets.com/en/x?partner=planitenary',
      provider: 'tiqets',
    })).toEqual({ url: OFFICIAL, authority: 'website' });
  });

  it('reaches a marketplace only for a provider we deliberately support', () => {
    const url = 'https://www.tiqets.com/en/x?partner=planitenary';
    expect(activityBookingLink({ providerUrl: url, provider: 'tiqets' }))
      .toEqual({ url, authority: 'provider' });
    // An unattributed marketplace URL is a guess, not an offer.
    expect(activityBookingLink({ providerUrl: url })).toBeUndefined();
  });

  it('never lets a reseller masquerade as the operator', () => {
    // The whole point of isLikelyResellerUrl, exercised through the ladder: a
    // marketplace handed in as the "official" site is refused outright rather
    // than relabelled, so no surface can caption it "Official website".
    for (const reseller of [
      'https://www.viator.com/tours/x',
      'https://www.getyourguide.com/x',
      'https://www.klook.com/activity/x',
      'https://www.tiqets.com/en/x',
      'https://www.headout.com/x',
    ]) {
      expect(activityBookingLink({ officialTicketUrl: reseller, websiteUrl: reseller })).toBeUndefined();
      expect(activityCommerceState({ websiteUrl: reseller })).toBe('no-commerce-data');
    }
  });

  it('refuses a URL that is not safe to follow', () => {
    for (const unsafe of ['javascript:alert(1)', 'http://localhost/admin', 'https://192.168.1.1/']) {
      expect(activityBookingLink({ websiteUrl: unsafe })).toBeUndefined();
      expect(activityBookingLink({ providerUrl: unsafe, provider: 'tiqets' })).toBeUndefined();
    }
  });

  it('leaves an attraction plannable with no link and no price at all', () => {
    // Nothing here throws, and nothing here is a failure state: the attraction
    // still exists, still holds its slot, and simply offers no commerce.
    const bare = {};
    expect(activityCommerceState(bare)).toBe('no-commerce-data');
    expect(activityBookingLink(bare)).toBeUndefined();
  });
});

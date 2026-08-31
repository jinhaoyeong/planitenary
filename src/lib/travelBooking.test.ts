import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary, sanitizeTravelBooking } from './itinerarySanitize';
import {
  formatBookingPrice,
  priceCheckedLabel,
  priceFreshness,
  priceValidityLabel,
  bookingDayNumber,
  type FreshnessPolicy,
  type TravelBooking,
} from './travelBooking';
import {
  bookingPriceFreshness,
  bookingPriceValidityLabel,
  canRefreshPrice,
  freshnessPolicyFor,
  refreshUnavailableReason,
  travelOfferProviders,
} from './travelOffer';

const NOW = Date.parse('2027-01-29T12:00:00Z');

const tripWith = (bookings: unknown): Itinerary =>
  sanitizeItinerary({ ...emptyItinerary, id: 'trip-1', bookings }, { ...emptyItinerary, id: 'trip-1' });

const flight = {
  id: 'booking-flight-1',
  type: 'flight',
  status: 'confirmed',
  title: 'AirAsia AK 68',
  startDate: '2027-01-31',
  startTime: '10:55',
  endTime: '17:20',
  origin: 'KIX',
  destination: 'KUL',
  operator: 'AirAsia',
  serviceNumber: 'AK 68',
  cabin: 'Economy',
  reference: 'X7QK2M',
  price: { amount: 3596, currency: 'myr', source: 'manual', retrievedAt: '2027-01-20T09:00:00Z' },
};

const stay = {
  id: 'booking-stay-1',
  type: 'stay',
  status: 'confirmed',
  title: 'Nara Hotel',
  startDate: '2027-01-29',
  startTime: '15:00',
  endDate: '2027-01-30',
  endTime: '10:00',
  city: 'Nara',
  roomDescription: 'Standard twin, non-smoking',
  price: { amount: 988, currency: 'MYR', source: 'manual', retrievedAt: '2027-01-20T09:00:00Z' },
};

const rail = {
  id: 'booking-rail-1',
  type: 'rail',
  status: 'confirmed',
  title: 'JR Nara Line',
  startDate: '2027-01-29',
  startTime: '10:30',
  endTime: '11:15',
  origin: 'Kyoto',
  destination: 'Nara',
};

const ticket = {
  id: 'booking-ticket-1',
  type: 'activity-ticket',
  status: 'confirmed',
  title: 'Todai-ji guided entry',
  startDate: '2027-01-29',
  startTime: '14:30',
  city: 'Nara',
  partySize: 2,
};

describe('travel booking persistence', () => {
  it('carries a booking through the sanitiser that decides what is saved', () => {
    const trip = tripWith([flight]);
    expect(trip.bookings).toHaveLength(1);
    expect(trip.bookings?.[0]).toMatchObject({
      id: 'booking-flight-1',
      type: 'flight',
      status: 'confirmed',
      title: 'AirAsia AK 68',
      startDate: '2027-01-31',
      startTime: '10:55',
      origin: 'KIX',
      destination: 'KUL',
      reference: 'X7QK2M',
    });
    // Currency is normalised, so `myr` and `MYR` cannot become two prices.
    expect(trip.bookings?.[0].price?.currency).toBe('MYR');
  });

  it('is idempotent: sanitising twice produces byte-identical output', () => {
    const once = tripWith([flight, stay, rail, ticket]);
    const twice = sanitizeItinerary(once, { ...emptyItinerary, id: 'trip-1' });
    // The realtime sync compares stringified payloads to decide whether a
    // remote echo differs from local state. Anything non-deterministic here
    // would make every save look like a change and loop the sync.
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('persists only an explicit Activity relationship, never a leg id', () => {
    const trip = tripWith([{ ...flight, relatedActivityId: 'activity-flight-1', legId: 'osaka#2' }]);
    expect(trip.bookings?.[0].relatedActivityId).toBe('activity-flight-1');
    expect(trip.bookings?.[0]).not.toHaveProperty('legId');
  });

  it('drops fields it does not know about, legId above all', () => {
    const trip = tripWith([{
      ...flight,
      // A derived stay ordinal renumbers whenever the route is reordered, so a
      // stored one would silently retarget to a different stay.
      legId: 'osaka#2',
      totallyMadeUp: { nested: true },
      __proto__polluting: 'no',
    }]);
    const saved = trip.bookings?.[0] as unknown as Record<string, unknown>;
    expect(saved).toBeDefined();
    expect(saved.legId).toBeUndefined();
    expect(saved.totallyMadeUp).toBeUndefined();
    expect(JSON.stringify(trip)).not.toContain('osaka#2');
    expect(JSON.stringify(trip)).not.toContain('totallyMadeUp');
  });

  it('fails closed on a malformed booking rather than half-keeping it', () => {
    expect(sanitizeTravelBooking(null, 0)).toBeUndefined();
    expect(sanitizeTravelBooking({ type: 'spaceship', startDate: '2027-01-29' }, 0)).toBeUndefined();
    expect(sanitizeTravelBooking({ type: 'flight', startDate: '31/01/2027' }, 0)).toBeUndefined();
    expect(sanitizeTravelBooking({ type: 'flight' }, 0)).toBeUndefined();

    const mixed = tripWith([flight, { type: 'flight' }, stay]);
    expect(mixed.bookings).toHaveLength(2);
  });

  it('refuses a price that is only half a fact', () => {
    const noCurrency = tripWith([{ ...flight, price: { amount: 500, retrievedAt: '2027-01-20T09:00:00Z' } }]);
    expect(noCurrency.bookings?.[0].price).toBeUndefined();

    const noTimestamp = tripWith([{ ...flight, price: { amount: 500, currency: 'MYR' } }]);
    expect(noTimestamp.bookings?.[0].price).toBeUndefined();
  });

  it('never invents an identity that changes between reads', () => {
    const withoutId = { ...flight, id: undefined };
    const first = tripWith([withoutId]).bookings?.[0].id;
    const second = tripWith([withoutId]).bookings?.[0].id;
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it.each([
    ['flight', flight],
    ['stay', stay],
    ['rail', rail],
    ['confirmed activity ticket', ticket],
  ])('survives a save and reload unchanged: %s', (_label, booking) => {
    const saved = tripWith([booking]);
    // Exactly what localStorage and the Supabase document do to a trip.
    const reloaded = sanitizeItinerary(
      JSON.parse(JSON.stringify(saved)),
      { ...emptyItinerary, id: 'trip-1' },
    );
    expect(reloaded.bookings).toEqual(saved.bookings);
    expect(reloaded.bookings?.[0].id).toBe(saved.bookings?.[0].id);
    expect(reloaded.bookings?.[0].price?.retrievedAt).toBe(saved.bookings?.[0].price?.retrievedAt);
  });

  it('leaves a trip with no bookings serialising exactly as it did before', () => {
    const withoutField = sanitizeItinerary({ ...emptyItinerary, id: 'trip-1' }, { ...emptyItinerary, id: 'trip-1' });
    const withEmptyArray = tripWith([]);
    expect(withoutField.bookings).toBeUndefined();
    expect(JSON.stringify(withEmptyArray)).toBe(JSON.stringify(withoutField));
    expect(JSON.stringify(withoutField)).not.toContain('bookings');
  });

  it('orders bookings by when they happen, not by how they were typed', () => {
    const trip = tripWith([ticket, flight, rail]);
    expect(trip.bookings?.map((booking) => booking.id)).toEqual([
      'booking-rail-1',
      'booking-ticket-1',
      'booking-flight-1',
    ]);
  });
});

describe('price freshness', () => {
  const providerPrice = (overrides: Record<string, unknown> = {}) => ({
    amount: 608,
    currency: 'MYR',
    source: 'provider' as const,
    retrievedAt: new Date(NOW - 5 * 60000).toISOString(),
    ...overrides,
  });

  it('expires a price only when the provider said it would', () => {
    const expired = providerPrice({ expiresAt: new Date(NOW - 60000).toISOString() });
    expect(priceFreshness(expired, NOW)).toBe('expired');
  });

  it('keeps a provider-guaranteed price live until its boundary, however old the fetch', () => {
    // Age does not weaken a guarantee that has not run out. Duffel quotes us
    // an hour; a quote fetched 50 minutes ago is still the one being honoured.
    const aged = providerPrice({
      retrievedAt: new Date(NOW - 50 * 60000).toISOString(),
      expiresAt: new Date(NOW + 10 * 60000).toISOString(),
    });
    expect(priceFreshness(aged, NOW)).toBe('live');
    expect(priceValidityLabel(aged, NOW)).toBe('Expires in 10 min');
  });

  it('reports a price with no provider guarantee as checked, never live', () => {
    // "Live" is the provider's word, not ours. Without a boundary the most we
    // can say is when we asked.
    expect(priceFreshness(providerPrice(), NOW)).toBe('checked');
    expect(priceValidityLabel(providerPrice(), NOW)).toBe('Checked 5 min ago');
  });

  it('never expires a price on age alone, however ancient', () => {
    // The absence of an expiry is not an expiry of zero. Treating it as one
    // would mark every fetched price dead on arrival.
    const ancient = providerPrice({ retrievedAt: new Date(NOW - 400 * 24 * 60 * 60000).toISOString() });
    expect(priceFreshness(ancient, NOW)).not.toBe('expired');
  });

  it('leaves an unguaranteed price checked at any age until a policy approves a threshold', () => {
    // An invented deadline is the same failure as an invented guarantee.
    const old = providerPrice({ retrievedAt: new Date(NOW - 90 * 60000).toISOString() });
    expect(priceFreshness(old, NOW)).toBe('checked');
    expect(priceFreshness(old, NOW, { mode: 'provider-expiry' })).toBe('checked');
  });

  it('lets a provider policy age its own unguaranteed prices into stale', () => {
    const policy: FreshnessPolicy = { mode: 'age-based', staleAfterMinutes: 30 };
    const recent = providerPrice({ retrievedAt: new Date(NOW - 20 * 60000).toISOString() });
    const old = providerPrice({ retrievedAt: new Date(NOW - 90 * 60000).toISOString() });
    expect(priceFreshness(recent, NOW, policy)).toBe('checked');
    expect(priceFreshness(old, NOW, policy)).toBe('stale');
    expect(priceValidityLabel(old, NOW, policy)).toBe('Price may have changed');
    // Even under an age policy, ageing recommends a re-check — it never claims
    // the provider withdrew the price.
    expect(priceFreshness(old, NOW, policy)).not.toBe('expired');
  });

  it('will not call a price checked when it cannot say when it was checked', () => {
    const undated = providerPrice({ retrievedAt: 'not-an-instant' });
    expect(priceFreshness(undated, NOW)).toBe('stale');
  });

  it("does not let one provider's ageing rule reach another provider's prices", () => {
    // Duffel states its own expiry, so it must never inherit an activity
    // provider's refresh window.
    expect(freshnessPolicyFor('duffel')).toEqual({ mode: 'provider-expiry' });
    // An unknown provider is not guessed at.
    expect(freshnessPolicyFor('viator')).toEqual({ mode: 'provider-expiry' });
    expect(freshnessPolicyFor(undefined)).toEqual({ mode: 'provider-expiry' });
  });

  it('keeps a confirmed booking price historical rather than market-fresh', () => {
    // What a held reservation cost is a receipt. Striking it through as
    // "Expired" would tell the traveller their money lapsed.
    const paid = {
      provider: 'duffel',
      status: 'confirmed' as const,
      price: providerPrice({ expiresAt: new Date(NOW - 60 * 60000).toISOString() }),
    };
    expect(priceFreshness(paid.price, NOW)).toBe('expired');
    expect(bookingPriceFreshness(paid, NOW)).toBe('checked');
    expect(bookingPriceFreshness(paid, NOW)).not.toBe('stale');
    expect(bookingPriceValidityLabel(paid, NOW)).toBe('Price paid at booking');
  });

  it('decides refreshability separately from freshness', () => {
    const price = providerPrice({ expiresAt: new Date(NOW - 60000).toISOString() });
    // Same dead quote, different answers: a requested booking can be re-quoted,
    // a confirmed one cannot, and freshness had no say in either.
    const requested = { provider: 'duffel', status: 'requested' as const, price };
    const confirmed = { provider: 'duffel', status: 'confirmed' as const, price };
    expect(bookingPriceFreshness(requested, NOW)).toBe('expired');
    // No provider is wired in this release, so the reason refresh is
    // unavailable is the missing adapter — not the status and not the
    // freshness, which is the independence this test exists to show.
    expect(canRefreshPrice(requested)).toBe(false);
    expect(refreshUnavailableReason(requested)).toBe('This provider is not connected');
    // Status still decides on its own: a confirmed booking is unrefreshable
    // for a different reason entirely.
    expect(canRefreshPrice(confirmed)).toBe(false);
    expect(refreshUnavailableReason(confirmed)).toBe('Price paid at booking');

    // And a perfectly live price is still unrefreshable without an adapter.
    const unwired = { provider: 'viator', status: 'planned' as const, price: providerPrice() };
    expect(bookingPriceFreshness(unwired, NOW)).toBe('checked');
    expect(canRefreshPrice(unwired)).toBe(false);
    expect(refreshUnavailableReason(unwired)).toBe('This provider is not connected');
  });

  it('treats a price the traveller typed in as manual, never stale or expired', () => {
    const manual = {
      amount: 988,
      currency: 'MYR',
      source: 'manual' as const,
      retrievedAt: new Date(NOW - 400 * 24 * 60 * 60000).toISOString(),
      expiresAt: new Date(NOW - 60000).toISOString(),
    };
    expect(priceFreshness(manual, NOW)).toBe('manual');
    expect(priceCheckedLabel(manual, NOW)).toBe('Price entered manually');
  });

  it('says how old a provider figure is in words a traveller can act on', () => {
    expect(priceCheckedLabel(providerPrice({ retrievedAt: new Date(NOW - 18 * 60000).toISOString() }), NOW))
      .toBe('Checked 18 min ago');
  });

  it('always prints a currency beside an amount', () => {
    expect(formatBookingPrice({ amount: 3596, currency: 'MYR', source: 'manual', retrievedAt: '' }))
      .toBe('MYR 3,596');
  });
});

describe('refresh availability', () => {
  it('never re-prices what the traveller already paid for', () => {
    // Four different facts share one field, and only one of them is a live
    // quote. A confirmed booking's amount is a receipt: replacing it with
    // today's market price would destroy the only record of the real one.
    const paid = {
      status: 'confirmed' as const,
      provider: 'duffel',
      price: { amount: 3596, currency: 'MYR', source: 'provider' as const, retrievedAt: '' },
    };
    expect(canRefreshPrice(paid)).toBe(false);
    expect(refreshUnavailableReason(paid)).toBe('Price paid at booking');
  });

  it('treats an official researched fare as research, not bookable inventory', () => {
    const researched = {
      status: 'planned' as const,
      provider: undefined,
      price: { amount: 600, currency: 'JPY', source: 'official-website' as const, retrievedAt: '' },
    };
    expect(canRefreshPrice(researched)).toBe(false);
    expect(refreshUnavailableReason(researched)).toBe('This provider is not connected');
  });

  it('offers no refresh for a manually entered price', () => {
    const manual = { status: 'planned' as const, provider: undefined, price: { amount: 1, currency: 'MYR', source: 'manual' as const, retrievedAt: '' } };
    expect(canRefreshPrice(manual)).toBe(false);
    expect(refreshUnavailableReason(manual)).toBe('Price entered manually');
  });

  it('never calls a fetched price manual, even when the provider field is missing', () => {
    // Otherwise one card could say "Checked 12 min ago" and "Price entered
    // manually" at the same time — two contradictory claims about one number.
    const fetched = { status: 'planned' as const, provider: undefined, price: { amount: 154, currency: 'CNY', source: 'provider' as const, retrievedAt: '' } };
    expect(canRefreshPrice(fetched)).toBe(false);
    expect(refreshUnavailableReason(fetched)).toBe('This provider is not connected');
  });

  it('offers no refresh for a provider that is not wired up', () => {
    // V1 ships no providers, and the control must say so rather than render a
    // button that silently does nothing and implies a re-check happened.
    expect(travelOfferProviders).toHaveLength(0);
    const orphaned = { status: 'planned' as const, provider: 'duffel', price: { amount: 1, currency: 'MYR', source: 'provider' as const, retrievedAt: '' } };
    expect(canRefreshPrice(orphaned)).toBe(false);
    expect(refreshUnavailableReason(orphaned)).toBe('This provider is not connected');
  });
});

describe('placing a booking on a day', () => {
  const booking = { startDate: '2027-01-29' } satisfies Pick<TravelBooking, 'startDate'>;

  it('counts from the trip start date, not from a stay ordinal', () => {
    expect(bookingDayNumber(booking, '2027-01-21', 11)).toBe(9);
  });

  it('places nothing when the trip has no start date to count from', () => {
    expect(bookingDayNumber(booking, undefined, 11)).toBeUndefined();
  });

  it('places nothing outside the trip', () => {
    expect(bookingDayNumber(booking, '2027-02-10', 11)).toBeUndefined();
    expect(bookingDayNumber(booking, '2027-01-21', 3)).toBeUndefined();
  });
});

/**
 * "No price" and "the traveller typed a price" were the same value until
 * 2026-08-31, which made a card with nothing to show say "Price entered
 * manually" about an entry nobody made. Most attractions have no price at all,
 * so this is the ordinary case rather than an edge one.
 */
describe('telling an absent price from a manual one', () => {
  const provider = (over: Record<string, unknown> = {}) => ({
    amount: 120,
    currency: 'MYR',
    source: 'provider' as const,
    retrievedAt: '2027-01-29T11:40:00Z',
    ...over,
  });

  it('reports no price as unknown, never as manual', () => {
    expect(priceFreshness(undefined, NOW)).toBe('unknown');
    expect(priceFreshness(undefined, NOW)).not.toBe('manual');
  });

  it('says nothing at all about a price that does not exist', () => {
    // The old answer here was "Price entered manually", a claim about an act
    // the traveller never performed.
    expect(priceValidityLabel(undefined, NOW)).toBeUndefined();
    expect(priceCheckedLabel(undefined, NOW)).toBeUndefined();
    expect(formatBookingPrice(undefined)).toBeUndefined();
  });

  it('still reports a figure the traveller typed as manual', () => {
    const manual = { amount: 80, currency: 'MYR', source: 'manual' as const, retrievedAt: '2027-01-29T09:00:00Z' };
    expect(priceFreshness(manual, NOW)).toBe('manual');
    expect(priceValidityLabel(manual, NOW)).toBe('Price entered manually');
  });

  it("treats an operator's published admission as checked, not guaranteed", () => {
    // An admission rate on a venue's own page is a real, sourced figure — and
    // the venue guaranteed nothing about how long it stands.
    const official = provider({ source: 'official-website', sourceUrl: 'https://www.louvre.fr/en/tickets' });
    expect(priceFreshness(official, NOW)).toBe('checked');
  });

  it('leaves the four sourced states exactly as they were', () => {
    expect(priceFreshness(provider(), NOW)).toBe('checked');
    expect(priceFreshness(provider({ expiresAt: '2027-01-29T12:30:00Z' }), NOW)).toBe('live');
    expect(priceFreshness(provider({ expiresAt: '2027-01-29T11:30:00Z' }), NOW)).toBe('expired');
    const ageing: FreshnessPolicy = { mode: 'age-based', staleAfterMinutes: 10 };
    expect(priceFreshness(provider(), NOW, ageing)).toBe('stale');
  });

  it('does not turn an unpriced confirmed booking into a checked one', () => {
    // `bookingPriceFreshness` downgrades a confirmed price to `checked` because
    // what was paid is a receipt. With no price there is no receipt to report.
    const unpriced = { status: 'confirmed' as const, provider: 'duffel', price: undefined };
    expect(bookingPriceFreshness(unpriced, NOW)).toBe('unknown');
    expect(bookingPriceValidityLabel(unpriced, NOW)).toBeUndefined();
  });

  it('gives a truthful reason when there is no price and nobody to ask', () => {
    const nothing = { status: 'planned' as const, provider: undefined, price: undefined };
    expect(canRefreshPrice(nothing)).toBe(false);
    expect(refreshUnavailableReason(nothing)).toBe('No price to refresh');
  });

  it('still offers refresh when a wired provider could price it for the first time', () => {
    // No adapter ships in this release, so the wired provider is registered
    // here rather than borrowed from the roster. That also keeps the assertion
    // about `canRefreshPrice` itself instead of about which providers happen to
    // exist on any given branch.
    const stub = {
      id: 'test-provider',
      label: 'Test provider',
      supports: () => true,
      search: async () => [],
      refresh: async () => null,
      materialise: () => ({ type: 'activity-ticket' as const, status: 'planned' as const, title: '', startDate: '2027-01-29' }),
    };
    travelOfferProviders.push(stub);
    try {
      const unpriced = { status: 'planned' as const, provider: stub.id, price: undefined };
      expect(canRefreshPrice(unpriced)).toBe(true);
      expect(refreshUnavailableReason(unpriced)).toBeUndefined();
    } finally {
      travelOfferProviders.splice(travelOfferProviders.indexOf(stub), 1);
    }
  });

  it('survives persistence without acquiring a price nobody entered', () => {
    const saved = sanitizeTravelBooking({
      id: 'booking-activity-1',
      type: 'activity-ticket',
      status: 'planned',
      title: 'Batu Caves',
      startDate: '2027-01-29',
    }, 0);
    expect(saved?.price).toBeUndefined();
    expect(priceFreshness(saved?.price, NOW)).toBe('unknown');

    const roundTripped = JSON.parse(JSON.stringify(saved)) as TravelBooking;
    expect(roundTripped.price).toBeUndefined();
    expect(priceFreshness(roundTripped.price, NOW)).toBe('unknown');
  });

  it('keeps where a stored price came from', () => {
    const saved = sanitizeTravelBooking({
      id: 'booking-activity-2',
      type: 'activity-ticket',
      status: 'planned',
      title: 'Petronas Towers',
      startDate: '2027-01-29',
      price: { amount: 98, currency: 'myr', source: 'official-website', sourceUrl: 'https://www.petronastwintowers.com.my/', retrievedAt: '2027-01-29T11:40:00Z' },
    }, 0);
    expect(saved?.price?.source).toBe('official-website');
    expect(saved?.price?.currency).toBe('MYR');
    expect(priceFreshness(saved?.price, NOW)).toBe('checked');
  });


});

/**
 * A stored amount whose `source` is unreadable is a price without provenance.
 *
 * The first fix for this defaulted it to `manual`, which is safe from a
 * provider-trust angle and still untrue: it asserts the traveller typed a
 * figure they may never have seen. The amount is knowable; who supplied it is
 * not, and the model now keeps those two facts apart.
 */
describe('a price whose provenance did not survive', () => {
  const legacy = (source: unknown) => sanitizeTravelBooking({
    id: 'booking-activity-legacy',
    type: 'activity-ticket',
    status: 'planned',
    title: 'Older record',
    startDate: '2027-01-29',
    price: { amount: 50, currency: 'MYR', source, retrievedAt: '2027-01-29T11:40:00Z' },
  }, 0);

  it('keeps the amount rather than discarding a real number', () => {
    const saved = legacy('scraped-from-somewhere');
    expect(saved?.price?.amount).toBe(50);
    expect(saved?.price?.currency).toBe('MYR');
  });

  it('never claims the traveller entered it', () => {
    for (const source of ['scraped-from-somewhere', undefined, '', 42, null]) {
      expect(legacy(source)?.price?.source).toBe('unspecified');
      expect(legacy(source)?.price?.source).not.toBe('manual');
    }
  });

  it('never claims anyone vouched for it either', () => {
    const price = legacy('scraped-from-somewhere')?.price;
    const state = priceFreshness(price, NOW);
    expect(state).toBe('unsourced');
    for (const claim of ['checked', 'live', 'manual', 'expired', 'unknown']) {
      expect(state).not.toBe(claim);
    }
  });

  it('says what it can and no more', () => {
    const price = legacy('scraped-from-somewhere')?.price;
    expect(priceValidityLabel(price, NOW)).toBe('Source not recorded');
    expect(priceCheckedLabel(price, NOW)).toBe('Source not recorded');
    expect(formatBookingPrice(price)).toBe('MYR 50');
  });

  it('does not let an expiry it never carried apply to it', () => {
    // An unsourced price has no provider boundary, so it cannot expire, and an
    // age-based policy must not quietly promote it to "checked then stale".
    const price = legacy('scraped-from-somewhere')?.price;
    const ageing: FreshnessPolicy = { mode: 'age-based', staleAfterMinutes: 1 };
    expect(priceFreshness(price, NOW, ageing)).toBe('unsourced');
  });

  it('does not become a receipt when the booking is confirmed', () => {
    const price = legacy('scraped-from-somewhere')?.price;
    const confirmed = { status: 'confirmed' as const, provider: undefined, price };
    expect(bookingPriceFreshness(confirmed, NOW)).toBe('unsourced');
    expect(bookingPriceValidityLabel(confirmed, NOW)).toBe('Source not recorded');
    expect(refreshUnavailableReason(confirmed)).toBe('Price paid at booking');
  });

  it('offers no refresh, and says why truthfully', () => {
    const price = legacy('scraped-from-somewhere')?.price;
    const planned = { status: 'planned' as const, provider: undefined, price };
    expect(canRefreshPrice(planned)).toBe(false);
    expect(refreshUnavailableReason(planned)).toBe('Source not recorded');
  });

  it('round-trips deterministically without acquiring provenance', () => {
    const once = legacy('scraped-from-somewhere');
    const twice = sanitizeTravelBooking(JSON.parse(JSON.stringify(once)), 0);
    expect(twice?.price).toEqual(once?.price);
    expect(twice?.price?.source).toBe('unspecified');
    expect(priceFreshness(twice?.price, NOW)).toBe('unsourced');
  });

  it('leaves a readable source alone', () => {
    expect(legacy('official-website')?.price?.source).toBe('official-website');
    expect(legacy('provider')?.price?.source).toBe('provider');
    expect(legacy('manual')?.price?.source).toBe('manual');
  });
});

import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../data';
import { emptyItinerary, sanitizeItinerary, sanitizeTravelBooking } from './itinerarySanitize';
import {
  formatBookingPrice,
  priceCheckedLabel,
  priceFreshness,
  bookingDayNumber,
  type TravelBooking,
} from './travelBooking';
import { canRefreshPrice, refreshUnavailableReason, travelOfferProviders } from './travelOffer';

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

  it('does not expire a price that carries no expiry', () => {
    // The absence of an expiry is not an expiry of zero. Treating it as one
    // would mark every fetched price dead on arrival.
    expect(priceFreshness(providerPrice(), NOW)).toBe('live');
    const old = providerPrice({ retrievedAt: new Date(NOW - 90 * 60000).toISOString() });
    expect(priceFreshness(old, NOW)).toBe('stale');
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
  it('offers no refresh for a manually entered price', () => {
    const manual = { provider: undefined, price: { amount: 1, currency: 'MYR', source: 'manual' as const, retrievedAt: '' } };
    expect(canRefreshPrice(manual)).toBe(false);
    expect(refreshUnavailableReason(manual)).toBe('Price entered manually');
  });

  it('never calls a fetched price manual, even when the provider field is missing', () => {
    // Otherwise one card could say "Checked 12 min ago" and "Price entered
    // manually" at the same time — two contradictory claims about one number.
    const fetched = { provider: undefined, price: { amount: 154, currency: 'CNY', source: 'provider' as const, retrievedAt: '' } };
    expect(canRefreshPrice(fetched)).toBe(false);
    expect(refreshUnavailableReason(fetched)).toBe('This provider is not connected');
  });

  it('offers no refresh for a provider that is not wired up', () => {
    // V1 ships no providers, and the control must say so rather than render a
    // button that silently does nothing and implies a re-check happened.
    expect(travelOfferProviders).toHaveLength(0);
    const orphaned = { provider: 'duffel', price: { amount: 1, currency: 'MYR', source: 'provider' as const, retrievedAt: '' } };
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

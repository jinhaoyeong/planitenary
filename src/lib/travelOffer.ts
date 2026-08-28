/**
 * What a provider is quoting right now.
 *
 * An offer and a booking are different kinds of fact and must not share a
 * record. An offer is inventory: it belongs to a provider, it has a price that
 * moves, and it stops existing after a few minutes. A booking is the
 * traveller's own decision, and it has to survive a reload, a sync, a restore
 * from backup, and a year of the provider changing its API.
 *
 * Collapsing the two is the mistake that would put `providerOfferId` and a
 * fifteen-minute expiry into the saved itinerary, so that reopening a trip in
 * March showed a hotel whose price "expired" in January and whose refresh
 * button called an endpoint that had been retired.
 *
 * V1 ships **no provider**. This file exists to fix the boundary before any
 * provider arrives, so that adding Duffel, Booking.com, Viator or Omio later is
 * an implementation of {@link TravelOfferProvider} and not a redesign of
 * {@link TravelBooking}.
 */
import type { PriceSnapshot, TravelBooking, TravelBookingType } from './travelBooking';

/**
 * A quote, as the provider returned it.
 *
 * Never persisted into the itinerary. An offer becomes durable only by being
 * materialised into a booking, which is a deliberate act by the traveller.
 */
export interface TravelOffer {
  provider: string;
  providerOfferId: string;
  bookingType: TravelBookingType;
  title: string;
  price: PriceSnapshot;
  /** The provider's own expiry, when it publishes one. Never invented here. */
  validUntil?: string;
  /** Where the traveller completes the purchase. Always the provider's site. */
  bookingUrl?: string;
  /**
   * Provider-specific facts, kept flat and stringly typed on purpose.
   *
   * Anything that matters enough to plan around has a named field on
   * `TravelBooking`. This is for the rest — a fare brand, a room code — which
   * would otherwise push provider vocabulary into the durable model.
   */
  details?: Record<string, string | number | boolean>;
}

/** What a search asks for. Kept to what every provider can actually answer. */
export interface TravelOfferQuery {
  bookingType: TravelBookingType;
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate?: string;
  origin?: string;
  destination?: string;
  city?: string;
  partySize?: number;
  currency?: string;
}

/**
 * The narrow surface a provider has to implement.
 *
 * Three operations, because three are what the timeline needs: find something,
 * ask again when the price has aged, and turn a chosen offer into a durable
 * record. Anything wider would be designing for a provider we have not read the
 * documentation of yet.
 */
export interface TravelOfferProvider {
  id: string;
  label: string;
  supports(bookingType: TravelBookingType): boolean;
  search(query: TravelOfferQuery): Promise<TravelOffer[]>;
  /** A fresh quote for the same inventory, or null when it is gone. */
  refresh(offer: Pick<TravelOffer, 'provider' | 'providerOfferId'>): Promise<TravelOffer | null>;
  /** Pure: the durable record this offer would become if chosen. */
  materialise(offer: TravelOffer): Omit<TravelBooking, 'id'>;
}

/**
 * Every provider wired up. Empty in V1, and that emptiness is load-bearing:
 * {@link canRefreshPrice} reads it, so a manual booking correctly reports that
 * nothing can refresh it rather than offering a button that does nothing.
 */
export const travelOfferProviders: TravelOfferProvider[] = [];

export const providerById = (id: string | undefined): TravelOfferProvider | undefined =>
  (id ? travelOfferProviders.find((provider) => provider.id === id) : undefined);

/**
 * Whether a "Refresh price" control is truthful for this booking.
 *
 * False for everything a traveller typed in, and false for a provider record
 * whose provider is not wired up any more. The UI must not offer an action it
 * cannot perform — a refresh that silently does nothing is worse than no
 * refresh, because it implies the number was re-checked.
 */
export function canRefreshPrice(booking: Pick<TravelBooking, 'provider' | 'price'>): boolean {
  if (!booking.provider) return false;
  if (booking.price && booking.price.source === 'manual') return false;
  const provider = providerById(booking.provider);
  return Boolean(provider);
}

/**
 * Why refresh is unavailable, in words a traveller can act on.
 *
 * Returns undefined when refresh *is* available, so a caller can use the
 * presence of a reason as the disabled state without a second predicate.
 */
export function refreshUnavailableReason(booking: Pick<TravelBooking, 'provider' | 'price'>): string | undefined {
  if (canRefreshPrice(booking)) return undefined;
  // The price's own `source` decides the wording, not whether `provider` is
  // filled in. Reading the absence of `provider` as "typed in by hand" let a
  // card say "Checked 12 minutes ago" and "Price entered manually" at once,
  // which is two contradictory claims about the same number.
  if (!booking.price || booking.price.source === 'manual') return 'Price entered manually';
  return 'This provider is not connected';
}

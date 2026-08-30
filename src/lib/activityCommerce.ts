/**
 * What Planitenary can honestly say about buying a ticket for an attraction.
 *
 * Four provider attempts — Viator, GetYourGuide, Tiqets, Headout — produced no
 * usable account, and each failed outside the code: an account was removed, a
 * traffic threshold was unreachable, a signup could not be completed, a
 * documentation site was withdrawn. The conclusion recorded in
 * `docs/providers/activity-commerce-fallback.md` is that commerce is
 * *enrichment over a plan that is already complete*, so the ordinary state of
 * an attraction is "no price, and that is fine".
 *
 * This module holds the two decisions that must not be made ad hoc in a
 * component: what commercial knowledge we have, and where a traveller should be
 * sent. Neither ever asserts availability — no provider currently reachable
 * supplies it, and "Available" without an authority is the exact failure the
 * booking layer exists to prevent.
 */
import { isLikelyResellerUrl, isSafePublicUrl } from '../../supabase/functions/_shared/officialSource';
import type { PriceSnapshot } from './travelBooking';

/**
 * How much commercial knowledge exists about one attraction.
 *
 * Ordered by what it lets the interface say, not by desirability — the first
 * state is the common one and is fully usable. These are internal names; the
 * traveller sees the consequence, never the label.
 */
export type ActivityCommerceState =
  /** Nothing to say beyond the attraction itself. Still fully schedulable. */
  | 'no-commerce-data'
  /** No amount, but an honest place to go and find out. */
  | 'official-link-only'
  /** The operator publishes an admission price. Not an offer, not inventory. */
  | 'official-price'
  /** A commerce provider quoted a price for this attraction. */
  | 'marketplace-enriched';

/** Which authority a booking link came from. Never guessed, never blended. */
export type BookingLinkAuthority = 'official-ticket' | 'official-website' | 'provider';

export interface ActivityBookingLink {
  url: string;
  authority: BookingLinkAuthority;
}

/**
 * Everything the two decisions below are allowed to look at.
 *
 * Deliberately not a `TravelBooking` or a place record: this is a pure question
 * about commercial knowledge, and keeping the input narrow stops the ladder
 * quietly acquiring a dependency on itinerary shape.
 */
export interface ActivityCommerceInput {
  /** The price we hold, if any. Absent is the normal case. */
  price?: PriceSnapshot;
  /** The operator's own ticket page, e.g. from `officialTicketLinks`. */
  officialTicketUrl?: string;
  /** The operator's own website. */
  officialWebsiteUrl?: string;
  /** A URL from a provider we deliberately support, with its attribution. */
  providerUrl?: string;
  /** The provider id backing `providerUrl`. A URL without one is not trusted. */
  provider?: string;
}

/**
 * A URL that may stand for the operator itself.
 *
 * Two independent refusals. `isSafePublicUrl` keeps an attacker-supplied
 * OpenStreetMap tag from becoming a request target; `isLikelyResellerUrl` keeps
 * a marketplace from being presented as the venue's own voice. Both are reused
 * rather than reimplemented — a second copy of the reseller host list would
 * drift, and the day it drifts is the day a Viator page is captioned "Official
 * website".
 */
const asOfficialUrl = (raw: string | undefined): string | undefined =>
  (raw && isSafePublicUrl(raw) && !isLikelyResellerUrl(raw) ? raw : undefined);

/**
 * What we know commercially about this attraction.
 *
 * A manual price does not appear here on purpose. What a traveller typed into
 * their own plan is their note to themselves, not commercial knowledge we
 * sourced, so it neither raises nor lowers this state — it is reported by
 * `priceFreshness` as `manual` and shown as their own figure.
 */
export function activityCommerceState(input: ActivityCommerceInput): ActivityCommerceState {
  if (input.price?.source === 'provider') return 'marketplace-enriched';
  if (input.price?.source === 'official-website') return 'official-price';
  return activityBookingLink(input) ? 'official-link-only' : 'no-commerce-data';
}

/**
 * Where to send a traveller who wants to act on this attraction, or nowhere.
 *
 * The ladder prefers the operator over any intermediary, because the operator
 * is who actually sells the ticket and the traveller keeps the whole
 * transaction. A marketplace is reached only when we deliberately support that
 * provider — `providerUrl` without a `provider` is discarded rather than
 * followed, since an unattributed marketplace URL is a guess.
 *
 * Returning `undefined` is a real answer. An attraction with no operator site
 * and no provider still belongs in the plan, still holds its opening hours, and
 * still occupies its slot; it simply offers no link.
 */
export function activityBookingLink(input: ActivityCommerceInput): ActivityBookingLink | undefined {
  const ticket = asOfficialUrl(input.officialTicketUrl);
  if (ticket) return { url: ticket, authority: 'official-ticket' };

  const website = asOfficialUrl(input.officialWebsiteUrl);
  if (website) return { url: website, authority: 'official-website' };

  // A provider link is allowed to be a marketplace host — that is the point of
  // it — but it must still be a safe public URL and must name its provider.
  if (input.provider && input.providerUrl && isSafePublicUrl(input.providerUrl)) {
    return { url: input.providerUrl, authority: 'provider' };
  }

  return undefined;
}

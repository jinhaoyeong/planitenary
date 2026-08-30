/**
 * The one place that decides what a stored price reads as.
 *
 * `admissionCopy` already does this job for `PlaceAdmission` — what a *venue*
 * publishes about itself. This is its counterpart for `PriceSnapshot` — what
 * *we* hold about a booking or a ticket — and it exists for the same reason:
 * two surfaces describing the same figure differently is how a card ends up
 * claiming a price is current when nobody said so.
 *
 * The rule it enforces: **every branch says something true and specific, and
 * the hedged branches are audibly hedged.** There is no "Price unavailable",
 * because that string would stand in for four different facts — no price was
 * ever fetched, a provider withdrew one, a legacy record lost its provenance,
 * and the traveller typed one — which the domain now keeps apart.
 *
 * Nothing here invents an amount. In particular a missing price never becomes
 * `0` and never becomes "Free": costing nothing is a claim a source has to
 * make, and `describeAdmission` is the only thing entitled to make it.
 */
import {
  formatBookingPrice,
  priceFreshness,
  DEFAULT_FRESHNESS_POLICY,
  type FreshnessPolicy,
  type PriceSnapshot,
  type PriceState,
} from './travelBooking';
import type { ActivityBookingLink } from './activityCommerce';

export interface PriceDisplay {
  /** The figure, formatted, when there is one worth showing. */
  amount?: string;
  /** The qualifier that makes the amount honest. Never empty. */
  note: string;
  /**
   * Whether the amount may be presented as what it costs *now*.
   *
   * False for a price that aged, expired, was typed in, or arrived without
   * provenance. A caller showing `amount` while ignoring this is making the
   * claim this module exists to prevent.
   */
  current: boolean;
  state: PriceState;
}

/**
 * What this price is, said in a phrase.
 *
 * `checked` splits on provenance because "Official price" is a stronger claim
 * than "Checked price" and only the venue's own site earns it. A provider
 * quote with no expiry is checked and no more — the provider named a number
 * and guaranteed nothing about how long it stands.
 */
export function describePriceState(
  price: PriceSnapshot | undefined,
  now: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): PriceDisplay {
  const state = priceFreshness(price, now, policy);
  const amount = formatBookingPrice(price);

  switch (state) {
    case 'unknown':
      // No amount, deliberately. Not "RM 0", not "Free", not "Unavailable" —
      // an instruction to the traveller instead of a claim about the venue.
      return { note: 'Check current price', current: false, state };

    case 'unsourced':
      return { amount, note: 'Source not recorded', current: false, state };

    case 'manual':
      return { amount, note: 'Entered manually', current: false, state };

    case 'checked':
      return price?.source === 'official-website'
        ? { amount, note: 'Official price', current: true, state }
        : { amount, note: 'Checked price', current: true, state };

    case 'stale':
      return { amount, note: 'Price may have changed', current: false, state };

    case 'live':
      return { amount, note: 'Current price', current: true, state };

    case 'expired':
      // The provider withdrew this figure. The amount travels so a surface with
      // somewhere safe for it can show what the quote *was*, but `current` is
      // false and the note tells the traveller what to do instead.
      return { amount, note: 'Check current price', current: false, state };
  }
}

/**
 * What the button says, given where it goes and whether a price is known.
 *
 * Never "Book now". Every destination in the ladder is somewhere the traveller
 * finds out more or buys from someone else — none of them is a booking flow we
 * operate, and a label promising one would be the click-off equivalent of
 * claiming a price is current.
 */
export function bookingCtaLabel(
  link: ActivityBookingLink | undefined,
  priceKnown: boolean,
): string | undefined {
  if (!link) return undefined;
  if (link.authority === 'official-website') return 'Official website';
  // A ticket destination with a figure already shown is somewhere to confirm
  // and buy; without one it is somewhere to go and find out.
  return priceKnown ? 'View tickets' : 'Check tickets';
}

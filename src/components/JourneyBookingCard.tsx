import { BedDouble, Plane, RefreshCw, Ticket, TrainFront, Car } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  elapsedMinutes,
  formatBookingPrice,
  hasComparableClocks,
  priceCheckedLabel,
  type TravelBooking,
  type TravelBookingType,
} from '../lib/travelBooking';
import {
  bookingPriceFreshness,
  bookingPriceValidityLabel,
  canRefreshPrice,
  refreshUnavailableReason,
} from '../lib/travelOffer';

interface JourneyBookingCardProps {
  booking: TravelBooking;
  /**
   * The clock this card is read against.
   *
   * Passed in rather than read here so freshness is a pure function of props.
   * A component that called `Date.now()` internally would render differently on
   * every pass and could never be asserted against in a test.
   */
  now: number;
  onEdit?: (bookingId: string) => void;
  onRefreshPrice?: (bookingId: string) => void;
  compact?: boolean;
}

const BOOKING_ICONS: Record<TravelBookingType, ReactNode> = {
  flight: <Plane aria-hidden="true" />,
  stay: <BedDouble aria-hidden="true" />,
  rail: <TrainFront aria-hidden="true" />,
  transfer: <Car aria-hidden="true" />,
  'activity-ticket': <Ticket aria-hidden="true" />,
};

const BOOKING_LABELS: Record<TravelBookingType, string> = {
  flight: 'Flight',
  stay: 'Stay',
  rail: 'Rail',
  transfer: 'Transfer',
  'activity-ticket': 'Ticket',
};

const STATUS_LABELS: Record<TravelBooking['status'], string> = {
  planned: 'Planned',
  requested: 'Requested',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

/** `Jan 29` from `2027-01-29`, without pulling in a date library. */
const shortDate = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * One arrangement, in the handbook's own voice.
 *
 * Deliberately not a copy of the purple provider cards it is modelled on: the
 * journey timeline already has a typographic system, and a booking is one more
 * kind of fact on it rather than an advertisement pasted into it.
 */
export function JourneyBookingCard({ booking, now, onEdit, onRefreshPrice, compact = false }: JourneyBookingCardProps) {
  const freshness = bookingPriceFreshness(booking, now);
  const price = formatBookingPrice(booking.price);
  const checked = priceCheckedLabel(booking.price, now);
  // A guaranteed price answers "how long have I got", not "how old is this",
  // and a paid one answers neither. Every other state has no boundary to count
  // down to, so the plain age stands.
  const validity = freshness === 'live' || booking.status === 'confirmed'
    ? bookingPriceValidityLabel(booking, now)
    : checked;
  const refreshable = canRefreshPrice(booking);
  const unavailable = refreshUnavailableReason(booking);
  // Absence of a price is not a manual price. Reading it as one hid refresh on
  // exactly the records a provider could still price for the first time, and
  // it is the state most activities are in.
  const isManualPrice = booking.price?.source === 'manual';
  /**
   * A refresh control appears only where the number is still a quote.
   *
   * Not for a price typed in by hand, and not for a confirmed booking either:
   * what a held reservation cost is a receipt, and re-pricing it would replace
   * the only record of what was actually charged.
   */
  // A provider is what makes refresh meaningful, so an unpriced attraction with
  // nobody to ask shows no control at all rather than a disabled one — that is
  // the ordinary state of a plan, not a fault worth flagging on every card.
  const showsRefresh = !isManualPrice
    && Boolean(booking.provider)
    && booking.status !== 'confirmed';

  const route = booking.origin && booking.destination
    ? `${booking.origin} → ${booking.destination}`
    : undefined;
  const startDate = shortDate(booking.startDate);
  const endDate = shortDate(booking.endDate);
  const dateLine = endDate && endDate !== startDate ? `${startDate} → ${endDate}` : startDate;

  const minutes = elapsedMinutes(booking);
  const elapsed = minutes === undefined
    ? undefined
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  const arrivesLaterDay = Boolean(booking.endDate && booking.endDate !== booking.startDate);
  // Only where a duration would otherwise be assumed: a journey whose two
  // clocks cannot be proved to share a zone.
  const showsLocalClocksNote = Boolean(booking.startTime && booking.endTime) && !hasComparableClocks(booking);

  return (
    <article
      className={`journey-booking-card${compact ? ' is-compact' : ''}`}
      data-booking-type={booking.type}
      data-booking-status={booking.status}
    >
      <span className="journey-booking-icon">{BOOKING_ICONS[booking.type]}</span>

      <div className="journey-booking-body">
        <span className="journey-booking-kicker">
          {BOOKING_LABELS[booking.type]}
          {booking.operator ? ` · ${booking.operator}` : ''}
          {booking.serviceNumber ? ` ${booking.serviceNumber}` : ''}
        </span>
        <strong className="journey-booking-title">{booking.title}</strong>

        {route && (
          <span className="journey-booking-route">
            <span>{booking.origin}</span>
            <i aria-hidden="true" />
            <span>{booking.destination}</span>
          </span>
        )}

        <span className="journey-booking-meta">
          {dateLine}
          {booking.startTime ? ` · ${booking.startTime}` : ''}
          {booking.endTime && booking.endTime !== booking.startTime ? ` – ${booking.endTime}${arrivesLaterDay ? ' (+1)' : ''}` : ''}
          {elapsed ? ` · ${elapsed}` : ''}
          {booking.roomDescription ? ` · ${booking.roomDescription}` : ''}
          {booking.cabin ? ` · ${booking.cabin}` : ''}
        </span>

        {/*
          Two clocks in two zones are not a range. Without both zone names the
          duration is unknowable — 10:55 to 17:20 is 7h25m between Osaka and
          Kuala Lumpur and 6h25m if you just subtract — so the card says which
          clock each time belongs to and prints no duration at all.
        */}
        {showsLocalClocksNote && (
          <span className="journey-booking-meta">Times are local to each airport</span>
        )}

        {booking.reference && (
          <span className="journey-booking-meta">Ref {booking.reference}</span>
        )}
      </div>

      <div className="journey-booking-side">
        <span className={`journey-booking-status is-${booking.status}`}>{STATUS_LABELS[booking.status]}</span>

        {price && (
          <span className={`journey-booking-price is-${freshness}`}>
            {freshness === 'expired' ? <s>{price}</s> : price}
          </span>
        )}

        {freshness === 'expired' && <span className="journey-booking-flag">Expired</span>}
        {freshness === 'stale' && <span className="journey-booking-flag is-soft">Price may have changed</span>}
        {validity && <small className="journey-booking-checked">{validity}</small>}

        {/*
          A refresh control appears only where something can actually refresh.
          V1 has no wired provider, so a manually entered fare says so and
          offers nothing — a button that silently did nothing would imply the
          number had just been re-checked, which is the one lie this whole
          layer exists to prevent.
        */}
        {showsRefresh && (
          <button
            type="button"
            className="journey-booking-refresh"
            disabled={!refreshable}
            title={unavailable}
            onClick={refreshable && onRefreshPrice ? () => onRefreshPrice(booking.id) : undefined}
          >
            <RefreshCw aria-hidden="true" />
            Refresh price
          </button>
        )}

        {onEdit && (
          <button type="button" className="journey-booking-edit" onClick={() => onEdit(booking.id)}>
            Details
          </button>
        )}
      </div>
    </article>
  );
}

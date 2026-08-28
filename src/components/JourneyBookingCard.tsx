import { BedDouble, Plane, RefreshCw, Ticket, TrainFront, Car } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  formatBookingPrice,
  priceCheckedLabel,
  priceFreshness,
  type TravelBooking,
  type TravelBookingType,
} from '../lib/travelBooking';
import { canRefreshPrice, refreshUnavailableReason } from '../lib/travelOffer';

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
  const freshness = priceFreshness(booking.price, now);
  const price = formatBookingPrice(booking.price);
  const checked = priceCheckedLabel(booking.price, now);
  const refreshable = canRefreshPrice(booking);
  const unavailable = refreshUnavailableReason(booking);
  const isManualPrice = booking.price?.source === 'manual' || !booking.price;

  const route = booking.origin && booking.destination
    ? `${booking.origin} → ${booking.destination}`
    : undefined;
  const startDate = shortDate(booking.startDate);
  const endDate = shortDate(booking.endDate);
  const dateLine = endDate && endDate !== startDate ? `${startDate} → ${endDate}` : startDate;

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
          {booking.endTime && booking.endTime !== booking.startTime ? ` – ${booking.endTime}` : ''}
          {booking.roomDescription ? ` · ${booking.roomDescription}` : ''}
          {booking.cabin ? ` · ${booking.cabin}` : ''}
        </span>

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
        {checked && <small className="journey-booking-checked">{checked}</small>}

        {/*
          A refresh control appears only where something can actually refresh.
          V1 has no wired provider, so a manually entered fare says so and
          offers nothing — a button that silently did nothing would imply the
          number had just been re-checked, which is the one lie this whole
          layer exists to prevent.
        */}
        {!isManualPrice && (
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

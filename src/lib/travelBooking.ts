/**
 * What the traveller has actually arranged.
 *
 * The itinerary says where a day goes. It has never been able to say that the
 * traveller holds a seat on the 10:55 to Kuala Lumpur, or that the room in Nara
 * is paid for and the door does not open before three. Those are not opinions
 * the planner may revise; they are facts the plan has to fit around.
 *
 * Two rules shape everything here, and they are why this is a module of its own
 * rather than another field on `Activity`.
 *
 * **A booking is not an activity.** Putting a confirmed flight into
 * `days[].activities` would hand the planner permission to move it, shorten it,
 * or drop it for a better museum — every operation that exists precisely
 * because activities are provisional. Bookings sit beside `days`, and the
 * planner reads them as constraints rather than as material.
 *
 * **A price is a claim with a date on it.** This mirrors `PlaceAdmission`
 * exactly: an amount, its currency, where it came from, and when it was
 * retrieved. Nothing here ever stores "expired" or "live" — those are read off
 * the clock at display time, because a value that changes on its own cannot be
 * persisted without making every save look like an edit to the realtime sync.
 *
 * No provider is imported. V1 has none, and the model must not acquire the
 * shape of whichever one arrives first.
 */
import { ISO_DATE_PATTERN, type IsoDate } from './dateRange';

/**
 * What kind of arrangement this is.
 *
 * Bounded on purpose. Car hire and cruises are real, but each brings its own
 * timing semantics — a collection window, a boarding cut-off — and adding them
 * before the five below are proven would mean guessing at those semantics
 * twice.
 */
export type TravelBookingType = 'flight' | 'stay' | 'rail' | 'transfer' | 'activity-ticket';

/**
 * How far along the arrangement is.
 *
 * Deliberately about the traveller's commitment, not about money: a booking is
 * `confirmed` because they hold it, never because a price was fetched
 * successfully. Nothing in this module promotes a status on its own.
 */
export type TravelBookingStatus = 'planned' | 'requested' | 'confirmed' | 'cancelled';

/**
 * Where a figure came from. `manual` is the honest answer for everything a
 * traveller typed in, and it is what stops the UI offering to "refresh" a
 * number that no system can re-fetch.
 */
export type PriceSource = 'manual' | 'provider' | 'official-website';

/**
 * One price, as it stood at one moment.
 *
 * `retrievedAt` is mandatory: a figure without a time is the thing this whole
 * layer exists to avoid displaying. `expiresAt` is optional and never invented
 * — only a provider that publishes an expiry gets one, which is why a manually
 * entered fare can go stale in a traveller's judgement but never "expires" in
 * ours.
 */
export interface PriceSnapshot {
  amount: number;
  /** ISO 4217, upper case. A number without one is not a price. */
  currency: string;
  source: PriceSource;
  sourceUrl?: string;
  /** ISO 8601 instant the figure was read. */
  retrievedAt: string;
  /** ISO 8601 instant the provider itself said it stops being valid. */
  expiresAt?: string;
}

/**
 * A durable arrangement, stored with the trip.
 *
 * Every field is either something a traveller can point at on a confirmation
 * email or something a provider published. Nothing derived belongs here — see
 * the note on `cityKey` for the one that keeps trying to.
 */
export interface TravelBooking {
  id: string;
  type: TravelBookingType;
  status: TravelBookingStatus;
  /** What it is called on the confirmation: "AK 68", "Hotel Nikko Osaka". */
  title: string;
  /** Local calendar date it begins, `YYYY-MM-DD`. */
  startDate: IsoDate;
  /** Local clock time it begins, `HH:MM`. Absent when only the date is known. */
  startTime?: string;
  /** Check-out, landing, or arrival date when it differs from the start. */
  endDate?: IsoDate;
  endTime?: string;
  /**
   * The city a stay sits in, as the traveller wrote it, plus its normalised
   * form for comparison.
   *
   * **Never a `legId`.** `osaka#1` is derived inside a single build and
   * renumbers the moment a route is reordered, so a booking holding one would
   * silently retarget to a different stay. A city name and a pair of dates
   * survive reordering because they were never ordinals.
   */
  city?: string;
  cityKey?: string;
  /** For anything that moves: where it leaves from and arrives at. */
  origin?: string;
  destination?: string;
  /** Airline, rail operator, hotel group, tour company. */
  operator?: string;
  /** Flight number, train number, service code. */
  serviceNumber?: string;
  cabin?: string;
  roomDescription?: string;
  partySize?: number;
  /** The traveller's own booking reference. */
  reference?: string;
  price?: PriceSnapshot;
  /** Set only when a provider supplied this record. Absent for manual entry. */
  provider?: string;
  providerBookingId?: string;
  providerOfferId?: string;
  notes?: string;
}

/** Normalised city name, matching `cityLegs.cityKey`. Never shown to anyone. */
export const bookingCityKey = (city: string): string => city.trim().toLowerCase();

export const TRAVEL_BOOKING_TYPES: TravelBookingType[] = ['flight', 'stay', 'rail', 'transfer', 'activity-ticket'];
export const TRAVEL_BOOKING_STATUSES: TravelBookingStatus[] = ['planned', 'requested', 'confirmed', 'cancelled'];
export const PRICE_SOURCES: PriceSource[] = ['manual', 'provider', 'official-website'];

/** A booking the traveller is actually holding, rather than sketching. */
export const isCommittedBooking = (booking: TravelBooking): boolean =>
  booking.status === 'confirmed' || booking.status === 'requested';

/** Types that move the traveller from one place to another. */
export const isTransportBooking = (booking: TravelBooking): boolean =>
  booking.type === 'flight' || booking.type === 'rail' || booking.type === 'transfer';

/**
 * How current a stored price is, read against a clock.
 *
 * Derived at display time and never written back. Persisting `'expired'` would
 * make the record change without anyone editing it, and the realtime sync
 * compares `JSON.stringify` output to decide whether a remote payload differs
 * from local state — a self-changing field would loop it forever.
 */
export type PriceFreshness = 'live' | 'stale' | 'expired' | 'manual';

/**
 * How long a provider figure stands when the provider named no expiry.
 *
 * Applies to provider material only. A traveller's own typed-in fare is not
 * "stale" after half an hour — nobody is going to re-fetch it — so `manual`
 * prices leave this path entirely rather than accumulating a badge that
 * suggests an action nothing can perform.
 */
export const PROVIDER_PRICE_STALE_AFTER_MINUTES = 30;

const parseInstant = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Whether a price should be shown as current, ageing, or dead.
 *
 * `now` is passed in rather than read here so every caller — the UI, the tests,
 * a future refresh sweep — asks the same question against a clock it controls.
 */
export function priceFreshness(price: PriceSnapshot | undefined, now: number): PriceFreshness {
  if (!price) return 'manual';
  if (price.source === 'manual') return 'manual';
  const expiresAt = parseInstant(price.expiresAt);
  // Only a provider's own expiry can expire a price. The absence of one is not
  // an expiry of zero, which is the mistake that would mark every fetched price
  // dead on arrival.
  if (expiresAt !== undefined && now > expiresAt) return 'expired';
  const retrievedAt = parseInstant(price.retrievedAt);
  if (retrievedAt === undefined) return 'stale';
  const ageMinutes = (now - retrievedAt) / 60000;
  return ageMinutes > PROVIDER_PRICE_STALE_AFTER_MINUTES ? 'stale' : 'live';
}

/**
 * "Checked 18 min ago" — or the plain truth that a traveller typed it in.
 *
 * An age rather than a date, because the question behind the question is how
 * much the number should be trusted, and an ISO string does not answer that.
 */
export function priceCheckedLabel(price: PriceSnapshot | undefined, now: number): string | undefined {
  if (!price) return undefined;
  if (price.source === 'manual') return 'Price entered manually';
  const retrievedAt = parseInstant(price.retrievedAt);
  if (retrievedAt === undefined) return undefined;
  const minutes = Math.max(0, Math.round((now - retrievedAt) / 60000));
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** `MYR 988`. The currency is never optional — see `PriceSnapshot.currency`. */
export function formatBookingPrice(price: PriceSnapshot | undefined): string | undefined {
  if (!price) return undefined;
  const rounded = Number.isInteger(price.amount) ? price.amount : Math.round(price.amount * 100) / 100;
  return `${price.currency} ${rounded.toLocaleString('en-US')}`;
}

const CLOCK_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const isBookingDate = (value: unknown): value is IsoDate =>
  typeof value === 'string' && ISO_DATE_PATTERN.test(value);

export const isBookingClock = (value: unknown): value is string =>
  typeof value === 'string' && CLOCK_PATTERN.test(value);

/**
 * Which trip day a booking lands on, 1-indexed, or `undefined` when the trip
 * has no start date to count from.
 *
 * Dates rather than ordinals is the whole point: reordering the route changes
 * which city day four belongs to, but it does not move the 29th of January.
 */
export function bookingDayNumber(
  booking: Pick<TravelBooking, 'startDate'>,
  tripStartDate: string | undefined,
  dayCount: number,
): number | undefined {
  if (!isBookingDate(tripStartDate) || !isBookingDate(booking.startDate)) return undefined;
  const start = Date.parse(`${tripStartDate}T00:00:00`);
  const at = Date.parse(`${booking.startDate}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(at)) return undefined;
  const dayNumber = Math.round((at - start) / 86400000) + 1;
  if (dayNumber < 1 || (dayCount > 0 && dayNumber > dayCount)) return undefined;
  return dayNumber;
}

/**
 * Bookings in the order a day is lived: by date, then by clock, then by a
 * stable tiebreak so two same-minute records never swap places between saves.
 */
export function sortBookings(bookings: TravelBooking[]): TravelBooking[] {
  return [...bookings].sort((left, right) => {
    if (left.startDate !== right.startDate) return left.startDate < right.startDate ? -1 : 1;
    const leftTime = left.startTime || '';
    const rightTime = right.startTime || '';
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.id < right.id ? -1 : (left.id > right.id ? 1 : 0);
  });
}

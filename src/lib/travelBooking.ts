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
import {
  elapsedMinutes as elapsedZonedMinutes,
  isTimeZone as isIanaTimeZone,
} from '../../supabase/functions/_shared/timeZoneMath';

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
 * successfully. `requested` protects its pending slot but is never presented
 * as equally factual; `planned` is soft information and `cancelled` is inert.
 * Nothing in this module promotes a status on its own.
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
 *
 * ## Which model owns what
 *
 * Planitenary already had two authorities before bookings existed, and a
 * booking augments them rather than replacing either.
 *
 * **Legacy flight schedule** belongs to the `Activity` with `type: 'flight'`
 * on a day. An unlinked flight booking can also protect its own factual local
 * departure/arrival clocks, so the traveller never has to enter a flight
 * twice. When {@link relatedActivityId} explicitly joins the two records they
 * are one real flight: planning de-duplicates them and reports a deterministic
 * mismatch instead of silently choosing between disagreeing schedules.
 *
 * **Where the traveller sleeps** belongs to the stay plan
 * (`tripProfile.cityStays` and `DayPlan.stayCity`). A `stay` booking says
 * which hotel is reserved for those nights. Disagreements surface through
 * `bookingConstraints.stayRouteConflicts`; neither side silently rewrites the
 * other.
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
  /**
   * The zones the two clocks belong to, IANA names.
   *
   * `startTime` is wall time at the origin and `endTime` is wall time at the
   * destination, and for anything crossing a zone those are not comparable
   * numbers. KUL 23:30 → KIX 07:10 the next morning is seven hours forty in
   * wall clock and six hours forty in the air, and nothing can tell the
   * difference from four date/time fields alone.
   *
   * Optional because a traveller may not know them and a domestic hop does not
   * need them. Their absence is never guessed at: {@link elapsedMinutes}
   * returns nothing rather than subtracting two clocks that may be in
   * different zones, and the card declines to print a duration it cannot
   * stand behind. Never read from the browser — the traveller's own zone says
   * nothing about where the aircraft is.
   */
  originTimeZone?: string;
  destinationTimeZone?: string;
  /**
   * Explicit stable link to the legacy flight Activity representing this same
   * real flight. Never inferred from a name, and never a Stage-4 legId.
   */
  relatedActivityId?: string;
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

export type BookingConstraintStrength = 'hard' | 'provisional' | 'none';

/** Confirmed is factual; requested is protected but explicitly pending. */
export const bookingConstraintStrength = (booking: Pick<TravelBooking, 'status'>): BookingConstraintStrength => {
  if (booking.status === 'confirmed') return 'hard';
  if (booking.status === 'requested') return 'provisional';
  return 'none';
};

/** Types that move the traveller from one place to another. */
export const isTransportBooking = (booking: TravelBooking): boolean =>
  booking.type === 'flight' || booking.type === 'rail' || booking.type === 'transfer';

/**
 * How much a stored price can be trusted, in five distinguishable states.
 *
 * The distinction that matters is *who* is making the claim. `live` and
 * `expired` are the provider's own words: it named a boundary and we are
 * either inside it or past it. `checked` and `stale` are ours: the provider
 * told us a number and said nothing about how long it stands, so the most we
 * can honestly report is when we asked and whether that was long enough ago to
 * be worth asking again.
 *
 * Collapsing those two pairs would let a Viator-style price with no expiry
 * either claim a guarantee nobody gave (`live` forever) or announce an expiry
 * nobody declared (`expired` on a timer we invented).
 *
 * Derived at display time and never written back. Persisting `'expired'` would
 * make the record change without anyone editing it, and the realtime sync
 * compares `JSON.stringify` output to decide whether a remote payload differs
 * from local state — a self-changing field would loop it forever.
 */
export type PriceFreshness = 'live' | 'checked' | 'stale' | 'expired' | 'manual';

/**
 * What we know about a price, including the case where there is not one.
 *
 * `PriceFreshness` answers "how much can this number be trusted", which is a
 * question about a number that exists. Most attractions have no number at all:
 * an OSM museum nobody has priced is the *normal* state of a plan, not a
 * degraded one, and it is not the same fact as a figure the traveller typed in.
 *
 * Those two were the same value until 2026-08-31, so a card with no price
 * announced "Price entered manually" — a sentence about an entry nobody made.
 * `unknown` exists to keep the absence sayable, and it is deliberately *not* a
 * member of `PriceFreshness`: there is nothing to be fresh about.
 *
 * Absence is still modelled by the absent snapshot itself — `unknown` is the
 * derived reading of `price === undefined`, never a stored value.
 */
export type PriceState = 'unknown' | PriceFreshness;

/**
 * How a given provider's prices age, declared by that provider.
 *
 * Deliberately not one universal number. Duffel issues a real `expires_at` and
 * a price is good until then no matter how long ago we fetched it; an activity
 * provider that guarantees nothing needs an age rule instead. A shared
 * threshold would either expire Duffel quotes early or invent a deadline the
 * other provider never gave.
 */
export type FreshnessPolicy =
  /** The provider states a validity boundary. Only that boundary expires it. */
  | { mode: 'provider-expiry' }
  /** No boundary given; recommend re-checking after this many minutes. */
  | { mode: 'age-based'; staleAfterMinutes: number };

/**
 * What we assume about a provider that has not declared a policy.
 *
 * `provider-expiry` is the conservative default in both directions: it honours
 * an explicit expiry when one exists, and when none does it stops at `checked`
 * rather than inventing a staleness deadline nobody approved.
 */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = { mode: 'provider-expiry' };

const parseInstant = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Whether a price is absent, guaranteed, merely observed, ageing, or dead.
 *
 * `now` is passed in rather than read here so every caller — the UI, the tests,
 * a future refresh sweep — asks the same question against a clock it controls.
 * `policy` comes from the provider that supplied the number; see
 * `freshnessPolicyFor` in `travelOffer.ts`.
 */
export function priceFreshness(
  price: PriceSnapshot | undefined,
  now: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): PriceState {
  // No price is not a manual price. Nobody typed anything, so there is nothing
  // to attribute to the traveller and nothing to refresh.
  if (!price) return 'unknown';
  if (price.source === 'manual') return 'manual';

  // Only a provider's own expiry can expire a price, and inside that boundary
  // the provider is still standing behind the number — however long ago we
  // asked. Age does not weaken a guarantee that has not run out.
  const expiresAt = parseInstant(price.expiresAt);
  if (expiresAt !== undefined) return now > expiresAt ? 'expired' : 'live';

  // No boundary was given. The absence of one is not an expiry of zero, which
  // is the mistake that would mark every fetched price dead on arrival — but
  // it is not a guarantee either, so this can never reach `live`.
  const retrievedAt = parseInstant(price.retrievedAt);
  // Without a readable `retrievedAt` we cannot say *when* it was checked, so
  // "checked" would be a claim we cannot support. Recommend asking again.
  if (retrievedAt === undefined) return 'stale';
  if (policy.mode !== 'age-based') return 'checked';
  const ageMinutes = (now - retrievedAt) / 60000;
  return ageMinutes > policy.staleAfterMinutes ? 'stale' : 'checked';
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

/**
 * The single phrase that tells the truth about this price, given its state.
 *
 * Separate from `priceCheckedLabel` because "Checked 12 min ago" is only the
 * right sentence for a number nobody guaranteed. Said about a quote that
 * expires in three minutes it buries the fact that actually matters; and
 * "Expired" said about a price that merely aged claims the provider withdrew
 * it when the provider never said anything at all.
 */
export function priceValidityLabel(
  price: PriceSnapshot | undefined,
  now: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): string | undefined {
  const freshness = priceFreshness(price, now, policy);
  // Nothing to label. A caller with no price should say what it will do about
  // that ("Check current price"), which is a decision about the surface rather
  // than a claim about a figure, so this layer stays silent.
  if (freshness === 'unknown') return undefined;
  if (freshness === 'manual') return 'Price entered manually';
  if (freshness === 'expired') return 'Expired';
  if (freshness === 'stale') return 'Price may have changed';
  if (freshness === 'checked') return priceCheckedLabel(price, now);
  // `live` is the only state carrying a provider-declared boundary, so it is
  // the only one that can count down to anything.
  const expiresAt = parseInstant(price?.expiresAt);
  if (expiresAt === undefined) return priceCheckedLabel(price, now);
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60000));
  if (minutes < 1) return 'Expires in under a minute';
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
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

/** A zone this runtime actually recognises. Never a guess, never the browser's. */
export function isTimeZone(value: unknown): value is string {
  return isIanaTimeZone(value);
}

/**
 * How long the journey actually takes, or nothing.
 *
 * Nothing is the important half. Subtracting a destination clock from an
 * origin clock is only arithmetic when both are in the same zone, and this
 * refuses to do it otherwise: a KIX 10:55 → KUL 17:20 flight is 7h25m, and the
 * naive subtraction says 6h25m. Being an hour wrong about a flight is worse
 * than saying nothing, so an unknown zone yields `undefined` and every caller
 * is forced to handle it.
 *
 * Same-zone journeys — both zones given and equal, or neither given on a
 * booking that stays within one date — are safe to subtract directly.
 */
export function elapsedMinutes(booking: TravelBooking): number | undefined {
  return elapsedZonedMinutes(booking);
}

/**
 * Whether the two clocks on this booking are known to be comparable.
 *
 * Drives presentation: a card that cannot prove the zones match must not show
 * the two times as though they were on one dial.
 */
export function hasComparableClocks(booking: TravelBooking): boolean {
  if (!isTransportBooking(booking)) return true;
  const { originTimeZone, destinationTimeZone } = booking;
  if (originTimeZone && destinationTimeZone) return originTimeZone === destinationTimeZone;
  if (originTimeZone || destinationTimeZone) return false;
  return (booking.endDate || booking.startDate) === booking.startDate;
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

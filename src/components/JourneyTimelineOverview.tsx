import { useRef, useState } from 'react';
import { BedDouble, CalendarDays, ChevronRight, Clock3, MapPin, PencilLine, Route, TicketCheck, TrainFront } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Activity, DayPhoto, DayPlan, Itinerary } from '../data';
import { countryArtworkForItinerary } from '../lib/countryArtwork';
import { sanitizeTripProfile } from '../lib/tripProfile';
import { bookingDayNumber, type TravelBooking } from '../lib/travelBooking';
import { JourneyBookingCard } from './JourneyBookingCard';

interface JourneyTimelineOverviewProps {
  itinerary: Itinerary;
  onSelectDay: (day: number) => void;
  dayPhotos?: Record<number, DayPhoto[]>;
  /** What the traveller has arranged, placed on the days it actually falls on. */
  bookings?: TravelBooking[];
  /** Opens manual booking entry. Absent in read-only contexts. */
  onManageBookings?: () => void;
  /**
   * The clock price freshness is read against.
   *
   * A prop rather than a `Date.now()` inside the render, so a test can assert
   * that a price expired without waiting for it to.
   */
  now?: number;
  /**
   * Opens the route editor. The strip is where a traveller looks at their
   * route, so it is where changing it should start from — previously the stay
   * plan was only reachable by hunting through trip settings.
   */
  onEditRoute?: () => void;
  /** Trip-level actions shown alongside Edit route. */
  actions?: ReactNode;
  /**
   * Planning tools, shown between the route and the days they act on.
   *
   * A slot rather than an import: this component describes a route and must
   * not depend on the planner. It sits here because the traveller reads the
   * route, decides the days are thin, and acts — and the card used to render
   * last on the page, below a block of markup the stylesheet hides, where
   * nothing pointed to it.
   */
  planner?: ReactNode;
}

interface StaySegment {
  city: string;
  days: DayPlan[];
}

export function resolvedDayCity(itinerary: Itinerary, index: number): string {
  const profile = sanitizeTripProfile(itinerary.tripProfile);
  const profileRoute = profile?.cityStays?.flatMap((stay) =>
    Array.from({ length: Math.max(0, stay.days) }, () => stay.city),
  ) ?? [];
  const routeCities = profile?.cityStays?.length
    ? profile.cityStays.map((stay) => stay.city)
    : itinerary.cities;
  const evenlyDistributedCity = routeCities.length
    ? routeCities[Math.min(routeCities.length - 1, Math.floor((index * routeCities.length) / Math.max(1, itinerary.days.length)))]
    : '';
  const day = itinerary.days[index];
  return day?.stayCity?.trim()
    || day?.city?.trim()
    || profileRoute[index]
    || profileRoute[profileRoute.length - 1]
    || evenlyDistributedCity
    || 'Trip day';
}

type ActivityWithMedia = Activity & {
  imageUrl?: string;
  photoUrl?: string;
  photoThumbnailUrl?: string;
};

function dayPreview(day: DayPlan, fallbackCity: string, dayPhotos: Record<number, DayPhoto[]>) {
  const firstPlace = day.activities.find((activity) => activity.kind !== 'transport') as ActivityWithMedia | undefined;
  const userPhoto = dayPhotos[day.day]?.[0]?.dataUrl;
  const verifiedPlacePhoto = firstPlace?.photoThumbnailUrl || firstPlace?.photoUrl || firstPlace?.imageUrl;
  return {
    image: userPhoto || verifiedPlacePhoto,
    label: firstPlace?.name || day.activityCities?.[0] || day.stayCity || fallbackCity,
  };
}

function staySegments(itinerary: Itinerary): StaySegment[] {
  const profile = sanitizeTripProfile(itinerary.tripProfile);
  const profileRoute = profile?.cityStays?.flatMap((stay) =>
    Array.from({ length: Math.max(0, stay.days) }, () => stay.city),
  ) ?? [];
  const routeCities = profile?.cityStays?.length
    ? profile.cityStays.map((stay) => stay.city)
    : itinerary.cities;
  const evenlyDistributedRoute = itinerary.days.map((_, index) => {
    if (!routeCities.length) return '';
    const cityIndex = Math.min(
      routeCities.length - 1,
      Math.floor((index * routeCities.length) / Math.max(1, itinerary.days.length)),
    );
    return routeCities[cityIndex];
  });

  return itinerary.days.reduce<StaySegment[]>((segments, day, index) => {
    // A saved day remains authoritative. Older trips sometimes predate the
    // stay-city field, so presentation falls back to the traveller's stored
    // city-stay plan before using an even route preview as a last resort.
    const city = day.stayCity?.trim()
      || day.city?.trim()
      || profileRoute[index]
      || profileRoute[profileRoute.length - 1]
      || evenlyDistributedRoute[index]
      || resolvedDayCity(itinerary, index);
    const last = segments[segments.length - 1];
    if (last?.city === city) last.days.push(day);
    else segments.push({ city, days: [day] });
    return segments;
  }, []);
}

const durationLabel = (day: DayPlan) => {
  const activities = day.activities.length;
  return `${activities} ${activities === 1 ? 'activity' : 'activities'}`;
};

/**
 * Bookings sorted onto the days they fall on.
 *
 * Keyed by day number rather than by stay, because a stay is derived from the
 * route and renumbers when the route is reordered. A date does not.
 *
 * Anything whose date cannot be placed — a trip with no start date, a booking
 * outside the trip's span — lands in `unplaced` rather than being dropped. A
 * traveller who typed in a flight is entitled to see it even when the itinerary
 * cannot yet say which day it belongs to.
 */
function placeBookings(itinerary: Itinerary, bookings: TravelBooking[]) {
  const tripStartDate = sanitizeTripProfile(itinerary.tripProfile)?.startDate;
  const dayCount = itinerary.days.length;
  const byDay = new Map<number, TravelBooking[]>();
  const unplaced: TravelBooking[] = [];

  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue;
    const dayNumber = bookingDayNumber(booking, tripStartDate, dayCount);
    if (dayNumber === undefined) {
      unplaced.push(booking);
      continue;
    }
    const existing = byDay.get(dayNumber);
    if (existing) existing.push(booking);
    else byDay.set(dayNumber, [booking]);
  }

  return { byDay, unplaced };
}

export function JourneyTimelineOverview({
  itinerary,
  onSelectDay,
  dayPhotos = {},
  onEditRoute,
  actions,
  planner,
  bookings = [],
  onManageBookings,
  now,
}: JourneyTimelineOverviewProps) {
  /**
   * The clock price freshness is read against, captured once.
   *
   * Reading `Date.now()` during render is impure — two cards in the same pass
   * could disagree about the time, and a re-render for an unrelated reason
   * would silently age every price. A state initialiser runs once, which is
   * what "as of when this screen opened" actually means.
   */
  const [openedAt] = useState(() => Date.now());
  const readAt = now ?? openedAt;
  const segments = staySegments(itinerary);
  const countryArtwork = countryArtworkForItinerary(itinerary);
  const placed = placeBookings(itinerary, bookings);
  const [activeSegment, setActiveSegment] = useState(0);
  const segmentRefs = useRef<Array<HTMLElement | null>>([]);
  const verifiedSources = itinerary.days.reduce((total, day) => total + day.activities.filter((activity) => activity.sourceReferences?.length || activity.lastVerifiedAt).length, 0);

  const focusSegment = (index: number) => {
    setActiveSegment(index);
    segmentRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="journey-itinerary-overview">
      <section className="journey-itinerary-intro">
        <div className="journey-itinerary-art">
          <img
            src={countryArtwork.src}
            alt={countryArtwork.alt}
            width={1536}
            height={1024}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
          />
        </div>
        <div className="journey-itinerary-intro-copy">
          <span className="journey-kicker"><i /> Your route</span>
          <h2>{itinerary.name}</h2>
          <p>{itinerary.overviewDescription || itinerary.description || 'A practical day-by-day plan with room to adjust as the trip gets closer.'}</p>
          <div className="journey-itinerary-facts">
            <span><CalendarDays /> {itinerary.days.length} days</span>
            <span><MapPin /> {itinerary.cities.length} {itinerary.cities.length === 1 ? 'city' : 'cities'}</span>
            <span><Route /> {verifiedSources ? `${verifiedSources} sourced stops` : 'Editable plan'}</span>
          </div>
        </div>
      </section>

      <div className="journey-route-row">
      <nav className="journey-city-tabs" aria-label="Route cities">
        {segments.map((segment, index) => (
          <button type="button" className={activeSegment === index ? 'is-active' : ''} aria-current={activeSegment === index ? 'location' : undefined} key={`${segment.city}-${index}`} onClick={() => focusSegment(index)}>
            <span>{index + 1}</span>
            <strong>{segment.city}</strong>
            <small>Days {segment.days[0].day}–{segment.days[segment.days.length - 1].day}</small>
          </button>
        ))}
      </nav>
      <div className="journey-route-actions">
        {actions}
        {onManageBookings && (
          <button type="button" className="journey-route-edit" onClick={onManageBookings}>
            <TicketCheck className="w-3.5 h-3.5" aria-hidden="true" />
            Bookings{bookings.length ? ` (${bookings.length})` : ''}
          </button>
        )}
        {onEditRoute && (
          <button type="button" className="journey-route-edit" onClick={onEditRoute}>
            <PencilLine className="w-3.5 h-3.5" aria-hidden="true" />
            Edit route
          </button>
        )}
      </div>
      </div>

      {planner}

      <div className="journey-stay-timeline">
        {segments.map((segment, segmentIndex) => (
          <section
            className="journey-stay-segment"
            key={`${segment.city}-${segmentIndex}`}
            ref={(node) => { segmentRefs.current[segmentIndex] = node; }}
          >
            <aside className="journey-stay-marker">
              <span><BedDouble /></span>
              <strong>Stay</strong>
              <small>Days {segment.days[0].day}–{segment.days[segment.days.length - 1].day}</small>
              <small>{segment.days.length} {segment.days.length === 1 ? 'day' : 'days'}</small>
            </aside>

            <div className="journey-stay-content">
              <header>
                <div>
                  <span>Base for this part of the trip</span>
                  <h3>{segment.city}</h3>
                </div>
                <div className="journey-stay-dates"><CalendarDays /> {segment.days[0].date} – {segment.days[segment.days.length - 1].date}</div>
              </header>

              <div className="journey-day-rows">
                {segment.days.map((day) => {
                  const preview = dayPreview(day, segment.city, dayPhotos);
                  const dayBookings = placed.byDay.get(day.day) || [];
                  return (
                  <div className="journey-day-block" key={day.day}>
                  <button type="button" className="journey-day-row" onClick={() => onSelectDay(day.day)}>
                    <span className="journey-day-place-preview">
                      {preview.image ? (
                        <img src={preview.image} alt={`Preview for ${preview.label}`} loading="lazy" />
                      ) : (
                        <span><MapPin aria-hidden="true" /><small>Going to</small><strong>{preview.label}</strong></span>
                      )}
                    </span>
                    <span className="journey-day-badge">Day {day.day}</span>
                    <span className="journey-day-copy">
                      <small>{day.date} · {durationLabel(day)}</small>
                      <strong>{day.title || `${segment.city} day`}</strong>
                      <em><Clock3 /> {day.activities[0]?.time || 'Flexible start'}</em>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  {dayBookings.length > 0 && (
                    <div className="journey-day-bookings">
                      {dayBookings.map((booking) => (
                        <JourneyBookingCard
                          key={booking.id}
                          booking={booking}
                          now={readAt}
                          onEdit={onManageBookings ? () => onManageBookings() : undefined}
                          compact
                        />
                      ))}
                    </div>
                  )}
                  </div>
                  );
                })}
              </div>

              {segmentIndex < segments.length - 1 && (
                <div className="journey-transfer-row">
                  <TrainFront />
                  <span><small>Next base</small><strong>{segment.city} → {segments[segmentIndex + 1].city}</strong></span>
                  <em>Route details stay editable</em>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {placed.unplaced.length > 0 && (
        <section className="journey-unplaced-bookings">
          <header>
            <span className="journey-kicker"><i /> Booked</span>
            <h3>Not yet on a day</h3>
            <p>
              These have dates outside the trip, or the trip has no start date to count from.
              Set the trip dates and they will move onto the days they belong to.
            </p>
          </header>
          <div className="journey-day-bookings">
            {placed.unplaced.map((booking) => (
              <JourneyBookingCard
                key={booking.id}
                booking={booking}
                now={readAt}
                onEdit={onManageBookings ? () => onManageBookings() : undefined}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

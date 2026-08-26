import { useRef, useState } from 'react';
import { BedDouble, CalendarDays, ChevronRight, Clock3, MapPin, Route, TrainFront } from 'lucide-react';
import type { Activity, DayPhoto, DayPlan, Itinerary } from '../data';
import { sanitizeTripProfile } from '../lib/tripProfile';
import trainLakeIllustration from '../assets/journey/train-lake.jpg';

interface JourneyTimelineOverviewProps {
  itinerary: Itinerary;
  onSelectDay: (day: number) => void;
  dayPhotos?: Record<number, DayPhoto[]>;
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

export function JourneyTimelineOverview({ itinerary, onSelectDay, dayPhotos = {} }: JourneyTimelineOverviewProps) {
  const segments = staySegments(itinerary);
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
          <img src={trainLakeIllustration} alt="A regional train crossing yellow flower fields beside a lake and mountains" />
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

      <nav className="journey-city-tabs" aria-label="Route cities">
        {segments.map((segment, index) => (
          <button type="button" className={activeSegment === index ? 'is-active' : ''} aria-current={activeSegment === index ? 'location' : undefined} key={`${segment.city}-${index}`} onClick={() => focusSegment(index)}>
            <span>{index + 1}</span>
            <strong>{segment.city}</strong>
            <small>Days {segment.days[0].day}–{segment.days[segment.days.length - 1].day}</small>
          </button>
        ))}
      </nav>

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
                  return (
                  <button type="button" className="journey-day-row" key={day.day} onClick={() => onSelectDay(day.day)}>
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
    </div>
  );
}

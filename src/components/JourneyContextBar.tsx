import { CalendarDays, MapPin, Route } from 'lucide-react';
import type { Itinerary } from '../data';
import { sanitizeTripProfile } from '../lib/tripProfile';

interface JourneyContextBarProps {
  itinerary: Itinerary;
}

const formatDateRange = (start?: string, end?: string) => {
  if (!start && !end) return 'Dates not set';
  const formatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const safeDate = (value?: string) => value ? new Date(`${value}T12:00:00`) : null;
  const from = safeDate(start);
  const to = safeDate(end);
  if (from && to) return `${formatter.format(from)} – ${formatter.format(to)}`;
  return formatter.format((from || to)!);
};

export function JourneyContextBar({ itinerary }: JourneyContextBarProps) {
  const profile = sanitizeTripProfile(itinerary.tripProfile);
  const route = profile?.cityStays?.length
    ? profile.cityStays.map((stay) => stay.city)
    : itinerary.cities;
  const visibleRoute = route.length ? route : ['Destination'];
  const dayCount = profile?.dayCount || itinerary.days.length;

  return (
    <section className="journey-context-bar" aria-label="Current trip overview">
      <div className="journey-context-primary">
        <div className="journey-context-title">
          <span>Current trip</span>
          <h1>{itinerary.name || visibleRoute.join(' · ')}</h1>
        </div>
        <div className="journey-context-metrics">
          <span><CalendarDays /> {formatDateRange(profile?.startDate, profile?.endDate)}</span>
          <span><Route /> {dayCount || '—'} days</span>
          <span><MapPin /> {itinerary.cities.length || '—'} {itinerary.cities.length === 1 ? 'city' : 'cities'}</span>
        </div>
      </div>

      <div className="journey-route-strip" aria-label="Trip route">
        <span className="journey-route-origin"><MapPin /> Start</span>
        {visibleRoute.map((city, index) => (
          <div className="journey-route-stop" key={`${city}-${index}`}>
            <i aria-hidden="true" />
            <span>{index + 1}</span>
            <strong>{city}</strong>
          </div>
        ))}
        <span className="journey-route-destination"><MapPin /> Trip ready</span>
      </div>
    </section>
  );
}

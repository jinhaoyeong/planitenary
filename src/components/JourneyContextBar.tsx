import {
  BusFront,
  CalendarDays,
  CarFront,
  Check,
  Footprints,
  MapPin,
  PlaneTakeoff,
  Route,
  TrainFront,
  type LucideIcon,
} from 'lucide-react';
import type { Itinerary } from '../data';
import { describeStayDates } from '../lib/cityStays';
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
  const dayCount = profile?.dayCount || itinerary.days.length;
  let nextDay = 1;
  const routeStops = profile?.cityStays?.length
    ? profile.cityStays.map((stay) => {
      const leg = { startDay: nextDay, endDay: nextDay + stay.days - 1 };
      nextDay += stay.days;
      return {
        city: stay.city,
        dates: describeStayDates(leg, profile.startDate),
      };
    })
    : (itinerary.cities.length ? itinerary.cities : ['Destination']).map((city) => {
      const cityDays = itinerary.days.filter((day) => day.city === city);
      const firstDate = cityDays[0]?.date;
      const lastDate = cityDays.at(-1)?.date;
      return {
        city,
        dates: firstDate && lastDate
          ? (firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`)
          : `${cityDays.length || 1} ${cityDays.length === 1 ? 'day' : 'days'}`,
      };
    });

  const transport = profile?.transport || [];
  const localMode: { label: string; icon: LucideIcon } = transport.includes('train')
    ? { label: 'Train', icon: TrainFront }
    : transport.includes('public-transport')
      ? { label: 'Transit', icon: BusFront }
      : transport.includes('car')
        ? { label: 'Drive', icon: CarFront }
        : { label: 'Walk', icon: Footprints };
  const arrivalMode: { label: string; icon: LucideIcon } = transport.includes('plane')
    ? { label: 'Fly', icon: PlaneTakeoff }
    : localMode;

  return (
    <section className="journey-context-bar" aria-label="Current trip overview">
      <div className="journey-context-primary">
        <div className="journey-context-title">
          <span>Your itinerary</span>
          <h1>{itinerary.name || routeStops.map((stop) => stop.city).join(' · ')}</h1>
        </div>
        <div className="journey-context-metrics">
          <span><CalendarDays /> {formatDateRange(profile?.startDate, profile?.endDate)}</span>
          <span><Route /> {dayCount || '—'} days</span>
          <span><MapPin /> {itinerary.cities.length || '—'} {itinerary.cities.length === 1 ? 'city' : 'cities'}</span>
        </div>
      </div>

      <div className="journey-route-strip" aria-label="Trip route">
        <span className="journey-route-origin"><MapPin /> Trip start</span>
        {routeStops.map((stop, index) => {
          const mode = index === 0 ? arrivalMode : localMode;
          const ModeIcon = mode.icon;
          return (
            <div className="journey-route-leg" key={`${stop.city}-${index}`}>
              <span className="journey-route-mode" title={mode.label} aria-label={mode.label}>
                <ModeIcon aria-hidden="true" />
              </span>
              <div className="journey-route-stop">
                <span>{index + 1}</span>
                <span className="journey-route-stop-copy">
                  <strong>{stop.city}</strong>
                  <small>{stop.dates}</small>
                </span>
              </div>
            </div>
          );
        })}
        <span className="journey-route-destination"><Check /> Ready</span>
      </div>
    </section>
  );
}

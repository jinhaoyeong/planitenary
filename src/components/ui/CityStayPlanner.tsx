import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import {
  adjustCityStay,
  cityStayStatus,
  describeStayDates,
  legsFromCityStays,
  moveCityStay,
  proposeCityStays,
  reconcileCityStays,
} from '../../lib/cityStays';
import type { TripCityStay } from '../../lib/tripProfile';

interface CityStayPlannerProps {
  cities: string[];
  dayCount: number;
  /** Trip start date, so each stay can be shown as real dates. */
  startDate?: string;
  value: TripCityStay[] | undefined;
  onChange: (next: TripCityStay[]) => void;
}

/**
 * Where the traveller sleeps, and for how long.
 *
 * The planner can infer a division from what was shortlisted, and it still does
 * for trips that were never asked. But this is a booking, not a scheduling
 * preference: the app does not get to decide that night four is in Kyoto. So a
 * multi-city trip is asked here, before discovery, and the answer is what every
 * later stage follows.
 *
 * Days come from and return to an unassigned pool rather than being taken from
 * a neighbouring city. Auto-balancing would be smoother and would quietly undo
 * a decision the traveller had already made.
 */
export function CityStayPlanner({ cities, dayCount, startDate, value, onChange }: CityStayPlannerProps) {
  const stays = reconcileCityStays(value, cities);
  const status = cityStayStatus(stays, dayCount);
  // Legs are only real once the plan adds up; until then the rows show days
  // rather than dates, because a date that will move is worse than no date.
  const legs = legsFromCityStays(stays, dayCount);

  if (cities.length < 2 || dayCount <= 0) return null;

  const set = (next: TripCityStay[]) => onChange(next);

  return (
    <div className="city-stay-planner">
      <div className="city-stay-planner-head">
        <p className="city-stay-planner-status" role="status">
          {status.complete
            ? `All ${dayCount} days placed.`
            : status.remaining > 0
              ? `${status.remaining} of ${dayCount} ${status.remaining === 1 ? 'day' : 'days'} still to place.`
              : `${Math.abs(status.remaining)} ${Math.abs(status.remaining) === 1 ? 'day' : 'days'} more than this trip has.`}
        </p>
        <button
          type="button"
          className="city-stay-planner-even"
          onClick={() => set(proposeCityStays(stays.map((stay) => stay.city), dayCount))}
        >
          Split evenly
        </button>
      </div>

      <ol className="city-stay-list">
        {stays.map((stay, index) => {
          const leg = legs.find((entry) => entry.city === stay.city);
          return (
            <li key={stay.city} className="city-stay-row" data-empty={stay.days === 0 ? 'true' : undefined}>
              <div className="city-stay-order">
                <button
                  type="button"
                  onClick={() => set(moveCityStay(stays, index, -1))}
                  disabled={index === 0}
                  aria-label={`Move ${stay.city} earlier in the trip`}
                >
                  <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => set(moveCityStay(stays, index, 1))}
                  disabled={index === stays.length - 1}
                  aria-label={`Move ${stay.city} later in the trip`}
                >
                  <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="city-stay-name">
                <strong>{stay.city}</strong>
                <span>
                  {stay.days === 0
                    ? 'No days yet'
                    : leg
                      ? describeStayDates(leg, startDate)
                      : `${stay.days} ${stay.days === 1 ? 'day' : 'days'}`}
                </span>
              </div>

              <div className="city-stay-stepper">
                <button
                  type="button"
                  onClick={() => set(adjustCityStay(stays, stay.city, -1, dayCount))}
                  disabled={stay.days === 0}
                  aria-label={`One day fewer in ${stay.city}`}
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                {/*
                  * Visual only. An `<output>` here is a live region, so four
                  * cities would announce four separate counters on every edit;
                  * the row's own line already reads the stay out, and the
                  * stepper buttons name the city they act on.
                  */}
                <span className="city-stay-days" aria-hidden="true">{stay.days}</span>
                <button
                  type="button"
                  onClick={() => set(adjustCityStay(stays, stay.city, 1, dayCount))}
                  disabled={status.remaining <= 0}
                  aria-label={`One more day in ${stay.city}`}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {status.unplaced.length > 0 && (
        <p className="city-stay-planner-note">
          {status.unplaced.join(' and ')} {status.unplaced.length === 1 ? 'has' : 'have'} no days yet.
          Give {status.unplaced.length === 1 ? 'it' : 'them'} at least one, or remove
          {status.unplaced.length === 1 ? ' it' : ' them'} from the trip.
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Minus, Plus, X } from 'lucide-react';
import {
  addCityStay,
  adjustCityStay,
  canRemoveCityStay,
  cityStayStatus,
  collapseAdjacentStays,
  describeStayDates,
  legsFromCityStays,
  moveCityStay,
  proposeCityStays,
  reconcileCityStays,
  removeCityStay,
  setCityStayDays,
} from '../../lib/cityStays';
import { cityKey } from '../../lib/cityLegs';
import type { TripCityStay } from '../../lib/tripProfile';

interface CityStayPlannerProps {
  cities: string[];
  dayCount: number;
  /** Trip start date, so each stay can be shown as real dates. */
  startDate?: string;
  value: TripCityStay[] | undefined;
  onChange: (next: TripCityStay[]) => void;
}

interface DayCountInputProps {
  city: string;
  /** Which row this is. The stay's address — see {@link setCityStayDays}. */
  index: number;
  days: number;
  dayCount: number;
  stays: TripCityStay[];
  onCommit: (next: TripCityStay[]) => void;
}

/**
 * The number between − and +. Clicking it lets the traveller type a count
 * instead of tapping one day at a time — useful once a trip is long enough
 * that sixteen taps would be a joke.
 *
 * Draft text stays local while focused so clearing the field to type "16"
 * does not briefly commit zero and scramble the other cities. Blur / Enter
 * hand the value to {@link setCityStayDays}, which clamps to the free pool.
 */
function DayCountInput({ city, index, days, dayCount, stays, onCommit }: DayCountInputProps) {
  const [draft, setDraft] = useState(String(days));
  const [focused, setFocused] = useState(false);

  // Keep the field in step with +/− and Split evenly while it is not being
  // edited. Adjusted during render so a plus click never paints a stale digit.
  if (!focused && draft !== String(days)) {
    setDraft(String(days));
  }

  const commit = (raw: string) => {
    const parsed = raw.trim() === '' ? 0 : Number.parseInt(raw, 10);
    const next = setCityStayDays(stays, index, Number.isFinite(parsed) ? parsed : 0, dayCount);
    const committed = next[index]?.days ?? 0;
    setDraft(String(committed));
    if (committed !== days) onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      setDraft(String(days));
      event.currentTarget.blur();
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className="city-stay-days adaptive-input"
      aria-label={`Days in ${city}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 3))}
      onFocus={(event) => {
        setFocused(true);
        event.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={onKeyDown}
    />
  );
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
 *
 * The list is a *route*, not the trip's set of cities: a traveller who ends
 * their trip back where it started has two Osaka stays, and both are real. The
 * destination list stays unique — one Osaka, one deck of places — and adding a
 * return happens here, where the question is about nights rather than places.
 */
export function CityStayPlanner({ cities, dayCount, startDate, value, onChange }: CityStayPlannerProps) {
  const [addOpen, setAddOpen] = useState(false);
  /** What the last edit merged, if it merged anything. Cleared by the next one. */
  const [mergeNote, setMergeNote] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstAddOptionRef = useRef<HTMLButtonElement | null>(null);
  const addWasOpenedRef = useRef(false);

  // Opening the inline sheet removes the trigger from the DOM. Move keyboard
  // focus into the choice list, then return it to the trigger when the sheet
  // closes so a keyboard user never falls back to the document body.
  useEffect(() => {
    if (addOpen) {
      addWasOpenedRef.current = true;
      firstAddOptionRef.current?.focus();
      return;
    }
    if (addWasOpenedRef.current) {
      addWasOpenedRef.current = false;
      addButtonRef.current?.focus();
    }
  }, [addOpen]);

  const stays = reconcileCityStays(value, cities);
  const status = cityStayStatus(stays, dayCount);
  // Legs are only real once the plan adds up; until then the rows show days
  // rather than dates, because a date that will move is worse than no date.
  const legs = legsFromCityStays(stays, dayCount);

  /**
   * Which leg each row is showing, found by the row's own first day.
   *
   * Not a positional match: `legsFromCityStays` skips rows with no days and
   * merges two adjacent stays in the same city, so the two lists are different
   * lengths. Walking the day counter gets the same answer without repeating
   * those rules here. Empty while the plan is incomplete, which is when rows
   * deliberately show day counts rather than dates.
   */
  const legForStay = (() => {
    const startDays: number[] = [];
    let day = 1;
    for (const stay of stays) {
      startDays.push(day);
      day += Math.max(0, stay.days);
    }
    return stays.map((stay, index) => (stay.days <= 0
      ? undefined
      : legs.find((leg) => startDays[index] >= leg.startDay && startDays[index] <= leg.endDay)));
  })();

  /**
   * Which visit to its city each row is, 1-indexed.
   *
   * Two jobs. It gives each row a React key that stays unique once a city
   * repeats — duplicate keys would let React reuse the wrong row's typing
   * state — and it decides which rows say "Coming back", which is only ever
   * true of a city the traveller has already stayed in earlier.
   */
  const visits = (() => {
    const seen = new Map<string, number>();
    return stays.map((stay) => {
      const key = cityKey(stay.city);
      const visit = (seen.get(key) ?? 0) + 1;
      seen.set(key, visit);
      return visit;
    });
  })();

  if (cities.length < 2 || dayCount <= 0) return null;

  /** An edit that cannot change what is next to what: no merge is possible. */
  const set = (next: TripCityStay[]) => {
    setMergeNote(null);
    onChange(next);
  };

  /**
   * An edit that reorders, adds or removes — the only three that can leave two
   * stays in the same city touching. Those merge, and the traveller is told
   * once rather than asked to approve arithmetic they cannot disagree with.
   */
  const setSequence = (next: TripCityStay[]) => {
    const touching = next.findIndex((stay, index) =>
      index > 0 && cityKey(next[index - 1].city) === cityKey(stay.city));
    if (touching < 0) {
      setMergeNote(null);
      onChange(next);
      return;
    }

    const key = cityKey(next[touching].city);
    let first = touching - 1;
    while (first > 0 && cityKey(next[first - 1].city) === key) first -= 1;
    let last = touching;
    while (last + 1 < next.length && cityKey(next[last + 1].city) === key) last += 1;
    const days = next.slice(first, last + 1).reduce((total, stay) => total + Math.max(0, stay.days), 0);

    setMergeNote(`Two ${next[touching].city} stays ran back to back, so they're one ${days}-day stay now.`);
    onChange(collapseAdjacentStays(next));
  };

  const daysIn = (city: string) => stays
    .filter((stay) => cityKey(stay.city) === cityKey(city))
    .reduce((total, stay) => total + Math.max(0, stay.days), 0);

  return (
    <div className="city-stay-planner adaptive-surface adaptive-surface-card">
      <div className="city-stay-planner-head">
        <p className="city-stay-planner-status" role="status">
          {status.complete
            ? `All ${dayCount} days placed.`
            : status.remaining > 0
              // "1 of 7 days" — the noun being counted is the trip's length,
              // not what is left of it, so it agrees with dayCount.
              ? `${status.remaining} of ${dayCount} ${dayCount === 1 ? 'day' : 'days'} still to place.`
              : `${Math.abs(status.remaining)} ${Math.abs(status.remaining) === 1 ? 'day' : 'days'} more than this trip has.`}
        </p>
        <button
          type="button"
          className="city-stay-planner-even adaptive-button"
          // The current route, repeats included — never the unique city list,
          // which would drop a return stay without saying so.
          onClick={() => set(proposeCityStays(stays.map((stay) => stay.city), dayCount))}
        >
          Split evenly
        </button>
      </div>

      <ol className="city-stay-list">
        {stays.map((stay, index) => {
          const leg = legForStay[index];
          const comingBack = visits[index] > 1;
          const removable = canRemoveCityStay(stays, index);
          return (
            <li
              key={`${cityKey(stay.city)}#${visits[index]}`}
              className="city-stay-row adaptive-surface adaptive-surface-compact-card"
              data-empty={stay.days === 0 ? 'true' : undefined}
            >
              <div className="city-stay-order">
                <button
                  type="button"
                  className="adaptive-button"
                  onClick={() => setSequence(moveCityStay(stays, index, -1))}
                  disabled={index === 0}
                  aria-label={`Move ${stay.city} earlier in the trip`}
                >
                  <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="adaptive-button"
                  onClick={() => setSequence(moveCityStay(stays, index, 1))}
                  disabled={index === stays.length - 1}
                  aria-label={`Move ${stay.city} later in the trip`}
                >
                  <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <div className="city-stay-name">
                <strong>{stay.city}</strong>
                <span>
                  {/*
                    * "Coming back" rather than a number. The traveller knows
                    * which Osaka this is from where it sits and when it falls;
                    * an index would only be the app talking to itself.
                    */}
                  {comingBack && <em className="city-stay-return">Coming back</em>}
                  {comingBack && ' · '}
                  {stay.days === 0
                    ? 'Needs a day'
                    : leg
                      ? describeStayDates(leg, startDate)
                      : `${stay.days} ${stay.days === 1 ? 'day' : 'days'}`}
                </span>
              </div>

              <div className="city-stay-stepper">
                <button
                  type="button"
                  className="adaptive-button"
                  onClick={() => set(adjustCityStay(stays, index, -1, dayCount))}
                  disabled={stay.days === 0}
                  aria-label={`One day fewer in ${stay.city}`}
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <DayCountInput
                  city={stay.city}
                  index={index}
                  days={stay.days}
                  dayCount={dayCount}
                  stays={stays}
                  onCommit={set}
                />
                <button
                  type="button"
                  className="adaptive-button"
                  onClick={() => set(adjustCityStay(stays, index, 1, dayCount))}
                  disabled={status.remaining <= 0}
                  aria-label={`One more day in ${stay.city}`}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                {/*
                  * Removable only while the city is stayed in somewhere else.
                  * The last stay in a city is the city itself, and dropping a
                  * destination — with its whole deck of places — is not
                  * something to do from a nights counter.
                  */}
                {removable && (
                  <button
                    type="button"
                    className="city-stay-remove adaptive-button"
                    onClick={() => setSequence(removeCityStay(stays, index))}
                    aria-label={`Remove this stay in ${stay.city}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {addOpen ? (
        <div
          className="city-stay-sheet"
          role="group"
          aria-labelledby="city-stay-sheet-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setAddOpen(false);
          }}
        >
          <div className="city-stay-sheet-head">
            <strong id="city-stay-sheet-title">Add another stay</strong>
            <button
              type="button"
              className="city-stay-sheet-close adaptive-button"
              onClick={() => setAddOpen(false)}
              aria-label="Close add another stay"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <p>Somewhere you&rsquo;re coming back to. Your destinations don&rsquo;t change.</p>
          {cities.map((city, index) => {
            const held = daysIn(city);
            return (
              <button
                key={cityKey(city)}
                ref={index === 0 ? firstAddOptionRef : undefined}
                type="button"
                className="city-stay-sheet-option adaptive-button"
                onClick={() => {
                  setAddOpen(false);
                  setSequence(addCityStay(stays, city, dayCount));
                }}
              >
                <strong>{city}</strong>
                <span>{held > 0 ? `staying ${held} ${held === 1 ? 'day' : 'days'}` : 'no days yet'}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <button
          ref={addButtonRef}
          type="button"
          className="city-stay-add adaptive-button"
          onClick={() => setAddOpen(true)}
        >
          + Add another stay
        </button>
      )}

      {mergeNote && <p className="city-stay-planner-note" role="status">{mergeNote}</p>}

      {status.unplacedStays.length > 0 && (() => {
        // "Osaka" reads fine mid-sentence; "your return stay in Osaka" has to
        // start one. Capitalise whichever the list begins with.
        const named = status.unplacedStays.map((entry) => entry.label).join(' and ');
        const one = status.unplacedStays.length === 1;
        return (
          <p className="city-stay-planner-note">
            {named.charAt(0).toUpperCase() + named.slice(1)} {one ? 'has' : 'have'} no days yet.
            Give {one ? 'it' : 'them'} at least one, or remove {one ? 'it' : 'them'}.
          </p>
        );
      })()}
    </div>
  );
}

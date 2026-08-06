import { useMemo, useState } from 'react';
import { ChevronDown, MapPin, Wand2, X } from 'lucide-react';
import type { Itinerary } from '../data';
import { findCountry, type PlaceSuggestion } from '../lib/destinations';
import { CitySearchInput } from './ui/CitySearchInput';
import { DateRangeCalendar } from './ui/DateRangeCalendar';
import { CityStayPlanner } from './ui/CityStayPlanner';
import { ToggleRow } from './ui/ToggleRow';
import { buildTripIdentity } from '../lib/tripIdentity';
import { RegenerationPreview } from './RegenerationPreview';
import { syncDurationDependentFields } from '../lib/trips';
import {
  MAX_GENERATED_DAYS,
  longTripPartialGenerationMessage,
  validateTripDuration,
  withValidatedDuration,
} from '../lib/tripDuration';
import { VisualDesignControls } from './VisualDesignControls';
import {
  BUDGET_OPTIONS,
  MOOD_OPTIONS,
  STAY_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  TRIP_TYPE_OPTIONS,
  createEmptyProfile,
  destinationFromPlace,
  manualDestination,
  primaryCountry,
  resolveDuration,
  sanitizeClockTime,
  sanitizeTripProfile,
  type BudgetTier,
  type TripProfile,
} from '../lib/tripProfile';
import { OptionChips } from './ui/OptionChips';

interface TripIdentityPanelProps {
  itinerary: Itinerary;
  onItineraryChange: (itinerary: Itinerary) => void;
}

export function TripIdentityPanel({ itinerary, onItineraryChange }: TripIdentityPanelProps) {
  const storedProfile = useMemo(() => sanitizeTripProfile(itinerary.tripProfile), [itinerary.tripProfile]);
  const profile = useMemo(
    () =>
      storedProfile ?? {
        ...createEmptyProfile(),
        // A handbook created before profiles existed still lists its cities.
        destinations: itinerary.cities.map((city) => manualDestination(city)),
        dayCount: itinerary.days.length,
      },
    [storedProfile, itinerary.cities, itinerary.days.length],
  );
  const [durationError, setDurationError] = useState<string | null>(null);

  const save = (next: TripProfile) => {
    // Profile is the source of truth for duration: clearing dates must clear
    // the badge in the same write, so a reload cannot resurrect a stale "8".
    onItineraryChange(syncDurationDependentFields({ ...itinerary, tripProfile: next }, next));
  };

  const update = (patch: Partial<TripProfile>) => {
    const next = { ...profile, ...patch };
    // Duration fields are validated before any write so an over-long or
    // reversed range never partially mutates the saved profile.
    if ('startDate' in patch || 'endDate' in patch || 'dayCount' in patch) {
      const committed = withValidatedDuration(next);
      if (!committed.ok) {
        setDurationError(committed.message);
        return;
      }
      setDurationError(null);
      save(committed.profile);
      return;
    }
    setDurationError(null);
    save(next);
  };

  const toggle = <T extends string>(key: 'tripTypes' | 'styles' | 'moods' | 'transport' | 'stays', id: T) => {
    const list = profile[key] as unknown as T[];
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    save({ ...profile, [key]: next } as TripProfile);
  };

  const addPlace = (place: PlaceSuggestion) => {
    const destination = destinationFromPlace(place, profile.destinations[0]?.country);
    if (profile.destinations.some((existing) => existing.id === destination.id)) return;
    save({ ...profile, destinations: [...profile.destinations, destination] });
  };

  const removeCity = (index: number) =>
    update({ destinations: profile.destinations.filter((_, itemIndex) => itemIndex !== index) });

  const countryCode = findCountry(primaryCountry(profile))?.code;
  const duration = resolveDuration(profile);
  const durationValidation = validateTripDuration(profile);
  const identity = useMemo(
    () => buildTripIdentity(profile, { plannedDays: itinerary.days.length }),
    [profile, itinerary.days.length],
  );

  return (
    <div className="space-y-6">
      {/*
        * The same calendar the wizard uses, so changing dates afterwards is the
        * same gesture as choosing them — and the days between the two ends stay
        * visible while they are being changed.
        *
        * Every remaining input below is tied to its label by id. They were bare
        * <label> siblings, which reads as an unlabelled field to a screen
        * reader — and is why nothing could find them by name.
        */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
          Trip dates
        </label>
        <DateRangeCalendar
          label="Trip dates"
          value={{ start: profile.startDate, end: profile.endDate }}
          onChange={(range) => update({ startDate: range.start, endDate: range.end })}
        />
      </div>

      {/*
        * The stay plan, editable after the fact for the same reason the dates
        * are: hotels get rebooked. Changing it changes which city each day
        * belongs to on the next build — it does not silently rewrite a plan
        * already applied, because moving someone's scheduled days without
        * asking is exactly what this control exists to stop.
        */}
      {profile.destinations.length > 1 && duration.days > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            How long in each city
          </label>
          <CityStayPlanner
            cities={profile.destinations.map((destination) => destination.city)}
            dayCount={duration.days}
            startDate={profile.startDate}
            value={profile.cityStays}
            onChange={(cityStays) => update({ cityStays })}
          />
        </div>
      )}

      {/*
        * Flight times, editable after the fact because they are usually booked
        * later than the trip is planned. They bypass the duration validation
        * above: a time cannot make a date range reversed or over-long.
        */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="trip-arrival-time" className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Arrival time (optional)
          </label>
          <input
            id="trip-arrival-time"
            type="time"
            className="editorial-input w-full"
            value={profile.arrivalTime || ''}
            onChange={(event) => update({ arrivalTime: sanitizeClockTime(event.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="trip-departure-time" className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Departure time (optional)
          </label>
          <input
            id="trip-departure-time"
            type="time"
            className="editorial-input w-full"
            value={profile.departureTime || ''}
            onChange={(event) => update({ departureTime: sanitizeClockTime(event.target.value) })}
          />
        </div>
      </div>

      {durationError && (
        <p className="text-sm" style={{ color: 'var(--accent)' }} role="alert">
          {durationError}
        </p>
      )}

      {durationValidation.ok && durationValidation.generatesPartialDays && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {longTripPartialGenerationMessage(durationValidation.days)}
          {itinerary.days.length > 0 && itinerary.days.length < durationValidation.days
            ? ` ${itinerary.days.length} of ${durationValidation.days} pages are on this handbook now.`
            : ''}
        </p>
      )}

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
          Cities
        </label>
        <CitySearchInput
          countryCode={countryCode}
          countryName={profile.destinations[0]?.country}
          chosenIds={profile.destinations.map((destination) => destination.id)}
          onSelect={addPlace}
          placeholder="Add another city"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {profile.destinations.map((destination, index) => (
            <span
              key={destination.id}
              className="inline-flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <span className="min-w-0">
                <span className="block leading-tight">{destination.city}</span>
                {(destination.region || destination.country) && (
                  <span className="block text-[11px] leading-tight" style={{ color: 'var(--ink-muted)' }}>
                    {[destination.region, destination.country].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeCity(index)}
                className="p-1 rounded-full shrink-0"
                aria-label={`Remove ${destination.city}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {duration.days > 0 ? `${duration.days} days · ${duration.nights} nights · ` : 'Dates not set · '}
          {profile.destinations.length} {profile.destinations.length === 1 ? 'stop' : 'stops'} on the map
          {duration.days > MAX_GENERATED_DAYS && itinerary.days.length > 0
            ? ` · ${itinerary.days.length} daily pages created`
            : ''}
          .
        </p>
      </div>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Trip type</span>
          <span className="settings-choice-meta">{profile.tripTypes.length} selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips options={TRIP_TYPE_OPTIONS} selected={profile.tripTypes} onToggle={(id) => toggle('tripTypes', id)} />
      </details>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Travel style</span>
          <span className="settings-choice-meta">{profile.styles.length} selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips options={TRAVEL_STYLE_OPTIONS} selected={profile.styles} onToggle={(id) => toggle('styles', id)} />
      </details>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Mood</span>
          <span className="settings-choice-meta">{profile.moods.length} selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips options={MOOD_OPTIONS} selected={profile.moods} onToggle={(id) => toggle('moods', id)} />
      </details>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Budget</span>
          <span className="settings-choice-meta">Selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips
          options={BUDGET_OPTIONS}
          selected={[profile.budgetTier]}
          onToggle={(id) => update({ budgetTier: id as BudgetTier })}
          single
          columns={3}
        />
      </details>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Getting around</span>
          <span className="settings-choice-meta">{profile.transport.length} selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips options={TRANSPORT_OPTIONS} selected={profile.transport} onToggle={(id) => toggle('transport', id)} />
      </details>

      <details className="settings-choice-section">
        <summary className="settings-choice-summary">
          <span className="eyebrow m-0">Where you stay</span>
          <span className="settings-choice-meta">{profile.stays.length} selected <ChevronDown className="settings-choice-chevron w-4 h-4" /></span>
        </summary>
        <OptionChips options={STAY_OPTIONS} selected={profile.stays} onToggle={(id) => toggle('stays', id)} />
      </details>

      <div className="space-y-2">
        <ToggleRow
          label="Name the handbook after the trip"
          description={`Currently “${identity.brandTitle}”.`}
          checked={profile.brandAfterDestination}
          onChange={(checked) => update({ brandAfterDestination: checked })}
        />
      </div>

      <VisualDesignControls profile={profile} onChange={save} />

      <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="eyebrow m-0">Generated copy</span>
        </div>
        <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{identity.heroEyebrow}</p>
        <p className="font-display text-2xl leading-tight">{identity.heroTitle}</p>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{identity.heroDescription}</p>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Overview: “{identity.overviewEyebrow}” · Button: “{identity.primaryButtonLabel}” · Search: “{identity.searchPlaceholder}”
        </p>
        <RegenerationPreview itinerary={itinerary} profile={profile} onItineraryChange={onItineraryChange} />
      </div>
    </div>
  );
}

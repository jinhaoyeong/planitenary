import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, MapPin, Save, Wand2, X } from 'lucide-react';
import type { Itinerary } from '../data';
import { findCountry, type PlaceSuggestion } from '../lib/destinations';
import { CitySearchInput } from './ui/CitySearchInput';
import { DateRangeCalendar } from './ui/DateRangeCalendar';
import { CityStayPlanner } from './ui/CityStayPlanner';
import { ToggleRow } from './ui/ToggleRow';
import { buildTripIdentity } from '../lib/tripIdentity';
import { RegenerationPreview } from './RegenerationPreview';
import { buildIdentityProposal, defaultProposalSelection, diffIdentityProposal } from '../lib/identityFields';
import { regenerateItinerary } from '../lib/trips';
import { cityStayStatus, reconcileCityStays } from '../lib/cityStays';
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
  isDesignHighlighted?: boolean;
}

type SaveStatus = {
  tone: 'success' | 'error' | 'neutral';
  message: string;
};

export function TripIdentityPanel({ itinerary, onItineraryChange, isDesignHighlighted = false }: TripIdentityPanelProps) {
  const storedProfile = useMemo(() => sanitizeTripProfile(itinerary.tripProfile), [itinerary.tripProfile]);
  const savedProfile = useMemo<TripProfile>(
    () =>
      storedProfile ?? {
        ...createEmptyProfile(),
        // A handbook created before profiles existed still lists its cities.
        destinations: itinerary.cities.map((city) => manualDestination(city)),
        dayCount: itinerary.days.length,
      },
    [storedProfile, itinerary.cities, itinerary.days.length],
  );
  const [draftProfile, setDraftProfile] = useState<TripProfile>(savedProfile);
  const [durationError, setDurationError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);

  useEffect(() => {
    setDraftProfile(savedProfile);
    setDurationError(null);
  }, [savedProfile]);

  const profile = draftProfile;
  const isDirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);

  const updateDraft = (next: TripProfile) => {
    setDraftProfile(next);
    setDurationError(null);
    setSaveStatus(null);
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
      updateDraft(committed.profile);
      return;
    }
    setDurationError(null);
    updateDraft(next);
  };

  const toggle = <T extends string>(key: 'tripTypes' | 'styles' | 'moods' | 'transport' | 'stays', id: T) => {
    const list = profile[key] as unknown as T[];
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    updateDraft({ ...profile, [key]: next } as TripProfile);
  };

  const addPlace = (place: PlaceSuggestion) => {
    const destination = destinationFromPlace(place, profile.destinations[0]?.country);
    if (profile.destinations.some((existing) => existing.id === destination.id)) return;
    updateDraft({ ...profile, destinations: [...profile.destinations, destination] });
  };

  const removeCity = (index: number) =>
    update({ destinations: profile.destinations.filter((_, itemIndex) => itemIndex !== index) });

  const countryCode = findCountry(primaryCountry(profile))?.code;
  const duration = resolveDuration(profile);
  const plannedDays = duration.days > 0 ? duration.days : itinerary.days.length;
  const cityStaySummary = profile.destinations.length > 1 && duration.days > 0
    ? cityStayStatus(
        reconcileCityStays(
          profile.cityStays,
          profile.destinations.map((destination) => destination.city),
        ),
        duration.days,
      )
    : null;
  const cityStayNeedsAttention = cityStaySummary && (!cityStaySummary.complete || cityStaySummary.unplaced.length > 0);
  const durationValidation = validateTripDuration(profile);
  const identity = useMemo(
    () => buildTripIdentity(profile, { plannedDays }),
    [profile, plannedDays],
  );

  const handleSave = () => {
    if (!isDirty) return;

    // Saving trip details also refreshes generated/empty copy in one write.
    // Fields the traveller previously edited remain protected by provenance.
    const proposal = buildIdentityProposal(
      itinerary,
      profile,
      buildTripIdentity(profile, { plannedDays }),
    );
    const diffs = diffIdentityProposal(itinerary, proposal);
    const result = regenerateItinerary(itinerary, profile, proposal, defaultProposalSelection(diffs));

    if (!result.ok) {
      setSaveStatus({
        tone: 'error',
        message: 'These details changed elsewhere. Refresh the page and try saving again.',
      });
      return;
    }

    onItineraryChange(result.itinerary);
    setDraftProfile(sanitizeTripProfile(result.itinerary.tripProfile) ?? profile);
    setSaveStatus({
      tone: 'success',
      message: result.applied.length > 0
        ? `Refreshed ${result.applied.length} generated ${result.applied.length === 1 ? 'field' : 'fields'}.`
        : 'Your written copy was preserved.',
    });
  };

  const handleCancel = () => {
    setDraftProfile(savedProfile);
    setDurationError(null);
    setSaveStatus({ tone: 'neutral', message: 'Unsaved trip detail changes were discarded.' });
  };

  /**
   * Read from the handbook as it stands, not from the edit that produced it,
   * so it survives a reload and stays true while the traveller is still
   * deciding.
   */
  const durationChange = useMemo(() => {
    if (!durationValidation.ok || durationValidation.days <= 0 || itinerary.days.length === 0) return null;

    const emptyTail = [...itinerary.days]
      .reverse()
      .findIndex((day) => day.activities.length > 0);
    const trailingEmpty = emptyTail === -1 ? itinerary.days.length : emptyTail;
    const planned = itinerary.days.some((day) => day.activities.length > 0);

    if (itinerary.days.length > durationValidation.days) {
      const stranded = itinerary.days.length - durationValidation.days;
      return `${stranded} ${stranded === 1 ? 'day is' : 'days are'} past the end of these dates and still hold plans. They have been kept — remove them from the itinerary if you no longer want them.`;
    }
    if (planned && trailingEmpty > 0) {
      return `${trailingEmpty === 1 ? 'The last day is' : `The last ${trailingEmpty} days are`} empty. Rebuild through the discovery panel to schedule ${trailingEmpty === 1 ? 'it' : 'them'}.`;
    }
    return null;
  }, [durationValidation, itinerary.days]);

  const designSectionStyle = {
    borderTop: '1px solid var(--border)',
    borderRadius: '1.5rem',
    outline: isDesignHighlighted ? '2px solid var(--accent)' : '2px solid transparent',
    outlineOffset: '0.75rem',
    boxShadow: isDesignHighlighted
      ? '0 0 0 0.75rem color-mix(in srgb, var(--accent-soft) 65%, transparent)'
      : 'none',
    transition: 'outline-color 450ms ease, box-shadow 450ms ease',
  };

  return (
    <div className="space-y-6">
      <div
        className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        <div>
          <div className="eyebrow m-0">Trip details</div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
            Changes stay here until you save. Saving also refreshes generated banner copy.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isDirty && (
            <button type="button" className="pill-btn pill-ghost" onClick={handleCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="pill-btn pill-primary" onClick={handleSave} disabled={!isDirty}>
            <Save className="w-4 h-4" />
            Save changes
          </button>
        </div>
      </div>
      {saveStatus && (
        <div
          className="flex items-start gap-3 rounded-2xl border px-4 py-3"
          style={{
            backgroundColor: saveStatus.tone === 'success'
              ? 'color-mix(in srgb, #16a34a 12%, var(--surface))'
              : saveStatus.tone === 'error'
                ? 'color-mix(in srgb, #dc2626 12%, var(--surface))'
                : 'color-mix(in srgb, var(--ink-muted) 10%, var(--surface))',
            borderColor: saveStatus.tone === 'success'
              ? 'color-mix(in srgb, #16a34a 42%, var(--border))'
              : saveStatus.tone === 'error'
                ? 'color-mix(in srgb, #dc2626 42%, var(--border))'
                : 'var(--border)',
            color: 'var(--ink)',
          }}
          role="status"
          aria-live="polite"
        >
          {saveStatus.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#15803d' }} aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: saveStatus.tone === 'error' ? '#b91c1c' : 'var(--ink-muted)' }} aria-hidden="true" />
          )}
          <div className="min-w-0 text-xs">
            <p className="font-semibold">
              {saveStatus.tone === 'success' ? 'Saved successfully' : saveStatus.tone === 'error' ? 'Could not save changes' : 'Changes discarded'}
            </p>
            <p className="mt-0.5" style={{ color: 'var(--ink-muted)' }}>{saveStatus.message}</p>
          </div>
        </div>
      )}
      {cityStayNeedsAttention && (
        <div
          className="flex items-start gap-3 rounded-2xl border px-4 py-3"
          style={{
            backgroundColor: 'color-mix(in srgb, #d97706 13%, var(--surface))',
            borderColor: 'color-mix(in srgb, #d97706 45%, var(--border))',
            color: 'var(--ink)',
          }}
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#b45309' }} aria-hidden="true" />
          <div className="min-w-0 text-xs">
            <p className="font-semibold">City split still needs attention</p>
            <p className="mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {cityStaySummary.remaining > 0
                ? `${cityStaySummary.remaining} of ${cityStaySummary.dayCount} ${cityStaySummary.remaining === 1 ? 'day is' : 'days are'} still unassigned.`
                : cityStaySummary.remaining < 0
                  ? `${Math.abs(cityStaySummary.remaining)} ${Math.abs(cityStaySummary.remaining) === 1 ? 'day is' : 'days are'} assigned beyond the ${cityStaySummary.dayCount}-day trip.`
                  : `${cityStaySummary.unplaced.join(' and ')} ${cityStaySummary.unplaced.length === 1 ? 'has' : 'have'} no days yet.`}
              {' '}You can save while you decide; use <span className="font-semibold" style={{ color: 'var(--ink)' }}>Split evenly</span> or adjust the city rows before building the itinerary.
            </p>
          </div>
        </div>
      )}
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
            onChange={(cityStays) => update({ cityStays, cityStayDayCount: duration.days })}
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

      {/*
        * What changing the dates just did to the handbook.
        *
        * The day cards follow the dates now, but a new day arrives empty and
        * the planner does not re-run on its own — so a traveller who adds a day
        * would otherwise see a ninth card appear, blank, with no indication of
        * how to fill it. Days past the end of a shortened trip are never
        * deleted, and this is where they are accounted for.
        */}
      {durationChange && (
        <p className="text-xs" role="status" style={{ color: 'var(--accent)' }}>
          {durationChange}
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

      <section
        id="settings-design"
        className="scroll-mt-24 mt-8 space-y-5 pt-8"
        style={designSectionStyle}
        aria-labelledby="settings-design-heading"
      >
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Wand2 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="eyebrow">Handbook design</div>
            <h3 id="settings-design-heading" className="font-display text-2xl sm:text-3xl mt-2">Give the journey its look.</h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
              Choose how strongly the handbook adapts to the destination, then review the copy it generates.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
        <ToggleRow
          label="Name the handbook after the trip"
          description={`Currently “${identity.brandTitle}”.`}
          checked={profile.brandAfterDestination}
          onChange={(checked) => update({ brandAfterDestination: checked })}
        />
      </div>

      <VisualDesignControls profile={profile} onChange={updateDraft} />

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
        {isDirty ? (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Save your trip details first, then you can review any protected copy before replacing it.
          </p>
        ) : (
          <RegenerationPreview itinerary={itinerary} profile={profile} onItineraryChange={onItineraryChange} />
        )}
          </div>
        </div>
      </section>
    </div>
  );
}

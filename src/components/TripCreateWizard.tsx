import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Coins,
  Loader2,
  MapPin,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { findCountry, type CountryProfile, type PlaceSuggestion } from '../lib/destinations';
import { CountryMark } from './ui/CountryMark';
import { CURRENCIES } from '../lib/currencyCatalog';
import { buildTripIdentity } from '../lib/tripIdentity';
import {
  MAX_TRIP_DURATION_DAYS,
  TRIP_DATES_REVERSED_MESSAGE,
  longTripPartialGenerationMessage,
  validateTripDuration,
  withValidatedDuration,
} from '../lib/tripDuration';
import { OptionChips } from './ui/OptionChips';
import { CountryPicker } from './ui/CountryPicker';
import { CitySearchInput } from './ui/CitySearchInput';
import { DateRangeCalendar } from './ui/DateRangeCalendar';
import { CityStayPlanner } from './ui/CityStayPlanner';
import { ToggleRow } from './ui/ToggleRow';
import { VisualDesignControls } from './VisualDesignControls';
import { resolveVisualIdentity } from '../lib/visualIdentity';
import { useTheme } from '../contexts/ThemeContext';
import {
  BUDGET_OPTIONS,
  MOOD_OPTIONS,
  STAY_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  TRIP_TYPE_OPTIONS,
  countryBreakdown,
  createEmptyProfile,
  describeDestination,
  destinationCurrencies,
  destinationFromPlace,
  manualDestination,
  nightsBetween,
  sanitizeClockTime,
  sanitizeTripProfile,
  resolveDuration,
  suggestedCurrency,
  type BudgetTier,
  type TripProfile,
} from '../lib/tripProfile';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../lib/safeLocalStorage';

interface TripCreateWizardProps {
  open: boolean;
  busy?: boolean;
  defaultHomeCurrency?: string;
  onCancel: () => void;
  onCreate: (profile: TripProfile) => void;
}

const DRAFT_KEY = 'trip-wizard-draft-v2';
const LEGACY_DRAFT_KEY = 'trip-wizard-draft-v1';

interface WizardDraft {
  stepIndex: number;
  profile: TripProfile;
  countryCode: string;
  countryName: string;
  currencyTouched: boolean;
  savedAt: string;
}

/**
 * Answers survive an accidental close. Nothing is created until the last step,
 * so the draft is the only record of the work in progress.
 */
const readDraft = (): WizardDraft | null => {
  try {
    const currentRaw = safeGetItem(DRAFT_KEY);
    const raw = currentRaw ?? safeGetItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft>;
    const profile = sanitizeTripProfile(parsed.profile);
    if (!profile) return null;
    const parsedStepIndex = typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0;
    const stepIndex = currentRaw || parsedStepIndex < 4 ? parsedStepIndex : parsedStepIndex + 1;
    return {
      stepIndex,
      profile,
      countryCode: typeof parsed.countryCode === 'string' ? parsed.countryCode : '',
      countryName: typeof parsed.countryName === 'string' ? parsed.countryName : '',
      currencyTouched: parsed.currencyTouched === true,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const clearDraft = () => safeRemoveItem(DRAFT_KEY);

/** True once the traveller has actually answered something worth keeping. */
const isWorthSaving = (draft: Omit<WizardDraft, 'savedAt'>) =>
  draft.stepIndex > 0
  || draft.profile.destinations.length > 0
  || draft.countryCode.length > 0;

const STEPS = [
  { id: 'where', title: 'Where are you going?', hint: 'Add every city you plan to visit.' },
  { id: 'when', title: 'When is the trip?', hint: 'Dates set your days, nights, and season.' },
  { id: 'type', title: 'What kind of trip is it?', hint: 'Pick the ones that fit.' },
  { id: 'style', title: 'What will you spend time on?', hint: 'Choose the experiences you want to make room for.' },
  { id: 'mood', title: 'What should it feel like?', hint: 'Set the mood for the writing in your handbook.' },
  { id: 'practical', title: 'How will you travel?', hint: 'Budget, transport, and where you stay.' },
  { id: 'identity', title: 'Your handbook identity', hint: 'Generated from everything above.' },
] as const;

export function TripCreateWizard({
  open,
  busy = false,
  defaultHomeCurrency = 'MYR',
  onCancel,
  onCreate,
}: TripCreateWizardProps) {
  // Already resolved upstream: a saved preference if there is one, otherwise
  // the device region.
  const detectedHomeCurrency = defaultHomeCurrency;
  // The dialog writes palette variables onto its own subtree, so it has to
  // resolve them for the active theme. Without this the light palette leaks
  // into dark mode and selected chips render light-on-light.
  const { theme } = useTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const [profile, setProfile] = useState<TripProfile>(() => createEmptyProfile(detectedHomeCurrency));
  const [countryCode, setCountryCode] = useState('');
  const [countryName, setCountryName] = useState('');
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [resumedDraft, setResumedDraft] = useState(false);

  // Restore while rendering rather than in an effect, so reopening never shows
  // a blank form for a frame before the draft arrives.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const draft = readDraft();
      setStepIndex(draft?.stepIndex ?? 0);
      setProfile(draft?.profile ?? createEmptyProfile(detectedHomeCurrency));
      setCountryCode(draft?.countryCode ?? '');
      setCountryName(draft?.countryName ?? '');
      setCurrencyTouched(draft?.currencyTouched ?? false);
      setResumedDraft(draft !== null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const draft = { stepIndex, profile, countryCode, countryName, currencyTouched };
    if (!isWorthSaving(draft)) return;
    safeSetItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  }, [open, stepIndex, profile, countryCode, countryName, currencyTouched]);

  const startOver = () => {
    clearDraft();
    setStepIndex(0);
    setProfile(createEmptyProfile(detectedHomeCurrency));
    setCountryCode('');
    setCountryName('');
    setCurrencyTouched(false);
    setResumedDraft(false);
  };

  const update = (patch: Partial<TripProfile>) => setProfile((current) => ({ ...current, ...patch }));

  const toggle = <T extends string>(key: 'tripTypes' | 'styles' | 'moods' | 'transport' | 'stays', id: T) => {
    setProfile((current) => {
      const list = current[key] as unknown as T[];
      const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
      return { ...current, [key]: next } as TripProfile;
    });
  };

  const selectCountry = (country: CountryProfile) => {
    setCountryCode(country.code);
    setCountryName(country.name);
    // Stops that already know their own country are left alone, so switching
    // country to add a second leg does not rewrite the first one. Only stops
    // with no country of their own are re-derived, which also refreshes their
    // id, currency and time zone.
    setProfile((current) => ({
      ...current,
      destinations: current.destinations.map((destination) =>
        destination.country
          ? destination
          : { ...manualDestination(destination.city, country.name), lat: destination.lat, lng: destination.lng },
      ),
    }));
  };

  const addPlace = (place: PlaceSuggestion) => {
    const destination = destinationFromPlace(place, countryName);
    setProfile((current) =>
      // Identity is the place id, so two cities that share a name are both kept
      // while the same place added twice is not.
      current.destinations.some((existing) => existing.id === destination.id)
        ? current
        : { ...current, destinations: [...current.destinations, destination] },
    );
    // The first city can teach us the country when it was never picked.
    if (!countryCode && place.countryCode) {
      setCountryCode(place.countryCode);
      setCountryName(place.country || '');
    }
  };

  const removeDestination = (index: number) =>
    setProfile((current) => ({
      ...current,
      destinations: current.destinations.filter((_, itemIndex) => itemIndex !== index),
    }));

  const duration = resolveDuration(profile);
  const nights = nightsBetween(profile.startDate, profile.endDate);
  const durationValidation = validateTripDuration(profile);
  const datesReversed = durationValidation.ok === false && durationValidation.reason === 'reversed';
  const durationTooLong = durationValidation.ok === false && durationValidation.reason === 'too_long';
  const selectedCountry = useMemo(() => findCountry(countryCode), [countryCode]);
  // Cities can span countries, so the saved stops decide the currency once
  // there are any; the country picker only seeds it beforehand.
  const autoCurrency = profile.destinations.length > 0
    ? suggestedCurrency(profile)
    : selectedCountry?.currency || suggestedCurrency(profile);
  const tripCountries = useMemo(() => countryBreakdown(profile), [profile]);
  const otherCurrencies = useMemo(
    () => destinationCurrencies(profile).filter((code) => code !== autoCurrency),
    [profile, autoCurrency],
  );

  // Until the traveller overrides it, the trip currency simply follows the destination.
  const resolvedProfile = useMemo<TripProfile>(
    () => (currencyTouched ? profile : { ...profile, tripCurrency: autoCurrency }),
    [profile, currencyTouched, autoCurrency],
  );

  const identity = useMemo(
    () => buildTripIdentity(resolvedProfile, { plannedDays: duration.days }),
    [resolvedProfile, duration.days],
  );
  const resolvedVisualIdentity = useMemo(
    () => resolveVisualIdentity(resolvedProfile, { theme }),
    [resolvedProfile, theme],
  );

  if (!open) return null;

  const step = STEPS[stepIndex];
  const finalDestination = profile.destinations[0]?.city || resolvedVisualIdentity.country.name;
  const stepTitle = step.id === 'identity' && finalDestination
    ? `Your ${finalDestination} handbook is ready`
    : step.title;
  const manualRecipe = resolvedProfile.visualDesign?.recipeOverride;
  const stepHint = step.id === 'identity'
    ? manualRecipe
      ? `You selected ${resolvedVisualIdentity.recipe.label} for your ${finalDestination || 'handbook'}.`
      : resolvedProfile.visualDesign?.intensity === 'off'
        ? 'Your handbook will use the standard app design.'
        : `We created a ${resolvedVisualIdentity.recipe.label} design based on ${resolvedVisualIdentity.country.name || 'your destination'} and your travel preferences.`
    : step.hint;
  const whenStepValid = durationValidation.ok;
  const canContinue = step.id === 'where'
    ? profile.destinations.length > 0
    : step.id === 'when'
      ? whenStepValid
      : true;
  const isLast = stepIndex === STEPS.length - 1;

  const goNext = () => {
    if (isLast) {
      const committed = withValidatedDuration(resolvedProfile);
      if (!committed.ok) {
        setStepIndex(STEPS.findIndex((entry) => entry.id === 'when'));
        return;
      }
      clearDraft();
      onCreate(committed.profile);
      return;
    }
    setStepIndex((index) => Math.min(STEPS.length - 1, index + 1));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(15, 14, 13, 0.6)' }}
        aria-label="Close trip setup"
        onClick={onCancel}
      />

      <div
        className="wizard-dialog relative z-10 w-full sm:max-w-2xl flex flex-col sm:rounded-[1.75rem] overflow-hidden"
        data-adaptive-handbook="true"
        data-visual-intensity={resolvedVisualIdentity.intensity}
        data-design-recipe={resolvedVisualIdentity.recipe.id}
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          maxHeight: '100dvh',
          paddingTop: 'var(--app-safe-top)',
          paddingBottom: 'var(--app-safe-bottom)',
          // Scope the trip's design tokens onto the dialog so city controls,
          // chips, and calendar chrome follow the recipe while creating.
          ...resolvedVisualIdentity.cssVars,
          borderRadius: 'var(--radius-modal, 1.75rem)',
        }}
      >
        <header className="wizard-dialog-header px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">Step {stepIndex + 1} of {STEPS.length}</div>
              <h2 className="font-display text-2xl sm:text-3xl mt-2">{stepTitle}</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>{stepHint}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-2 rounded-full shrink-0"
              style={{ color: 'var(--ink-muted)' }}
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%`, backgroundColor: 'var(--accent)' }}
            />
          </div>
        </header>

        <div
          className="wizard-dialog-content flex-1 overflow-y-auto px-5 py-5 space-y-5"
          data-lenis-prevent
          data-lenis-prevent-wheel
          data-lenis-prevent-touch
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {resumedDraft && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
            >
              <p className="text-sm">
                Picked up where you left off. Your earlier answers are still here.
              </p>
              <button
                type="button"
                onClick={startOver}
                className="text-sm font-semibold underline underline-offset-4"
              >
                Start over
              </button>
            </div>
          )}

          {step.id === 'where' && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Country
                </label>
                <CountryPicker value={countryCode} onChange={selectCountry} />
                {selectedCountry && (
                  <p className="text-xs flex items-center gap-2" style={{ color: 'var(--ink-muted)' }}>
                    <CountryMark code={selectedCountry.code} compact />
                    <span>
                      Money there is {selectedCountry.currency}, and the handbook will pick up its colours.
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Cities
                </label>
                <CitySearchInput
                  countryCode={countryCode || undefined}
                  countryName={countryName || undefined}
                  chosenIds={profile.destinations.map((destination) => destination.id)}
                  onSelect={addPlace}
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  {profile.destinations.map((destination, index) => (
                    <span
                      key={destination.id}
                      className="adaptive-chip inline-flex items-center gap-2 pl-3 pr-2 py-1.5 text-sm"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                      {/* Region and country keep two Georgetowns apart. */}
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
                        onClick={() => removeDestination(index)}
                        className="adaptive-button p-1 shrink-0"
                        aria-label={`Remove ${describeDestination(destination)}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {profile.destinations.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                      Pick a city from the list so the map, route, and copy know exactly where you are going.
                    </p>
                  )}
                </div>
              </div>

              <ToggleRow
                label="Include hidden gems"
                description="Lean away from the obvious stops."
                checked={profile.hiddenGems}
                onChange={(checked) => update({ hiddenGems: checked })}
              />
            </>
          )}

          {step.id === 'when' && (
            <>
              {/*
                * One calendar for both ends of the trip. Two `type="date"`
                * fields never showed the trip as a whole: you chose a start,
                * the picker closed, and the days you had committed to were
                * drawn nowhere.
                */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  When are you going
                </label>
                <DateRangeCalendar
                  label="Trip dates"
                  value={{ start: profile.startDate, end: profile.endDate }}
                  onChange={(range) => update({ startDate: range.start, endDate: range.end })}
                />
              </div>

              {/*
                * Asked, not assumed. On a multi-city trip the app does not get
                * to decide which nights are in which city, so it asks here —
                * before discovery, so every later stage follows the answer.
                */}
              {profile.destinations.length > 1 && nights !== null && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    How long in each city
                  </label>
                  <CityStayPlanner
                    cities={profile.destinations.map((destination) => destination.city)}
                    dayCount={nights + 1}
                    startDate={profile.startDate}
                    value={profile.cityStays}
                    onChange={(cityStays) => update({ cityStays, cityStayDayCount: nights + 1 })}
                  />
                </div>
              )}

              {/*
                * Optional, and deliberately placed under the dates rather than
                * in its own step: a traveller who has not booked flights yet
                * should be able to skip straight past it.
                */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Arrival time (optional)
                  </label>
                  <input
                    type="time"
                    className="editorial-input w-full"
                    value={profile.arrivalTime || ''}
                    onChange={(event) => update({ arrivalTime: sanitizeClockTime(event.target.value) })}
                  />
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Day one starts after you land, with time to drop bags.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Departure time (optional)
                  </label>
                  <input
                    type="time"
                    className="editorial-input w-full"
                    value={profile.departureTime || ''}
                    onChange={(event) => update({ departureTime: sanitizeClockTime(event.target.value) })}
                  />
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    The last day ends in time to leave for the airport.
                  </p>
                </div>
              </div>

              {nights === null && !datesReversed && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Or just the number of days
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={MAX_TRIP_DURATION_DAYS}
                    className="editorial-input w-full"
                    value={profile.dayCount || ''}
                    onChange={(event) => update({ dayCount: Number(event.target.value) || 0 })}
                    placeholder="7"
                  />
                </div>
              )}

              {datesReversed && (
                <p className="text-sm" style={{ color: 'var(--accent)' }}>
                  {durationValidation.ok === false ? durationValidation.message : TRIP_DATES_REVERSED_MESSAGE}
                </p>
              )}

              {durationTooLong && (
                <p className="text-sm" style={{ color: 'var(--accent)' }}>
                  {durationValidation.ok === false ? durationValidation.message : ''}
                </p>
              )}

              <div
                className="rounded-2xl px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                {durationValidation.ok && duration.days > 0 ? (
                  <>
                    <span><strong>{duration.days}</strong> {duration.days === 1 ? 'day' : 'days'}</span>
                    <span><strong>{duration.nights}</strong> {duration.nights === 1 ? 'night' : 'nights'}</span>
                  </>
                ) : durationTooLong ? (
                  <span>That span is too long to save.</span>
                ) : datesReversed ? (
                  <span>Fix the dates to see the day count.</span>
                ) : (
                  // Never show "0 days": an undated trip simply has no duration yet.
                  <span>Dates not set — you can add them later.</span>
                )}
                {identity.summaryChips.includes('Spring') || identity.summaryChips.includes('Summer')
                  || identity.summaryChips.includes('Autumn') || identity.summaryChips.includes('Winter') ? (
                  <span>Season detected</span>
                ) : null}
              </div>

              {durationValidation.ok && durationValidation.generatesPartialDays && (
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {longTripPartialGenerationMessage(durationValidation.days)}
                </p>
              )}
            </>
          )}

          {step.id === 'type' && (
            <OptionChips
              options={TRIP_TYPE_OPTIONS}
              selected={profile.tripTypes}
              onToggle={(id) => toggle('tripTypes', id)}
            />
          )}

          {step.id === 'style' && (
            <div>
              <div className="eyebrow mb-3">Travel style</div>
              <OptionChips
                options={TRAVEL_STYLE_OPTIONS}
                selected={profile.styles}
                onToggle={(id) => toggle('styles', id)}
              />
            </div>
          )}

          {step.id === 'mood' && (
            <div>
              <div className="eyebrow mb-3">Mood</div>
              <OptionChips
                options={MOOD_OPTIONS}
                selected={profile.moods}
                onToggle={(id) => toggle('moods', id)}
              />
            </div>
          )}

          {step.id === 'practical' && (
            <>
              <div>
                <div className="eyebrow mb-3">Budget</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {BUDGET_OPTIONS.map((option) => {
                    const active = profile.budgetTier === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => update({ budgetTier: option.id as BudgetTier })}
                        className="text-left rounded-2xl px-4 py-3 min-h-16"
                        style={{
                          backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg)',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        }}
                        aria-pressed={active}
                      >
                        <span className="text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs" style={{ color: 'var(--ink-muted)' }}>{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-3">Getting around</div>
                <OptionChips
                  options={TRANSPORT_OPTIONS}
                  selected={profile.transport}
                  onToggle={(id) => toggle('transport', id)}
                />
              </div>
              <div>
                <div className="eyebrow mb-3">Where you stay</div>
                <OptionChips
                  options={STAY_OPTIONS}
                  selected={profile.stays}
                  onToggle={(id) => toggle('stays', id)}
                />
              </div>
            </>
          )}

          {step.id === 'identity' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Home currency
                  </label>
                  <select
                    className="editorial-input w-full"
                    value={profile.homeCurrency}
                    onChange={(event) => update({ homeCurrency: event.target.value })}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.code} — {currency.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    What you spend back home.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Trip currency
                  </label>
                  <select
                    className="editorial-input w-full"
                    value={resolvedProfile.tripCurrency}
                    onChange={(event) => {
                      setCurrencyTouched(true);
                      update({ tripCurrency: event.target.value });
                    }}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.code} — {currency.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--ink-muted)' }}>
                    <Coins className="w-3.5 h-3.5" />
                    {tripCountries.length > 1
                      ? `Suggested from ${tripCountries[0].country}, where most of your stops are.`
                      : 'Suggested from your destination.'}
                  </p>
                  {otherCurrencies.length > 0 && (
                    <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                      You will also spend {otherCurrencies.join(', ')} on this trip. The wallet
                      converts everything to the currency above.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <ToggleRow
                  label="Name the handbook after the trip"
                  description={`Otherwise it stays “Travel Handbook”.`}
                  checked={profile.brandAfterDestination}
                  onChange={(checked) => update({ brandAfterDestination: checked })}
                />
              </div>

              <VisualDesignControls
                profile={resolvedProfile}
                compact
                onChange={(next) => {
                  setProfile(next);
                  if (next.tripCurrency !== autoCurrency) setCurrencyTouched(true);
                }}
              />

              <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  <span className="eyebrow m-0">Copy preview</span>
                </div>
                <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{identity.heroEyebrow}</p>
                <p className="font-display handbook-display text-3xl leading-tight">{identity.heroTitle}</p>
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{identity.heroDescription}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {identity.summaryChips.map((chip) => (
                    <span
                      key={chip}
                      className="adaptive-chip px-2.5 py-1 text-xs font-semibold"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Nav brand: <strong>{identity.brandTitle}</strong> · Badge: <strong>{identity.dayBadgeValue} {identity.dayBadgeUnit}</strong>
                </p>
              </div>

              <p className="text-xs inline-flex items-start gap-2" style={{ color: 'var(--ink-muted)' }}>
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Everything generated here stays editable later in Settings and the home hero editor.
              </p>
            </>
          )}
        </div>

        <footer className="wizard-dialog-footer px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="pill-btn pill-ghost"
            onClick={() => (stepIndex === 0 ? onCancel() : setStepIndex((index) => index - 1))}
            disabled={busy}
          >
            <ArrowLeft className="w-4 h-4" />
            {stepIndex === 0 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {!isLast && step.id !== 'where' && (
              <button
                type="button"
                className="pill-btn pill-soft"
                onClick={() => {
                  if (!durationValidation.ok) {
                    setStepIndex(STEPS.findIndex((entry) => entry.id === 'when'));
                    return;
                  }
                  setStepIndex(STEPS.length - 1);
                }}
              >
                Skip
              </button>
            )}
            <button
              type="button"
              className="pill-btn pill-primary"
              onClick={goNext}
              disabled={!canContinue || busy}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isLast ? <CalendarDays className="w-4 h-4" /> : null}
              {isLast ? 'Create handbook' : 'Continue'}
              {!isLast && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

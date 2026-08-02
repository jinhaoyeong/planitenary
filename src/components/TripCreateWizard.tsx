import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Coins,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { geocodePlace, findCountry, listCountries } from '../lib/destinations';
import { CURRENCIES } from '../lib/currencyCatalog';
import { buildTripIdentity } from '../lib/tripIdentity';
import { OptionChips } from './ui/OptionChips';
import {
  BUDGET_OPTIONS,
  MOOD_OPTIONS,
  STAY_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  TRIP_TYPE_OPTIONS,
  createEmptyProfile,
  nightsBetween,
  resolveDuration,
  suggestedCurrency,
  type BudgetTier,
  type TripDestination,
  type TripProfile,
} from '../lib/tripProfile';

interface TripCreateWizardProps {
  open: boolean;
  busy?: boolean;
  defaultHomeCurrency?: string;
  onCancel: () => void;
  onCreate: (profile: TripProfile) => void;
}

const STEPS = [
  { id: 'where', title: 'Where are you going?', hint: 'Add every city you plan to visit.' },
  { id: 'when', title: 'When is the trip?', hint: 'Dates set your days, nights, and season.' },
  { id: 'type', title: 'What kind of trip is it?', hint: 'Pick the ones that fit.' },
  { id: 'style', title: 'What will you spend time on?', hint: 'Style and mood shape the writing.' },
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
  const [stepIndex, setStepIndex] = useState(0);
  const [profile, setProfile] = useState<TripProfile>(() => createEmptyProfile(defaultHomeCurrency));
  const [countryInput, setCountryInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [locating, setLocating] = useState(false);
  const [currencyTouched, setCurrencyTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setProfile(createEmptyProfile(defaultHomeCurrency));
    setCountryInput('');
    setCityInput('');
    setCurrencyTouched(false);
  }, [open, defaultHomeCurrency]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const update = (patch: Partial<TripProfile>) => setProfile((current) => ({ ...current, ...patch }));

  const toggle = <T extends string>(key: 'tripTypes' | 'styles' | 'moods' | 'transport' | 'stays', id: T) => {
    setProfile((current) => {
      const list = current[key] as unknown as T[];
      const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
      return { ...current, [key]: next } as TripProfile;
    });
  };

  const addDestination = async () => {
    const city = cityInput.trim();
    if (!city) return;
    const country = countryInput.trim() || profile.destinations[0]?.country || '';
    const draft: TripDestination = { city, country };
    setProfile((current) => ({ ...current, destinations: [...current.destinations, draft] }));
    setCityInput('');
    setLocating(true);

    try {
      const result = await geocodePlace(country ? `${city}, ${country}` : city);
      if (result) {
        setProfile((current) => ({
          ...current,
          destinations: current.destinations.map((destination) =>
            destination.city === city && destination.lat === undefined
              ? { ...destination, lat: result.lat, lng: result.lng, country: destination.country || result.country || '' }
              : destination,
          ),
        }));
        if (!country && result.country) setCountryInput(result.country);
      }
    } finally {
      setLocating(false);
    }
  };

  const removeDestination = (index: number) =>
    setProfile((current) => ({
      ...current,
      destinations: current.destinations.filter((_, itemIndex) => itemIndex !== index),
    }));

  const duration = resolveDuration(profile);
  const nights = nightsBetween(profile.startDate, profile.endDate);
  const autoCurrency = suggestedCurrency(profile);

  useEffect(() => {
    if (currencyTouched) return;
    if (autoCurrency && autoCurrency !== profile.tripCurrency) {
      setProfile((current) => ({ ...current, tripCurrency: autoCurrency }));
    }
  }, [autoCurrency, currencyTouched, profile.tripCurrency]);

  const identity = useMemo(
    () => buildTripIdentity(profile, { plannedDays: duration.days }),
    [profile, duration.days],
  );

  if (!open) return null;

  const step = STEPS[stepIndex];
  const canContinue = step.id === 'where' ? profile.destinations.length > 0 : true;
  const isLast = stepIndex === STEPS.length - 1;

  const goNext = () => {
    if (isLast) {
      onCreate(profile);
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
        className="relative z-10 w-full sm:max-w-2xl flex flex-col sm:rounded-[1.75rem] overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          maxHeight: '100dvh',
          paddingTop: 'var(--app-safe-top)',
          paddingBottom: 'var(--app-safe-bottom)',
        }}
      >
        <header className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">Step {stepIndex + 1} of {STEPS.length}</div>
              <h2 className="font-display text-2xl sm:text-3xl mt-2">{step.title}</h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>{step.hint}</p>
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

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {step.id === 'where' && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Country
                </label>
                <input
                  className="editorial-input w-full"
                  value={countryInput}
                  onChange={(event) => setCountryInput(event.target.value)}
                  placeholder="Japan"
                  list="trip-country-options"
                />
                <datalist id="trip-country-options">
                  {listCountries().map((country) => (
                    <option key={country.code} value={country.name} />
                  ))}
                </datalist>
                {findCountry(countryInput) && (
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Currency there is {findCountry(countryInput)?.currency}.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                  Cities
                </label>
                <div className="flex gap-2">
                  <input
                    className="editorial-input flex-1"
                    value={cityInput}
                    onChange={(event) => setCityInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void addDestination();
                      }
                    }}
                    placeholder="Kyoto"
                  />
                  <button type="button" className="pill-btn pill-primary shrink-0" onClick={() => void addDestination()}>
                    {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {profile.destinations.map((destination, index) => (
                    <span
                      key={`${destination.city}-${index}`}
                      className="inline-flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 text-sm"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}
                    >
                      <MapPin className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      {destination.city}
                      <button
                        type="button"
                        onClick={() => removeDestination(index)}
                        className="p-1 rounded-full"
                        aria-label={`Remove ${destination.city}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {profile.destinations.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                      Add at least one city so the map and copy know where you are going.
                    </p>
                  )}
                </div>
              </div>

              <label
                className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span>
                  <span className="text-sm font-semibold">Include hidden gems</span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    Lean away from the obvious stops.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="w-5 h-5"
                  checked={profile.hiddenGems}
                  onChange={(event) => update({ hiddenGems: event.target.checked })}
                />
              </label>
            </>
          )}

          {step.id === 'when' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Start date
                  </label>
                  <input
                    type="date"
                    className="editorial-input w-full"
                    value={profile.startDate || ''}
                    onChange={(event) => update({ startDate: event.target.value || undefined })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    End date
                  </label>
                  <input
                    type="date"
                    className="editorial-input w-full"
                    min={profile.startDate || undefined}
                    value={profile.endDate || ''}
                    onChange={(event) => update({ endDate: event.target.value || undefined })}
                  />
                </div>
              </div>

              {nights === null && (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Or just the number of days
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    className="editorial-input w-full"
                    value={profile.dayCount || ''}
                    onChange={(event) => update({ dayCount: Number(event.target.value) || 0 })}
                    placeholder="7"
                  />
                </div>
              )}

              <div
                className="rounded-2xl px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1"
                style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
              >
                <span><strong>{duration.days}</strong> days</span>
                <span><strong>{duration.nights}</strong> nights</span>
                {identity.summaryChips.includes('Spring') || identity.summaryChips.includes('Summer')
                  || identity.summaryChips.includes('Autumn') || identity.summaryChips.includes('Winter') ? (
                  <span>Season detected</span>
                ) : null}
              </div>
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
            <>
              <div>
                <div className="eyebrow mb-3">Travel style</div>
                <OptionChips
                  options={TRAVEL_STYLE_OPTIONS}
                  selected={profile.styles}
                  onToggle={(id) => toggle('styles', id)}
                />
              </div>
              <div>
                <div className="eyebrow mb-3">Mood</div>
                <OptionChips
                  options={MOOD_OPTIONS}
                  selected={profile.moods}
                  onToggle={(id) => toggle('moods', id)}
                />
              </div>
            </>
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
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                    Trip currency
                  </label>
                  <select
                    className="editorial-input w-full"
                    value={profile.tripCurrency}
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
                    <Coins className="w-3.5 h-3.5" /> Suggested from your destination.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                  style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
                >
                  <span>
                    <span className="text-sm font-semibold">Name the handbook after the trip</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      Otherwise it stays “Travel Handbook”.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="w-5 h-5"
                    checked={profile.brandAfterDestination}
                    onChange={(event) => update({ brandAfterDestination: event.target.checked })}
                  />
                </label>
                <label
                  className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                  style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
                >
                  <span>
                    <span className="text-sm font-semibold">Use the destination’s colours</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      Accent and highlights match where you are going.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="w-5 h-5"
                    checked={profile.applyVisualIdentity}
                    onChange={(event) => update({ applyVisualIdentity: event.target.checked })}
                  />
                </label>
              </div>

              <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  <span className="eyebrow m-0">Preview</span>
                  {profile.applyVisualIdentity && (
                    <span
                      className="ml-auto h-5 w-10 rounded-full"
                      style={{ backgroundColor: identity.palette.accent }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{identity.heroEyebrow}</p>
                <p className="font-display text-3xl leading-tight">{identity.heroTitle}</p>
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{identity.heroDescription}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {identity.summaryChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full px-2.5 py-1 text-xs font-semibold"
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

        <footer className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)' }}>
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
              <button type="button" className="pill-btn pill-soft" onClick={() => setStepIndex(STEPS.length - 1)}>
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

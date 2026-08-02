import { useMemo, useState } from 'react';
import { Loader2, MapPin, Plus, RotateCcw, Wand2, X } from 'lucide-react';
import type { Itinerary } from '../data';
import { geocodePlace } from '../lib/destinations';
import { buildTripIdentity } from '../lib/tripIdentity';
import { applyIdentityToItinerary } from '../lib/trips';
import {
  BUDGET_OPTIONS,
  MOOD_OPTIONS,
  STAY_OPTIONS,
  TRANSPORT_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
  TRIP_TYPE_OPTIONS,
  createEmptyProfile,
  resolveDuration,
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
  const [cityInput, setCityInput] = useState('');
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const profile = useMemo(
    () =>
      storedProfile ?? {
        ...createEmptyProfile(),
        destinations: itinerary.cities.map((city) => ({ city, country: '' })),
        dayCount: itinerary.days.length,
      },
    [storedProfile, itinerary.cities, itinerary.days.length],
  );

  const save = (next: TripProfile) => {
    setStatus(null);
    onItineraryChange({ ...itinerary, tripProfile: next });
  };

  const update = (patch: Partial<TripProfile>) => save({ ...profile, ...patch });

  const toggle = <T extends string>(key: 'tripTypes' | 'styles' | 'moods' | 'transport' | 'stays', id: T) => {
    const list = profile[key] as unknown as T[];
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    save({ ...profile, [key]: next } as TripProfile);
  };

  const addCity = async () => {
    const city = cityInput.trim();
    if (!city) return;
    const country = profile.destinations[0]?.country || '';
    setCityInput('');
    setLocating(true);
    try {
      const result = await geocodePlace(country ? `${city}, ${country}` : city);
      save({
        ...profile,
        destinations: [
          ...profile.destinations,
          { city, country: country || result?.country || '', lat: result?.lat, lng: result?.lng },
        ],
      });
    } finally {
      setLocating(false);
    }
  };

  const removeCity = (index: number) =>
    update({ destinations: profile.destinations.filter((_, itemIndex) => itemIndex !== index) });

  const duration = resolveDuration(profile);
  const identity = useMemo(
    () => buildTripIdentity(profile, { plannedDays: itinerary.days.length }),
    [profile, itinerary.days.length],
  );

  const regenerate = () => {
    onItineraryChange(applyIdentityToItinerary(itinerary, profile, identity));
    setStatus('Handbook copy regenerated from this profile.');
  };

  return (
    <div className="space-y-6">
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
                void addCity();
              }
            }}
            placeholder="Add another city"
          />
          <button type="button" className="pill-btn pill-soft shrink-0" onClick={() => void addCity()}>
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
              <button type="button" onClick={() => removeCity(index)} className="p-1 rounded-full" aria-label={`Remove ${destination.city}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {duration.days} days · {duration.nights} nights · {profile.destinations.length} stops on the map.
        </p>
      </div>

      <div>
        <div className="eyebrow mb-3">Trip type</div>
        <OptionChips options={TRIP_TYPE_OPTIONS} selected={profile.tripTypes} onToggle={(id) => toggle('tripTypes', id)} />
      </div>

      <div>
        <div className="eyebrow mb-3">Travel style</div>
        <OptionChips options={TRAVEL_STYLE_OPTIONS} selected={profile.styles} onToggle={(id) => toggle('styles', id)} />
      </div>

      <div>
        <div className="eyebrow mb-3">Mood</div>
        <OptionChips options={MOOD_OPTIONS} selected={profile.moods} onToggle={(id) => toggle('moods', id)} />
      </div>

      <div>
        <div className="eyebrow mb-3">Budget</div>
        <OptionChips
          options={BUDGET_OPTIONS}
          selected={[profile.budgetTier]}
          onToggle={(id) => update({ budgetTier: id as BudgetTier })}
          single
          columns={3}
        />
      </div>

      <div>
        <div className="eyebrow mb-3">Getting around</div>
        <OptionChips options={TRANSPORT_OPTIONS} selected={profile.transport} onToggle={(id) => toggle('transport', id)} />
      </div>

      <div>
        <div className="eyebrow mb-3">Where you stay</div>
        <OptionChips options={STAY_OPTIONS} selected={profile.stays} onToggle={(id) => toggle('stays', id)} />
      </div>

      <div className="space-y-2">
        <label
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}
        >
          <span>
            <span className="text-sm font-semibold">Name the handbook after the trip</span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              Currently “{identity.brandTitle}”.
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
              Applies as soon as you toggle it.
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
          <span className="eyebrow m-0">Generated copy</span>
        </div>
        <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{identity.heroEyebrow}</p>
        <p className="font-display text-2xl leading-tight">{identity.heroTitle}</p>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{identity.heroDescription}</p>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Overview: “{identity.overviewEyebrow}” · Button: “{identity.primaryButtonLabel}” · Search: “{identity.searchPlaceholder}”
        </p>
        <button type="button" className="pill-btn pill-primary" onClick={regenerate}>
          <RotateCcw className="w-4 h-4" />
          Apply to my handbook
        </button>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          This overwrites hero and overview text. Any wording you typed yourself will be replaced.
        </p>
        {status && <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{status}</p>}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { MapPin, RotateCcw, Wand2, X } from 'lucide-react';
import type { Itinerary } from '../data';
import { findCountry, type PlaceSuggestion } from '../lib/destinations';
import { CitySearchInput } from './ui/CitySearchInput';
import { ToggleRow } from './ui/ToggleRow';
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

  const addPlace = (place: PlaceSuggestion) => {
    save({
      ...profile,
      destinations: [
        ...profile.destinations,
        {
          city: place.city,
          country: place.country || profile.destinations[0]?.country || '',
          region: place.region,
          lat: place.lat,
          lng: place.lng,
        },
      ],
    });
  };

  const removeCity = (index: number) =>
    update({ destinations: profile.destinations.filter((_, itemIndex) => itemIndex !== index) });

  const countryCode = findCountry(profile.destinations[0]?.country)?.code;
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
        <CitySearchInput
          countryCode={countryCode}
          countryName={profile.destinations[0]?.country}
          chosen={profile.destinations.map((destination) => destination.city)}
          onSelect={addPlace}
          placeholder="Add another city"
        />
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
        <ToggleRow
          label="Name the handbook after the trip"
          description={`Currently “${identity.brandTitle}”.`}
          checked={profile.brandAfterDestination}
          onChange={(checked) => update({ brandAfterDestination: checked })}
        />
        <ToggleRow
          label="Use the destination’s colours"
          description="Applies as soon as you toggle it."
          checked={profile.applyVisualIdentity}
          onChange={(checked) => update({ applyVisualIdentity: checked })}
        />
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

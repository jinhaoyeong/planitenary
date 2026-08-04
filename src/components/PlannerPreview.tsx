import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock3, Lock, RefreshCw, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import type { Itinerary } from '../data';
import type { TripProfile } from '../lib/tripProfile';
import { declaredTripDays, plannerExistingDaysNotice } from '../lib/tripDuration';
import {
  applyItineraryProposal,
  generateInitialItinerary,
  optimiseDay,
  optimiseTrip,
  undoPlannerChange,
  type ItineraryProposal,
} from '../lib/tripIntelligence';
import { profileRevision } from '../lib/identityFields';

interface PlannerPreviewProps {
  itinerary: Itinerary;
  profile: TripProfile;
  onItineraryChange: (itinerary: Itinerary) => void;
}

function ChangeToggle({ checked, disabled, onClick, label }: { checked: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center transition-colors disabled:opacity-60"
      style={{
        backgroundColor: checked ? 'var(--accent)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        color: 'var(--accent-ink, #fff)',
      }}
    >
      {checked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </button>
  );
}

const actionLabel = (proposal: ItineraryProposal) => {
  if (proposal.action === 'generate') return 'Organise my saved places';
  if (proposal.action === 'optimise-day') return 'Optimise this day';
  return 'Optimise whole trip';
};

export function PlannerPreview({ itinerary, profile, onItineraryChange }: PlannerPreviewProps) {
  const [proposal, setProposal] = useState<ItineraryProposal | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const currentRevision = profileRevision(profile);
  const isStale = Boolean(proposal && (
    proposal.baseProfileRevision !== currentRevision
    || proposal.baseItineraryRevision !== (itinerary.revision || 0)
  ));
  const lastHistory = itinerary.plannerHistory?.[itinerary.plannerHistory.length - 1];
  const isPlaceActivity = (activity: (typeof itinerary.days)[number]['activities'][number]) =>
    activity.kind !== 'meal-window'
    && activity.kind !== 'rest-window'
    && activity.kind !== 'free-time'
    && activity.kind !== 'transport'
    && !(activity.source === 'generated' && !activity.providerPlaceId && (activity.type === 'food' || activity.type === 'cafe'));
  const hasPlaceActivities = itinerary.days.some((day) => day.activities.some(isPlaceActivity));
  const hasInboxActivities = (itinerary.unassignedActivities?.length || 0) > 0;
  const dayOptions = useMemo(() => itinerary.days.filter((day) => day.activities.some(isPlaceActivity)), [itinerary.days]);
  const declaredDays = declaredTripDays(profile);
  const existingDaysNotice = plannerExistingDaysNotice(declaredDays, itinerary.days.length);

  const openProposal = (next: ItineraryProposal) => {
    setProposal(next);
    setSelection(new Set(next.changes.filter((change) => !change.protected).map((change) => change.id)));
    setStatus(null);
  };

  const build = () => openProposal(generateInitialItinerary(itinerary, profile));
  const optimiseWholeTrip = () => openProposal(optimiseTrip(itinerary, profile));
  const optimiseSelectedDay = (dayNumber: number) => openProposal(optimiseDay(itinerary, profile, dayNumber));

  const toggle = (id: string) => setSelection((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const apply = () => {
    if (!proposal) return;
    if (isStale) {
      setStatus('Your trip details changed while this preview was open. Refresh it before applying.');
      return;
    }
    const result = applyItineraryProposal(itinerary, profile, proposal, selection);
    if (!result.ok) {
      setStatus(result.reason === 'profile-changed'
        ? 'Your trip profile changed while this preview was open. Refresh it before applying.'
        : 'Your itinerary changed while this preview was open. Refresh it before applying.');
      return;
    }
    onItineraryChange(result.itinerary);
    setProposal(null);
    setSelection(new Set());
    setStatus(result.applied.length > 0
      ? `${result.applied.length} changes applied. Your previous plan can be undone.`
      : 'Nothing selected, so the itinerary is unchanged.');
  };

  const undo = () => {
    if (!lastHistory) return;
    onItineraryChange(undoPlannerChange(itinerary, lastHistory.id));
    setStatus('The last planner change was undone.');
  };

  if (proposal) {
    return (
      <section className="rounded-3xl p-4 sm:p-5 space-y-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }} aria-live="polite">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow m-0">Preview before applying</div>
            <h3 className="font-display text-2xl mt-2">{actionLabel(proposal)}</h3>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--ink-muted)' }}>{proposal.reason}</p>
          </div>
          <Sparkles className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        </div>

        {isStale && (
          <div className="flex items-start gap-2 rounded-2xl p-3 text-xs" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>Your trip details changed after this preview was created. Refresh to calculate a safe proposal.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded-2xl p-3" style={{ border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--ink-muted)' }}>Approximate movement estimate</span>
            <strong className="block mt-1">{proposal.travelMinutesBefore} → {proposal.travelMinutesAfter} min</strong>
            <span className="block mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>Offline straight-line model · {Math.round(proposal.coordinateCoverage * 100)}% coordinate coverage</span>
          </div>
          <div className="rounded-2xl p-3" style={{ border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--ink-muted)' }}>Changes</span>
            <strong className="block mt-1">{proposal.changes.length}</strong>
          </div>
          <div className="rounded-2xl p-3" style={{ border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--ink-muted)' }}>Confidence</span>
            <strong className="block mt-1 capitalize">{proposal.confidence}</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]" aria-label="Planner evidence coverage">
          {Object.entries({
            Places: proposal.coverage.placeVerification,
            Coordinates: proposal.coverage.coordinates,
            Hours: proposal.coverage.openingHours,
            Routes: proposal.coverage.route,
            Reservations: proposal.coverage.reservations,
          }).map(([label, value]) => (
            <div key={label} className="rounded-2xl p-2.5" style={{ border: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
              <strong className="block mt-1">{Math.round(value * 100)}%</strong>
            </div>
          ))}
        </div>

        {proposal.warnings.length > 0 && (
          <div className="rounded-2xl p-3 text-xs" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
            {proposal.warnings.join(' ')}{proposal.unknownLegCount > 0 ? ' Unknown legs are not presented as precise routing.' : ''}
          </div>
        )}

        {proposal.changes.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>This plan already matches the current information.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {proposal.changes.map((change) => (
              <div key={change.id} className="flex items-start gap-3 rounded-2xl p-3" style={{ border: `1px solid ${selection.has(change.id) ? 'var(--accent)' : 'var(--border)'}` }}>
                <ChangeToggle
                  checked={selection.has(change.id)}
                  disabled={change.protected}
                  onClick={() => toggle(change.id)}
                  label={change.label}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{change.label}</span>
                    {change.protected && <Lock className="w-3.5 h-3.5" style={{ color: 'var(--ink-muted)' }} aria-label="Protected" />}
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                    Day {change.dayNumber} · {change.current || 'New'} → {change.proposed || 'Updated'}
                  </p>
                  {change.protected && <p className="text-[11px] mt-1" style={{ color: 'var(--accent)' }}>Locked activity stays unchanged.</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="pill-btn pill-primary" onClick={apply} disabled={selection.size === 0 || isStale}>
            <Check className="w-4 h-4" /> Apply selected
          </button>
          <button type="button" className="pill-btn pill-ghost" onClick={() => {
            if (proposal.action === 'generate') build();
            else if (proposal.action === 'optimise-trip') optimiseWholeTrip();
            else optimiseSelectedDay(proposal.changes[0]?.dayNumber || dayOptions[0]?.day || 1);
          }}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button type="button" className="pill-btn pill-ghost" onClick={() => setProposal(null)}>Cancel</button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl p-4 sm:p-5 space-y-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow m-0">Organise saved places</div>
          <h3 className="font-display text-2xl mt-2">Keep the places you saved coherent.</h3>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--ink-muted)' }}>
            Arrange confirmed places, protect what matters, and keep every change reversible. Destination discovery is not connected yet.
          </p>
        </div>
        <Clock3 className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
      </div>

      {existingDaysNotice && (
        <p className="text-xs rounded-2xl px-3 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
          {existingDaysNotice}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(hasPlaceActivities || hasInboxActivities) && <button type="button" className="pill-btn pill-primary" onClick={hasPlaceActivities ? optimiseWholeTrip : build}><Sparkles className="w-4 h-4" /> {hasPlaceActivities ? 'Organise my saved places' : 'Place saved activities'}</button>}
        {!hasPlaceActivities && !hasInboxActivities && <button type="button" className="pill-btn pill-soft" disabled><Sparkles className="w-4 h-4" /> Discover and build my itinerary</button>}
        {hasPlaceActivities && <button type="button" className="pill-btn pill-soft" disabled title="Discovery provider is not connected yet"><Sparkles className="w-4 h-4" /> Discover and build my itinerary</button>}
        {dayOptions.map((day) => (
          <button key={day.day} type="button" className="pill-btn pill-soft" onClick={() => optimiseSelectedDay(day.day)}>
            <RotateCcw className="w-4 h-4" /> Optimise day {day.day}
          </button>
        ))}
        {lastHistory && <button type="button" className="pill-btn pill-ghost" onClick={undo}><Undo2 className="w-4 h-4" /> Undo last change</button>}
      </div>

      {status && <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{status}</p>}
      {!hasPlaceActivities && !hasInboxActivities && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No places selected yet. Discover attractions and build a destination-specific itinerary, or add places manually.</p>}
      {itinerary.days.length === 0 && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Add travel dates first, then the organiser can shape your saved places.</p>}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Clock3, Lock, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import type { Activity, Itinerary } from '../data';
import type { TripProfile } from '../lib/tripProfile';
import { declaredTripDays, plannerExistingDaysNotice } from '../lib/tripDuration';
import {
  applyItineraryProposal,
  generateInitialItinerary,
  optimiseDay,
  optimiseTrip,
  lowerCostTrip,
  repairConflicts,
  replanDay,
  relaxTrip,
  undoPlannerChange,
  type ItineraryProposal,
} from '../lib/tripIntelligence';
import { profileRevision } from '../lib/identityFields';
import { canDiscover } from '../lib/destinationCapability';
import { capabilityFor } from '../lib/discoveryRuntime';
import { DestinationDiscoveryPanel } from './DestinationDiscoveryPanel';

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

const isPlaceActivity = (activity: Activity) =>
  activity.kind !== 'meal-window'
  && activity.kind !== 'rest-window'
  && activity.kind !== 'free-time'
  && activity.kind !== 'transport'
  && !(activity.source === 'generated' && !activity.providerPlaceId && (activity.type === 'food' || activity.type === 'cafe'));

const timeToMinutes = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const conflictCountFor = (itinerary: Itinerary) => itinerary.days.reduce((total, day) => {
  const activities = day.activities.filter(isPlaceActivity).sort((left, right) => (timeToMinutes(left.time) ?? 0) - (timeToMinutes(right.time) ?? 0));
  let conflicts = 0;
  activities.forEach((activity, index) => {
    const start = timeToMinutes(activity.time);
    const end = start === null ? null : start + Math.max(15, activity.durationMinutes || 90);
    const openingStart = timeToMinutes(activity.openingHours?.opensAt || '');
    const openingEnd = timeToMinutes(activity.openingHours?.closesAt || '');
    if (start !== null && end !== null && ((openingStart !== null && start < openingStart) || (openingEnd !== null && end > openingEnd))) conflicts += 1;
    const previous = activities[index - 1];
    const previousStart = previous ? timeToMinutes(previous.time) : null;
    const previousEnd = previousStart === null ? null : previousStart + Math.max(15, previous.durationMinutes || 90);
    if (previousEnd !== null && start !== null && start < previousEnd) conflicts += 1;
  });
  return total + conflicts;
}, 0);

export function PlannerPreview({ itinerary, profile, onItineraryChange }: PlannerPreviewProps) {
  const [proposal, setProposal] = useState<ItineraryProposal | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [improveOpen, setImproveOpen] = useState(false);
  const [organiseOpen, setOrganiseOpen] = useState(() => itinerary.discoveryState?.stage !== 'itinerary-built');
  const currentRevision = profileRevision(profile);
  const isStale = Boolean(proposal && (
    proposal.baseProfileRevision !== currentRevision
    || proposal.baseItineraryRevision !== (itinerary.revision || 0)
  ));
  const lastHistory = itinerary.plannerHistory?.[itinerary.plannerHistory.length - 1];
  const hasPlaceActivities = itinerary.days.some((day) => day.activities.some(isPlaceActivity));
  const hasInboxActivities = (itinerary.unassignedActivities?.length || 0) > 0;
  const discoveryBuilt = itinerary.discoveryState?.stage === 'itinerary-built';
  // Capability comes from the destination's region and the connected
  // providers, so this stays correct as live backends come online.
  const discoveryDestination = profile.destinations[0];
  const discoveryCityLabel = discoveryDestination?.city || itinerary.cities[0] || '';
  const discoverySupported = discoveryCityLabel
    ? canDiscover(capabilityFor({
        city: discoveryCityLabel,
        region: discoveryDestination?.region,
        countryCode: discoveryDestination?.countryCode || '',
      }))
    : false;
  const dayOptions = useMemo(() => itinerary.days.filter((day) => day.activities.some(isPlaceActivity)), [itinerary.days]);
  const conflictCount = useMemo(() => conflictCountFor(itinerary), [itinerary]);
  const declaredDays = declaredTripDays(profile);
  const existingDaysNotice = plannerExistingDaysNotice(declaredDays, itinerary.days.length);

  useEffect(() => {
    document.body.classList.add('planner-intelligence-active');
    return () => document.body.classList.remove('planner-intelligence-active');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    // Keep the organiser compact on phones: collapsed shell, Improve folded.
    if (discoveryBuilt) setOrganiseOpen(false);
    setImproveOpen(false);
  }, [discoveryBuilt]);

  const openProposal = (next: ItineraryProposal) => {
    setProposal(next);
    setSelection(new Set(next.changes.filter((change) => !change.protected).map((change) => change.id)));
    setStatus(null);
  };

  const build = () => openProposal(generateInitialItinerary(itinerary, profile));
  const optimiseWholeTrip = () => {
    const next = optimiseTrip(itinerary, profile);
    if (next.travelMinutesAfter > next.travelMinutesBefore) {
      setProposal(null);
      setStatus(`No travel-saving improvement found. The offline estimate would increase from ${next.travelMinutesBefore} to ${next.travelMinutesAfter} minutes.`);
      return;
    }
    openProposal(next);
  };
  const optimiseSelectedDay = (dayNumber: number) => openProposal(optimiseDay(itinerary, profile, dayNumber));
  const replanSelectedDay = (disruption: Parameters<typeof replanDay>[3]) => {
    const dayNumber = dayOptions[0]?.day || itinerary.days[0]?.day || 1;
    openProposal(replanDay(itinerary, profile, dayNumber, disruption));
  };
  const relaxWholeTrip = () => openProposal(relaxTrip(itinerary, profile));
  const repairWholeTrip = () => openProposal(repairConflicts(itinerary, profile));
  const lowerCostWholeTrip = () => openProposal(lowerCostTrip(itinerary, profile));

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

  const changesByDay = useMemo(() => {
    if (!proposal) return [] as Array<[number, ItineraryProposal['changes']]>;
    const grouped = new Map<number, ItineraryProposal['changes']>();
    proposal.changes.forEach((change) => {
      const current = grouped.get(change.dayNumber) || [];
      current.push(change);
      grouped.set(change.dayNumber, current);
    });
    return Array.from(grouped.entries()).sort(([left], [right]) => left - right);
  }, [proposal]);

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

        {proposal.travelMinutesAfter > proposal.travelMinutesBefore && (
          <div className="flex items-start gap-2 rounded-2xl p-3 text-xs" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>This proposal increases the offline movement estimate and is not a travel-saving improvement.</span>
          </div>
        )}

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
            {changesByDay.map(([dayNumber, dayChanges]) => (
              <details key={dayNumber} className="planner-change-day" open>
                <summary>Day {dayNumber} <span>{dayChanges.length} {dayChanges.length === 1 ? 'change' : 'changes'}</span></summary>
                <div className="space-y-2 pt-2">
                  {dayChanges.map((change) => (
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
              </details>
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
    <div className="space-y-4">
      <DestinationDiscoveryPanel itinerary={itinerary} profile={profile} onItineraryChange={onItineraryChange} />
      <section className="planner-organise-panel rounded-3xl p-4 sm:p-5 space-y-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="planner-organise-header"
            aria-expanded={organiseOpen}
            onClick={() => setOrganiseOpen((open) => !open)}
          >
            <h3 className="font-display text-2xl text-left">
              {discoveryBuilt ? 'Improve itinerary' : 'Organise places'}
            </h3>
            <ChevronDown
              className={`planner-organise-chevron w-5 h-5 shrink-0 transition-transform ${organiseOpen ? 'rotate-180' : ''}`}
              style={{ color: 'var(--ink-muted)' }}
              aria-hidden="true"
            />
          </button>
          <Clock3 className="w-5 h-5 shrink-0 hidden sm:block" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        </div>

        <div className="planner-organise-body" data-open={organiseOpen ? 'true' : 'false'}>
          {existingDaysNotice && (
            <p className="text-xs rounded-2xl px-3 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
              {existingDaysNotice}
            </p>
          )}

          <div className="planner-action-groups">
            {!discoveryBuilt && (
              <div>
                <span className="planner-action-label">Build</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {hasPlaceActivities && <button type="button" className="pill-btn pill-primary" onClick={optimiseWholeTrip}><Sparkles className="w-4 h-4" /> Organise places</button>}
                  {hasInboxActivities && !hasPlaceActivities && <button type="button" className="pill-btn pill-primary" onClick={build}><Sparkles className="w-4 h-4" /> Place activities</button>}
                  {!hasPlaceActivities && !hasInboxActivities && (
                    <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                      {discoverySupported ? `Add places or use ${discoveryCityLabel} discovery above.` : 'Add places to start.'}
                    </span>
                  )}
                </div>
              </div>
            )}
            {hasPlaceActivities && (
              <div className="planner-improve-block">
                <span className="planner-action-label planner-improve-desktop-label">Improve itinerary</span>
                {!discoveryBuilt && (
                  <button
                    type="button"
                    className="planner-improve-section-toggle"
                    aria-expanded={improveOpen}
                    onClick={() => setImproveOpen((open) => !open)}
                  >
                    <span>Improve itinerary</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${improveOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                )}
                <div
                  className="planner-improve-section"
                  data-open={discoveryBuilt || improveOpen ? 'true' : 'false'}
                >
                  <div className="planner-improve-actions flex flex-wrap gap-2">
                    <button type="button" className="pill-btn pill-soft" onClick={optimiseWholeTrip}>Balance travel</button>
                    <button type="button" className="pill-btn pill-soft" onClick={() => replanSelectedDay({ kind: 'late-start', minutes: 60 })}>Late start · 60 min</button>
                    <button type="button" className="pill-btn pill-soft" onClick={() => replanSelectedDay({ kind: 'rain' })}>Rainy-day plan</button>
                    <button type="button" className="pill-btn pill-soft" onClick={() => replanSelectedDay({ kind: 'route-delay', minutes: 30 })}>Route delay · 30 min</button>
                    <button type="button" className="pill-btn pill-soft" onClick={() => replanSelectedDay({ kind: 'fatigue', walkingMinutes: 90 })}>Less walking</button>
                    <button type="button" className="pill-btn pill-soft" disabled title="Requires live place discovery and replacement candidates">More local · Soon</button>
                    <button type="button" className="pill-btn pill-soft" onClick={relaxWholeTrip}>More relaxed</button>
                    <button type="button" className="pill-btn pill-soft" onClick={lowerCostWholeTrip}>Lower cost</button>
                    <button type="button" className="pill-btn pill-soft" disabled={conflictCount === 0} title={conflictCount > 0 ? 'Preview deterministic conflict repair' : 'No opening-hours or overlap conflicts detected'} onClick={repairWholeTrip}>Fix conflicts{conflictCount > 0 ? ` · ${conflictCount}` : ''}</button>
                    {lastHistory && <button type="button" className="pill-btn pill-ghost" onClick={undo}><Undo2 className="w-4 h-4" /> Undo</button>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {status && <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{status}</p>}
          {!hasPlaceActivities && !hasInboxActivities && !discoverySupported && (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No places yet.</p>
          )}
          {itinerary.days.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Add travel dates first.</p>
          )}
        </div>
      </section>
    </div>
  );
}

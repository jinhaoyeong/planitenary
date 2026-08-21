import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Lock, RefreshCw, Sparkles } from 'lucide-react';
import type { Itinerary } from '../data';
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
import { isPlannerPlaceActivity, type PlannerCapabilityId } from '../lib/plannerCapabilities';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import { profileRevision } from '../lib/identityFields';
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

/**
 * The deterministic half of the planner, with no surface of its own.
 *
 * This component used to carry an "Organise places" panel: a permanent block of
 * chips on the itinerary page offering nine ways to adjust the plan. It was the
 * third thing on screen that looked like a planner, beside Smart Plan and Ask,
 * and a traveller had no way to tell which one to reach for.
 *
 * The chips are gone; every engine behind them is not. Smart Plan now names the
 * capability and asks for it through the shared UI channel, and this component
 * answers by opening exactly the proposal the chip used to open. The important
 * property is unchanged and is the reason the work stayed here rather than
 * moving into Smart Plan: a capability produces a *proposal*, the traveller
 * reads a per-change diff, and nothing is written until they apply it.
 */
export function PlannerPreview({ itinerary, profile, onItineraryChange }: PlannerPreviewProps) {
  const intelligence = useTripIntelligenceUi();
  const [proposal, setProposal] = useState<ItineraryProposal | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const currentRevision = profileRevision(profile);
  const isStale = Boolean(proposal && (
    proposal.baseProfileRevision !== currentRevision
    || proposal.baseItineraryRevision !== (itinerary.revision || 0)
  ));
  const lastHistory = itinerary.plannerHistory?.[itinerary.plannerHistory.length - 1];
  const dayOptions = useMemo(
    () => itinerary.days.filter((day) => day.activities.some(isPlannerPlaceActivity)),
    [itinerary.days],
  );
  const declaredDays = declaredTripDays(profile);
  const existingDaysNotice = plannerExistingDaysNotice(declaredDays, itinerary.days.length);

  useEffect(() => {
    document.body.classList.add('planner-intelligence-active');
    return () => document.body.classList.remove('planner-intelligence-active');
  }, []);

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

  const undo = () => {
    if (!lastHistory) return;
    onItineraryChange(undoPlannerChange(itinerary, lastHistory.id));
    setStatus('The last planner change was undone.');
  };

  /**
   * One capability, one engine.
   *
   * Every arm here calls the function the removed chip called, with the
   * argument it passed. `ask`-routed capabilities never arrive: Smart Plan
   * sends those into the conversation instead, so there is no arm for them and
   * no second implementation to keep in step.
   */
  const runCapability = (id: PlannerCapabilityId) => {
    if (id === 'place-saved') return build();
    if (id === 'rebalance-travel') return optimiseWholeTrip();
    if (id === 'more-relaxed') return openProposal(relaxTrip(itinerary, profile));
    if (id === 'lower-cost') return openProposal(lowerCostTrip(itinerary, profile));
    if (id === 'fix-conflicts') return openProposal(repairConflicts(itinerary, profile));
    if (id === 'less-walking') return replanSelectedDay({ kind: 'fatigue', walkingMinutes: 90 });
    if (id === 'rainy-day') return replanSelectedDay({ kind: 'rain' });
    if (id === 'late-start') return replanSelectedDay({ kind: 'late-start', minutes: 60 });
    if (id === 'route-delay') return replanSelectedDay({ kind: 'route-delay', minutes: 30 });
    if (id === 'undo-last') return undo();
  };

  /**
   * Answer a capability Smart Plan asked for.
   *
   * Keyed on the nonce so the same capability twice in a row is two requests,
   * and cleared before it runs so a re-render can never replay it.
   */
  const requestNonce = intelligence?.plannerRequest?.nonce;
  useEffect(() => {
    const request = intelligence?.plannerRequest;
    if (!request) return;
    intelligence?.clearPlannerRequest();
    runCapability(request.id);
    // The proposal opens below the fold when the drawer closes over it.
    window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    // Only the nonce may re-trigger this. Depending on the itinerary or the
    // handlers would re-run a capability every time its own proposal changed
    // the trip, which is the one thing a request channel must never do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce]);

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
      <section ref={previewRef} className="p-4 sm:p-5 space-y-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-section, var(--card-radius, 1.5rem))' }} aria-live="polite">
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

  /**
   * With no proposal open there is nothing for this component to show but
   * discovery. The outcome of the last capability is worth a line — a repair
   * that found nothing to repair otherwise looks like a button that did not
   * work — but it is one line, not a panel.
   */
  return (
    <div ref={previewRef} className="space-y-4">
      {existingDaysNotice && (
        <p className="text-xs rounded-2xl px-3 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink)' }}>
          {existingDaysNotice}
        </p>
      )}
      {status && (
        <p className="text-xs font-semibold px-1" style={{ color: 'var(--accent)' }} aria-live="polite">{status}</p>
      )}
      <DestinationDiscoveryPanel itinerary={itinerary} profile={profile} onItineraryChange={onItineraryChange} />
    </div>
  );
}

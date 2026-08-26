import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, Loader2, MapPin, Route, ShieldCheck, Sparkles, Undo2, X } from 'lucide-react';
import { planTripProposal, type PlanTripResult } from '../lib/planTripProposal';
import {
  applyItineraryChange,
  stageItineraryChange,
  undoItineraryChange,
  type StagedChange,
} from '../lib/itineraryChangeClient';
import {
  PLAN_TRIP_WRITE_COPY,
  presentBlockedPlan,
  presentPlanTripWriteRefusal,
  type PlanTripWriteNotice,
} from '../lib/planTripWritePresentation';
import { deriveSmartActions, type SmartAction } from '../../supabase/functions/_shared/smartPlannerActions';
import { resolvePlaceCards } from '../lib/placeCards';
import { PlaceCard } from './PlaceCard';
import type { StructuredPlaceCard } from '../../supabase/functions/_shared/placeReference';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import {
  availableCapabilities,
  plannerTripSignals,
  type PlannerCapability,
} from '../lib/plannerCapabilities';
import { tripBudgetHint } from '../lib/tripBudgetHint';
import type { Itinerary } from '../data';
import { BUDGET_OPTIONS, sanitizeTripProfile } from '../lib/tripProfile';
import smartPlanRouteIllustration from '../assets/illustrations/smart-plan-route.webp';

interface PlanTripProposalPanelProps {
  tripId: string;
  tripName?: string;
  /** The trip as it stands, used only as the shape a server result falls back to. */
  itinerary?: Itinerary;
  /**
   * Hand the authoritative post-write itinerary back to the app. Applying is a
   * server-side write, so local state has to adopt the result exactly rather
   * than re-deriving it, or the next autosave would write something else over it.
   */
  onApplied?: (itinerary: Itinerary) => void;
  /** Read-mode Smart Plan actions may switch the active tab. They never write. */
  onNavigate?: (tab: 'itinerary' | 'budget') => void;
}

/**
 * Applying is a real write, so it is a small state machine rather than a button.
 * Nothing advances without the traveller: `idle -> confirm` needs a click, and
 * `confirm -> applied` needs a second one against a diff they can read.
 */
type WritePhase =
  | { phase: 'idle' }
  | { phase: 'staging' }
  | { phase: 'confirm'; staged: StagedChange }
  | { phase: 'applying'; staged: StagedChange }
  | { phase: 'applied'; changeId: string }
  | { phase: 'undoing'; changeId: string }
  | { phase: 'undone' }
  | { phase: 'stale' }
  | { phase: 'expired' }
  | { phase: 'unavailable' }
  | { phase: 'blocked'; reasons: string[] };

const noticeFromWrite = (write: WritePhase): PlanTripWriteNotice | null => {
  if (write.phase === 'stale') return { kind: 'stale', ...PLAN_TRIP_WRITE_COPY.stale, reasons: [] };
  if (write.phase === 'expired') return { kind: 'expired', ...PLAN_TRIP_WRITE_COPY.expired, reasons: [] };
  if (write.phase === 'unavailable') return { kind: 'unavailable', ...PLAN_TRIP_WRITE_COPY.unavailable, reasons: [] };
  if (write.phase === 'blocked') return presentBlockedPlan(write.reasons);
  return null;
};

const adoptWriteNotice = (notice: PlanTripWriteNotice): WritePhase =>
  notice.kind === 'blocked' ? { phase: 'blocked', reasons: notice.reasons } : { phase: notice.kind };

const PLANNING_STEPS = [
  'Arranging your saved places',
  'Checking one route matrix',
  'Fitting hours and trip edges',
  'Validating every day',
] as const;

const modeLabel = (mode: string) => mode === 'public-transport'
  ? 'Transit'
  : mode.charAt(0).toUpperCase() + mode.slice(1);

function PlanningStepMarker({ active, done, index }: { active: boolean; done: boolean; index: number }) {
  if (done) {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (active) {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  }
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
      <span className="text-xs font-semibold">{index + 1}</span>
    </span>
  );
}

/** One readable line per structured change atom. Wording only; the facts are the diff. */
function changeSummary(staged: StagedChange): string[] {
  const diff = staged.diff;
  const lines: string[] = [];
  const list = (entries: Array<{ name: string }>, limit = 3) => {
    const names = entries.slice(0, limit).map((entry) => entry.name);
    return entries.length > limit ? `${names.join(', ')} and ${entries.length - limit} more` : names.join(', ');
  };
  if (diff.added?.length) lines.push(`Adds ${list(diff.added)} to your days.`);
  if (diff.moved?.length) {
    lines.push(...diff.moved.slice(0, 3).map((entry) => `Moves ${entry.name} from day ${entry.fromDay} to day ${entry.toDay}.`));
  }
  if (diff.retimed?.length) {
    lines.push(...diff.retimed.slice(0, 3).map((entry) => `Retimes ${entry.name} from ${entry.fromTime} to ${entry.toTime}.`));
  }
  if (diff.unscheduled?.length) lines.push(`Moves ${list(diff.unscheduled)} to your unassigned list — nothing is deleted.`);
  if (diff.windowsAdded?.length) lines.push(`Adds ${diff.windowsAdded.length} meal, rest or open window.`);
  if (diff.travelChanged?.length) lines.push(`Updates ${diff.travelChanged.length} travel time from the route provider.`);
  if (diff.preservedMustDo?.length) lines.push(`Keeps every Must do: ${list(diff.preservedMustDo)}.`);
  return lines.length > 0 ? lines : ['No activity changes — times and details only.'];
}

export function PlanTripProposalPanel({ tripId, tripName, itinerary, onApplied, onNavigate }: PlanTripProposalPanelProps) {
  const intelligence = useTripIntelligenceUi();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'proposal'>('menu');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PlanTripResult | null>(null);
  const [write, setWrite] = useState<WritePhase>({ phase: 'idle' });
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /** No exit, no second click, and no backdrop dismiss while a write is in flight. */
  const busy = loading || write.phase === 'staging' || write.phase === 'applying' || write.phase === 'undoing';
  const proposal = result?.proposal;
  const surface = intelligence?.envelope.surface ?? 'itinerary';
  const dayNumber = intelligence?.envelope.dayNumber;
  const budgetHint = tripBudgetHint(tripId, (itinerary ?? null) as unknown as Record<string, unknown> | null);
  const smartActions = useMemo(
    () => deriveSmartActions({
      itinerary: (itinerary ?? null) as unknown as Record<string, unknown> | null,
      surface,
      dayNumber,
      hasBudget: budgetHint.hasBudget,
      budgetRemainingKnown: budgetHint.remainingKnown,
      budgetCeilingKnown: budgetHint.ceilingKnown,
    }),
    [itinerary, surface, dayNumber, budgetHint.hasBudget, budgetHint.remainingKnown, budgetHint.ceilingKnown],
  );

  /**
   * Factual cards for the actions that have a stored place behind them.
   *
   * Keyed by decision, because that is all the server is asked for. The local
   * placeRef decides only *whether* to ask — a decision made before references
   * existed has none, and that action simply stays prose, with no request made
   * on its behalf.
   *
   * Costs nothing at the model tier: the operation this calls returns before
   * any AI code is reachable.
   */
  const [placeCards, setPlaceCards] = useState<Map<string, StructuredPlaceCard>>(new Map());
  const cardDecisionKeys = useMemo(
    () => smartActions
      .filter((action) => action.placeRef && action.decisionKey)
      .map((action) => action.decisionKey as string),
    [smartActions],
  );
  // A stable dependency: the same keys in the same order must not refetch.
  const cardKeySignature = cardDecisionKeys.join('|');

  useEffect(() => {
    if (!tripId || cardDecisionKeys.length === 0) {
      setPlaceCards(new Map());
      return;
    }
    let cancelled = false;
    resolvePlaceCards({ tripId, decisionKeys: cardDecisionKeys })
      .then((cards) => { if (!cancelled) setPlaceCards(cards); })
      // An action without its picture is still the action.
      .catch(() => { if (!cancelled) setPlaceCards(new Map()); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, cardKeySignature]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setProgress((current) => Math.min(current + 1, PLANNING_STEPS.length - 1)), 2_300);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, open]);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setProgress(0);
    setResult(null);
    setWrite({ phase: 'idle' });
    setWriteError(null);
    const next = await planTripProposal(tripId);
    setResult(next);
    setLoading(false);
  };

  /**
   * Step one of two. Binds the reviewed plan to the trip's current state on the
   * server and brings back the diff — it authorises a write without performing
   * one, so a traveller who stops here has changed nothing.
   */
  const prepare = async () => {
    if (write.phase !== 'idle' && write.phase !== 'undone') return;
    // Stage the plan on screen, by its identity. Not "this trip's latest plan":
    // another tab may have regenerated one since, and the traveller is agreeing
    // to what they can see.
    if (!proposal) return;
    setWriteError(null);
    setWrite({ phase: 'staging' });
    const staged = await stageItineraryChange(tripId, {
      proposalId: proposal.id,
      materialRevision: proposal.materialRevision,
    });
    if (!staged.ok) {
      const presented = presentPlanTripWriteRefusal('stage', staged.refusal);
      if (presented) {
        setWrite(adoptWriteNotice(presented));
        return;
      }
      setWrite({ phase: 'idle' });
      setWriteError(staged.detail);
      return;
    }
    if (!staged.staged.applicable) {
      setWrite(adoptWriteNotice(presentBlockedPlan(staged.staged.blocking)));
      return;
    }
    setWrite({ phase: 'confirm', staged: staged.staged });
  };

  /** Step two of two, and the only call in this component that writes. */
  const confirmApply = async () => {
    if (write.phase !== 'confirm') return;
    const staged = write.staged;
    setWrite({ phase: 'applying', staged });
    const applied = await applyItineraryChange(staged.proposalId, itinerary ?? ({} as Itinerary));
    if (!applied.ok) {
      const presented = presentPlanTripWriteRefusal('apply', applied.refusal);
      if (presented) {
        setWrite(adoptWriteNotice(presented));
        setWriteError(null);
        return;
      }
      setWrite({ phase: 'idle' });
      setWriteError(applied.detail);
      return;
    }
    onApplied?.(applied.itinerary);
    setWrite({ phase: 'applied', changeId: applied.changeId });
    setView('menu');
  };

  const undo = async () => {
    if (write.phase !== 'applied') return;
    const changeId = write.changeId;
    setWrite({ phase: 'undoing', changeId });
    const undone = await undoItineraryChange(changeId, itinerary ?? ({} as Itinerary));
    if (!undone.ok) {
      setWrite({ phase: 'applied', changeId });
      setWriteError(undone.detail);
      return;
    }
    onApplied?.(undone.itinerary);
    setWrite({ phase: 'undone' });
  };

  const errorCount = useMemo(
    () => proposal?.conflicts.filter((conflict) => conflict.severity === 'error').length ?? 0,
    [proposal],
  );
  const notice = noticeFromWrite(write);
  const recovering = notice !== null;
  const applyLocked = recovering
    || write.phase === 'confirm'
    || write.phase === 'applied'
    || write.phase === 'applying'
    || write.phase === 'staging';

  const recoverFromNotice = () => {
    if (!notice || busy) return;
    if (notice.action === 'review-again') {
      setWrite({ phase: 'idle' });
      setWriteError(null);
      return;
    }
    setView('proposal');
    void generate();
  };

  const openPlanner = () => {
    setOpen(true);
    setView('menu');
  };

  /**
   * Back changes only the drawer's navigation level. The generated proposal is
   * deliberately retained for this mounted session, while an unfinished write
   * confirmation and its presentation errors are discarded.
   */
  const returnToSmartPlan = () => {
    if (busy) return;
    setView('menu');
    if (write.phase !== 'applied') setWrite({ phase: 'idle' });
    setWriteError(null);
  };

  const runSmartAction = (action: SmartAction) => {
    if (action.mode === 'proposal') {
      setView('proposal');
      void generate();
      return;
    }
    setOpen(false);
    if (action.id === 'ask') intelligence?.openAsk();
    if (action.id === 'organise-saved') onNavigate?.('itinerary');
    if (action.id === 'review-budget') onNavigate?.('budget');
  };

  /**
   * One capability, routed to whichever surface can answer it cheapest.
   *
   * A deterministic capability is arithmetic the device can already do, so it
   * goes to the itinerary planner and costs nothing. Only the genuinely
   * open-ended ones reach a model, and even then this pre-types the question
   * rather than asking it — the traveller still presses Send.
   */
  const runCapability = (capability: PlannerCapability) => {
    setOpen(false);
    if (capability.route === 'ask') {
      intelligence?.openAsk(capability.askExample);
      return;
    }
    onNavigate?.('itinerary');
    intelligence?.requestPlannerCapability(capability.id);
  };

  /**
   * What this trip needs, minus the Ask card.
   *
   * `deriveSmartActions` always appends an `ask` action, which used to render
   * as a full-width card duplicating the launcher in the header. The action
   * itself still exists for any other caller; this surface shows it as a link
   * at the foot instead.
   */
  const contextualActions = useMemo(
    () => smartActions.filter((action) => action.id !== 'ask'),
    [smartActions],
  );

  /**
   * The catalogue, filtered to what this trip has the material for.
   *
   * Same registry Ask draws its examples from, so the two surfaces cannot
   * describe different products.
   */
  const capabilities = useMemo(
    () => (itinerary ? availableCapabilities(plannerTripSignals(itinerary)) : []),
    [itinerary],
  );
  const undoCapability = capabilities.find((capability) => capability.route === 'history');
  const helpCapabilities = capabilities.filter((capability) => capability.route !== 'history');

  const tripBrief = useMemo(() => {
    const profile = sanitizeTripProfile(itinerary?.tripProfile);
    const activityCount = itinerary?.days.reduce((total, day) => total + day.activities.length, 0) || 0;
    const budgetLabel = profile
      ? BUDGET_OPTIONS.find((option) => option.id === profile.budgetTier)?.label || profile.budgetTier
      : '';
    const items = [
      {
        label: 'Where to',
        value: itinerary?.cities.length ? itinerary.cities.join(' · ') : 'Add a destination',
        complete: Boolean(itinerary?.cities.length),
      },
      {
        label: 'When',
        value: profile?.startDate && profile?.endDate
          ? `${profile.startDate} – ${profile.endDate}`
          : itinerary?.days.length ? `${itinerary.days.length} days saved` : 'Add dates',
        complete: Boolean((profile?.startDate && profile?.endDate) || itinerary?.days.length),
      },
      {
        label: 'What suits you',
        value: profile?.styles.length
          ? profile.styles.slice(0, 3).join(' · ')
          : profile?.tripTypes.length ? profile.tripTypes.slice(0, 3).join(' · ') : 'Tell me your pace and interests',
        complete: Boolean(profile?.styles.length || profile?.tripTypes.length),
      },
      {
        label: 'Practical choices',
        value: profile ? `${budgetLabel} · ${profile.transport.slice(0, 2).join(' · ') || 'transport open'}` : 'Add budget and transport',
        complete: Boolean(profile),
      },
      {
        label: 'Saved places',
        value: activityCount ? `${activityCount} stops already in the itinerary` : 'Save a few places or let Smart Plan suggest them',
        complete: activityCount > 0,
      },
    ];
    return { items, completeCount: items.filter((item) => item.complete).length };
  }, [itinerary]);

  const showingProposal = view === 'proposal';
  const title = showingProposal ? 'Plan my trip' : 'Smart plan';

  return (
    <>
      <motion.button
        type="button"
        onClick={openPlanner}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold"
        style={{ color: 'var(--accent-ink, #fff)', backgroundColor: 'var(--accent)' }}
        whileTap={{ scale: 0.96 }}
        whileHover={{ y: -1 }}
        aria-label="Smart plan"
        aria-expanded={open}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden 2xl:inline">Plan my trip</span>
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[190] flex justify-end bg-slate-950/50"
              data-lenis-prevent
              data-lenis-prevent-wheel
              data-lenis-prevent-touch
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) setOpen(false);
              }}
            >
              <motion.section
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-trip-title"
                className="plan-trip-journey-panel flex h-full w-full min-w-0 max-w-3xl flex-col overflow-hidden bg-white text-slate-950 shadow-[-18px_0_48px_rgba(15,23,42,0.24)] dark:bg-slate-950 dark:text-white"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              >
                <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-7 sm:py-5">
                  <div className="min-w-0 flex-1">
                    {showingProposal && (
                      <button
                        type="button"
                        onClick={returnToSmartPlan}
                        disabled={busy}
                        className="mb-2 inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-rose-600 transition hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-40 dark:text-rose-400"
                      >
                        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">Back to Smart plan</span>
                      </button>
                    )}
                    <h2 id="plan-trip-title" className="font-display text-3xl tracking-[-0.025em] sm:text-4xl">{title}</h2>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {showingProposal
                        ? `A complete, route-aware proposal for ${tripName || 'this trip'}. Nothing changes until you apply it.`
                        : `Based on ${tripName || 'your trip'}. Actions are derived from the saved itinerary — nothing changes until you confirm a proposal.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                    aria-label={showingProposal ? 'Close Plan my trip' : 'Close Smart plan'}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div
                  className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-6 sm:px-7"
                  data-lenis-prevent
                  data-lenis-prevent-wheel
                  data-lenis-prevent-touch
                  onWheel={(event) => event.stopPropagation()}
                  onTouchMove={(event) => event.stopPropagation()}
                  style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
                >
                  {!showingProposal && !loading && (
                    <div className="plan-trip-start-grid">
                      <div className="plan-trip-action-column">
                      {write.phase === 'applied' && (
                        <section
                          role="status"
                          aria-labelledby="apply-success-title"
                          className="mb-6 rounded-2xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
                        >
                          <h3 id="apply-success-title" className="flex items-center gap-2 text-sm font-semibold">
                            <Check className="h-4 w-4" /> Applied to your itinerary
                          </h3>
                          <p className="mt-1 text-xs leading-5">
                            Smart Plan has refreshed its suggestions for your updated trip.
                          </p>
                          <button
                            type="button"
                            className="mt-3 rounded-full border border-emerald-700 px-4 py-2 text-xs font-semibold disabled:opacity-60 dark:border-emerald-300"
                            onClick={() => void undo()}
                            disabled={busy}
                          >
                            Undo this change
                          </button>
                        </section>
                      )}
                      {write.phase === 'undoing' && (
                        <p role="status" className="mb-6 flex items-center gap-2 rounded-2xl bg-slate-100 p-4 text-sm font-semibold dark:bg-slate-900">
                          <Loader2 className="h-4 w-4 animate-spin" /> Undoing…
                        </p>
                      )}
                      {write.phase === 'undone' && (
                        <p role="status" className="mb-6 rounded-2xl bg-slate-100 p-4 text-sm font-semibold dark:bg-slate-900">
                          Change undone. Your itinerary is back to what it was.
                        </p>
                      )}
                      {writeError && (
                        <section role="alert" className="mb-6 rounded-2xl bg-rose-50 p-4 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <AlertTriangle className="h-4 w-4" /> Nothing was changed
                          </div>
                          <p className="plan-trip-wrap mt-2 text-xs leading-5">{writeError}</p>
                        </section>
                      )}
                      {/*
                        Two sections, and the order is the point. What this trip
                        needs comes first and stays short; the full catalogue sits
                        below it as chips. Giving every capability a card was what
                        made this drawer scroll.
                      */}
                      {contextualActions.length > 0 && (
                        <>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                            Based on your trip
                          </p>
                          <div className="mt-3 grid gap-2">
                            {contextualActions.map((action) => {
                              const card = action.decisionKey ? placeCards.get(action.decisionKey) : undefined;
                              return (
                                <div key={action.id} className="grid gap-2">
                                  <button
                                    type="button"
                                    aria-label={action.title}
                                    onClick={() => runSmartAction(action)}
                                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:border-rose-200 hover:bg-rose-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-rose-900 dark:hover:bg-rose-950/20"
                                  >
                                    <Sparkles className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400" aria-hidden="true" />
                                    <span className="min-w-0">
                                      <span className="block text-sm font-semibold text-slate-950 dark:text-white">{action.title}</span>
                                      <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{action.reason}</span>
                                    </span>
                                  </button>
                                  {/*
                                    Outside the button, not inside it: the credit is
                                    a link, and a link nested in a button is neither
                                    valid HTML nor reachable by keyboard.
                                  */}
                                  {card && <PlaceCard card={card} as="div" />}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {helpCapabilities.length > 0 && (
                        <div className={contextualActions.length > 0 ? 'mt-7' : ''}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                            Things I can help with
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {helpCapabilities.map((capability) => (
                              <button
                                key={capability.id}
                                type="button"
                                onClick={() => runCapability(capability)}
                                title={capability.description}
                                className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-rose-200 hover:bg-rose-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-rose-900 dark:hover:bg-rose-950/20"
                              >
                                <span aria-hidden="true" className="text-rose-500 dark:text-rose-400">✦</span>
                                <span className="min-w-0 truncate font-medium">{capability.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                        {/*
                          Ask keeps its own launcher in the header, so a full card
                          here was a second door to the same room. A link is enough.
                        */}
                        <button
                          type="button"
                          onClick={() => { setOpen(false); intelligence?.openAsk(); }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 transition hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400"
                        >
                          Ask something else <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        {/*
                          Undo appears only when something is reversible. A
                          permanently greyed button teaches nothing except that
                          the app has a button it will not let you press.
                        */}
                        {undoCapability && (
                          <button
                            type="button"
                            onClick={() => runCapability(undoCapability)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:text-white"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> {undoCapability.label}
                          </button>
                        )}
                      </div>
                      </div>

                      <aside className="plan-trip-brief" aria-label="Trip brief">
                        <div className="plan-trip-brief-head">
                          <span>{tripBrief.completeCount}/5</span>
                          <div>
                            <small>Trip brief</small>
                            <h3>Your plan is taking shape</h3>
                            <p>{tripBrief.completeCount} of 5 captured</p>
                          </div>
                        </div>
                        <ol>
                          {tripBrief.items.map((item) => (
                            <li key={item.label} data-complete={item.complete ? 'true' : 'false'}>
                              <i>{item.complete ? <Check /> : null}</i>
                              <span><strong>{item.label}</strong><small>{item.value}</small></span>
                            </li>
                          ))}
                        </ol>
                        <div className="plan-trip-brief-actions">
                          <button type="button" onClick={() => { setOpen(false); intelligence?.openAsk('Help me fill the missing parts of my trip brief.'); }}>
                            Ask about the gaps
                          </button>
                          <button type="button" onClick={() => void generate()} disabled={busy}>
                            <Sparkles /> Build a proposed draft
                          </button>
                          <p>Nothing changes until you review and apply the proposal.</p>
                        </div>
                      </aside>
                    </div>
                  )}

                  {showingProposal && loading && (
                    <div className="mx-auto flex min-h-[65vh] max-w-md flex-col justify-center">
                      <div className="relative h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <motion.span
                          className="absolute inset-y-0 left-0 rounded-full bg-rose-500"
                          animate={{ width: `${((progress + 1) / PLANNING_STEPS.length) * 100}%` }}
                        />
                      </div>
                      <div className="mt-8 grid gap-4">
                        {PLANNING_STEPS.map((step, index) => {
                          const active = index === progress;
                          const done = index < progress;
                          return (
                            <div key={step} className="flex items-center gap-3">
                              <PlanningStepMarker active={active} done={done} index={index} />
                              <span className={`text-sm ${active ? 'font-semibold text-slate-950 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{step}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-8 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        Day themes are drafted first. Planitenary then calculates clocks, routes, buffers, opening windows, and conflicts from your trip data.
                      </p>
                      <img
                        src={smartPlanRouteIllustration}
                        alt=""
                        width={600}
                        height={450}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="reduced-smart-plan-illustration"
                        data-illustration="smart-plan-route"
                        aria-hidden="true"
                      />
                    </div>
                  )}

                  {showingProposal && !loading && result && !proposal && (
                    <div className="mx-auto max-w-lg py-16 text-center">
                      <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
                      <h3 className="mt-4 text-lg font-semibold">No proposal was generated</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {result.detail || 'The planner stopped safely before producing an incomplete itinerary.'}
                      </p>
                      <button type="button" className="mt-6 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950" onClick={() => void generate()}>
                        Try again
                      </button>
                    </div>
                  )}

                  {showingProposal && !loading && proposal && (
                    <div className="space-y-8">
                      {notice && (
                        <section role="alert" className="plan-trip-notice rounded-2xl bg-rose-50 p-4 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
                          <div className="flex items-start gap-2 text-sm font-semibold">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <h3 className="plan-trip-wrap min-w-0 text-base leading-6">{notice.title}</h3>
                          </div>
                          <p className="plan-trip-wrap mt-2 text-sm leading-6">{notice.body}</p>
                          {notice.reasons.length > 0 && (
                            <ul className="mt-3 space-y-1.5 text-sm leading-6">
                              {notice.reasons.map((reason) => (
                                <li key={reason} className="plan-trip-wrap">{reason}</li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="mt-4 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold whitespace-normal text-white disabled:opacity-60"
                            onClick={recoverFromNotice}
                            disabled={busy}
                          >
                            {notice.actionLabel}
                          </button>
                        </section>
                      )}

                      {writeError && !notice && (
                        <section role="alert" className="rounded-2xl bg-rose-50 p-4 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <AlertTriangle className="h-4 w-4" /> Nothing was changed
                          </div>
                          <p className="plan-trip-wrap mt-2 text-xs leading-5">{writeError}</p>
                        </section>
                      )}

                      {write.phase === 'confirm' && (
                        <section
                          aria-labelledby="apply-confirm-title"
                          className="rounded-2xl border-2 border-rose-500 p-4 dark:border-rose-400"
                        >
                          <h3 id="apply-confirm-title" className="text-base font-semibold">
                            Apply this plan to your itinerary?
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                            This replaces the days below in your saved itinerary. You can undo it straight afterwards.
                          </p>
                          <ul className="mt-3 space-y-1.5 text-xs leading-5 text-slate-700 dark:text-slate-200">
                            {changeSummary(write.staged).map((line) => (
                              <li key={line} className="plan-trip-wrap">· {line}</li>
                            ))}
                          </ul>
                          {write.staged.warnings.length > 0 && (
                            <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
                              {write.staged.warnings.slice(0, 4).map((warning) => (
                                <li key={warning} className="plan-trip-wrap">{warning}</li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                              onClick={() => void confirmApply()}
                              disabled={busy}
                            >
                              Apply to my itinerary
                            </button>
                            <button
                              type="button"
                              className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-900"
                              onClick={() => setWrite({ phase: 'idle' })}
                              disabled={busy}
                            >
                              Not yet
                            </button>
                          </div>
                        </section>
                      )}

                      {write.phase === 'applying' && (
                        <p role="status" className="flex items-center gap-2 text-sm font-semibold">
                          <Loader2 className="h-4 w-4 animate-spin" /> Applying to your itinerary…
                        </p>
                      )}

                      {write.phase === 'applied' && (
                        <section
                          aria-labelledby="apply-success-title"
                          className="rounded-2xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
                        >
                          <h3 id="apply-success-title" className="flex items-center gap-2 text-sm font-semibold">
                            <Check className="h-4 w-4" /> Applied to your itinerary
                          </h3>
                          <p className="mt-1 text-xs leading-5">
                            Your saved days now match this plan. Undo restores exactly what you had before.
                          </p>
                          <button
                            type="button"
                            className="mt-3 rounded-full border border-emerald-700 px-4 py-2 text-xs font-semibold disabled:opacity-60 dark:border-emerald-300"
                            onClick={() => void undo()}
                            disabled={busy}
                          >
                            Undo this change
                          </button>
                        </section>
                      )}

                      {write.phase === 'undoing' && (
                        <p role="status" className="flex items-center gap-2 text-sm font-semibold">
                          <Loader2 className="h-4 w-4 animate-spin" /> Undoing…
                        </p>
                      )}

                      {write.phase === 'undone' && (
                        <p role="status" className="rounded-2xl bg-slate-100 p-4 text-sm font-semibold dark:bg-slate-900">
                          Change undone. Your itinerary is back to what it was.
                        </p>
                      )}
                      <section className="grid gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${proposal.status === 'valid' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
                              {proposal.status === 'valid' ? 'Validated proposal' : `${errorCount} conflicts need review`}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 dark:bg-slate-900 dark:text-slate-300">{proposal.pace} pace</span>
                          </div>
                          <h3 className="mt-3 font-display text-3xl tracking-[-0.025em]">Proposed itinerary</h3>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {proposal.routeSummary.confirmedLegs} routed legs · {proposal.routeSummary.matrixCalls} batched matrix {proposal.routeSummary.matrixCalls === 1 ? 'call' : 'calls'} · {proposal.repairIterations} repairs
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <ShieldCheck className="h-4 w-4 text-emerald-600" />
                          {write.phase === 'applied' ? 'Applied · undo available' : 'Proposal only · not saved'}
                        </div>
                      </section>

                      {proposal.conflicts.length > 0 && (
                        <section aria-label="Proposal conflicts" className="rounded-2xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <AlertTriangle className="h-4 w-4" /> Check before relying on this plan
                          </div>
                          <ul className="mt-3 space-y-2 text-xs leading-5">
                            {proposal.conflicts.slice(0, 8).map((conflict, index) => (
                              <li key={`${conflict.code}-${index}`} className="plan-trip-wrap">{conflict.message}</li>
                            ))}
                          </ul>
                        </section>
                      )}

                      <div className="space-y-10">
                        {proposal.days.map((day) => (
                          <section key={day.day} aria-labelledby={`proposal-day-${day.day}`}>
                            <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-3 dark:border-slate-800">
                              <div>
                                <h4 id={`proposal-day-${day.day}`} className="font-display text-2xl">Day {day.day} · {day.city}</h4>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{day.date || 'Date not set'} · usable {day.startTime}–{day.endTime}</p>
                                {day.warnings.map((warning) => (
                                  <p key={warning} className="mt-1 text-xs text-slate-500 dark:text-slate-400">{warning}</p>
                                ))}
                              </div>
                              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{day.metrics.freeMinutes} min open</span>
                            </div>

                            <ol className="mt-4 space-y-1">
                              {day.items.length === 0 && (
                                <li className="py-5 text-sm text-slate-500 dark:text-slate-400">Kept open because no activity fits the day’s verified constraints.</li>
                              )}
                              {day.items.map((item, index) => (
                                <li key={item.id} className="grid grid-cols-[3.75rem_1fr] gap-3 py-3 sm:grid-cols-[4.5rem_3.5rem_1fr]">
                                  <time className="pt-1 text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">{item.startTime}</time>
                                  <div className="hidden sm:block">
                                    {item.imageUrl ? (
                                      <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" loading="lazy" />
                                    ) : (
                                      <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-400 dark:bg-slate-900">{String(index + 1).padStart(2, '0')}</span>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    {item.travelFromPrevious && (
                                      <p className={`mb-2 flex items-center gap-1.5 text-xs ${item.travelFromPrevious.status === 'confirmed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                        <Route className="h-3.5 w-3.5" />
                                        {item.travelFromPrevious.status === 'confirmed'
                                          ? `${item.travelFromPrevious.durationMinutes} min ${modeLabel(item.travelFromPrevious.mode)} from ${item.travelFromPrevious.fromName}`
                                          : `Route unavailable from ${item.travelFromPrevious.fromName} · no estimate used`}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h5 className="plan-trip-wrap font-semibold text-slate-950 dark:text-white">{item.name}</h5>
                                      {item.priority === 'must-do' && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-200">Must do</span>}
                                      {item.locked && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">Locked</span>}
                                    </div>
                                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {item.visitDurationMinutes} min · ends {item.endTime}</span>
                                      {item.placeId && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {item.bufferMinutes} min buffer</span>}
                                    </p>
                                    {item.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-700 dark:text-amber-300">{warning}</p>)}
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {showingProposal && (
                <footer className="border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-7">
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-slate-900" onClick={() => setOpen(false)} disabled={busy}>
                      Keep editing manually
                    </button>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                      {!recovering && (
                        <button type="button" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900" onClick={() => void generate()} disabled={busy}>
                          Regenerate proposal
                        </button>
                      )}
                      {recovering && notice ? (
                        <button
                          type="button"
                          onClick={recoverFromNotice}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-2 whitespace-normal rounded-full bg-rose-600 px-4 py-2.5 text-center text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {notice.actionLabel}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void prepare()}
                          disabled={busy || !proposal || proposal.status !== 'valid' || applyLocked}
                          title={proposal?.status === 'valid' ? 'Review the changes before saving them' : 'Resolve the conflicts above first'}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
                        >
                          {write.phase === 'staging' ? 'Preparing…' : 'Apply plan…'}
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </footer>
                )}
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

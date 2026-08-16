import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Route,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { planTripProposal, type PlanTripResult } from '../lib/planTripProposal';

interface PlanTripProposalPanelProps {
  tripId: string;
  tripName?: string;
}

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

export function PlanTripProposalPanel({ tripId, tripName }: PlanTripProposalPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PlanTripResult | null>(null);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setProgress((current) => Math.min(current + 1, PLANNING_STEPS.length - 1)), 2_300);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, open]);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setProgress(0);
    setResult(null);
    const next = await planTripProposal(tripId);
    setResult(next);
    setLoading(false);
  };

  const proposal = result?.proposal;
  const errorCount = useMemo(
    () => proposal?.conflicts.filter((conflict) => conflict.severity === 'error').length ?? 0,
    [proposal],
  );

  const openPlanner = () => {
    setOpen(true);
    if (!result && !loading) void generate();
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={openPlanner}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold"
        style={{ color: 'var(--accent-ink, #fff)', backgroundColor: 'var(--accent)' }}
        whileTap={{ scale: 0.96 }}
        whileHover={{ y: -1 }}
        aria-label="Plan my trip"
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !loading) setOpen(false);
              }}
            >
              <motion.section
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-trip-title"
                className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white text-slate-950 shadow-[-18px_0_48px_rgba(15,23,42,0.24)] dark:bg-slate-950 dark:text-white"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              >
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-800 sm:px-7">
                  <div className="min-w-0">
                    <h2 id="plan-trip-title" className="font-display text-3xl tracking-[-0.025em] sm:text-4xl">Plan my trip</h2>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      A complete, route-aware proposal for {tripName || 'this trip'}. Nothing here changes your saved itinerary.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={loading}
                    className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                    aria-label="Close Plan my trip"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7" data-lenis-prevent>
                  {loading && (
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
                    </div>
                  )}

                  {!loading && result && !proposal && (
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

                  {!loading && proposal && (
                    <div className="space-y-8">
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
                          <ShieldCheck className="h-4 w-4 text-emerald-600" /> Proposal only · not saved
                        </div>
                      </section>

                      {proposal.conflicts.length > 0 && (
                        <section aria-label="Proposal conflicts" className="rounded-2xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <AlertTriangle className="h-4 w-4" /> Check before relying on this plan
                          </div>
                          <ul className="mt-3 space-y-2 text-xs leading-5">
                            {proposal.conflicts.slice(0, 8).map((conflict, index) => (
                              <li key={`${conflict.code}-${index}`}>{conflict.message}</li>
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
                                      <h5 className="font-semibold text-slate-950 dark:text-white">{item.name}</h5>
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

                <footer className="border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-7">
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-slate-900" onClick={() => setOpen(false)}>
                      Keep editing manually
                    </button>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="button" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900" onClick={() => void generate()} disabled={loading}>
                        Regenerate proposal
                      </button>
                      <button type="button" disabled className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Saving arrives in Phase 2B">
                        Apply in Phase 2B <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </footer>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

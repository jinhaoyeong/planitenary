import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, History, Loader2, X } from 'lucide-react';
import {
  listItineraryChangeHistory,
  type ItineraryHistoryItem,
} from '../lib/itineraryChangeClient';
import {
  formatHistoryAppliedAt,
  formatHistoryClock,
  historyDetailSections,
} from '../../supabase/functions/_shared/itineraryChangeHistory';

interface ItineraryChangeHistoryPanelProps {
  tripId: string;
  tripName?: string;
}

const LOAD_ERROR = 'Plan changes could not be loaded. Try again.';

export function ItineraryChangeHistoryPanel({ tripId, tripName }: ItineraryChangeHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ItineraryHistoryItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const selected = changes?.find((entry) => entry.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectedId) {
        setSelectedId(null);
        return;
      }
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, selectedId]);

  const load = () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    void listItineraryChangeHistory(tripId).then((result) => {
      if (request !== requestRef.current) return;
      if (!result.ok) {
        setChanges(null);
        setError(LOAD_ERROR);
        setLoading(false);
        return;
      }
      setChanges(result.changes);
      setLoading(false);
    });
  };

  const openPanel = () => {
    setSelectedId(null);
    setOpen(true);
    load();
  };

  const close = () => {
    requestRef.current += 1;
    setOpen(false);
    setSelectedId(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="plan-changes-trigger w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-3xl text-sm font-medium"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <History className="w-4 h-4" aria-hidden="true" />
        Plan changes
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[190] flex justify-end bg-slate-950/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <motion.section
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-changes-title"
                className="plan-changes-panel flex h-full w-full max-w-lg flex-col overflow-hidden bg-white text-slate-950 shadow-[-18px_0_48px_rgba(15,23,42,0.24)] dark:bg-slate-950 dark:text-white"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
              >
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 dark:border-slate-800 sm:px-6">
                  <div className="min-w-0">
                    {selected ? (
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-400 dark:hover:text-white"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Back
                      </button>
                    ) : null}
                    <h2 id="plan-changes-title" className="font-display text-3xl tracking-[-0.025em]">
                      {selected ? 'Changes' : 'Plan changes'}
                    </h2>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {selected
                        ? selected.summary
                        : `AI plans you applied to ${tripName || 'this trip'}.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                    aria-label="Close plan changes"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6" data-lenis-prevent>
                  {loading && (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading plan changes">
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Loading plan changes
                      </div>
                      {[0, 1, 2].map((row) => (
                        <div
                          key={row}
                          className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900"
                        />
                      ))}
                    </div>
                  )}

                  {!loading && error && (
                    <div className="mx-auto max-w-sm py-12 text-center" role="alert">
                      <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
                      <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{error}</p>
                      <button
                        type="button"
                        className="mt-6 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
                        onClick={load}
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  {!loading && !error && changes && changes.length === 0 && (
                    <div className="mx-auto max-w-sm py-12 text-center">
                      <History className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
                      <h3 className="mt-4 text-lg font-semibold">No itinerary changes yet.</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Changes you apply from Plan my trip will appear here.
                      </p>
                    </div>
                  )}

                  {!loading && !error && selected && (
                    <HistoryDetail change={selected} />
                  )}

                  {!loading && !error && !selected && changes && changes.length > 0 && (
                    <ul className="space-y-2">
                      {changes.map((change) => (
                        <li key={change.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(change.id)}
                            className="plan-changes-item w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:border-rose-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-slate-800 dark:hover:border-rose-900 dark:hover:bg-slate-900"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="min-w-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                {formatHistoryAppliedAt(change.appliedAt)}
                              </p>
                              <span className={`plan-changes-status shrink-0 ${change.status === 'undone' ? 'is-undone' : 'is-applied'}`}>
                                {change.status === 'undone' ? 'Undone' : 'Applied'}
                              </span>
                            </div>
                            <p className="mt-2 font-semibold tracking-tight">{change.title}</p>
                            <p className="plan-changes-name mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                              {change.summary}
                            </p>
                            {change.status === 'undone' && change.undoneAt && (
                              <p className="mt-2 text-[11px] text-slate-400">
                                Undone at {formatHistoryClock(change.undoneAt)}
                              </p>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function HistoryDetail({ change }: { change: ItineraryHistoryItem }) {
  const sections = historyDetailSections(change.diff);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {formatHistoryAppliedAt(change.appliedAt)}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{change.title}</h3>
        </div>
        <span className={`plan-changes-status shrink-0 ${change.status === 'undone' ? 'is-undone' : 'is-applied'}`}>
          {change.status === 'undone' ? 'Undone' : 'Applied'}
        </span>
      </div>
      {change.status === 'undone' && change.undoneAt && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Undone at {formatHistoryClock(change.undoneAt)}
        </p>
      )}
      {sections.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Times and details only.</p>
      ) : (
        sections.map((section) => (
          <section key={section.title}>
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {section.title}
            </h4>
            <ul className="mt-2 space-y-3">
              {section.items.map((item, index) => (
                <li key={`${section.title}-${index}`} className="min-w-0">
                  <p className="plan-changes-name font-semibold leading-5">{item.name}</p>
                  {item.detail ? (
                    <p className="plan-changes-name mt-0.5 text-sm leading-5 text-slate-500 dark:text-slate-400">
                      {item.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

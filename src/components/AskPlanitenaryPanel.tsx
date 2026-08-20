import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Loader2,
  MessageCircleQuestion,
  Route,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { ASK_SUGGESTIONS, askPlanitenary, type AskResult } from '../lib/askPlanitenary';
import { askSuggestionsFor } from '../../supabase/functions/_shared/smartPlannerActions';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import type { ConversationTurn } from '../../supabase/functions/_shared/intelligenceContext';
import { PlaceCard } from './PlaceCard';

interface AskPlanitenaryPanelProps {
  tripId: string;
  tripName?: string;
}

const PROGRESS = [
  'Reading your trip',
  'Choosing the right travel tools',
  'Checking live facts and timing',
  'Grounding the recommendation',
] as const;

const TOOL_LABELS: Record<string, string> = {
  get_trip: 'Trip overview',
  get_trip_profile: 'Travel preferences',
  get_current_itinerary: 'Current itinerary',
  get_saved_places: 'Saved places',
  get_candidate_decisions: 'Discovery decisions',
  search_places: 'Place search',
  search_web: 'Current web research',
  get_place_details: 'Place details',
  get_opening_hours: 'Opening hours',
  get_events: 'Current events',
  get_weather: 'Weather forecast',
  get_place_images: 'Wikimedia photographs',
  get_route: 'Route check',
  get_route_matrix: 'Route matrix',
  validate_schedule: 'Schedule check',
  calculate_day_timing: 'Day timing',
  find_schedule_conflicts: 'Conflict check',
  get_current_day: 'This day',
  get_unassigned_places: 'Unassigned places',
  get_fixed_events: 'Fixed events',
  get_flights: 'Flights',
  get_current_proposal: 'Current proposal',
  get_change_history: 'Change history',
  get_budget_summary: 'Budget',
  get_expenses: 'Expenses',
  get_trip_documents: 'Documents',
  get_document_facts: 'Document facts',
  get_current_ui_context: 'Current view',
  check_schedule_fit: 'Fit check',
};

const sourceLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
};

export function AskPlanitenaryPanel({ tripId, tripName }: AskPlanitenaryPanelProps) {
  const intelligence = useTripIntelligenceUi();
  const [open, setOpen] = useState(false);
  const [seenAskNonce, setSeenAskNonce] = useState(0);
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [thread, setThread] = useState<ConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askNonce = intelligence?.askNonce ?? 0;
  if (askNonce > seenAskNonce) {
    setSeenAskNonce(askNonce);
    setOpen(true);
  }
  const suggestions = intelligence?.envelope.surface
    ? askSuggestionsFor(intelligence.envelope.surface)
    : ASK_SUGGESTIONS;

  useEffect(() => {
    if (!open) return;
    const frame = window.setTimeout(() => inputRef.current?.focus(), 120);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setProgressIndex((current) => Math.min(current + 1, PROGRESS.length - 1));
    }, 2_400);
    return () => window.clearInterval(timer);
  }, [loading]);

  const canSubmit = Boolean(question.trim()) && !loading;
  const completedSteps = useMemo(
    () => result?.steps.filter((step) => step.ok).slice(0, 6) ?? [],
    [result],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setProgressIndex(0);
    setResult(null);
    setSubmittedQuestion(trimmed);
    const next = await askPlanitenary({
      tripId,
      question: trimmed,
      uiContext: intelligence?.envelope,
      conversation: thread.slice(-4),
    });
    setResult(next);
    if (next.answer) {
      setThread((current) => [...current, { question: trimmed, answer: next.answer! }].slice(-4));
    }
    setLoading(false);
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-2 text-xs font-semibold sm:px-3"
        style={{ color: 'var(--ink)', border: '1px solid var(--border)', background: 'var(--surface)' }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.96 }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
        <span className="hidden 2xl:inline">Ask Planitenary</span>
        <span className="sr-only 2xl:hidden">Ask Planitenary</span>
      </motion.button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-[85] bg-slate-950/45"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              aria-label="Close Ask Planitenary"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="ask-planitenary-title"
              initial={{ opacity: 0, x: 28, y: 12 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 24, y: 8 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-18px_55px_rgba(15,23,42,0.24)] dark:bg-slate-950 md:inset-y-0 md:left-auto md:w-[430px] md:max-h-none md:rounded-none md:shadow-[-18px_0_55px_rgba(15,23,42,0.22)]"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6 sm:py-5">
                  <div>
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <h2 id="ask-planitenary-title" className="font-display text-xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
                        Ask Planitenary
                      </h2>
                    </div>
                    <p className="mt-1 max-w-[34ch] text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {tripName || 'This trip'}
                    </p>
                    <p className="mt-1 max-w-[34ch] text-xs leading-5 text-slate-500 dark:text-slate-400">
                      A read-only travel assistant. It can research and propose, but cannot change your plan.
                    </p>
                    {(intelligence?.envelope.surface || intelligence?.envelope.dayNumber || intelligence?.envelope.selectedActivityId) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {intelligence.envelope.surface && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {intelligence.envelope.surface}
                          </span>
                        )}
                        {intelligence.envelope.dayNumber && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            Day {intelligence.envelope.dayNumber}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-slate-800 dark:hover:text-white"
                  aria-label="Close Ask Planitenary"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                {!loading && !result && (
                  <div>
                    <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                      Ask about tonight, rain plans, nearby places, real routes, or whether a day feels overloaded.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            setQuestion(suggestion);
                            inputRef.current?.focus();
                          }}
                          className="rounded-xl bg-slate-100 px-3 py-2 text-left text-xs font-medium leading-4 text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                    <div className="mt-6 flex items-start gap-3 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      Routes, weather, places, events, and images come from connected tools. The assistant does not estimate them.
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="flex min-h-56 flex-col items-center justify-center text-center" aria-live="polite">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">{PROGRESS[progressIndex]}</p>
                    <p className="mt-1 max-w-[34ch] text-xs leading-5 text-slate-500 dark:text-slate-400">
                      Tool use and model rounds are capped. If a source cannot answer, Planitenary will say so.
                    </p>
                  </div>
                )}

                {!loading && result && (
                  <div aria-live="polite">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Your question</p>
                    <p className="mt-1 text-sm font-medium leading-6 text-slate-700 dark:text-slate-200">{submittedQuestion}</p>

                    {result.answer ? (
                      <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
                        <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-slate-100">{result.answer}</p>
                      </div>
                    ) : (
                      <div className="mt-5 flex gap-3 rounded-xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <p className="text-sm leading-6">{result.detail || 'Planitenary could not answer this question safely.'}</p>
                      </div>
                    )}

                    {/*
                      Read defensively: a result parsed by an older build
                      carries no places field at all, and an answer is worth
                      showing with or without its cards.
                    */}
                    {(result.places ?? []).length > 0 && (
                      <section className="mt-5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                          Places in this answer
                        </h3>
                        <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {(result.places ?? []).map((card) => (
                            <PlaceCard key={card.ref.canonicalPlaceId} card={card} />
                          ))}
                        </ul>
                      </section>
                    )}

                    {result.proposal && (
                      <section className="mt-5 rounded-xl bg-slate-950 p-4 text-white dark:bg-slate-900">
                        <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                          <Route className="h-4 w-4" aria-hidden="true" />
                          Proposal only · nothing changed
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-100">{result.proposal.summary}</p>
                        {(result.proposal.day || result.proposal.travelMinutes) && (
                          <p className="mt-2 text-xs text-slate-400">
                            {result.proposal.day ? `Day ${result.proposal.day}` : ''}
                            {result.proposal.day && result.proposal.travelMinutes ? ' · ' : ''}
                            {result.proposal.travelMinutes ? `${result.proposal.travelMinutes} min from routing` : ''}
                          </p>
                        )}
                        {result.proposal.replan && (
                          <div className="mt-3 border-t border-slate-700 pt-3">
                            <p className="text-xs font-semibold text-rose-200">Replan preview · Days {result.proposal.replan.affectedDays.join(', ')}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-300">{result.proposal.replan.objective}</p>
                            {result.proposal.replan.moves.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                                {result.proposal.replan.moves.map((move, index) => (
                                  <li key={`${move.placeName}-${index}`}>
                                    {move.placeName}: {move.fromDay ? `Day ${move.fromDay}` : 'Unscheduled'} → Day {move.toDay}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </section>
                    )}

                    {result.citations.length > 0 && (
                      <section className="mt-6">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                          <Search className="h-4 w-4" aria-hidden="true" /> Sources
                        </div>
                        <ul className="mt-2 space-y-1">
                          {result.citations.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                              >
                                <span className="truncate">{sourceLabel(url)}</span>
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60 transition group-hover:opacity-100" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {completedSteps.length > 0 && (
                      <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Checked for this answer</p>
                        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {completedSteps.map((step, index) => (
                            <li key={`${step.tool}-${index}`} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                              {TOOL_LABELS[step.tool] || step.tool.replaceAll('_', ' ')}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setResult(null);
                        setQuestion('');
                        window.setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="mt-6 text-xs font-semibold text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400"
                    >
                      Ask another question
                    </button>
                  </div>
                )}
              </div>

              <form onSubmit={submit} className="border-t border-slate-200 bg-white p-4 pb-[calc(1rem+var(--app-safe-bottom))] dark:border-slate-800 dark:bg-slate-950 sm:px-6 md:pb-5">
                <label htmlFor="ask-planitenary-question" className="sr-only">Question for Planitenary</label>
                <div className="flex items-end gap-2 rounded-2xl bg-slate-100 p-2 dark:bg-slate-900">
                  <textarea
                    ref={inputRef}
                    id="ask-planitenary-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    maxLength={600}
                    rows={2}
                    disabled={loading}
                    placeholder="Ask about this trip…"
                    className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
                    aria-label="Send question"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                  Read-only V1 · no itinerary changes or bookings
                </p>
              </form>
            </motion.aside>
          </>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

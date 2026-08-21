import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
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
  SquarePen,
  X,
} from 'lucide-react';
import { ASK_SUGGESTIONS, askPlanitenary, type AskResult } from '../lib/askPlanitenary';
import { askSuggestionsFor } from '../../supabase/functions/_shared/smartPlannerActions';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import { useAuth } from '../contexts/AuthContext';
import {
  askChatMessageId,
  askChatStorageKey,
  clearAskChat,
  conversationTurnsFrom,
  readAskChat,
  writeAskChat,
  type AskChatMessage,
} from '../lib/askChatThread';
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

/**
 * How close to the end counts as "following along".
 *
 * A traveller who has scrolled up to reread an earlier answer is reading, and
 * yanking them to the bottom when a reply lands loses their place. Anyone
 * within this much of the end is still watching the newest message.
 */
const FOLLOW_THRESHOLD_PX = 96;

/** Diagnostics belong to one answer, and only while that answer is the newest. */
interface LatestDiagnostics {
  messageId: string;
  result: AskResult;
}

export function AskPlanitenaryPanel({ tripId, tripName }: AskPlanitenaryPanelProps) {
  const intelligence = useTripIntelligenceUi();
  const { user, isDemoUser } = useAuth();
  const [open, setOpen] = useState(false);

  /**
   * Hold the page still while the panel is open.
   *
   * This is a modal dialog, and the plan behind it was staying fully
   * scrollable: a wheel over the answer scrolled the itinerary underneath
   * instead, which is indistinguishable from the panel refusing to scroll.
   * The previous value is restored rather than assumed to be `visible`, so
   * closing cannot quietly clear an overflow some other surface had set.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const [seenAskNonce, setSeenAskNonce] = useState(0);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<AskChatMessage[]>([]);
  const [latest, setLatest] = useState<LatestDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [confirmingNewChat, setConfirmingNewChat] = useState(false);
  const [following, setFollowing] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const storageKey = askChatStorageKey({ tripId, userId: user?.id, isDemoUser });

  /**
   * Load this trip's conversation, and swap it when the trip changes.
   *
   * Done during render rather than in an effect, and both pieces of state move
   * together. An effect would paint one frame of the previous trip's
   * conversation under the new trip's name, and — worse — the save effect
   * below would fire first and write Tokyo's messages to Osaka's key. Reading
   * `localStorage` is synchronous, so there is nothing to wait for.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== storageKey) {
    setLoadedKey(storageKey);
    setMessages(readAskChat(storageKey));
    setLatest(null);
    setConfirmingNewChat(false);
    setFollowing(true);
  }

  /**
   * Persist, but only once the key it belongs to is the key that was loaded.
   *
   * The guard is what stops a trip switch from writing the outgoing trip's
   * messages under the incoming trip's key during the render that swaps them.
   */
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    writeAskChat(storageKey, messages);
  }, [storageKey, loadedKey, messages]);

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

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setFollowing(true);
  }, []);

  /**
   * Follow the newest message, unless the traveller has scrolled away from it.
   *
   * `useLayoutEffect` so the jump happens in the same paint the message
   * appears in; an ordinary effect shows the old position for a frame first,
   * which reads as a flicker.
   */
  useLayoutEffect(() => {
    if (!open || !following) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [open, following, messages, loading]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setFollowing(distance <= FOLLOW_THRESHOLD_PX);
  };

  const canSubmit = Boolean(question.trim()) && !loading;

  const startNewChat = () => {
    setMessages([]);
    setLatest(null);
    setConfirmingNewChat(false);
    setQuestion('');
    setFollowing(true);
    clearAskChat(storageKey);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    /**
     * The bounded context is read from the conversation as it stands *before*
     * this question joins it. The new question travels as `question`; adding
     * it to history as well would send it twice.
     */
    const conversation = conversationTurnsFrom(messages);
    const userMessage: AskChatMessage = {
      id: askChatMessageId(),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    // Appended before the request, so the question the traveller just asked is
    // on screen while it is being answered rather than after.
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setLoading(true);
    setProgressIndex(0);
    setConfirmingNewChat(false);
    setFollowing(true);

    const next = await askPlanitenary({
      tripId,
      question: trimmed,
      uiContext: intelligence?.envelope,
      conversation,
    });

    /**
     * A failure is a message too, not a cleared panel. The question stays, the
     * refusal is appended under it, and every earlier turn is untouched — the
     * traveller can read what went wrong and ask again without losing the
     * conversation that led there.
     */
    const answered = Boolean(next.answer);
    const assistantMessage: AskChatMessage = {
      id: askChatMessageId(),
      role: 'assistant',
      text: answered
        ? next.answer!
        : next.detail || 'Planitenary could not answer this question safely.',
      createdAt: new Date().toISOString(),
      status: answered ? next.status : 'refused',
      // Read defensively: a result parsed by an older build carries no
      // places field at all, and an answer is worth keeping either way.
      ...((next.places ?? []).length > 0 ? { places: next.places } : {}),
      ...((next.citations ?? []).length > 0 ? { citations: next.citations } : {}),
    };

    setMessages((current) => [...current, assistantMessage]);
    setLatest({ messageId: assistantMessage.id, result: next });
    setLoading(false);
  };

  const empty = messages.length === 0 && !loading;

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
              data-lenis-prevent
              data-lenis-prevent-wheel
              data-lenis-prevent-touch
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
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
              data-lenis-prevent
              data-lenis-prevent-wheel
              data-lenis-prevent-touch
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-18px_55px_rgba(15,23,42,0.24)] dark:bg-slate-950 md:inset-y-0 md:left-auto md:w-[430px] md:max-h-none md:rounded-none md:shadow-[-18px_0_55px_rgba(15,23,42,0.22)]"
            >
              <header className="relative flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-6 sm:py-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <h2 id="ask-planitenary-title" className="font-display text-xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
                        Ask Planitenary
                      </h2>
                    </div>
                    <p className="mt-1 max-w-[34ch] truncate text-xs leading-5 text-slate-500 dark:text-slate-400">
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
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      // Nothing to lose and nothing to confirm when the thread
                      // is already empty — asking would be ceremony.
                      if (messages.length === 0) {
                        startNewChat();
                        return;
                      }
                      setConfirmingNewChat((current) => !current);
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-expanded={confirmingNewChat}
                  >
                    <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                    New chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-label="Close Ask Planitenary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {confirmingNewChat && (
                  <div
                    role="dialog"
                    aria-label="Start a new chat"
                    className="absolute right-4 top-full z-10 mt-[-8px] w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  >
                    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">
                      Start a new chat? This clears this trip&rsquo;s Ask history on this device.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingNewChat(false)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Keep it
                      </button>
                      <button
                        type="button"
                        onClick={startNewChat}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
                      >
                        Start new chat
                      </button>
                    </div>
                  </div>
                )}
              </header>

              {/*
                `overscroll-contain` stops the wheel handing off to the page
                behind once this list reaches its end. Without it, reading to
                the bottom of an answer silently starts scrolling the itinerary
                underneath, which reads as "the panel will not scroll".
              */}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
                data-lenis-prevent
                data-lenis-prevent-wheel
                data-lenis-prevent-touch
                onWheel={(event) => event.stopPropagation()}
                onTouchMove={(event) => event.stopPropagation()}
                style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
              >
                {empty && (
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

                {messages.length > 0 && (
                  <ol className="space-y-5" aria-live="polite" aria-label="Conversation">
                    {messages.map((message) => {
                      if (message.role === 'user') {
                        return (
                          <li key={message.id} className="flex flex-col items-end">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">You</p>
                            <p className="mt-1 max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-slate-100 px-3.5 py-2.5 text-sm leading-6 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
                              {message.text}
                            </p>
                          </li>
                        );
                      }

                      const diagnostics = latest?.messageId === message.id ? latest.result : undefined;
                      const completedSteps = (diagnostics?.steps ?? []).filter((step) => step.ok).slice(0, 6);
                      const refused = message.status === 'refused';

                      return (
                        <li key={message.id}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-500 dark:text-rose-400">Planitenary</p>

                          {refused ? (
                            <div className="mt-1 flex gap-3 rounded-xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
                              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              <p className="text-sm leading-6">{message.text}</p>
                            </div>
                          ) : (
                            <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-slate-800 dark:text-slate-100">{message.text}</p>
                          )}

                          {/*
                            Cards stay attached to the answer that produced
                            them, so a follow-up does not scroll the place it is
                            about off the record. Their identity was resolved
                            server-side for that turn; nothing here re-asserts
                            it, and nothing here is sent back as authority.
                          */}
                          {(message.places ?? []).length > 0 && (
                            <section className="mt-4">
                              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                                Places in this answer
                              </h3>
                              <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {(message.places ?? []).map((card) => (
                                  <PlaceCard key={`${message.id}-${card.ref.canonicalPlaceId}`} card={card} />
                                ))}
                              </ul>
                            </section>
                          )}

                          {diagnostics?.proposal && (
                            <section className="mt-4 rounded-xl bg-slate-950 p-4 text-white dark:bg-slate-900">
                              <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                                <Route className="h-4 w-4" aria-hidden="true" />
                                Proposal only · nothing changed
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-100">{diagnostics.proposal.summary}</p>
                              {(diagnostics.proposal.day || diagnostics.proposal.travelMinutes) && (
                                <p className="mt-2 text-xs text-slate-400">
                                  {diagnostics.proposal.day ? `Day ${diagnostics.proposal.day}` : ''}
                                  {diagnostics.proposal.day && diagnostics.proposal.travelMinutes ? ' · ' : ''}
                                  {diagnostics.proposal.travelMinutes ? `${diagnostics.proposal.travelMinutes} min from routing` : ''}
                                </p>
                              )}
                              {diagnostics.proposal.replan && (
                                <div className="mt-3 border-t border-slate-700 pt-3">
                                  <p className="text-xs font-semibold text-rose-200">Replan preview · Days {diagnostics.proposal.replan.affectedDays.join(', ')}</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-300">{diagnostics.proposal.replan.objective}</p>
                                  {diagnostics.proposal.replan.moves.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                                      {diagnostics.proposal.replan.moves.map((move, index) => (
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

                          {(message.citations ?? []).length > 0 && (
                            <section className="mt-4">
                              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                <Search className="h-4 w-4" aria-hidden="true" /> Sources
                              </div>
                              <ul className="mt-2 space-y-1">
                                {(message.citations ?? []).map((url) => (
                                  <li key={`${message.id}-${url}`}>
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
                            <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
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
                        </li>
                      );
                    })}

                    {/*
                      The thinking state sits under the question it belongs to,
                      not over the conversation. Replacing the pane with a
                      spinner is what made a follow-up feel like starting over.
                    */}
                    {loading && (
                      <li aria-live="polite">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-500 dark:text-rose-400">Planitenary</p>
                        <div className="mt-1 flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400">
                          <Loader2 className="h-4 w-4 animate-spin text-rose-600 dark:text-rose-300" aria-hidden="true" />
                          <span className="font-medium text-slate-700 dark:text-slate-200">{PROGRESS[progressIndex]}</span>
                        </div>
                        <p className="mt-1 max-w-[34ch] text-xs leading-5 text-slate-500 dark:text-slate-400">
                          Tool use and model rounds are capped. If a source cannot answer, Planitenary will say so.
                        </p>
                      </li>
                    )}
                  </ol>
                )}
              </div>

              <form onSubmit={submit} className="relative border-t border-slate-200 bg-white p-4 pb-[calc(1rem+var(--app-safe-bottom))] dark:border-slate-800 dark:bg-slate-950 sm:px-6 md:pb-5">
                {!following && messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => scrollToLatest()}
                    className="absolute -top-11 right-4 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    Latest
                  </button>
                )}
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
                    placeholder={messages.length > 0 ? 'Ask a follow-up…' : 'Ask about this trip…'}
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

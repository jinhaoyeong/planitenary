import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronLeft,
  CircleAlert,
  History,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Route,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { ASK_SUGGESTIONS, askPlanitenary, type AskResult } from '../lib/askPlanitenary';
import { askSuggestionsFor } from '../../supabase/functions/_shared/smartPlannerActions';
import { useTripIntelligenceUi } from '../lib/tripIntelligenceUi';
import { useAuth } from '../contexts/AuthContext';
import { useOptionalCurrency } from '../contexts/CurrencyContext';
import { convertCurrency, formatCurrency, hasRate, type ExchangeRates } from '../lib/currency';
import { adultFare, type AskPriceFact } from '../../supabase/functions/_shared/askPriceFacts';
import {
  askChatMessageId,
  askChatStorageKey,
  conversationTurnsFrom,
  type AskChatMessage,
} from '../lib/askChatThread';
import {
  ASK_CONVERSATION_TITLE_MAX,
  activeAskConversation,
  appendAskConversationMessage,
  askConversationClock,
  askConversationPreview,
  askConversationTitle,
  askHistoryRows,
  deleteAskConversation,
  emptyAskHistory,
  groupAskHistory,
  openAskConversation,
  readAskHistory,
  renameAskConversation,
  setAskConversationDraft,
  startAskConversation,
  writeAskHistory,
  type AskConversationStore,
} from '../lib/askChatHistory';
import { PlaceCard } from './PlaceCard';
import {
  capabilityAskExamples,
  plannerTripSignals,
} from '../lib/plannerCapabilities';
import type { Itinerary } from '../data';

interface AskPlanitenaryPanelProps {
  tripId: string;
  tripName?: string;
  /**
   * The trip as it stands, read only to decide which capability examples are
   * worth offering. Absent is fine: the surface suggestions still apply.
   */
  itinerary?: Itinerary;
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

const audienceLabel = (audience: string): string =>
  audience.charAt(0).toUpperCase() + audience.slice(1);

const fareRange = (fare: NonNullable<ReturnType<typeof adultFare>>) => ({
  min: fare.minAmount ?? fare.amount,
  max: fare.maxAmount ?? fare.amount,
});

const formatFareRange = (fare: NonNullable<ReturnType<typeof adultFare>>): string => {
  const range = fareRange(fare);
  const minimum = formatCurrency(range.min, fare.currency, { exact: true });
  return range.min === range.max
    ? minimum
    : `${minimum}–${formatCurrency(range.max, fare.currency, { exact: true })}`;
};

const checkedLabel = (retrievedAt?: string): string | undefined => {
  if (!retrievedAt || !Number.isFinite(Date.parse(retrievedAt))) return undefined;
  return `Checked ${new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium' }).format(new Date(retrievedAt))}`;
};

function VerifiedPriceFacts({
  facts,
  selectedCurrency,
  rates,
  ratesAreEstimate,
}: {
  facts: AskPriceFact[];
  selectedCurrency?: string;
  rates?: ExchangeRates;
  ratesAreEstimate?: boolean;
}) {
  const fares = facts.map((fact) => ({ fact, fare: adultFare(fact) })).filter(
    (entry): entry is { fact: AskPriceFact; fare: NonNullable<ReturnType<typeof adultFare>> } => Boolean(entry.fare),
  );
  const currencies = new Set(fares.map(({ fare }) => fare.currency));
  const sameSourceCurrency = currencies.size === 1;
  const sourceCurrency = sameSourceCurrency ? fares[0]?.fare.currency : undefined;
  const sourceRange = sameSourceCurrency
    ? fares.reduce((range, entry) => {
      const fare = fareRange(entry.fare);
      return { min: range.min + fare.min, max: range.max + fare.max };
    }, { min: 0, max: 0 })
    : undefined;
  const target = selectedCurrency?.toUpperCase();
  const canConvert = sourceRange !== undefined && Boolean(target) && Boolean(sourceCurrency)
    && sourceCurrency !== target
    && Boolean(rates)
    && ratesAreEstimate !== true
    && hasRate(rates!, sourceCurrency!)
    && hasRate(rates!, target!);
  const convertedRange = sourceRange !== undefined && target && sourceCurrency
    ? sourceCurrency === target
      ? sourceRange
      : canConvert
        ? {
          min: convertCurrency(sourceRange.min, sourceCurrency, target, rates!),
          max: convertCurrency(sourceRange.max, sourceCurrency, target, rates!),
        }
        : undefined
    : undefined;

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70" aria-label="Verified prices">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Verified prices
      </div>
      <ul className="mt-3 space-y-2">
        {fares.map(({ fact, fare }) => (
          <li key={`${fact.name}-${fare.audience}-${fare.currency}-${fare.amount}`} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 text-slate-700 dark:text-slate-200">
              {fact.kind === 'estimate' ? 'Estimate · ' : ''}{fact.name}
              <span className="block text-xs text-slate-500 dark:text-slate-400">{audienceLabel(fare.audience)}</span>
              {fare.note && (
                <span className="block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{fare.note}</span>
              )}
              {(fact.sourceUrl || checkedLabel(fact.retrievedAt)) && (
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  {fact.sourceUrl ? (
                    <a className="underline decoration-slate-300 underline-offset-2" href={fact.sourceUrl} target="_blank" rel="noreferrer">
                      {fact.source === 'official-website' ? 'Official source' : sourceLabel(fact.sourceUrl)}
                    </a>
                  ) : null}
                  {fact.sourceUrl && checkedLabel(fact.retrievedAt) ? ' · ' : ''}
                  {checkedLabel(fact.retrievedAt)}
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold text-slate-900 dark:text-white">
              {formatFareRange(fare)}
            </span>
          </li>
        ))}
      </ul>
      {sourceRange !== undefined && fares.length > 0 && sourceCurrency && (
        <div className="mt-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
          <div className="flex items-center justify-between gap-3 font-semibold text-slate-900 dark:text-white">
            <span>{fares.length > 1 ? 'Adult total' : 'Published fare'}</span>
            <span>{sourceRange.min === sourceRange.max
              ? formatCurrency(sourceRange.min, sourceCurrency, { exact: true })
              : `${formatCurrency(sourceRange.min, sourceCurrency, { exact: true })}–${formatCurrency(sourceRange.max, sourceCurrency, { exact: true })}`}</span>
          </div>
          {target && convertedRange !== undefined && (
            <p className="mt-1 text-right text-xs text-slate-500 dark:text-slate-400">
              ≈ {convertedRange.min === convertedRange.max
                ? formatCurrency(convertedRange.min, target)
                : `${formatCurrency(convertedRange.min, target)}–${formatCurrency(convertedRange.max, target)}`} in your selected currency
            </p>
          )}
          {target && convertedRange === undefined && sourceCurrency !== target && (
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Selected currency: {target}. A current exchange rate was not available, so the source total is shown without an invented conversion.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

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

export function AskPlanitenaryPanel({ tripId, tripName, itinerary }: AskPlanitenaryPanelProps) {
  const intelligence = useTripIntelligenceUi();
  const { user, isDemoUser } = useAuth();
  const currencyContext = useOptionalCurrency();
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
  const [store, setStore] = useState<AskConversationStore>(() => emptyAskHistory(tripId));
  const [latest, setLatest] = useState<LatestDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [following, setFollowing] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const storageKey = askChatStorageKey({ tripId, userId: user?.id, isDemoUser });
  // The thread on screen. Everything below — the transcript, the starter
  // state, the bounded window a follow-up carries — reads from this one.
  const messages = activeAskConversation(store).messages;

  /**
   * Load this trip's history, and swap it when the trip changes.
   *
   * Done during render rather than in an effect, and every piece of state moves
   * together. An effect would paint one frame of the previous trip's
   * conversation under the new trip's name, and — worse — the save effect
   * below would fire first and write Tokyo's messages to Osaka's key. Reading
   * `localStorage` is synchronous, so there is nothing to wait for.
   *
   * The outgoing trip's unsent composer text is parked with the conversation it
   * was typed into on the way past, for the same reason: after the swap there
   * is nothing left that knows where it belonged.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== storageKey) {
    if (loadedKey) {
      writeAskHistory(loadedKey, setAskConversationDraft(store, store.activeConversationId, question));
    }
    const restored = readAskHistory(storageKey, tripId);
    setLoadedKey(storageKey);
    setStore(restored);
    setQuestion(activeAskConversation(restored).draft ?? '');
    setLatest(null);
    setHistoryOpen(false);
    setConfirmingDeleteId(null);
    setRenamingId(null);
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
    writeAskHistory(storageKey, store);
  }, [storageKey, loadedKey, store]);

  const askNonce = intelligence?.askNonce ?? 0;
  if (askNonce > seenAskNonce) {
    setSeenAskNonce(askNonce);
    setOpen(true);
    // A question arriving from elsewhere belongs in the composer, so the
    // history drawer must not be sitting over it.
    setHistoryOpen(false);
    /**
     * A capability chosen elsewhere arrives as text in the composer, never as
     * a sent question. The traveller can edit it, and no metered call happens
     * until they press Send.
     */
    if (intelligence?.askPrefill) setQuestion(intelligence.askPrefill);
  }

  const suggestions = intelligence?.envelope.surface
    ? askSuggestionsFor(intelligence.envelope.surface)
    : ASK_SUGGESTIONS;

  /**
   * What the planner can do, phrased as questions.
   *
   * Drawn from the shared capability registry rather than a list kept here,
   * so Ask and Smart Plan cannot end up describing different products. Shown
   * only while the conversation is empty — once there is a thread, this space
   * belongs to it.
   */
  const capabilityExamples = useMemo(
    () => (itinerary ? capabilityAskExamples(plannerTripSignals(itinerary)) : []),
    [itinerary],
  );

  /**
   * The history list, grouped by the day each chat was last spoken to.
   *
   * Recomputed when the drawer opens rather than memoised on the store alone,
   * so "Today" is still today for a panel left open across midnight. A blank
   * thread has no row: an unused "New chat" is not a chat yet.
   */
  const historyGroups = useMemo(
    () => (historyOpen ? groupAskHistory(askHistoryRows(store)) : []),
    [historyOpen, store],
  );

  /**
   * Park the composer text with its conversation, then close.
   *
   * Closing is the last moment this component knows which thread the half-typed
   * question belonged to, so it is where the draft is committed. Not on every
   * keystroke: that would re-serialise the whole trip's history into
   * `localStorage` on each character typed.
   */
  const closePanel = useCallback(() => {
    setStore((current) => setAskConversationDraft(current, current.activeConversationId, question));
    setHistoryOpen(false);
    setOpen(false);
  }, [question]);

  useEffect(() => {
    if (!open) return;
    const frame = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // History sits over the conversation, so it is what Escape leaves first.
      if (historyOpen) {
        setHistoryOpen(false);
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, historyOpen, closePanel]);

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

  /**
   * Start a fresh thread. The current one is kept, not discarded.
   *
   * This is the whole change in one function: "New chat" used to clear the
   * conversation, which meant the only way to start a second question was to
   * destroy the first. Now it archives — nothing is deleted here, and nothing
   * is asked, because there is nothing to lose. Deletion happens exactly once,
   * from a history row, and only when somebody asks for it.
   */
  const startNewChat = () => {
    setStore((current) => startAskConversation(
      setAskConversationDraft(current, current.activeConversationId, question),
      tripId,
    ));
    setLatest(null);
    setHistoryOpen(false);
    setQuestion('');
    setFollowing(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  /**
   * Bring an archived thread back.
   *
   * A `localStorage` read and a state swap. Nothing about reopening an old
   * conversation re-asks its questions — the answers in it are the ones that
   * were given at the time, and the model is not consulted again until Send.
   */
  const openConversation = (id: string) => {
    if (id === store.activeConversationId) {
      setHistoryOpen(false);
      return;
    }
    const parked = setAskConversationDraft(store, store.activeConversationId, question);
    setStore(openAskConversation(parked, id));
    setQuestion(parked.conversations.find((entry) => entry.id === id)?.draft ?? '');
    // Diagnostics belong to one answer in the thread being left behind.
    setLatest(null);
    setHistoryOpen(false);
    setConfirmingDeleteId(null);
    setRenamingId(null);
    // An old conversation opens where it was left: at its most recent message.
    setFollowing(true);
  };

  /** One conversation, and nothing else in the trip. */
  const removeConversation = (id: string) => {
    const next = deleteAskConversation(store, id, tripId);
    setStore(next);
    setConfirmingDeleteId(null);
    setRenamingId(null);
    if (id !== store.activeConversationId) return;
    setLatest(null);
    setQuestion(activeAskConversation(next).draft ?? '');
    setFollowing(true);
  };

  const commitRename = (id: string) => {
    setStore((current) => renameAskConversation(current, id, renameDraft));
    setRenamingId(null);
    setRenameDraft('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    /**
     * The bounded context is read from the *active* conversation as it stands
     * before this question joins it. The new question travels as `question`;
     * adding it to history as well would send it twice.
     *
     * Only this thread travels. Chat history is navigation, not memory: the
     * other conversations stored for this trip are inert until opened, which
     * is what stops twenty archived chats from becoming twenty chats' worth of
     * input tokens on the next question.
     */
    const conversation = conversationTurnsFrom(messages);
    // The answer belongs to the thread that asked, whatever is on screen when
    // it arrives. Captured rather than re-read after the await.
    const conversationId = store.activeConversationId;
    const userMessage: AskChatMessage = {
      id: askChatMessageId(),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    // Appended before the request, so the question the traveller just asked is
    // on screen while it is being answered rather than after.
    setStore((current) => appendAskConversationMessage(current, conversationId, userMessage));
    setQuestion('');
    setLoading(true);
    setProgressIndex(0);
    setHistoryOpen(false);
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
    const budgetStatus = next.grounding?.scopes.includes('budget') && next.grounding.budget
      ? { requested: true, present: next.grounding.budget.present }
      : undefined;
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
      // Kept beside the answer they belong to, never rendered. This is what a
      // follow-up about an unsaved place is carried by.
      ...((next.placeTokens ?? []).length > 0 ? { placeTokens: next.placeTokens } : {}),
      ...((next.priceFacts ?? []).length > 0 ? { priceFacts: next.priceFacts } : {}),
      ...(next.currency ? { currency: next.currency } : {}),
      ...(budgetStatus ? { budgetStatus } : {}),
    };

    setStore((current) => appendAskConversationMessage(current, conversationId, assistantMessage));
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
              onClick={closePanel}
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
              className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-18px_55px_rgba(15,23,42,0.24)] dark:bg-slate-950 md:inset-y-0 md:left-auto md:w-[520px] md:max-h-none md:rounded-none md:shadow-[-18px_0_55px_rgba(15,23,42,0.22)] 2xl:w-[600px]"
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
                {/*
                  History sits to the left of New chat because it is the one a
                  traveller goes looking for; the label collapses to its icon on
                  a narrow sheet so the three controls never crowd the title.
                */}
                <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDeleteId(null);
                      setRenamingId(null);
                      setHistoryOpen((current) => !current);
                    }}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:px-2.5"
                    aria-label="Chat history"
                    aria-expanded={historyOpen}
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">History</span>
                  </button>
                  <button
                    type="button"
                    onClick={startNewChat}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:px-2.5"
                    aria-label="New chat"
                  >
                    <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">New chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={closePanel}
                    className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-slate-800 dark:hover:text-white"
                    aria-label="Close Ask Planitenary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {/*
                Everything below the header, and the containing block the
                history drawer slides over. Deliberately not the whole panel:
                History, New chat and Close stay reachable while the drawer is
                open, so reading an old chat is never a one-way door.
              */}
              <div className="relative flex min-h-0 flex-1 flex-col">

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
                      {capabilityExamples.length > 0 && (
                        <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                            You can ask me to…
                          </h3>
                          <ul className="mt-2 grid gap-1">
                            {capabilityExamples.map((example) => (
                              <li key={example}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Types it, never sends it.
                                    setQuestion(example);
                                    inputRef.current?.focus();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs leading-5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                                >
                                  <span aria-hidden="true" className="text-rose-500 dark:text-rose-400">•</span>
                                  <span className="min-w-0">{example}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
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
                        const priceFacts = diagnostics?.priceFacts ?? message.priceFacts ?? [];
                        const currencyFacts = diagnostics?.currency ?? message.currency;
                        const budgetMissing = diagnostics?.grounding?.budget?.present === false
                          || (diagnostics === undefined && message.budgetStatus?.requested === true && message.budgetStatus.present === false);

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

                            {priceFacts.length > 0 && !refused && (
                              <VerifiedPriceFacts
                                facts={priceFacts}
                                selectedCurrency={currencyFacts?.selected}
                                rates={currencyContext?.rates}
                                ratesAreEstimate={currencyContext?.rateFreshness.isEstimate}
                              />
                            )}

                            {budgetMissing && !refused && (
                              <div className="mt-4 flex gap-3 rounded-xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100">
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <p className="text-sm leading-6">
                                  No saved spending limit is available, so I can share verified prices but cannot calculate affordability or remaining budget yet.
                                </p>
                              </div>
                            )}

                            {/*
                              What is left when a fare could not be verified.

                              Some operators block server requests outright and
                              others draw their prices in the browser, so there
                              are attractions this app cannot read a fare from
                              however long it waits. Inventing a number is the
                              one thing it must not do, and "I could not check"
                              on its own helps nobody — so it offers the place
                              the traveller can check, which asserts nothing.

                              Shown only when nothing was verified: a real fare
                              makes the link redundant.
                            */}
                            {priceFacts.length === 0 && !refused && (diagnostics?.officialSources ?? []).length > 0 && (
                              <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70" aria-label="Check current ticket price">
                                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                                  Check current ticket price
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                  Planitenary could not verify today&rsquo;s fare automatically. Prices may vary by date or ticket type.
                                </p>
                                <ul className="mt-3 space-y-1">
                                  {(diagnostics?.officialSources ?? []).map((source) => (
                                    <li key={source.url}>
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
                                      >
                                        <span className="min-w-0 truncate">{source.name} &mdash; official site</span>
                                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60 transition group-hover:opacity-100" aria-hidden="true" />
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </section>
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

                {/*
                  History covers the conversation rather than opening beside it.
                  On a phone the panel *is* the screen, so a popover would be a
                  postage stamp; on a desktop, sliding over keeps the itinerary
                  behind untouched, which is the whole point of never navigating
                  away to read an old chat.
                */}
                {historyOpen && (
                  <motion.div
                    role="dialog"
                    aria-label="Chat history"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950"
                  >
                    <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-5">
                      <button
                        type="button"
                        onClick={() => setHistoryOpen(false)}
                        className="inline-flex items-center gap-1 rounded-full py-1.5 pl-1 pr-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                        aria-label="Back to chat"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Chat history
                      </button>
                    </header>

                    <div
                      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--app-safe-bottom))] pt-4 sm:px-5 md:pb-4"
                      data-lenis-prevent
                      data-lenis-prevent-wheel
                      data-lenis-prevent-touch
                      onWheel={(event) => event.stopPropagation()}
                      onTouchMove={(event) => event.stopPropagation()}
                      style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
                    >
                      {historyGroups.length === 0 ? (
                        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                          Chats you start here are kept on this device, for this trip. Ask something and it will appear in this list.
                        </p>
                      ) : (
                        historyGroups.map((group) => (
                          <section key={group.label} className="mb-5 last:mb-0">
                            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                              {group.label}
                            </h3>
                            <ol className="mt-2 space-y-1" aria-label={`${group.label} chats`}>
                              {group.conversations.map((conversation) => {
                                const title = askConversationTitle(conversation);
                                const preview = askConversationPreview(conversation);
                                const isActive = conversation.id === store.activeConversationId;

                                if (renamingId === conversation.id) {
                                  return (
                                    <li key={conversation.id} className="rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
                                      <label className="sr-only" htmlFor={`ask-rename-${conversation.id}`}>
                                        Rename chat
                                      </label>
                                      <input
                                        id={`ask-rename-${conversation.id}`}
                                        autoFocus
                                        value={renameDraft}
                                        maxLength={ASK_CONVERSATION_TITLE_MAX}
                                        onChange={(event) => setRenameDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                            commitRename(conversation.id);
                                          }
                                          if (event.key === 'Escape') {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setRenamingId(null);
                                          }
                                        }}
                                        className="w-full rounded-lg bg-white px-2.5 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-rose-500 dark:bg-slate-950 dark:text-white dark:ring-slate-700"
                                      />
                                      <div className="mt-2 flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setRenamingId(null)}
                                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => commitRename(conversation.id)}
                                          className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                                        >
                                          Save name
                                        </button>
                                      </div>
                                    </li>
                                  );
                                }

                                if (confirmingDeleteId === conversation.id) {
                                  return (
                                    <li key={conversation.id} className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900">
                                      <p className="text-xs leading-5 text-slate-700 dark:text-slate-200">
                                        Delete this chat? Your trip, itinerary and budget are untouched.
                                      </p>
                                      <div className="mt-2 flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setConfirmingDeleteId(null)}
                                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                          Keep it
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeConversation(conversation.id)}
                                          className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
                                        >
                                          Delete chat
                                        </button>
                                      </div>
                                    </li>
                                  );
                                }

                                return (
                                  <li
                                    key={conversation.id}
                                    className={`group flex items-center gap-1 rounded-xl pr-1 transition ${
                                      isActive
                                        ? 'bg-slate-100 dark:bg-slate-900'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openConversation(conversation.id)}
                                      className="min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                                      aria-label={`Open ${title}`}
                                      aria-current={isActive ? 'true' : undefined}
                                    >
                                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                        {title}
                                      </span>
                                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                        <span className="shrink-0">{askConversationClock(conversation)}</span>
                                        {preview && <span className="truncate">· {preview}</span>}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmingDeleteId(null);
                                        setRenameDraft(title);
                                        setRenamingId(conversation.id);
                                      }}
                                      className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                      aria-label={`Rename ${title}`}
                                    >
                                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenamingId(null);
                                        setConfirmingDeleteId(conversation.id);
                                      }}
                                      className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-rose-950/60 dark:hover:text-rose-200"
                                      aria-label={`Delete ${title}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                          </section>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.aside>
          </>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

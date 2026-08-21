/**
 * Many Ask Planitenary conversations per trip, as the browser holds them.
 *
 * `askChatThread` owns one thread; this module owns the *list* of them and the
 * single `localStorage` entry they share. The distinction that shapes
 * everything here is between navigation and memory:
 *
 * **History is navigation.** It lets a traveller go back to the chat where
 * they worked out theme-park tickets without losing the one about Day 3. It
 * costs a `JSON.parse`, never a model call — opening the drawer, switching
 * threads, renaming and deleting are all local, and the only thing on this
 * whole surface that may spend money is Send.
 *
 * **History is not model memory.** Only the *active* conversation's bounded
 * recent turns are ever offered to the server. An archived thread is inert
 * until the traveller opens it, which is what stops twenty stored chats from
 * turning into twenty chats' worth of input tokens on the next question.
 *
 * Three bounds, for three different failure modes. Messages per conversation
 * and bytes per conversation stay in `askChatThread`, because a runaway single
 * thread is that module's problem. Conversations per trip and bytes per *trip*
 * live here, because twenty threads at the single-thread ceiling would be
 * 2.5 MB of a ~5 MB origin quota — enough to starve Supabase auth of the room
 * it needs to keep somebody signed in. Pruning takes the oldest inactive
 * thread first and never the one on screen.
 *
 * Nothing new is trusted. A restored card is re-checked by the same parser the
 * network path uses, and an archived thread's opaque place tokens travel back
 * exactly as they were stored — still unreadable here, still verified only by
 * the server that signed them, and still expiring on their own schedule.
 */

import {
  askChatMessageId,
  askChatMessagesForStorage,
  parseAskChatMessages,
  trimAskChat,
  type AskChatMessage,
} from './askChatThread';
import {
  approximateEntryBytes,
  safeGetItem,
  safeRemoveItem,
  safeSetItemWithBudget,
} from './safeLocalStorage';

/**
 * One archived or active conversation.
 *
 * `title` is empty until somebody renames it or the first question fixes one;
 * {@link askConversationTitle} is what a row should display, so an untitled
 * thread never shows a blank line or, worse, an id.
 */
export interface AskConversation {
  id: string;
  tripId: string;
  title: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. Moves when a message lands, never when a draft is edited. */
  updatedAt: string;
  messages: AskChatMessage[];
  /**
   * Unsent composer text, kept with the thread it was typed into.
   *
   * Half a question is work, and switching to another chat to check something
   * should not throw it away. It is text the traveller typed and never sent,
   * so it reaches no server and costs nothing.
   */
  draft?: string;
}

/** Every conversation for one trip, newest first, plus which one is on screen. */
export interface AskConversationStore {
  activeConversationId: string;
  conversations: AskConversation[];
}

/**
 * Conversations kept per trip.
 *
 * Twenty is far more than a traveller will scroll through and small enough
 * that the list stays navigable without search. Passing it prunes the oldest
 * inactive thread, which is the one least likely to be missed.
 */
export const ASK_HISTORY_MAX_CONVERSATIONS = 20;

/**
 * Bytes kept per trip, measured the way the storage layer measures.
 *
 * The conversation cap alone is not a size bound: twenty threads at the
 * single-thread ceiling would be 2.5 MB, most of the app's own 3 MB budget,
 * for chat logs. Whichever bound bites first wins.
 */
export const ASK_HISTORY_SOFT_LIMIT_BYTES = 512_000;

/** Long enough to tell two questions apart in a list; short enough to fit one line. */
export const ASK_CONVERSATION_TITLE_MAX = 56;

/** Matches the composer's own `maxLength`; a draft is never longer than a question. */
const MAX_DRAFT_CHARS = 600;

/** What an untitled thread is called before its first question. */
export const UNTITLED_ASK_CONVERSATION = 'New chat';

/** The stored shape. Bumped only if a future shape cannot be read as this one. */
const STORE_VERSION = 2;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const iso = (value: unknown, fallback: string): string => {
  const candidate = text(value, 40);
  if (!candidate) return fallback;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

/** Ids only have to be unique within one browser list, never guessed. */
export const askConversationId = (): string => askChatMessageId();

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * A title from the first question, computed here rather than bought.
 *
 * Asking a model to summarise every new chat would spend a round trip on
 * something the traveller already wrote, on a surface whose whole premise is
 * that navigation is free. So this does not summarise: it takes the first
 * sentence of the first question and truncates it on a word boundary. "How
 * much is two of the theme park ticket…" is a worse headline than a model
 * would write and a better one than a bill.
 */
export const askConversationTitleFrom = (messages: AskChatMessage[]): string => {
  const asked = messages.find((message) => message.role === 'user');
  if (!asked) return '';
  const whole = collapse(asked.text);
  if (!whole) return '';

  // The first sentence, unless it is a greeting too short to identify anything.
  const sentence = /^[\s\S]*?[.?!](?=\s|$)/.exec(whole)?.[0];
  const source = sentence && sentence.length >= 12 ? sentence : whole;
  const capitalised = source.charAt(0).toLocaleUpperCase() + source.slice(1);
  if (capitalised.length <= ASK_CONVERSATION_TITLE_MAX) return capitalised;

  const cut = capitalised.slice(0, ASK_CONVERSATION_TITLE_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace >= ASK_CONVERSATION_TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,;:.!?-]+$/, '')}…`;
};

/** What a history row shows: a rename if there is one, else the first question. */
export const askConversationTitle = (conversation: AskConversation): string =>
  conversation.title
  || askConversationTitleFrom(conversation.messages)
  || UNTITLED_ASK_CONVERSATION;

/** A glance at where a thread got to. Never an id, never internal state. */
export const askConversationPreview = (conversation: AskConversation): string => {
  const last = conversation.messages.at(-1);
  if (!last) return '';
  const line = collapse(last.text);
  return line.length <= 90 ? line : `${line.slice(0, 89).trimEnd()}…`;
};

const newestFirst = (conversations: AskConversation[]): AskConversation[] =>
  [...conversations].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

/** A blank thread, ready for its first question. */
export const newAskConversation = (tripId: string, now: Date = new Date()): AskConversation => {
  const stamp = now.toISOString();
  return {
    id: askConversationId(),
    tripId,
    title: '',
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
  };
};

export const emptyAskHistory = (tripId: string, now: Date = new Date()): AskConversationStore => {
  const conversation = newAskConversation(tripId, now);
  return { activeConversationId: conversation.id, conversations: [conversation] };
};

/** The thread on screen. Never `undefined`: a store always has an active one. */
export const activeAskConversation = (store: AskConversationStore): AskConversation =>
  store.conversations.find((entry) => entry.id === store.activeConversationId)
  ?? store.conversations[0];

const forStorage = (conversations: AskConversation[]): unknown[] =>
  conversations.map((conversation) => ({
    id: conversation.id,
    tripId: conversation.tripId,
    ...(conversation.title ? { title: conversation.title } : {}),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: askChatMessagesForStorage(conversation.messages),
    ...(conversation.draft ? { draft: conversation.draft } : {}),
  }));

const storeBytes = (conversations: AskConversation[]): number =>
  approximateEntryBytes('', JSON.stringify(forStorage(conversations)));

/**
 * An empty thread is worth keeping only while it is the one on screen.
 *
 * Otherwise every press of "New chat" would leave a blank row behind, and the
 * list a traveller opens to find something would fill with nothing.
 */
const worthKeeping = (conversation: AskConversation, activeId: string): boolean =>
  conversation.messages.length > 0 || conversation.id === activeId;

/**
 * Bring one trip's history back inside both bounds, oldest inactive first.
 *
 * The active conversation survives every rule here. Pruning the thread being
 * read would be the storage layer deciding the traveller was finished with it.
 */
export function trimAskHistory(store: AskConversationStore): AskConversationStore {
  const activeId = store.activeConversationId;

  let conversations = newestFirst(
    store.conversations
      .filter((conversation) => worthKeeping(conversation, activeId))
      .map((conversation) => ({ ...conversation, messages: trimAskChat(conversation.messages) })),
  );

  if (conversations.length > ASK_HISTORY_MAX_CONVERSATIONS) {
    const active = conversations.find((entry) => entry.id === activeId);
    const others = conversations.filter((entry) => entry.id !== activeId);
    conversations = newestFirst(
      (active ? [active, ...others] : others).slice(0, ASK_HISTORY_MAX_CONVERSATIONS),
    );
  }

  // Oldest first among the inactive, so the thread least likely to be missed
  // goes before the one somebody was reading five minutes ago.
  while (conversations.length > 1 && storeBytes(conversations) > ASK_HISTORY_SOFT_LIMIT_BYTES) {
    const oldest = [...conversations].reverse().find((entry) => entry.id !== activeId);
    if (!oldest) break;
    conversations = conversations.filter((entry) => entry.id !== oldest.id);
  }

  return { activeConversationId: activeId, conversations };
}

const parseConversation = (value: unknown, tripId: string): AskConversation | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;

  const messages = parseAskChatMessages(raw.messages);
  const createdAt = iso(raw.createdAt, messages[0]?.createdAt ?? new Date(0).toISOString());
  const draft = text(raw.draft, MAX_DRAFT_CHARS);
  return {
    id: text(raw.id, 80) ?? askConversationId(),
    // The trip is the key's, never the entry's: a stored `tripId` claiming
    // another trip must not move a conversation between them.
    tripId,
    title: text(raw.title, ASK_CONVERSATION_TITLE_MAX) ?? '',
    createdAt,
    updatedAt: iso(raw.updatedAt, messages.at(-1)?.createdAt ?? createdAt),
    messages,
    ...(draft ? { draft } : {}),
  };
};

/**
 * The single-thread entry every existing browser is holding, read as history.
 *
 * Migration happens on read and writes nothing of its own: the panel's next
 * save stores the new shape. The id is derived from the first message rather
 * than minted, so reading the old entry twice yields the same conversation
 * rather than two — which is what makes this idempotent for a browser that
 * opens Ask and closes it again without asking anything.
 */
const migrateSingleThread = (
  value: unknown[],
  tripId: string,
): AskConversationStore | undefined => {
  const messages = parseAskChatMessages(value);
  if (messages.length === 0) return undefined;
  const conversation: AskConversation = {
    id: `c-${messages[0].id}`,
    tripId,
    title: '',
    createdAt: messages[0].createdAt,
    updatedAt: messages.at(-1)?.createdAt ?? messages[0].createdAt,
    messages,
  };
  return { activeConversationId: conversation.id, conversations: [conversation] };
};

/**
 * One stored entry, re-checked, in whichever shape it was written.
 *
 * Unreadable storage reads as no history rather than an error: a truncated
 * entry must cost a conversation list, never the panel.
 */
export function parseAskConversationStore(
  raw: string | null,
  tripId: string,
  now: Date = new Date(),
): AskConversationStore {
  if (!raw) return emptyAskHistory(tripId, now);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyAskHistory(tripId, now);
  }

  const migrated = Array.isArray(parsed) ? migrateSingleThread(parsed, tripId) : undefined;
  if (migrated) return trimAskHistory(migrated);
  if (Array.isArray(parsed)) return emptyAskHistory(tripId, now);

  if (!parsed || typeof parsed !== 'object') return emptyAskHistory(tripId, now);
  const store = parsed as Record<string, unknown>;
  const conversations = Array.isArray(store.conversations)
    ? store.conversations
      .map((entry) => parseConversation(entry, tripId))
      .filter((entry): entry is AskConversation => Boolean(entry))
    : [];
  if (conversations.length === 0) return emptyAskHistory(tripId, now);

  const claimed = text(store.activeConversationId, 80);
  const activeId = conversations.some((entry) => entry.id === claimed)
    ? claimed!
    : newestFirst(conversations)[0].id;

  return trimAskHistory({ activeConversationId: activeId, conversations });
}

export const readAskHistory = (key: string, tripId: string): AskConversationStore =>
  parseAskConversationStore(safeGetItem(key), tripId);

/**
 * Persist one trip's history.
 *
 * A history holding nothing but one blank thread removes the key rather than
 * storing a skeleton, so a browser that never used Ask carries no entry per
 * trip. Failure is silent by design: this is a cache, and a traveller
 * mid-question must not be interrupted because the origin is full.
 */
export const writeAskHistory = (key: string, store: AskConversationStore): void => {
  const bounded = trimAskHistory(store);
  const substantive = bounded.conversations.some(
    (conversation) => conversation.messages.length > 0 || conversation.draft,
  );
  if (!substantive) {
    safeRemoveItem(key);
    return;
  }
  safeSetItemWithBudget(key, JSON.stringify({
    v: STORE_VERSION,
    activeConversationId: bounded.activeConversationId,
    conversations: forStorage(bounded.conversations),
  }));
};

/** Every stored conversation for a trip, discarded together. */
export const clearAskHistory = (key: string): void => { safeRemoveItem(key); };

const replace = (
  store: AskConversationStore,
  id: string,
  change: (conversation: AskConversation) => AskConversation,
): AskConversationStore => {
  if (!store.conversations.some((entry) => entry.id === id)) return store;
  return {
    ...store,
    conversations: store.conversations.map(
      (entry) => (entry.id === id ? change(entry) : entry),
    ),
  };
};

/**
 * Record a turn against one named conversation.
 *
 * The id is passed rather than read from `activeConversationId` on purpose: an
 * answer belongs to the thread that asked for it, and a traveller who switched
 * chats while it was in flight must not have it land in the one they are
 * reading. An id that is no longer present — the trip changed underneath —
 * leaves the store untouched rather than inventing somewhere to put it.
 */
export const setAskConversationMessages = (
  store: AskConversationStore,
  id: string,
  messages: AskChatMessage[],
  now: Date = new Date(),
): AskConversationStore => replace(store, id, (conversation) => ({
  ...conversation,
  messages,
  // Fixed the first time there is a question to fix it from, so a title cannot
  // change later when trimming drops the message it was taken from.
  title: conversation.title || askConversationTitleFrom(messages),
  updatedAt: now.toISOString(),
}));

/** One more turn on the end of a named conversation. */
export const appendAskConversationMessage = (
  store: AskConversationStore,
  id: string,
  message: AskChatMessage,
  now: Date = new Date(),
): AskConversationStore => {
  const conversation = store.conversations.find((entry) => entry.id === id);
  if (!conversation) return store;
  return setAskConversationMessages(store, id, [...conversation.messages, message], now);
};

/** Park unsent composer text. Never moves `updatedAt`: typing is not activity. */
export const setAskConversationDraft = (
  store: AskConversationStore,
  id: string,
  draft: string,
): AskConversationStore => replace(store, id, (conversation) => {
  const kept = draft.slice(0, MAX_DRAFT_CHARS);
  const next: AskConversation = { ...conversation };
  if (kept.trim()) next.draft = kept;
  else delete next.draft;
  return next;
});

/** A rename, local and free. An empty name falls back to the first question. */
export const renameAskConversation = (
  store: AskConversationStore,
  id: string,
  title: string,
): AskConversationStore => replace(store, id, (conversation) => ({
  ...conversation,
  title: collapse(title).slice(0, ASK_CONVERSATION_TITLE_MAX),
}));

/**
 * Start a fresh thread, keeping the current one.
 *
 * This is the change the whole feature turns on: "New chat" archives rather
 * than deletes. Pressing it on a thread that is already blank re-uses that
 * blank thread instead of stacking another one, so a traveller who presses it
 * twice does not put two empty rows in their history.
 */
export const startAskConversation = (
  store: AskConversationStore,
  tripId: string,
  now: Date = new Date(),
): AskConversationStore => {
  const active = activeAskConversation(store);
  if (active && active.messages.length === 0) {
    return setAskConversationDraft(store, active.id, '');
  }
  const fresh = newAskConversation(tripId, now);
  return {
    activeConversationId: fresh.id,
    conversations: [fresh, ...store.conversations],
  };
};

/** Bring an archived thread back on screen. Unknown ids change nothing. */
export const openAskConversation = (
  store: AskConversationStore,
  id: string,
): AskConversationStore => {
  if (!store.conversations.some((entry) => entry.id === id)) return store;
  return { ...store, activeConversationId: id };
};

/**
 * Delete one conversation and nothing else.
 *
 * Deleting the thread on screen falls back to the most recent one left, and to
 * a fresh blank thread when there is none — never to an empty panel with no
 * active conversation at all.
 */
export const deleteAskConversation = (
  store: AskConversationStore,
  id: string,
  tripId: string,
  now: Date = new Date(),
): AskConversationStore => {
  const remaining = store.conversations.filter((entry) => entry.id !== id);
  if (remaining.length === store.conversations.length) return store;
  if (remaining.length === 0) return emptyAskHistory(tripId, now);
  return {
    activeConversationId: store.activeConversationId === id
      ? newestFirst(remaining)[0].id
      : store.activeConversationId,
    conversations: remaining,
  };
};

/** The list a history drawer renders: newest first, blank threads omitted. */
export const askHistoryRows = (store: AskConversationStore): AskConversation[] =>
  newestFirst(store.conversations.filter((conversation) => conversation.messages.length > 0));

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

export interface AskHistoryGroup {
  label: string;
  conversations: AskConversation[];
}

/**
 * History under day headings, the way somebody looks for a chat they half
 * remember: "that was yesterday evening" rather than a timestamp.
 */
export function groupAskHistory(
  conversations: AskConversation[],
  now: Date = new Date(),
): AskHistoryGroup[] {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const groups: AskHistoryGroup[] = [];

  for (const conversation of newestFirst(conversations)) {
    const at = new Date(conversation.updatedAt);
    const label = Number.isNaN(at.getTime())
      ? 'Earlier'
      : sameLocalDay(at, now)
        ? 'Today'
        : sameLocalDay(at, yesterday)
          ? 'Yesterday'
          : at.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
          });
    const open = groups.at(-1);
    if (open?.label === label) open.conversations.push(conversation);
    else groups.push({ label, conversations: [conversation] });
  }

  return groups;
}

/** The clock a history row shows beside its title. */
export const askConversationClock = (conversation: AskConversation): string => {
  const at = new Date(conversation.updatedAt);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

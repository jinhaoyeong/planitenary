// @vitest-environment jsdom

/**
 * Many conversations per trip, tested apart from the panel.
 *
 * The failures worth catching here are the quiet ones. A "New chat" that still
 * deletes. A migration that loses the thread somebody already had. A bound that
 * prunes the conversation being read instead of the one from last week. And the
 * expensive one: history leaking into what gets sent, so twenty stored chats
 * become twenty chats' worth of input tokens on the next question.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_CONVERSATION_TITLE_MAX,
  ASK_HISTORY_MAX_CONVERSATIONS,
  ASK_HISTORY_SOFT_LIMIT_BYTES,
  activeAskConversation,
  appendAskConversationMessage,
  askConversationTitle,
  askConversationTitleFrom,
  askHistoryRows,
  clearAskHistory,
  deleteAskConversation,
  emptyAskHistory,
  groupAskHistory,
  openAskConversation,
  parseAskConversationStore,
  readAskHistory,
  renameAskConversation,
  setAskConversationDraft,
  startAskConversation,
  trimAskHistory,
  writeAskHistory,
  type AskConversation,
  type AskConversationStore,
} from './askChatHistory';
import {
  ASK_CHAT_MAX_MESSAGES,
  askChatStorageKey,
  conversationTurnsFrom,
  type AskChatMessage,
} from './askChatThread';

const TRIP = 'trip-tokyo';
const KEY = askChatStorageKey({ tripId: TRIP, userId: 'u1' });

const message = (
  over: Partial<AskChatMessage> & Pick<AskChatMessage, 'role' | 'text'>,
): AskChatMessage => ({
  id: over.id ?? `id-${over.role}-${over.text}`,
  createdAt: over.createdAt ?? '2026-08-21T10:00:00.000Z',
  ...over,
});

/** One complete exchange, the smallest thing that counts as a conversation. */
const turn = (question: string, answer: string): AskChatMessage[] => [
  message({ role: 'user', text: question, id: `u-${question}` }),
  message({ role: 'assistant', text: answer, id: `a-${question}`, status: 'answered' }),
];

/** A store holding `count` finished conversations, oldest first. */
const withConversations = (count: number, over: Partial<AskConversation> = {}): AskConversationStore => {
  const conversations = Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    tripId: TRIP,
    title: '',
    createdAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
    messages: turn(`question ${index}`, `answer ${index}`),
    ...over,
  }));
  return { activeConversationId: conversations.at(-1)!.id, conversations };
};

describe('New chat archives rather than deletes', () => {
  it('keeps the current conversation and opens a blank one', () => {
    const before = withConversations(1);
    const after = startAskConversation(before, TRIP);

    expect(after.conversations).toHaveLength(2);
    expect(after.activeConversationId).not.toBe(before.activeConversationId);
    expect(activeAskConversation(after).messages).toEqual([]);
    // The archived thread is untouched, messages and all.
    expect(after.conversations.find((entry) => entry.id === 'c0')?.messages)
      .toEqual(before.conversations[0].messages);
  });

  /**
   * Pressing New chat on a blank panel must not stack blank rows. A history
   * full of empty conversations is worse than no history at all.
   */
  it('re-uses the blank conversation instead of stacking another', () => {
    let store = emptyAskHistory(TRIP);
    for (let index = 0; index < 5; index += 1) store = startAskConversation(store, TRIP);
    expect(store.conversations).toHaveLength(1);
  });

  it('clears the draft of the thread it leaves behind only once that thread is empty', () => {
    const started = startAskConversation(
      setAskConversationDraft(withConversations(1), 'c0', 'half a question'),
      TRIP,
    );
    // The archived thread keeps what was typed into it; the new one starts clean.
    expect(started.conversations.find((entry) => entry.id === 'c0')?.draft).toBe('half a question');
    expect(activeAskConversation(started).draft).toBeUndefined();
  });
});

describe('titles cost nothing', () => {
  it('takes the first question rather than asking a model to summarise it', () => {
    expect(askConversationTitleFrom(turn('How much is two of the theme park ticket price', 'a')))
      .toBe('How much is two of the theme park ticket price');
  });

  it('truncates a long question on a word boundary', () => {
    const long = 'How much would it cost for two adults to visit both of the big theme parks next week';
    const title = askConversationTitleFrom(turn(long, 'a'));
    expect(title.length).toBeLessThanOrEqual(ASK_CONVERSATION_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('stops at the first sentence when there is more than one', () => {
    expect(askConversationTitleFrom(turn('Is Day 3 too rushed? I keep worrying about it.', 'a')))
      .toBe('Is Day 3 too rushed?');
  });

  /** A greeting identifies nothing, so the question after it is the title. */
  it('does not title a chat with its opening pleasantry', () => {
    expect(askConversationTitleFrom(turn('Hi. Where should we eat tonight?', 'a')))
      .toBe('Hi. Where should we eat tonight?');
  });

  it('fixes the title when the first question lands, so trimming cannot change it later', () => {
    let store = emptyAskHistory(TRIP);
    const id = store.activeConversationId;
    store = appendAskConversationMessage(store, id, message({ role: 'user', text: 'Where tonight?' }));
    expect(activeAskConversation(store).title).toBe('Where tonight?');

    // Forty more messages push the first one out of the visible thread.
    for (let index = 0; index < 40; index += 1) {
      store = appendAskConversationMessage(store, id, message({
        role: index % 2 === 0 ? 'assistant' : 'user',
        text: `filler ${index}`,
        id: `f${index}`,
        ...(index % 2 === 0 ? { status: 'answered' as const } : {}),
      }));
    }
    const bounded = activeAskConversation(trimAskHistory(store));
    expect(bounded.messages.length).toBeLessThanOrEqual(ASK_CHAT_MAX_MESSAGES);
    expect(bounded.messages.some((entry) => entry.text === 'Where tonight?')).toBe(false);
    expect(bounded.title).toBe('Where tonight?');
  });

  it('shows a name for a thread that has none yet', () => {
    expect(askConversationTitle(emptyAskHistory(TRIP).conversations[0])).toBe('New chat');
  });

  it('prefers a rename over the question it was derived from', () => {
    const renamed = renameAskConversation(withConversations(1), 'c0', '  Theme park day  ');
    expect(askConversationTitle(renamed.conversations[0])).toBe('Theme park day');
  });
});

describe('opening and deleting', () => {
  it('switches the active conversation without touching either thread', () => {
    const store = withConversations(3);
    const opened = openAskConversation(store, 'c0');
    expect(opened.activeConversationId).toBe('c0');
    expect(opened.conversations).toEqual(store.conversations);
  });

  it('ignores an id it does not hold', () => {
    const store = withConversations(2);
    expect(openAskConversation(store, 'nonsense')).toBe(store);
    expect(deleteAskConversation(store, 'nonsense', TRIP)).toBe(store);
  });

  it('deletes one conversation and leaves the rest', () => {
    const after = deleteAskConversation(withConversations(3), 'c0', TRIP);
    expect(after.conversations.map((entry) => entry.id)).toEqual(['c1', 'c2']);
  });

  it('falls back to the newest remaining thread when the active one is deleted', () => {
    const store = withConversations(3);
    const after = deleteAskConversation(store, store.activeConversationId, TRIP);
    expect(after.activeConversationId).toBe('c1');
  });

  /** Never an empty panel with no conversation at all. */
  it('opens a fresh blank thread when the last one is deleted', () => {
    const after = deleteAskConversation(withConversations(1), 'c0', TRIP);
    expect(after.conversations).toHaveLength(1);
    expect(activeAskConversation(after).messages).toEqual([]);
    expect(askHistoryRows(after)).toEqual([]);
  });
});

describe('bounds on one trip’s history', () => {
  it('prunes the oldest conversations past the cap', () => {
    const store = withConversations(ASK_HISTORY_MAX_CONVERSATIONS + 6);
    const trimmed = trimAskHistory(store);
    expect(trimmed.conversations).toHaveLength(ASK_HISTORY_MAX_CONVERSATIONS);
    expect(trimmed.conversations.map((entry) => entry.id)).not.toContain('c0');
    expect(trimmed.conversations.map((entry) => entry.id)).toContain(store.activeConversationId);
  });

  /**
   * The thread on screen survives every rule here. Pruning it would be the
   * storage layer deciding the traveller was finished reading.
   */
  it('keeps the active conversation even when it is the oldest', () => {
    const store = { ...withConversations(ASK_HISTORY_MAX_CONVERSATIONS + 4), activeConversationId: 'c0' };
    const trimmed = trimAskHistory(store);
    expect(trimmed.conversations.map((entry) => entry.id)).toContain('c0');
    expect(trimmed.conversations).toHaveLength(ASK_HISTORY_MAX_CONVERSATIONS);
  });

  it('prunes by size too, because one conversation can be long', () => {
    const heavy = withConversations(8, {});
    heavy.conversations = heavy.conversations.map((conversation, index) => ({
      ...conversation,
      messages: [
        message({ role: 'user', text: `question ${index}`, id: `u${index}` }),
        message({ role: 'assistant', text: 'x'.repeat(60_000), id: `a${index}`, status: 'answered' }),
      ],
    }));
    const trimmed = trimAskHistory(heavy);
    expect(trimmed.conversations.length).toBeLessThan(8);
    expect(trimmed.conversations.map((entry) => entry.id)).toContain(heavy.activeConversationId);
    expect(JSON.stringify(trimmed.conversations).length * 2)
      .toBeLessThanOrEqual(ASK_HISTORY_SOFT_LIMIT_BYTES * 1.2);
  });

  /** Each surviving conversation is still a valid thread, never a half one. */
  it('leaves every remaining conversation well formed', () => {
    const trimmed = trimAskHistory(withConversations(ASK_HISTORY_MAX_CONVERSATIONS + 5));
    for (const conversation of trimmed.conversations) {
      expect(conversation.messages[0]?.role).toBe('user');
      expect(conversation.messages.at(-1)?.role).toBe('assistant');
      expect(conversation.tripId).toBe(TRIP);
    }
  });

  it('drops a blank conversation that is not the one on screen', () => {
    const store = withConversations(2);
    const withBlank: AskConversationStore = {
      ...store,
      conversations: [
        ...store.conversations,
        { id: 'blank', tripId: TRIP, title: '', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', messages: [] },
      ],
    };
    expect(trimAskHistory(withBlank).conversations.map((entry) => entry.id)).not.toContain('blank');
  });
});

describe('reading the stored entry back', () => {
  beforeEach(() => { localStorage.clear(); });

  it('round-trips a history through storage', () => {
    writeAskHistory(KEY, withConversations(3));
    const restored = readAskHistory(KEY, TRIP);
    expect(restored.conversations).toHaveLength(3);
    expect(restored.activeConversationId).toBe('c2');
    expect(restored.conversations.map((entry) => entry.messages[0].text).sort())
      .toEqual(['question 0', 'question 1', 'question 2']);
  });

  it('treats unreadable storage as no history rather than an error', () => {
    for (const raw of [null, '', '{ truncated', '"a string"', '[]', '{"conversations":"nope"}']) {
      const parsed = parseAskConversationStore(raw, TRIP);
      expect(parsed.conversations).toHaveLength(1);
      expect(activeAskConversation(parsed).messages).toEqual([]);
    }
  });

  it('falls back to the newest thread when the stored active id is gone', () => {
    const store = { ...withConversations(3), activeConversationId: 'vanished' };
    writeAskHistory(KEY, store);
    expect(readAskHistory(KEY, TRIP).activeConversationId).toBe('c2');
  });

  /** A stored `tripId` is not authority: the key says which trip this is. */
  it('does not let a stored entry claim another trip', () => {
    writeAskHistory(KEY, withConversations(1, { tripId: 'trip-somewhere-else' }));
    expect(readAskHistory(KEY, TRIP).conversations[0].tripId).toBe(TRIP);
  });

  it('keeps one trip out of another', () => {
    const osaka = askChatStorageKey({ tripId: 'trip-osaka', userId: 'u1' });
    writeAskHistory(KEY, withConversations(2));
    writeAskHistory(osaka, { ...withConversations(1), conversations: [{
      id: 'osaka-1', tripId: 'trip-osaka', title: '', createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z', messages: turn('Osaka question', 'Osaka answer'),
    }] });

    expect(askHistoryRows(readAskHistory(KEY, TRIP))).toHaveLength(2);
    expect(askHistoryRows(readAskHistory(osaka, 'trip-osaka'))).toHaveLength(1);

    clearAskHistory(KEY);
    expect(askHistoryRows(readAskHistory(KEY, TRIP))).toEqual([]);
    expect(askHistoryRows(readAskHistory(osaka, 'trip-osaka'))).toHaveLength(1);
  });

  /** A browser that never used Ask should carry no entry per trip. */
  it('removes the entry instead of storing a skeleton', () => {
    writeAskHistory(KEY, withConversations(1));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    writeAskHistory(KEY, emptyAskHistory(TRIP));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('stores the conversation and not the machinery that produced it', () => {
    writeAskHistory(KEY, withConversations(2));
    const raw = localStorage.getItem(KEY) ?? '';
    for (const forbidden of ['steps', 'transcript', 'proposal', 'grounding', 'rejected', 'prompt', 'sk-']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('never throws when storage refuses to co-operate', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('nope', 'QuotaExceededError');
    });
    expect(() => writeAskHistory(KEY, withConversations(2))).not.toThrow();
    setItem.mockRestore();
  });

  it('is bounded on write, not only in memory', () => {
    writeAskHistory(KEY, withConversations(ASK_HISTORY_MAX_CONVERSATIONS + 8));
    expect(readAskHistory(KEY, TRIP).conversations.length)
      .toBeLessThanOrEqual(ASK_HISTORY_MAX_CONVERSATIONS);
  });

  it('keeps an unsent draft with the thread it was typed into', () => {
    writeAskHistory(KEY, setAskConversationDraft(withConversations(2), 'c0', 'half a question'));
    expect(readAskHistory(KEY, TRIP).conversations.find((entry) => entry.id === 'c0')?.draft)
      .toBe('half a question');
  });
});

describe('the single-thread entry every existing browser is holding', () => {
  beforeEach(() => { localStorage.clear(); });

  /** The previous production shape: a bare array of messages. */
  const legacy = JSON.stringify([
    { id: 'u1', role: 'user', text: 'Where tonight?', createdAt: '2026-08-21T10:00:00.000Z' },
    {
      id: 'a1',
      role: 'assistant',
      text: 'Golden Gai.',
      createdAt: '2026-08-21T10:00:05.000Z',
      status: 'answered',
      places: [{ ref: { canonicalPlaceId: 'canon-a', provider: 'osm', providerPlaceId: 'pp-a' }, name: 'Golden Gai' }],
      placeTokens: [{ canonicalPlaceId: 'canon-a', token: 'signed-a' }],
    },
  ]);

  it('reads as one conversation, with nothing lost', () => {
    localStorage.setItem(KEY, legacy);
    const store = readAskHistory(KEY, TRIP);

    expect(store.conversations).toHaveLength(1);
    const [conversation] = store.conversations;
    expect(store.activeConversationId).toBe(conversation.id);
    expect(conversation.messages.map((entry) => entry.text)).toEqual(['Where tonight?', 'Golden Gai.']);
    expect(askConversationTitle(conversation)).toBe('Where tonight?');
    expect(conversation.createdAt).toBe('2026-08-21T10:00:00.000Z');
    expect(conversation.updatedAt).toBe('2026-08-21T10:00:05.000Z');
    // The place card and the reference that makes a follow-up work both survive.
    expect(conversation.messages[1].places?.[0].name).toBe('Golden Gai');
    expect(conversationTurnsFrom(conversation.messages)[0].trustedPlaceTokens).toEqual(['signed-a']);
  });

  /**
   * Migration writes nothing of its own, so a browser that opens Ask and
   * closes it again must not end up with two copies of the same chat.
   */
  it('is idempotent: reading the old entry twice yields the same conversation', () => {
    localStorage.setItem(KEY, legacy);
    const first = readAskHistory(KEY, TRIP);
    const second = readAskHistory(KEY, TRIP);
    expect(second).toEqual(first);
  });

  it('survives the round trip into the new shape and a New chat after it', () => {
    localStorage.setItem(KEY, legacy);
    const migrated = readAskHistory(KEY, TRIP);
    writeAskHistory(KEY, startAskConversation(migrated, TRIP));

    const reopened = readAskHistory(KEY, TRIP);
    expect(askHistoryRows(reopened)).toHaveLength(1);
    expect(askHistoryRows(reopened)[0].messages.map((entry) => entry.text))
      .toEqual(['Where tonight?', 'Golden Gai.']);
    // The blank thread is the one on screen, so the starter state shows.
    expect(activeAskConversation(reopened).messages).toEqual([]);
  });

  it('reads an empty legacy entry as a clean start', () => {
    localStorage.setItem(KEY, '[]');
    expect(askHistoryRows(readAskHistory(KEY, TRIP))).toEqual([]);
  });
});

describe('history rows', () => {
  it('lists finished conversations newest first, and never the blank one', () => {
    const rows = askHistoryRows(startAskConversation(withConversations(3), TRIP));
    expect(rows.map((entry) => entry.id)).toEqual(['c2', 'c1', 'c0']);
  });

  /** Local dates throughout: "yesterday" is the reader's yesterday, not UTC's. */
  it('groups by the day each chat was last spoken to', () => {
    const now = new Date(2026, 7, 21, 18, 0);
    const at = (when: Date, id: string): AskConversation => ({
      id,
      tripId: TRIP,
      title: '',
      createdAt: when.toISOString(),
      updatedAt: when.toISOString(),
      messages: turn(id, 'a'),
    });
    const groups = groupAskHistory([
      at(new Date(2026, 7, 21, 14, 0), 'today-early'),
      at(new Date(2026, 7, 21, 17, 0), 'today-late'),
      at(new Date(2026, 7, 20, 20, 0), 'yesterday'),
      at(new Date(2026, 7, 2, 20, 0), 'earlier'),
    ], now);

    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'Aug 2']);
    expect(groups[0].conversations.map((entry) => entry.id)).toEqual(['today-late', 'today-early']);
  });
});

describe('history is navigation, not model memory', () => {
  /**
   * The cost guarantee. Twenty archived chats must not become twenty chats'
   * worth of input tokens on the next question: only the thread on screen is
   * ever offered, and only its own bounded window of it.
   */
  it('offers the server nothing from a conversation that is not open', () => {
    const store = openAskConversation(withConversations(6), 'c1');
    const sent = conversationTurnsFrom(activeAskConversation(store).messages);

    expect(sent).toEqual([{ question: 'question 1', answer: 'answer 1' }]);
    const serialised = JSON.stringify(sent);
    for (const index of [0, 2, 3, 4, 5]) {
      expect(serialised).not.toContain(`question ${index}`);
    }
  });
});

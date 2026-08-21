// @vitest-environment jsdom

/**
 * Chat history as a traveller uses it.
 *
 * The behaviour under test is mostly the absence of two things. Nothing is
 * destroyed — "New chat" archives, and the only thing that deletes a
 * conversation is somebody choosing Delete on its row. And nothing is bought:
 * opening the drawer, switching threads, renaming, deleting, reloading the
 * page and switching trips are all `localStorage` operations, so the mock model
 * call count is the assertion that matters in almost every test here.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?'],
  askPlanitenary,
}));

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';
import { askChatStorageKey } from '../lib/askChatThread';

const answer = (text: string, over: Record<string, unknown> = {}) => ({
  status: 'answered',
  answer: text,
  citations: [],
  applied: false,
  steps: [],
  rejectedClaims: 0,
  places: [],
  ...over,
});

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen
    .getAllByRole('button', { name: /ask planitenary/i })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
  if (!trigger) throw new Error('Ask Planitenary launcher not found');
  await user.click(trigger);
};

const ask = async (user: ReturnType<typeof userEvent.setup>, question: string) => {
  await user.type(screen.getByLabelText('Question for Planitenary'), question);
  await user.click(screen.getByRole('button', { name: 'Send question' }));
};

const newChat = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'New chat' }));
};

const openHistory = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Chat history' }));
  return screen.getByRole('dialog', { name: 'Chat history' });
};

/** The titles in the drawer, in the order they are painted. */
const historyTitles = (): string[] =>
  within(screen.getByRole('dialog', { name: 'Chat history' }))
    .getAllByRole('button', { name: /^Open / })
    .map((button) => button.getAttribute('aria-label')?.replace(/^Open /, '') ?? '');

beforeEach(() => {
  askPlanitenary.mockReset();
  localStorage.clear();
});

describe('two chats, side by side', () => {
  /**
   * The headline case from the request: ask, start a new chat, ask again, and
   * both are still there — with the first restored exactly as it was left.
   */
  it('keeps both threads and hands each one back', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Tickets are ¥8,600 each.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');

    await newChat(user);
    await ask(user, 'How much are the theme park tickets?');
    await screen.findByText('Tickets are ¥8,600 each.');

    await openHistory(user);
    expect(historyTitles()).toEqual([
      'How much are the theme park tickets?',
      'Where should we go tonight?',
    ]);

    // Back to the first chat: its question and its answer, both intact.
    await user.click(screen.getByRole('button', { name: 'Open Where should we go tonight?' }));
    expect(await screen.findByText('Golden Gai is lively.')).toBeInTheDocument();
    expect(screen.queryByText('Tickets are ¥8,600 each.')).not.toBeInTheDocument();

    // And forward again to the second.
    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Open How much are the theme park tickets?' }));
    expect(await screen.findByText('Tickets are ¥8,600 each.')).toBeInTheDocument();
    expect(screen.queryByText('Golden Gai is lively.')).not.toBeInTheDocument();

    // Two questions asked, two model calls. Everything else was local.
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });

  /**
   * The cost rule, stated as a test. Opening Chat B must not carry Chat A: a
   * history that fed every archived thread to the model would make the twenty-
   * first question the most expensive one a traveller ever asks.
   */
  it('sends only the open thread when a follow-up is asked in it', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Tickets are ¥8,600 each.'))
      .mockResolvedValueOnce(answer('Yes, book ahead.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    await newChat(user);
    await ask(user, 'How much are the theme park tickets?');
    await screen.findByText('Tickets are ¥8,600 each.');

    await ask(user, 'Should we buy them in advance?');

    const sent = askPlanitenary.mock.calls.at(-1)?.[0] as {
      conversation: Array<{ question: string; answer: string }>;
    };
    expect(sent.conversation).toEqual([{
      question: 'How much are the theme park tickets?',
      answer: 'Tickets are ¥8,600 each.',
    }]);
    expect(JSON.stringify(sent)).not.toContain('Golden Gai');
  });

  it('shows the starter examples only in a chat with nothing in it', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    expect(screen.queryByRole('button', { name: 'What should we do tonight?' })).not.toBeInTheDocument();

    await newChat(user);
    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();

    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Open Where should we go tonight?' }));
    expect(screen.queryByRole('button', { name: 'What should we do tonight?' })).not.toBeInTheDocument();
  });
});

describe('history survives a refresh', () => {
  it('restores the active chat and every archived one, resending nothing', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Tickets are ¥8,600 each.'));
    const user = userEvent.setup();
    const { unmount } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    await newChat(user);
    await ask(user, 'How much are the theme park tickets?');
    await screen.findByText('Tickets are ¥8,600 each.');

    // A refresh is the component going away and coming back with storage intact.
    unmount();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    expect(await screen.findByText('Tickets are ¥8,600 each.')).toBeInTheDocument();
    await openHistory(user);
    expect(historyTitles()).toEqual([
      'How much are the theme park tickets?',
      'Where should we go tonight?',
    ]);
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });
});

describe('history belongs to one trip', () => {
  it('does not mix Tokyo’s chats with Osaka’s', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Tokyo one.'))
      .mockResolvedValueOnce(answer('Tokyo two.'))
      .mockResolvedValueOnce(answer('Osaka one.'));
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Chat A question');
    await screen.findByText('Tokyo one.');
    await newChat(user);
    await ask(user, 'Chat B question');
    await screen.findByText('Tokyo two.');

    rerender(<AskPlanitenaryPanel tripId="trip-osaka" />);
    await ask(user, 'Chat C question');
    await screen.findByText('Osaka one.');

    await openHistory(user);
    expect(historyTitles()).toEqual(['Chat C question']);
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    rerender(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openHistory(user);
    expect(historyTitles()).toEqual(['Chat B question', 'Chat A question']);

    // Each trip's entry holds only its own chats.
    const tokyo = localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' })) ?? '';
    const osaka = localStorage.getItem(askChatStorageKey({ tripId: 'trip-osaka' })) ?? '';
    expect(tokyo).toContain('Chat A question');
    expect(tokyo).not.toContain('Chat C question');
    expect(osaka).toContain('Chat C question');
    expect(osaka).not.toContain('Chat A question');
  });
});

describe('the conversation a browser already had', () => {
  /** Exactly the shape shipped before history existed: a bare message array. */
  const seedLegacy = (tripId: string) => {
    localStorage.setItem(askChatStorageKey({ tripId }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Is Day 3 too rushed?', createdAt: '2026-08-20T10:00:00.000Z' },
      { id: 'a1', role: 'assistant', text: 'It has four stops before noon.', createdAt: '2026-08-20T10:00:05.000Z', status: 'answered' },
    ]));
  };

  it('becomes the first entry in history, with nothing lost', async () => {
    const user = userEvent.setup();
    seedLegacy('trip-tokyo');
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    expect(await screen.findByText('It has four stops before noon.')).toBeInTheDocument();
    await openHistory(user);
    expect(historyTitles()).toEqual(['Is Day 3 too rushed?']);
    expect(askPlanitenary).not.toHaveBeenCalled();
  });

  it('is still in history after a New chat on top of it', async () => {
    askPlanitenary.mockResolvedValue(answer('Somewhere quiet, then.'));
    const user = userEvent.setup();
    seedLegacy('trip-tokyo');
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await screen.findByText('It has four stops before noon.');

    await newChat(user);
    await ask(user, 'Where else could we go?');
    await screen.findByText('Somewhere quiet, then.');

    await openHistory(user);
    expect(historyTitles()).toEqual(['Where else could we go?', 'Is Day 3 too rushed?']);

    await user.click(screen.getByRole('button', { name: 'Open Is Day 3 too rushed?' }));
    expect(await screen.findByText('It has four stops before noon.')).toBeInTheDocument();
  });
});

describe('renaming and deleting', () => {
  const twoChats = async (user: ReturnType<typeof userEvent.setup>) => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Tickets are ¥8,600 each.'));
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    await newChat(user);
    await ask(user, 'How much are the theme park tickets?');
    await screen.findByText('Tickets are ¥8,600 each.');
  };

  it('renames a chat locally, with no model call', async () => {
    const user = userEvent.setup();
    await twoChats(user);
    await openHistory(user);

    await user.click(screen.getByRole('button', { name: 'Rename Where should we go tonight?' }));
    const field = screen.getByLabelText('Rename chat');
    await user.clear(field);
    await user.type(field, 'Tokyo nightlife');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(historyTitles()).toEqual(['How much are the theme park tickets?', 'Tokyo nightlife']);
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });

  it('asks before deleting, and keeps the chat when told to', async () => {
    const user = userEvent.setup();
    await twoChats(user);
    await openHistory(user);

    await user.click(screen.getByRole('button', { name: 'Delete Where should we go tonight?' }));
    expect(screen.getByText(/Delete this chat\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(historyTitles()).toHaveLength(2);
  });

  it('deletes one chat and only that chat', async () => {
    const user = userEvent.setup();
    await twoChats(user);
    await openHistory(user);

    await user.click(screen.getByRole('button', { name: 'Delete Where should we go tonight?' }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    expect(historyTitles()).toEqual(['How much are the theme park tickets?']);
    const stored = localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' })) ?? '';
    expect(stored).not.toContain('Where should we go tonight?');
    expect(stored).toContain('How much are the theme park tickets?');
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });

  /** Deleting what is on screen must land somewhere, never on nothing. */
  it('falls back to the newest remaining chat when the open one is deleted', async () => {
    const user = userEvent.setup();
    await twoChats(user);
    await openHistory(user);

    await user.click(screen.getByRole('button', { name: 'Delete How much are the theme park tickets?' }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(await screen.findByText('Golden Gai is lively.')).toBeInTheDocument();
  });

  it('leaves a clean starter panel when the last chat is deleted', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');

    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Delete Where should we go tonight?' }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(screen.queryByText('Golden Gai is lively.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toBeNull();
  });
});

describe('the composer follows the chat it belongs to', () => {
  it('gives a half-typed question back when its chat is reopened', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Tickets are ¥8,600 each.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    await newChat(user);
    await ask(user, 'How much are the theme park tickets?');
    await screen.findByText('Tickets are ¥8,600 each.');

    // Half a question, unsent, in the ticket chat.
    await user.type(screen.getByLabelText('Question for Planitenary'), 'and how do we get');

    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Open Where should we go tonight?' }));
    expect(screen.getByLabelText('Question for Planitenary')).toHaveValue('');

    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Open How much are the theme park tickets?' }));
    expect(screen.getByLabelText('Question for Planitenary')).toHaveValue('and how do we get');
    // Nothing typed was ever sent.
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });
});

describe('the history drawer itself', () => {
  it('says so plainly when there is nothing in it yet', async () => {
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    const drawer = await openHistory(user);

    expect(within(drawer).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(drawer).getByText(/kept on this device/i)).toBeInTheDocument();
    expect(askPlanitenary).not.toHaveBeenCalled();
  });

  /**
   * The drawer scrolls on its own. Without containment the wheel hands off at
   * the end of the list and starts scrolling the itinerary behind the panel,
   * which reads as "the drawer will not scroll".
   */
  it('scrolls itself rather than the itinerary behind it', async () => {
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    const drawer = await openHistory(user);

    const scrollRegion = drawer.querySelector<HTMLElement>('[data-lenis-prevent]');
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion).toHaveAttribute('data-lenis-prevent-wheel');
    expect(scrollRegion).toHaveAttribute('data-lenis-prevent-touch');
    expect(scrollRegion?.className).toContain('overscroll-contain');
    expect(scrollRegion).toHaveStyle({ touchAction: 'pan-y' });
    // The page underneath is still held still.
    expect(document.body.style.overflow).toBe('hidden');
  });

  /**
   * The drawer covers the conversation, not the header. Reading an old chat
   * must never be a one-way door: New chat and Close are still one press away.
   */
  it('leaves the panel controls reachable while it is open', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    await openHistory(user);

    const panel = screen.getByRole('dialog', { name: 'Ask Planitenary' });
    expect(within(panel).getByRole('button', { name: 'Chat history' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByRole('button', { name: 'Close Ask Planitenary' })).toBeEnabled();

    // New chat works straight from the drawer, and puts the conversation back.
    await user.click(within(panel).getByRole('button', { name: 'New chat' }));
    expect(screen.queryByRole('dialog', { name: 'Chat history' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();
  });

  it('closes back to the conversation without leaving the itinerary', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');

    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(screen.queryByRole('dialog', { name: 'Chat history' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ask Planitenary' })).toBeInTheDocument();
    expect(screen.getByText('Golden Gai is lively.')).toBeInTheDocument();
  });

  it('shows no ids or internal state on a row', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where should we go tonight?');
    await screen.findByText('Golden Gai is lively.');
    const drawer = await openHistory(user);

    const row = within(drawer).getAllByRole('listitem')[0].textContent ?? '';
    expect(row).toContain('Where should we go tonight?');
    expect(row).toContain('Golden Gai is lively.');
    for (const leak of ['trip-tokyo', 'activeConversationId', 'placeTokens', 'createdAt']) {
      expect(row).not.toContain(leak);
    }
  });
});

describe('bounded, so a browser cannot fill up on chat logs', () => {
  /**
   * Past the cap, the oldest inactive conversations go first and the one on
   * screen stays. Seeded through storage rather than twenty-two typed
   * questions, which would be a minute of test time for the same assertion.
   */
  it('prunes the oldest chats and keeps the open one', async () => {
    const conversations = Array.from({ length: 26 }, (_, index) => ({
      id: `c${index}`,
      tripId: 'trip-tokyo',
      createdAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
      messages: [
        { id: `u${index}`, role: 'user', text: `Question ${index}`, createdAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString() },
        { id: `a${index}`, role: 'assistant', text: `Answer ${index}`, createdAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(), status: 'answered' },
      ],
    }));
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-tokyo' }), JSON.stringify({
      v: 2,
      activeConversationId: 'c25',
      conversations,
    }));

    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    expect(await screen.findByText('Answer 25')).toBeInTheDocument();

    await openHistory(user);
    const titles = historyTitles();
    expect(titles).toHaveLength(20);
    expect(titles[0]).toBe('Question 25');
    expect(titles).not.toContain('Question 0');
    expect(titles).not.toContain('Question 5');
    expect(askPlanitenary).not.toHaveBeenCalled();
  });
});

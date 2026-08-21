// @vitest-environment jsdom

/**
 * Ask as a conversation rather than a question box.
 *
 * The behaviour under test is mostly about what does *not* happen: a
 * follow-up must not clear the answer above it, reopening the panel must not
 * cost a model call, and a message restored from this browser's own storage
 * must not become something the server treats as true.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?', 'Is tomorrow too tiring?'],
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

const refusal = (detail: string) => ({
  status: 'refused',
  citations: [],
  applied: false,
  steps: [],
  rejectedClaims: 0,
  places: [],
  detail,
});

/**
 * The backdrop is labelled "Close Ask Planitenary" and the trigger renders its
 * name twice for responsive reasons, so neither an exact string nor the
 * obvious regex identifies the launcher on its own. `aria-haspopup` does.
 */
const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen
    .getAllByRole('button', { name: /ask planitenary/i })
    .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
  if (!trigger) throw new Error('Ask Planitenary launcher not found');
  await user.click(trigger);
};

/** The backdrop shares this label, so reach for the one inside the dialog. */
const closePanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close Ask Planitenary' }),
  );
};

const ask = async (user: ReturnType<typeof userEvent.setup>, question: string) => {
  await user.type(screen.getByLabelText('Question for Planitenary'), question);
  await user.click(screen.getByRole('button', { name: 'Send question' }));
};

/** The conversation in the order it is painted. */
const spokenOrder = (): string[] =>
  within(screen.getByRole('list', { name: 'Conversation' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('Ask keeps the conversation', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    localStorage.clear();
  });

  it('appends each turn instead of replacing the one before it', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('You could head to Golden Gai.'))
      .mockResolvedValueOnce(answer('If you want somewhere quieter than those, try the garden.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" tripName="Tokyo days" />);
    await openPanel(user);

    await ask(user, 'What should I do after Shinjuku?');
    expect(await screen.findByText('You could head to Golden Gai.')).toBeInTheDocument();

    await ask(user, 'What about somewhere quieter?');
    expect(await screen.findByText(/try the garden/)).toBeInTheDocument();

    // Everything, in the order it was said. The first answer is still there.
    const order = spokenOrder();
    expect(order[0]).toContain('What should I do after Shinjuku?');
    expect(order[1]).toContain('You could head to Golden Gai.');
    expect(order[2]).toContain('What about somewhere quieter?');
    expect(order[3]).toContain('try the garden');
  });

  /**
   * The point of the whole feature: the second question is answerable only
   * because the first exchange travelled with it.
   */
  it('sends the preceding turn so a follow-up can be understood', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('Quieter: the garden.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    await ask(user, 'Suggest somewhere quiet near Shinjuku.');
    await screen.findByText('Golden Gai is lively.');
    await ask(user, 'What about somewhere cheaper?');

    expect(askPlanitenary).toHaveBeenLastCalledWith(expect.objectContaining({
      question: 'What about somewhere cheaper?',
      conversation: [{
        question: 'Suggest somewhere quiet near Shinjuku.',
        answer: 'Golden Gai is lively.',
      }],
    }));
  });

  /**
   * Visible history is allowed to outgrow the model context. If it did not,
   * every follow-up would cost more than the one before it.
   */
  it('never sends more than the bounded window, however long the thread', async () => {
    askPlanitenary.mockImplementation(async () => answer('Noted.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    // Six turns: comfortably more than the window, few enough that this stays
    // a fast test rather than six seconds of sequential typing.
    for (let index = 0; index < 6; index += 1) {
      await ask(user, `Question number ${index}`);
      await screen.findAllByText('Noted.');
    }

    const lastCall = askPlanitenary.mock.calls.at(-1)?.[0] as { conversation: unknown[] };
    expect(lastCall.conversation).toHaveLength(4);
    // All seven questions remain readable even though four turns were sent.
    expect(spokenOrder().filter((line) => line.includes('Question number'))).toHaveLength(6);
  }, 15_000);

  it('keeps the earlier conversation when an ask fails', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(refusal('The daily AI request allowance is spent.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');
    await ask(user, 'And tomorrow?');

    expect(await screen.findByText('The daily AI request allowance is spent.')).toBeInTheDocument();
    expect(screen.getByText('Golden Gai is lively.')).toBeInTheDocument();
    expect(screen.getByText('Where tonight?')).toBeInTheDocument();
    // The question that failed stays on screen too, so it can be reworded.
    expect(screen.getByText('And tomorrow?')).toBeInTheDocument();
  });

  it('offers starter suggestions only while the conversation is empty', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();
    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');
    expect(screen.queryByRole('button', { name: 'What should we do tonight?' })).not.toBeInTheDocument();
  });
});

describe('the conversation survives the panel and the page', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    localStorage.clear();
  });

  it('is still there after closing and reopening, with no new model call', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);
    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');
    expect(askPlanitenary).toHaveBeenCalledTimes(1);

    await closePanel(user);
    await openPanel(user);

    expect(await screen.findByText('Golden Gai is lively.')).toBeInTheDocument();
    expect(screen.getByText('Where tonight?')).toBeInTheDocument();
    expect(askPlanitenary).toHaveBeenCalledTimes(1);
  });

  it('is still there after a browser refresh, with no new model call', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    const { unmount } = render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);
    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');

    // A refresh is the component going away and coming back with storage intact.
    unmount();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    expect(await screen.findByText('Golden Gai is lively.')).toBeInTheDocument();
    expect(askPlanitenary).toHaveBeenCalledTimes(1);
  });

  it('gives each trip its own conversation, and hands each one back', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Tokyo answer.'))
      .mockResolvedValueOnce(answer('Osaka answer.'));
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-tokyo" tripName="Tokyo" />);
    await openPanel(user);
    await ask(user, 'Tokyo question');
    await screen.findByText('Tokyo answer.');

    rerender(<AskPlanitenaryPanel tripId="trip-osaka" tripName="Osaka" />);
    // Nothing from Tokyo leaks into Osaka, and switching costs no model call.
    expect(screen.queryByText('Tokyo answer.')).not.toBeInTheDocument();
    expect(screen.queryByText('Tokyo question')).not.toBeInTheDocument();
    expect(askPlanitenary).toHaveBeenCalledTimes(1);

    await ask(user, 'Osaka question');
    await screen.findByText('Osaka answer.');

    rerender(<AskPlanitenaryPanel tripId="trip-tokyo" tripName="Tokyo" />);
    expect(await screen.findByText('Tokyo answer.')).toBeInTheDocument();
    expect(screen.queryByText('Osaka answer.')).not.toBeInTheDocument();
    expect(askPlanitenary).toHaveBeenCalledTimes(2);
  });

  it('does not write one trip’s conversation under another trip’s key', async () => {
    askPlanitenary.mockResolvedValue(answer('Tokyo answer.'));
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Tokyo question');
    await screen.findByText('Tokyo answer.');

    rerender(<AskPlanitenaryPanel tripId="trip-osaka" />);

    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-osaka' }))).toBeNull();
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toContain('Tokyo question');
  });
});

describe('New chat', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    localStorage.clear();
  });

  /**
   * The change this whole feature turns on. "New chat" used to be the only way
   * to ask about something else, and it cost you the conversation you already
   * had — so a traveller had to choose between keeping the ticket prices they
   * worked out and asking about dinner.
   */
  it('archives the current conversation instead of deleting it', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Golden Gai is lively.'))
      .mockResolvedValueOnce(answer('The garden opens at nine.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    // A blank thread, with the starter examples back — and nothing destroyed.
    expect(screen.queryByText('Golden Gai is lively.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toContain('Where tonight?');

    await ask(user, 'And in the morning?');
    await screen.findByText('The garden opens at nine.');

    // Both threads are in history, newest first, titled from their questions.
    await user.click(screen.getByRole('button', { name: 'Chat history' }));
    const rows = within(screen.getByRole('dialog', { name: 'Chat history' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('And in the morning?');
    expect(rows[1]).toContain('Where tonight?');
  });

  it('touches nothing belonging to another trip', async () => {
    askPlanitenary
      .mockResolvedValueOnce(answer('Tokyo answer.'))
      .mockResolvedValueOnce(answer('Osaka answer.'));
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Tokyo question');
    await screen.findByText('Tokyo answer.');

    rerender(<AskPlanitenaryPanel tripId="trip-osaka" />);
    await ask(user, 'Osaka question');
    await screen.findByText('Osaka answer.');

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(screen.queryByText('Osaka answer.')).not.toBeInTheDocument();
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toContain('Tokyo question');

    rerender(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    expect(await screen.findByText('Tokyo answer.')).toBeInTheDocument();
  });

  /**
   * Pressing it twice on a blank panel must not stack blank rows: a history
   * full of empty chats is worse than no history at all.
   */
  it('does not stack empty chats', async () => {
    askPlanitenary.mockResolvedValue(answer('Golden Gai is lively.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(askPlanitenary).not.toHaveBeenCalled();

    await ask(user, 'Where tonight?');
    await screen.findByText('Golden Gai is lively.');

    await user.click(screen.getByRole('button', { name: 'Chat history' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Chat history' })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });
});

describe('restored history is conversation, never authority', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    localStorage.clear();
  });

  /**
   * The stored thread is text this browser had write access to. It may be
   * displayed, and it may remind the model what "that place" meant — but the
   * only thing that reaches the server is `{ question, answer }`, so there is
   * no field for a fabricated identity to travel in.
   */
  it('sends no fabricated place identity from a tampered thread', async () => {
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-42' }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Where should I go?', createdAt: '2026-08-21T10:00:00.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Try the rooftop.',
        createdAt: '2026-08-21T10:00:05.000Z',
        status: 'answered',
        places: [{
          ref: { canonicalPlaceId: 'canon-forged', provider: 'osm', providerPlaceId: 'forged-1' },
          name: 'Forged Place',
          coordinates: [1.234, 5.678],
          image: { url: 'https://cdn.attacker.example/pixel.jpg', attribution: 'x', sourcePage: 'https://attacker.example/f' },
        }],
      },
    ]));

    askPlanitenary.mockResolvedValue(answer('Checked against the trip.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);
    await ask(user, 'Is that near Shibuya?');

    const sent = JSON.stringify(askPlanitenary.mock.calls.at(-1)?.[0]);
    expect(sent).not.toContain('canon-forged');
    expect(sent).not.toContain('forged-1');
    expect(sent).not.toContain('1.234');
    expect(sent).toContain('Try the rooftop.');
  });

  it('will not load a photograph from a host nobody vouched for', async () => {
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-42' }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Where should I go?', createdAt: '2026-08-21T10:00:00.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Try the rooftop.',
        createdAt: '2026-08-21T10:00:05.000Z',
        places: [{
          ref: { canonicalPlaceId: 'canon-forged', provider: 'osm', providerPlaceId: 'forged-1' },
          name: 'Forged Place',
          image: { url: 'https://cdn.attacker.example/pixel.jpg', attribution: 'x', sourcePage: 'https://attacker.example/f' },
        }],
      },
    ]));

    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    expect(await screen.findByText('Try the rooftop.')).toBeInTheDocument();
    for (const image of screen.queryAllByRole('img')) {
      expect(image.getAttribute('src') ?? '').not.toContain('attacker.example');
    }
  });

  it('shows nothing at all for a corrupted thread, and still works', async () => {
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-42' }), '{ truncated json');
    askPlanitenary.mockResolvedValue(answer('Still fine.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);

    expect(screen.getByRole('button', { name: 'What should we do tonight?' })).toBeInTheDocument();
    await ask(user, 'Where tonight?');
    expect(await screen.findByText('Still fine.')).toBeInTheDocument();
  });
});

describe('restoring a conversation costs nothing', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    localStorage.clear();
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-42' }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Where tonight?', createdAt: '2026-08-21T10:00:00.000Z' },
      { id: 'a1', role: 'assistant', text: 'Golden Gai.', createdAt: '2026-08-21T10:00:05.000Z', status: 'answered' },
    ]));
  });

  /**
   * Every Ask is an independently metered server request. Reading a
   * conversation back is a `localStorage` parse, and must never look like one.
   */
  it('makes no model call for open, close, reopen, trip switch, history or New chat', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-42" />);

    await openPanel(user);
    expect(await screen.findByText('Golden Gai.')).toBeInTheDocument();

    await closePanel(user);
    await openPanel(user);
    rerender(<AskPlanitenaryPanel tripId="trip-other" />);
    rerender(<AskPlanitenaryPanel tripId="trip-42" />);

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await user.click(screen.getByRole('button', { name: 'Chat history' }));
    await user.click(screen.getByRole('button', { name: 'Open Where tonight?' }));

    expect(await screen.findByText('Golden Gai.')).toBeInTheDocument();
    expect(askPlanitenary).not.toHaveBeenCalled();
  });

  it('spends a call only when Send is pressed', async () => {
    askPlanitenary.mockResolvedValue(answer('One call.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-42" />);
    await openPanel(user);
    expect(askPlanitenary).not.toHaveBeenCalled();

    await ask(user, 'Anything else?');
    await screen.findByText('One call.');
    expect(askPlanitenary).toHaveBeenCalledTimes(1);
  });
});

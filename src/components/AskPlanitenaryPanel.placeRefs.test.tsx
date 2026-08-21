// @vitest-environment jsdom

/**
 * The conversation this whole mechanism exists for.
 *
 * "Suggest two places" → "which of those is better?" → "is the second one open
 * late?" has to work for places that were never saved to the trip, and it has
 * to work without the browser ever being allowed to say what a place is. What
 * these tests watch is the wire: what leaves the device on each follow-up, and
 * what a tampered device can and cannot make happen.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', () => ({
  ASK_SUGGESTIONS: ['What should we do tonight?'],
  askPlanitenary,
}));

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';
import { askChatStorageKey } from '../lib/askChatThread';

const card = (canonicalPlaceId: string, name: string) => ({
  ref: { canonicalPlaceId, provider: 'osm', providerPlaceId: `pp-${canonicalPlaceId}` },
  name,
  city: 'Tokyo',
});

const twoPlaces = () => ({
  status: 'answered',
  answer: 'Ameya-Yokocho is lively; Shinjuku Gyoen is quiet.',
  citations: [],
  applied: false,
  steps: [],
  rejectedClaims: 0,
  places: [card('canon-ameya', 'Ameya-Yokocho'), card('canon-gyoen', 'Shinjuku Gyoen')],
  placeTokens: [
    { canonicalPlaceId: 'canon-ameya', token: 'signed-ameya' },
    { canonicalPlaceId: 'canon-gyoen', token: 'signed-gyoen' },
  ],
});

const plainAnswer = (answer: string) => ({
  status: 'answered', answer, citations: [], applied: false,
  steps: [], rejectedClaims: 0, places: [], placeTokens: [],
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

const lastCall = () => askPlanitenary.mock.calls.at(-1)?.[0] as {
  question: string;
  conversation: Array<{ question: string; answer: string; trustedPlaceTokens?: string[] }>;
};

beforeEach(() => {
  askPlanitenary.mockReset();
  localStorage.clear();
});

describe('a follow-up about places that were never saved', () => {
  it('carries the previous answer’s references, in the order shown', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('The garden is better for the evening.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);

    await ask(user, 'Which of those is better for the evening?');

    const [turn] = lastCall().conversation;
    expect(turn.trustedPlaceTokens).toEqual(['signed-ameya', 'signed-gyoen']);
  });

  /** "The second one" only means anything if the order is preserved. */
  it('keeps the ordering stable across a second follow-up', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('The garden is better for the evening.'))
      .mockResolvedValueOnce(plainAnswer('It closes at 18:00.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);

    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);
    await ask(user, 'Which of those is better for the evening?');
    await screen.findByText('The garden is better for the evening.');
    await ask(user, 'Is the second one open late?');

    // The card-bearing turn still carries both, unchanged and in order. The
    // answer in between carried none, which is what makes it unambiguous.
    const conversation = lastCall().conversation;
    expect(conversation.at(-2)?.trustedPlaceTokens).toEqual(['signed-ameya', 'signed-gyoen']);
    expect(conversation.at(-1)?.trustedPlaceTokens).toBeUndefined();
  });

  it('survives a refresh, tokens included', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('Still here.'));
    const user = userEvent.setup();
    const { unmount } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);

    unmount();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    expect(await screen.findByText(/Ameya-Yokocho is lively/)).toBeInTheDocument();

    await ask(user, 'Is that one open late?');
    expect(lastCall().conversation[0].trustedPlaceTokens).toEqual(['signed-ameya', 'signed-gyoen']);
  });

  it('still shows both cards under the answer that produced them', async () => {
    askPlanitenary.mockResolvedValue(twoPlaces());
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');

    expect(await screen.findByText('Ameya-Yokocho')).toBeInTheDocument();
    expect(screen.getByText('Shinjuku Gyoen')).toBeInTheDocument();
  });
});

describe('what a tampered device can and cannot do', () => {
  /**
   * G and H. The browser may fabricate a card and it may fabricate an id, but
   * neither has anywhere to go: the request carries two strings and opaque
   * tokens, and there is no field for an identity to travel in.
   */
  it('sends no fabricated identity even when storage is full of it', async () => {
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-tokyo' }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Where?', createdAt: '2026-08-21T10:00:00.000Z' },
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
        }],
        // No token at all: a card the browser invented has nothing to carry.
      },
    ]));

    askPlanitenary.mockResolvedValue(plainAnswer('Checked against the trip.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Is that near Shibuya?');

    const sent = JSON.stringify(lastCall());
    for (const forged of ['canon-forged', 'forged-1', '1.234']) {
      expect(sent).not.toContain(forged);
    }
    expect(lastCall().conversation[0].trustedPlaceTokens).toBeUndefined();
  });

  /**
   * A forged token travels — this side cannot tell it from a real one, and
   * pretending otherwise would be security theatre. It is refused by the
   * server that signed the real ones, which is the only place that can.
   */
  it('passes a forged token through untouched rather than pretending to check it', async () => {
    localStorage.setItem(askChatStorageKey({ tripId: 'trip-tokyo' }), JSON.stringify([
      { id: 'u1', role: 'user', text: 'Where?', createdAt: '2026-08-21T10:00:00.000Z' },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Try the rooftop.',
        createdAt: '2026-08-21T10:00:05.000Z',
        status: 'answered',
        places: [card('canon-forged', 'Forged Place')],
        placeTokens: [{ canonicalPlaceId: 'canon-forged', token: 'v1.forged.forged' }],
      },
    ]));

    askPlanitenary.mockResolvedValue(plainAnswer('Researched afresh.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Is that open late?');

    expect(lastCall().conversation[0].trustedPlaceTokens).toEqual(['v1.forged.forged']);
    // The identity beside it still never leaves.
    expect(JSON.stringify(lastCall())).not.toContain('canon-forged');
  });

  /**
   * A token whose authority has lapsed costs the shortcut, never the
   * conversation. The traveller keeps their answer and their cards, and is
   * told nothing about signatures.
   */
  it('keeps the conversation readable when a reference can no longer be used', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('I could not verify that place, so I looked again.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);
    await ask(user, 'Is that one open late?');

    expect(await screen.findByText(/I could not verify that place/)).toBeInTheDocument();
    // Everything above it survives, cards included.
    expect(screen.getByText(/Ameya-Yokocho is lively/)).toBeInTheDocument();
    expect(screen.getByText('Ameya-Yokocho')).toBeInTheDocument();
    expect(screen.getByText('Shinjuku Gyoen')).toBeInTheDocument();
    for (const leak of [/signature/i, /token/i, /expired/i]) {
      expect(screen.queryByText(leak)).not.toBeInTheDocument();
    }
  });
});

describe('references are scoped and clearable', () => {
  it('does not carry one trip’s references into another', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('Osaka answer.'));
    const user = userEvent.setup();
    const { rerender } = render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);

    rerender(<AskPlanitenaryPanel tripId="trip-osaka" />);
    await ask(user, 'What about here?');

    expect(lastCall().conversation).toEqual([]);
  });

  /**
   * New chat archives rather than deletes, so a reference does not lose its
   * authority because somebody asked about something else in between. What
   * ends it is the signature's own expiry, on the server that minted it.
   */
  it('New chat keeps the stored references with the chat they belong to', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('Noted.'))
      .mockResolvedValueOnce(plainAnswer('It closes at 18:00.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toContain('signed-ameya');

    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await ask(user, 'Something else entirely');
    await screen.findByText('Noted.');

    // The new thread starts clean: the archived chat's references are not its.
    expect(lastCall().conversation.at(-1)?.trustedPlaceTokens).toBeUndefined();
    expect(localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' }))).toContain('signed-ameya');

    // Reopening the old chat restores its cards and its follow-up capability.
    await user.click(screen.getByRole('button', { name: 'Chat history' }));
    await user.click(screen.getByRole('button', { name: /^Open Suggest two places/ }));
    expect(await screen.findByText('Ameya-Yokocho')).toBeInTheDocument();

    await ask(user, 'Is the second one open late?');
    expect(lastCall().conversation[0].trustedPlaceTokens).toEqual(['signed-ameya', 'signed-gyoen']);
  });

  it('deleting one chat leaves the other trip and the other chat alone', async () => {
    askPlanitenary
      .mockResolvedValueOnce(twoPlaces())
      .mockResolvedValueOnce(plainAnswer('Second thread.'));
    const user = userEvent.setup();
    render(<AskPlanitenaryPanel tripId="trip-tokyo" />);
    await openPanel(user);
    await ask(user, 'Suggest two places near Shinjuku.');
    await screen.findByText(/Ameya-Yokocho is lively/);
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await ask(user, 'Anything else?');
    await screen.findByText('Second thread.');

    await user.click(screen.getByRole('button', { name: 'Chat history' }));
    await user.click(screen.getByRole('button', { name: /^Delete Suggest two places/ }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    const stored = localStorage.getItem(askChatStorageKey({ tripId: 'trip-tokyo' })) ?? '';
    expect(stored).not.toContain('signed-ameya');
    expect(stored).toContain('Anything else?');
  });
});

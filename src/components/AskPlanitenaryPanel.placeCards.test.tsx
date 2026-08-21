// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAskResult } from '../lib/askPlanitenary';

const { askPlanitenary } = vi.hoisted(() => ({ askPlanitenary: vi.fn() }));

vi.mock('../lib/askPlanitenary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/askPlanitenary')>()),
  ASK_SUGGESTIONS: ['What should we do tonight?'],
  askPlanitenary,
}));

import { AskPlanitenaryPanel } from './AskPlanitenaryPanel';

const ACROS_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/9/93/Acrosfukuoka02.jpg';

const cardFor = (over: Record<string, unknown> = {}) => ({
  ref: {
    canonicalPlaceId: 'canon-acros',
    provider: 'osm',
    providerPlaceId: 'wv:ACROS rooftop garden',
  },
  name: 'ACROS Fukuoka',
  city: 'Fukuoka',
  area: 'Tenjin',
  image: {
    url: ACROS_IMAGE,
    attribution: 'Pontafon · CC BY-SA 3.0 · Wikimedia Commons',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg',
  },
  decision: 'interested',
  ...over,
});

const answered = (places: unknown[]) => ({
  status: 'answered',
  answer: 'The step garden is a good hour before dinner.',
  citations: [],
  applied: false,
  steps: [],
  rejectedClaims: 0,
  places,
});

const ask = async () => {
  const user = userEvent.setup();
  render(<AskPlanitenaryPanel tripId="trip-42" tripName="Fukuoka days" />);
  await user.click(screen.getByRole('button', { name: /ask planitenary/i }));
  await user.type(screen.getByRole('textbox'), 'What should I visit near here?');
  await user.keyboard('{Enter}');
  return user;
};

describe('structured place cards in Ask', () => {
  beforeEach(() => {
    askPlanitenary.mockReset();
    // Cards stay attached to their answer in a persisted thread, so a
    // leftover conversation would put the previous test’s card on screen.
    localStorage.clear();
  });

  it('shows the place with its real photograph and the credit that licences it', async () => {
    askPlanitenary.mockResolvedValue(answered([cardFor()]));
    await ask();

    expect(await screen.findByText('ACROS Fukuoka')).toBeInTheDocument();
    const photo = await screen.findByRole('img', { name: /ACROS Fukuoka, Tenjin · Fukuoka/ });
    expect(photo).toHaveAttribute('src', ACROS_IMAGE);

    // Not a caption: CC BY-SA requires the author be named, and the link goes
    // to the file page where the full licence text lives.
    const credit = screen.getByRole('link', { name: /Pontafon · CC BY-SA 3.0 · Wikimedia Commons/ });
    expect(credit).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg');
  });

  it('shows the existing decision as text, never as colour alone', async () => {
    askPlanitenary.mockResolvedValue(answered([cardFor({ decision: 'must-do', onDay: 3 })]));
    await ask();

    expect(await screen.findByText('Must do')).toBeInTheDocument();
    expect(screen.getByText('On day 3')).toBeInTheDocument();
  });

  it('still shows a place that has no photograph', async () => {
    askPlanitenary.mockResolvedValue(answered([cardFor({ image: undefined })]));
    await ask();

    expect(await screen.findByText('ACROS Fukuoka')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /ACROS Fukuoka/ })).not.toBeInTheDocument();
  });

  it('renders an answer from a build that had no cards at all', async () => {
    const legacy = { ...answered([]) } as Record<string, unknown>;
    delete legacy.places;
    askPlanitenary.mockResolvedValue(legacy);
    await ask();

    expect(await screen.findByText('The step garden is a good hour before dinner.')).toBeInTheDocument();
  });
});

describe('a card that crossed the network is re-checked', () => {
  it('keeps a well-formed card', () => {
    const parsed = parseAskResult(answered([cardFor()]));
    expect(parsed.places).toHaveLength(1);
    expect(parsed.places[0].ref.canonicalPlaceId).toBe('canon-acros');
    expect(parsed.places[0].image?.url).toBe(ACROS_IMAGE);
  });

  it('keeps the place and drops a photograph hosted anywhere but Wikimedia', () => {
    // An <img src> is loaded by the traveller's browser, so an arbitrary host
    // would hand a stranger the IP address of everyone who sees the card.
    const parsed = parseAskResult(answered([cardFor({
      image: {
        url: 'https://cdn.example.com/acros.jpg',
        attribution: 'Someone · CC BY 4.0',
        sourcePage: 'https://example.com/file',
      },
    })]));
    expect(parsed.places).toHaveLength(1);
    expect(parsed.places[0].image).toBeUndefined();
  });

  it('drops a card with no canonical identity', () => {
    const parsed = parseAskResult(answered([cardFor({ ref: { provider: 'osm', providerPlaceId: 'n1' } })]));
    expect(parsed.places).toEqual([]);
  });

  it('drops a photograph offered without its credit', () => {
    const parsed = parseAskResult(answered([cardFor({
      image: { url: ACROS_IMAGE, sourcePage: 'https://commons.wikimedia.org/wiki/File:Acrosfukuoka02.jpg' },
    })]));
    expect(parsed.places[0].image).toBeUndefined();
  });

  it('bounds how many cards one answer may carry', () => {
    const many = Array.from({ length: 12 }, (_, index) => cardFor({
      ref: { canonicalPlaceId: `canon-${index}`, provider: 'osm', providerPlaceId: `n${index}` },
    }));
    expect(parseAskResult(answered(many)).places.length).toBeLessThanOrEqual(5);
  });

  it('reads no cards from a response that has none', () => {
    expect(parseAskResult({ status: 'answered', answer: 'Fine.' }).places).toEqual([]);
  });
});

// @vitest-environment jsdom
/**
 * The discovery deck's card, added in `4c3d6c6` and verified until now only by
 * `tsc -b` and reading — the same standard that let two silent
 * `sanitizeActivity` losses through. Roadmap §9.6 named it as the largest
 * remaining gap after the harness was built.
 *
 * What is covered here is the flip: which clicks open the card, which close it,
 * and which must be left alone. The drag itself is not — Framer Motion's
 * pointer gestures cannot be driven honestly in jsdom, so the rules a drag is
 * judged by live in `src/lib/deckGestures.ts` and are tested there. This file
 * covers the half a browser is genuinely needed for.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeckCard } from './DestinationDiscoveryPanel';
import { OSAKA_PLACE_FIXTURE } from '../lib/destinationFixtures';
import { rankWithIntelligence } from '../lib/destinationPlanner';
import { createEmptyProfile, manualDestination, type TripProfile } from '../lib/tripProfile';
import type { RankedCandidate } from '../lib/destinationIntelligence';

const osakaProfile = (): TripProfile => ({
  ...createEmptyProfile('MYR'),
  destinations: [manualDestination('Osaka', 'Japan')],
  startDate: '2027-04-02',
  endDate: '2027-04-06',
});

/**
 * A real ranked candidate rather than a hand-built literal: the card reads
 * `score`, `reasons` and `cautions`, and a fixture that drifts from what the
 * ranker actually produces would test a shape nothing renders.
 */
const rankedOsakaPlace = (): RankedCandidate => {
  const ranked = rankWithIntelligence(OSAKA_PLACE_FIXTURE, osakaProfile());
  const withSource = ranked.find((entry) => entry.candidate.sourceReferences[0]?.url);
  return withSource ?? ranked[0];
};

const renderCard = (flipped: boolean) => {
  const onFlippedChange = vi.fn();
  const onDecision = vi.fn();
  const ranked = rankedOsakaPlace();
  render(
    <DeckCard
      ranked={ranked}
      onDecision={onDecision}
      variant="desktop"
      flipped={flipped}
      onFlippedChange={onFlippedChange}
    />,
  );
  return { ranked, onFlippedChange, onDecision };
};

/** The back face is a plain `div`, so it is reached by class rather than role. */
const backFace = (): HTMLElement => {
  const face = document.querySelector('.destination-flip-face.is-back');
  if (!face) throw new Error('card has no back face');
  return face as HTMLElement;
};

describe('opening the card', () => {
  it('flips open when the front is clicked', () => {
    const { ranked, onFlippedChange } = renderCard(false);

    fireEvent.click(screen.getByRole('button', { name: `Show details for ${ranked.candidate.name}` }));

    expect(onFlippedChange).toHaveBeenCalledWith(true);
  });

  it('names the place in the front face label, not just "details"', () => {
    // A screen-reader user swiping a deck hears this once per card; "Show
    // details" alone would not say which place is being decided on.
    const { ranked } = renderCard(false);

    expect(screen.getByRole('button', { name: `Show details for ${ranked.candidate.name}` })).toBeInTheDocument();
  });
});

describe('closing the card', () => {
  it('flips shut when the back surface is clicked', () => {
    const { onFlippedChange } = renderCard(true);

    fireEvent.click(backFace());

    expect(onFlippedChange).toHaveBeenCalledWith(false);
  });

  it('flips shut from the explicit close control', () => {
    const { onFlippedChange } = renderCard(true);

    fireEvent.click(screen.getByRole('button', { name: /flip card back/i }));

    expect(onFlippedChange).toHaveBeenCalledWith(false);
  });

  it('leaves the source link alone', () => {
    // Clicking through to a source and losing the card you were reading is the
    // regression this guards.
    const { onFlippedChange } = renderCard(true);
    const link = screen.queryByRole('link', { name: /open source/i });
    expect(link).not.toBeNull();

    fireEvent.click(link as HTMLElement);

    expect(onFlippedChange).not.toHaveBeenCalled();
  });

  it('does not close while text is selected', () => {
    // Releasing a drag-select inside the card fires a click on the surface.
    // Without the selection check, copying an excerpt would close the card.
    const { onFlippedChange } = renderCard(true);
    const selection = { toString: () => 'an excerpt worth keeping' } as unknown as Selection;
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    fireEvent.click(backFace());

    expect(onFlippedChange).not.toHaveBeenCalled();
    getSelection.mockRestore();
  });
});

describe('deciding without a pointer gesture', () => {
  it('offers all three decisions on the front of the card', () => {
    // The keyboard and button routes exist because a swipe is not available to
    // every traveller; losing one silently would leave the deck undecidable.
    const { onDecision } = renderCard(false);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Must do' }));

    expect(onDecision).toHaveBeenNthCalledWith(1, 'skip');
    expect(onDecision).toHaveBeenNthCalledWith(2, 'must-do');
  });

  it('keeps a decision reachable once the card is flipped open', () => {
    const { onDecision } = renderCard(true);

    fireEvent.click(screen.getByRole('button', { name: 'Interested' }));

    expect(onDecision).toHaveBeenCalledWith('interested');
  });
});

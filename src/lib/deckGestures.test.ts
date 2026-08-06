// @vitest-environment jsdom
/**
 * The deck's gesture rules, which were previously three inline conditions in a
 * component and covered by nothing. Roadmap §9.6 named this as the largest
 * remaining hole after `c5dfce5` built the harness.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAG_INTENT_PX,
  SWIPE_COMMIT_PX,
  SWIPE_COMMIT_VELOCITY,
  isDragIntent,
  shouldCloseFromSurface,
  swipeDecision,
} from './deckGestures';

describe('drag intent', () => {
  it('treats a still pointer as a tap', () => {
    expect(isDragIntent(0)).toBe(false);
  });

  it('treats the threshold itself as a tap, not a drag', () => {
    // Strictly greater, so a hand resting exactly on the boundary still opens
    // the card rather than silently swallowing the click.
    expect(isDragIntent(DRAG_INTENT_PX)).toBe(false);
    expect(isDragIntent(DRAG_INTENT_PX + 1)).toBe(true);
  });

  it('is symmetric, because a leftward drag is equally not a tap', () => {
    expect(isDragIntent(-(DRAG_INTENT_PX + 1))).toBe(true);
  });

  it('fires long before the swipe commits', () => {
    // The whole point: an abandoned swipe must already have suppressed its
    // trailing click, even though it decided nothing.
    expect(DRAG_INTENT_PX).toBeLessThan(SWIPE_COMMIT_PX);
    expect(isDragIntent(SWIPE_COMMIT_PX / 2)).toBe(true);
    expect(swipeDecision(SWIPE_COMMIT_PX / 2, 0)).toBeNull();
  });
});

describe('swipe decision', () => {
  it('keeps a place dragged far enough to the right', () => {
    expect(swipeDecision(SWIPE_COMMIT_PX, 0)).toBe('must-do');
  });

  it('skips a place dragged far enough to the left', () => {
    expect(swipeDecision(-SWIPE_COMMIT_PX, 0)).toBe('skip');
  });

  it('decides nothing when the card is released short of the line', () => {
    expect(swipeDecision(SWIPE_COMMIT_PX - 1, 0)).toBeNull();
    expect(swipeDecision(-(SWIPE_COMMIT_PX - 1), 0)).toBeNull();
  });

  it('honours a fast flick that never travelled the distance', () => {
    expect(swipeDecision(20, SWIPE_COMMIT_VELOCITY + 1)).toBe('must-do');
    expect(swipeDecision(-20, -(SWIPE_COMMIT_VELOCITY + 1))).toBe('skip');
  });

  it('ignores a slow drag back to centre', () => {
    // Released at rest in the middle: the traveller changed their mind, and
    // changing your mind is not a decision.
    expect(swipeDecision(0, 0)).toBeNull();
    expect(swipeDecision(0, SWIPE_COMMIT_VELOCITY)).toBeNull();
  });

  it('never reads a rightward throw as a skip', () => {
    // Distance and velocity disagreeing is the case that would silently reject
    // a place the traveller was keeping.
    expect(swipeDecision(SWIPE_COMMIT_PX, -(SWIPE_COMMIT_VELOCITY + 1))).toBe('must-do');
  });
});

describe('closing the card from its own surface', () => {
  const surface = () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p id="copy">Details a traveller is reading</p>
      <a id="source" href="https://example.com">Open source</a>
      <button id="close" type="button">Flip card back</button>
    `;
    document.body.append(root);
    return root;
  };

  it('closes when the traveller clicks the card itself', () => {
    const root = surface();
    expect(shouldCloseFromSurface(root.querySelector('#copy'), false)).toBe(true);
  });

  it('leaves a source link alone', () => {
    const root = surface();
    expect(shouldCloseFromSurface(root.querySelector('#source'), false)).toBe(false);
  });

  it('leaves a button alone, which the close control itself relies on', () => {
    const root = surface();
    expect(shouldCloseFromSurface(root.querySelector('#close'), false)).toBe(false);
  });

  it('never throws away a live text selection', () => {
    const root = surface();
    expect(shouldCloseFromSurface(root.querySelector('#copy'), true)).toBe(false);
  });

  it('survives a target that cannot answer closest', () => {
    // Clicks can land on a text node or on the document in odd cases; the card
    // should close rather than crash mid-gesture.
    expect(shouldCloseFromSurface(null, false)).toBe(true);
  });
});

/**
 * The rules a discovery-deck gesture is judged by.
 *
 * These lived inside `DestinationDiscoveryPanel` as three inline conditions,
 * which is the same shape the two silent `sanitizeActivity` losses had: real
 * decision logic in a file no test could reach. Framer Motion's drag cannot be
 * driven honestly in jsdom, so the arithmetic is separated from the gesture —
 * the component keeps the wiring, this file keeps the judgement, and the
 * judgement is what a regression would change.
 */
import type { DiscoveryCandidateDecision } from '../data';

/** How far a card travels before the swipe counts as a decision. */
export const SWIPE_COMMIT_PX = 110;

/**
 * A flick counts even when it is short. Pixels per second, so a fast, small
 * gesture decides while a slow, long one still has to cross the distance.
 */
export const SWIPE_COMMIT_VELOCITY = 700;

/**
 * Past this much movement a pointer gesture is a drag, not a tap. A mouse drag
 * still ends with a click on whatever was underneath it, so without a threshold
 * every desktop swipe would also flip the card it just decided on. Well under
 * `SWIPE_COMMIT_PX`, because an abandoned swipe is still not a tap.
 */
export const DRAG_INTENT_PX = 8;

/** Elements that own their own click and must never close the card. */
const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select';

/**
 * Has this gesture moved far enough to stop being a tap? Called on every drag
 * frame, so it must stay true once true — the caller latches it.
 */
export function isDragIntent(offsetX: number): boolean {
  return Math.abs(offsetX) > DRAG_INTENT_PX;
}

/**
 * What a released card decides, if anything. Right keeps, left skips, and a
 * gesture that reached neither the distance nor the speed decides nothing —
 * an abandoned swipe must leave the card exactly as it was.
 */
export function swipeDecision(offsetX: number, velocityX: number): DiscoveryCandidateDecision | null {
  if (offsetX >= SWIPE_COMMIT_PX || velocityX > SWIPE_COMMIT_VELOCITY) return 'must-do';
  if (offsetX <= -SWIPE_COMMIT_PX || velocityX < -SWIPE_COMMIT_VELOCITY) return 'skip';
  return null;
}

/**
 * Should a click on the back of the card flip it shut?
 *
 * Only the card's own surface closes it. Interactive children and a live text
 * selection are left alone, so opening a source or copying an excerpt does not
 * throw away the details the traveller was reading.
 */
export function shouldCloseFromSurface(
  target: EventTarget | null,
  hasSelection: boolean,
): boolean {
  if (hasSelection) return false;
  const element = target as HTMLElement | null;
  if (element?.closest?.(INTERACTIVE_SELECTOR)) return false;
  return true;
}

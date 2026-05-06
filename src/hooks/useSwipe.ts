import { useRef, useCallback } from 'react';
import { hapticTap } from '../lib/haptics';

interface Options {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onSwipeUp?: () => void;
  /** Minimum horizontal distance to count as a swipe (default 50px) */
  threshold?: number;
  /** If vertical distance exceeds this, cancel (default 80px) */
  verticalLimit?: number;
}

export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
  onSwipeUp,
  threshold = 50,
  verticalLimit = 80,
}: Options) {
  const startRef = useRef({ x: 0, y: 0, time: 0 });

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const onTouchMove = useCallback((_e: React.TouchEvent) => {
    // Only used to prevent default scrolling if we want, but not needed here strictly
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startRef.current.x;
    const dy = touch.clientY - startRef.current.y;
    const elapsed = Date.now() - startRef.current.time;

    if (elapsed > 400) return;

    // Check if it's primarily a vertical swipe
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > threshold) {
      if (dy > 0 && onSwipeDown) {
        hapticTap();
        onSwipeDown();
      } else if (dy < 0 && onSwipeUp) {
        hapticTap();
        onSwipeUp();
      }
      return;
    }

    // Otherwise check horizontal
    if (Math.abs(dy) > verticalLimit) return;
    if (Math.abs(dx) < threshold) return;

    if (dx < 0 && onSwipeLeft) {
      hapticTap();
      onSwipeLeft();
    } else if (dx > 0 && onSwipeRight) {
      hapticTap();
      onSwipeRight();
    }
  }, [onSwipeLeft, onSwipeRight, onSwipeDown, onSwipeUp, threshold, verticalLimit]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}

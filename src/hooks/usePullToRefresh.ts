import { useEffect, useRef, useState, useCallback } from 'react';
import { hapticMedium, hapticSuccess } from '../lib/haptics';

interface Options {
  onRefresh: () => Promise<void>;
  /** Minimum pull distance in px to trigger (default 80) */
  threshold?: number;
  /** Disable on desktop (default true — only fires on coarse pointer) */
  mobileOnly?: boolean;
}

export function usePullToRefresh({ onRefresh, threshold = 80, mobileOnly = true }: Options) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const activeRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    hapticSuccess();
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPullDistance(0);
      setPulling(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (mobileOnly && !window.matchMedia('(pointer: coarse)').matches) return;

    const onTouchStart = (e: TouchEvent) => {
      // Only activate when at the very top of the page
      if (window.scrollY > 5) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy < 0) {
        activeRef.current = false;
        setPulling(false);
        setPullDistance(0);
        return;
      }
      // Rubber-band effect: diminishing returns past threshold
      const clamped = dy < threshold ? dy : threshold + (dy - threshold) * 0.3;
      setPullDistance(clamped);
      setPulling(true);

      if (clamped >= threshold) hapticMedium();
    };

    const onTouchEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (pullDistance >= threshold) {
        handleRefresh();
      } else {
        setPullDistance(0);
        setPulling(false);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [mobileOnly, threshold, pullDistance, handleRefresh]);

  const progress = Math.min(1, pullDistance / threshold);

  return { pulling, pullDistance, refreshing, progress };
}

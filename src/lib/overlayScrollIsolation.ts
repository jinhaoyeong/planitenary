import { useEffect } from 'react';

type LenisInstance = { stop: () => void; start: () => void };

function getLenis(): LenisInstance | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __lenis?: LenisInstance }).__lenis ?? null;
}

/**
 * While overlays like portaled pickers are open, stop Lenis and any modal
 * scroll containers from stealing wheel/touch from the nested list.
 */
export function useOverlayScrollIsolation(open: boolean) {
  useEffect(() => {
    if (!open) return;

    const lenis = getLenis();
    lenis?.stop();

    const wizardContent = document.querySelector('.wizard-dialog-content');
    const wizardPreviousOverflow = wizardContent instanceof HTMLElement
      ? wizardContent.style.overflow
      : '';
    if (wizardContent instanceof HTMLElement) {
      wizardContent.style.overflow = 'hidden';
    }

    const blockBackgroundWheel = (event: WheelEvent) => {
      const target = event.target as Node | null;
      const inPicker = target instanceof Element && target.closest('.country-picker-menu, .country-picker-results');
      if (inPicker) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const blockBackgroundTouch = (event: TouchEvent) => {
      const target = event.target as Node | null;
      const inPicker = target instanceof Element && target.closest('.country-picker-menu, .country-picker-results');
      if (inPicker) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('wheel', blockBackgroundWheel, { passive: false, capture: true });
    document.addEventListener('touchmove', blockBackgroundTouch, { passive: false, capture: true });

    return () => {
      lenis?.start();
      if (wizardContent instanceof HTMLElement) {
        wizardContent.style.overflow = wizardPreviousOverflow;
      }
      document.removeEventListener('wheel', blockBackgroundWheel, { capture: true } as EventListenerOptions);
      document.removeEventListener('touchmove', blockBackgroundTouch, { capture: true } as EventListenerOptions);
    };
  }, [open]);
}

export function handleNestedListWheel(event: React.WheelEvent<HTMLElement>) {
  event.stopPropagation();
  const list = event.currentTarget;
  if (list.scrollHeight <= list.clientHeight) {
    event.preventDefault();
    return;
  }

  const maxScroll = list.scrollHeight - list.clientHeight;
  const next = list.scrollTop + event.deltaY;
  const scrollingUp = event.deltaY < 0;
  const scrollingDown = event.deltaY > 0;
  const atTop = list.scrollTop <= 0;
  const atBottom = list.scrollTop >= maxScroll - 1;

  if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
    event.preventDefault();
    return;
  }

  list.scrollTop = Math.max(0, Math.min(maxScroll, next));
  event.preventDefault();
}

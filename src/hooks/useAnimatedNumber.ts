import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

interface Options {
  duration?: number;
  startOnView?: boolean;
  format?: (n: number) => string;
}

export function useAnimatedNumber(value: number, options: Options = {}) {
  const { duration = 1.4, startOnView = true, format } = options;
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce || !startOnView ? value : 0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasStartedRef = useRef(!startOnView);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }

    const run = (from: number) => {
      const controls = animate(from, value, {
        duration,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (latest) => setDisplay(latest),
      });
      return controls;
    };

    if (!startOnView) {
      const controls = run(lastValueRef.current);
      lastValueRef.current = value;
      return () => controls.stop();
    }

    if (hasStartedRef.current) {
      const controls = run(lastValueRef.current);
      lastValueRef.current = value;
      return () => controls.stop();
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasStartedRef.current) {
            hasStartedRef.current = true;
            run(0);
            lastValueRef.current = value;
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, duration, startOnView, reduce]);

  const formatted = format ? format(Math.round(display)) : Math.round(display).toLocaleString();
  return { ref, display: formatted };
}

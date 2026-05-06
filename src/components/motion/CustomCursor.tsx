import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

const MAGNET_SELECTOR =
  'button, a, [role="button"], .pill-btn, input, select, textarea, [data-cursor]';

/* Heart SVG path (viewBox 0 0 24 24) */
const HEART =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

const RING_SVG = 60;
const RING_R = 22;
const HEART_COUNT = 8;
const HEART_SCALE = 0.32; // ~8px per heart

export function CustomCursor() {
  const mx = useMotionValue(-100);
  const my = useMotionValue(-100);

  const ringX = useSpring(mx, { damping: 35, stiffness: 450, mass: 0.3 });
  const ringY = useSpring(my, { damping: 35, stiffness: 450, mass: 0.3 });
  const ringScale = useMotionValue(0.75);
  const ringScaleSpring = useSpring(ringScale, { damping: 20, stiffness: 260 });

  const [hovering, setHovering] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);
  const [active, setActive] = useState(false);
  const rafRef = useRef<number | null>(null);
  const hoveringRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    setActive(true);
    document.documentElement.classList.add('cursor-none');

    const onMove = (e: MouseEvent) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setHidden(false);
        const target = e.target as HTMLElement | null;
        const magnet = target?.closest<HTMLElement>(MAGNET_SELECTOR);

        if (magnet) {
          const rect = magnet.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          mx.set(e.clientX + (cx - e.clientX) * 0.12);
          my.set(e.clientY + (cy - e.clientY) * 0.12);
          ringScale.set(1.05);
          hoveringRef.current = true;
          setHovering(true);
          setLabel(magnet.getAttribute('data-cursor'));
        } else {
          mx.set(e.clientX);
          my.set(e.clientY);
          ringScale.set(0.75);
          hoveringRef.current = false;
          setHovering(false);
          setLabel(null);
        }
      });
    };

    const onLeave = () => setHidden(true);
    const onDown = () => { setPressing(true); ringScale.set(0.5); };
    const onUp = () => {
      setPressing(false);
      ringScale.set(hoveringRef.current ? 1.05 : 0.75);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.documentElement.classList.remove('cursor-none');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [mx, my, ringScale]);

  if (!active) return null;

  const vis = hidden ? 0 : 1;
  const center = RING_SVG / 2;
  const heartSize = pressing ? 13 : hovering ? 15 : 17;

  return (
    <>
      {/* ── Center heart: instant tracking ── */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0"
        style={{
          x: mx,
          y: my,
          translateX: '-50%',
          translateY: '-50%',
          opacity: vis,
          zIndex: 10000,
          filter: 'drop-shadow(0 0 5px var(--cursor-glow))',
          transition: 'opacity 0.15s',
          willChange: 'transform',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={heartSize}
          height={heartSize}
          style={{
            overflow: 'visible',
            display: 'block',
            transition: 'width 0.15s ease, height 0.15s ease',
          }}
        >
          <path d={HEART} fill="var(--accent)" />
        </svg>
      </motion.div>

      {/* ── Ring of hearts: trails with spring, rotates ── */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 flex items-center justify-center"
        style={{
          x: ringX,
          y: ringY,
          translateX: '-50%',
          translateY: '-50%',
          width: RING_SVG,
          height: RING_SVG,
          scale: ringScaleSpring,
          opacity: vis * (pressing ? 0.45 : 1),
          zIndex: 9999,
          filter: hovering
            ? 'drop-shadow(0 0 8px var(--cursor-glow-strong))'
            : 'drop-shadow(0 0 4px var(--cursor-glow))',
          transition: 'opacity 0.2s, filter 0.3s',
          willChange: 'transform',
        }}
      >
        <motion.svg
          width={RING_SVG}
          height={RING_SVG}
          viewBox={`0 0 ${RING_SVG} ${RING_SVG}`}
          style={{ position: 'absolute', overflow: 'visible' }}
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        >
          {Array.from({ length: HEART_COUNT }, (_, i) => {
            const angle = (i / HEART_COUNT) * 2 * Math.PI - Math.PI / 2;
            const hx = center + RING_R * Math.cos(angle);
            const hy = center + RING_R * Math.sin(angle);
            return (
              <path
                key={i}
                d={HEART}
                fill="var(--accent)"
                opacity={0.6}
                transform={`translate(${hx},${hy}) scale(${HEART_SCALE}) translate(-12,-12)`}
              />
            );
          })}
        </motion.svg>

        {label && (
          <span
            className="text-[8px] font-semibold uppercase tracking-widest whitespace-nowrap relative z-10"
            style={{ color: 'var(--accent)' }}
          >
            {label}
          </span>
        )}
      </motion.div>
    </>
  );
}

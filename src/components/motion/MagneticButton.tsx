import { useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';

interface Props {
  children: ReactNode;
  className?: string;
  strength?: number;
  as?: 'div' | 'span';
  onClick?: () => void;
}

export function MagneticButton({
  children,
  className,
  strength = 0.35,
  as = 'div',
  onClick,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { damping: 18, stiffness: 260, mass: 0.3 });
  const sy = useSpring(my, { damping: 18, stiffness: 260, mass: 0.3 });

  if (reduce) {
    const Comp = as;
    return (
      <Comp className={className} onClick={onClick}>
        {children}
      </Comp>
    );
  }

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    mx.set((e.clientX - cx) * strength);
    my.set((e.clientY - cy) * strength);
  };

  const handleLeave = () => {
    mx.set(0);
    my.set(0);
  };

  const Comp = as === 'span' ? motion.span : motion.div;
  return (
    <Comp
      ref={ref as React.Ref<HTMLDivElement & HTMLSpanElement>}
      className={className}
      style={{ x: sx, y: sy, display: 'inline-block' }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {children}
    </Comp>
  );
}

import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

type Direction = 'up' | 'down' | 'left' | 'right' | 'scale' | 'blur' | 'none';

interface RevealProps {
  children: ReactNode;
  delay?: number;
  direction?: Direction;
  amount?: number;
  once?: boolean;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li' | 'span';
  duration?: number;
}

const offsets: Record<Direction, Record<string, number | string>> = {
  up: { y: 36 },
  down: { y: -36 },
  left: { x: 48 },
  right: { x: -48 },
  scale: { scale: 0.9 },
  blur: { y: 24 },
  none: {},
};

export function Reveal({
  children,
  delay = 0,
  direction = 'up',
  amount = 0.2,
  once = true,
  className,
  as = 'div',
  duration = 0.75,
}: RevealProps) {
  const reduce = useReducedMotion();
  const from = reduce ? {} : offsets[direction];

  const variants: Variants = {
    hidden: { opacity: 0, ...from },
    show: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: { duration, delay, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount, margin: '0px 0px -8% 0px' }}
      variants={variants}
    >
      {children}
    </Comp>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  gap?: number;
  amount?: number;
  once?: boolean;
  delayChildren?: number;
}

export function Stagger({
  children,
  className,
  gap = 0.08,
  amount = 0.15,
  once = true,
  delayChildren = 0.05,
}: StaggerProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren } },
      }}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
  },
};

import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';

interface Props {
  d: string;
  width?: number;
  height?: number;
  viewBox?: string;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  duration?: number;
  once?: boolean;
  vectorEffect?: 'non-scaling-stroke' | 'none';
}

export function LineDraw({
  d,
  width,
  height,
  viewBox = '0 0 100 100',
  stroke = 'currentColor',
  strokeWidth = 2,
  className,
  style,
  delay = 0,
  duration = 1.2,
  once = true,
  vectorEffect = 'non-scaling-stroke',
}: Props) {
  const reduce = useReducedMotion();

  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      className={className}
      style={style}
      fill="none"
      preserveAspectRatio="none"
    >
      <motion.path
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={vectorEffect}
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once, amount: 0.3 }}
        transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

interface BracketsProps {
  className?: string;
  color?: string;
  size?: number;
  inset?: number;
}

export function CornerBrackets({
  className,
  color = 'var(--ink)',
  size = 28,
  inset = 12,
}: BracketsProps) {
  const reduce = useReducedMotion();
  const common = {
    stroke: color,
    strokeWidth: 2,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
  };
  const animate = (delay: number) => ({
    initial: reduce ? { pathLength: 1 } : { pathLength: 0 },
    whileInView: { pathLength: 1 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  });

  return (
    <svg
      aria-hidden
      className={className}
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {/* top-left */}
      <motion.path
        d={`M ${inset} ${inset + size} L ${inset} ${inset} L ${inset + size} ${inset}`}
        {...common}
        {...animate(0)}
      />
      {/* top-right */}
      <motion.path
        d={`M ${100 - inset - size} ${inset} L ${100 - inset} ${inset} L ${100 - inset} ${inset + size}`}
        {...common}
        {...animate(0.1)}
      />
      {/* bottom-right */}
      <motion.path
        d={`M ${100 - inset} ${100 - inset - size} L ${100 - inset} ${100 - inset} L ${100 - inset - size} ${100 - inset}`}
        {...common}
        {...animate(0.2)}
      />
      {/* bottom-left */}
      <motion.path
        d={`M ${inset + size} ${100 - inset} L ${inset} ${100 - inset} L ${inset} ${100 - inset - size}`}
        {...common}
        {...animate(0.3)}
      />
    </svg>
  );
}

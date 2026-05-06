import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { type ReactNode, createElement } from 'react';

type Tag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div';

interface Props {
  children: string;
  as?: Tag;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  stagger?: number;
  amount?: number;
  once?: boolean;
  id?: string;
}

const container: Variants = {
  hidden: {},
  show: (custom: { stagger: number; delay: number }) => ({
    transition: { staggerChildren: custom.stagger, delayChildren: custom.delay },
  }),
};

const charVariants: Variants = {
  hidden: { y: '110%', opacity: 0 },
  show: {
    y: '0%',
    opacity: 1,
    transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
  },
};

export function SplitText({
  children,
  as = 'span',
  className,
  style,
  delay = 0,
  stagger = 0.018,
  amount = 0.4,
  once = true,
  id,
}: Props) {
  const reduce = useReducedMotion();

  if (reduce) {
    return createElement(as, { className, style, id }, children);
  }

  const words = children.split(/(\s+)/);

  return createElement(
    as,
    { className, style, id, 'aria-label': children },
    <motion.span
      aria-hidden
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount, margin: '0px 0px -5% 0px' }}
      variants={container}
      custom={{ stagger, delay }}
      style={{ display: 'inline-block' }}
    >
      {words.map((word, wi) => {
        if (/^\s+$/.test(word)) return <span key={`ws-${wi}`}>{word}</span>;
        return (
          <span
            key={`w-${wi}`}
            style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}
          >
            {Array.from(word).map((char, ci) => (
              <motion.span
                key={`c-${wi}-${ci}`}
                variants={charVariants}
                style={{ display: 'inline-block' }}
              >
                {char}
              </motion.span>
            ))}
          </span>
        );
      })}
    </motion.span>
  ) as ReactNode;
}

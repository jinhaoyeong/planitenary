import {
  motion,
  useScroll,
  useTransform,
  useVelocity,
  useSpring,
  useReducedMotion,
} from 'framer-motion';

interface Props {
  items: string[];
  separator?: string;
}

export const Marquee = ({ items, separator = '✦' }: Props) => {
  // Multiply the items to ensure there is always enough content to scroll infinitely without gap
  // By using an even number of copies (e.g. 10), translateX(-50%) shifts exactly 5 copies, looping perfectly.
  const multiplied = Array.from({ length: 10 }).flatMap(() => items);
  const reduce = useReducedMotion();

  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  const skew = useTransform(smoothVelocity, [-1500, 0, 1500], [-5, 0, 5]);

  if (!items || items.length === 0) return null;

  return (
    <div
      className="relative w-full overflow-hidden border-y bg-[color:var(--bg)] py-4"
      style={{ borderColor: 'var(--ink)' }}
    >
      <motion.div
        className="will-change-transform"
        style={reduce ? undefined : { skewX: skew }}
      >
        <div className="flex whitespace-nowrap animate-marquee w-max">
          {multiplied.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-6 px-6 font-display text-2xl sm:text-3xl md:text-4xl text-[color:var(--ink)]"
            >
              {item}
              <span className="text-[color:var(--accent)]">{separator}</span>
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

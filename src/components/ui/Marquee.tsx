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
  onItemChange?: (index: number, value: string) => void;
}

export const Marquee = ({ items, separator = '✦', onItemChange }: Props) => {
  // Triple the items to ensure there is always enough content to scroll infinitely without gap
  const tripled = [...items, ...items, ...items];
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
          {tripled.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-6 px-6 font-display text-2xl sm:text-3xl md:text-4xl text-[color:var(--ink)]"
            >
              <span
                contentEditable={Boolean(onItemChange)}
                suppressContentEditableWarning
                className={onItemChange ? 'cursor-text rounded px-1 outline-none focus:bg-white/10' : undefined}
                onBlur={onItemChange ? (event) => onItemChange(idx % items.length, event.currentTarget.textContent || '') : undefined}
                title={onItemChange ? 'Click to edit' : undefined}
              >{item}</span>
              <span className="text-[color:var(--accent)]">{separator}</span>
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

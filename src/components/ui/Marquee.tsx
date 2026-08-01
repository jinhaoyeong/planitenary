interface Props {
  items: string[];
  separator?: string;
}

export const Marquee = ({ items, separator = '✦' }: Props) => {
  const safeItems = items.map((item) => item.trim()).filter(Boolean).slice(0, 16);
  // Four copies keep the -50% loop seamless without the DOM cost of the old ten-copy track.
  const multiplied = Array.from({ length: 4 }).flatMap(() => safeItems);

  if (safeItems.length === 0) return null;

  return (
    <div
      className="marquee-strip relative w-full overflow-hidden bg-[color:var(--bg)]"
    >
      <span className="sr-only">Travel Handbook highlights: {safeItems.join(', ')}</span>
      <div className="marquee-scroll">
        <div className="marquee-track flex whitespace-nowrap w-max" aria-hidden="true">
          {multiplied.map((item, idx) => (
            <span
              key={idx}
              className="marquee-item inline-flex items-center font-display text-[color:var(--ink)]"
            >
              <span className="marquee-label">{item}</span>
              <span aria-hidden="true" className="marquee-separator text-[color:var(--accent)]">{separator}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  /** Render a circle instead of a rectangle */
  circle?: boolean;
  /** Width — number = px, string = any CSS value */
  w?: number | string;
  /** Height — number = px, string = any CSS value */
  h?: number | string;
}

export function Skeleton({ className, circle, w, h }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={clsx(
        'block animate-pulse',
        circle ? 'rounded-full' : 'rounded-xl',
        className,
      )}
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        height: typeof h === 'number' ? `${h}px` : h,
        backgroundColor: 'color-mix(in srgb, var(--ink) 8%, var(--bg-elevated))',
      }}
    />
  );
}

/** Card-shaped skeleton matching .editorial-card proportions */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx('editorial-card p-5 space-y-4', className)}
      style={{ pointerEvents: 'none' }}
    >
      <div className="flex items-center gap-3">
        <Skeleton circle w={40} h={40} />
        <div className="flex-1 space-y-2">
          <Skeleton h={14} className="w-2/3" />
          <Skeleton h={10} className="w-1/3" />
        </div>
      </div>
      <Skeleton h={12} className="w-full" />
      <Skeleton h={12} className="w-5/6" />
      <Skeleton h={12} className="w-3/4" />
    </div>
  );
}

/** Row skeleton for lists (checklist items, budget rows) */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-3 py-3', className)}>
      <Skeleton circle w={24} h={24} />
      <Skeleton h={14} className="flex-1" />
      <Skeleton h={14} w={48} />
    </div>
  );
}

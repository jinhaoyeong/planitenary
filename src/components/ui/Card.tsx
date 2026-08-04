import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { AdaptiveSurface } from './AdaptivePrimitives';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  numeral?: string;
}

export const Card = ({ children, numeral, className, ...rest }: Props) => (
  <AdaptiveSurface {...rest} role="card" className={clsx('editorial-card adaptive-card p-5 sm:p-6', className)}>
    {numeral && (
      <div className="font-display text-5xl sm:text-6xl leading-none text-[color:var(--accent)] mb-3">
        {numeral}
      </div>
    )}
    {children}
  </AdaptiveSurface>
);

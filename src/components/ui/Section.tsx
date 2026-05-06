import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Eyebrow } from './Eyebrow';

interface Props {
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center';
}

export const Section = ({ eyebrow, title, subtitle, children, className, align = 'left' }: Props) => (
  <section className={clsx('py-10 md:py-16', className)}>
    {(eyebrow || title || subtitle) && (
      <header className={clsx('mb-8 md:mb-12', align === 'center' && 'text-center')}>
        {eyebrow && <div className="mb-4"><Eyebrow>{eyebrow}</Eyebrow></div>}
        {title && (
          <h2 className="font-display text-4xl sm:text-5xl md:text-6xl leading-[1.02] tracking-tight text-[color:var(--ink)]">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="mt-4 text-base md:text-lg text-[color:var(--ink-muted)] max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </header>
    )}
    {children}
  </section>
);

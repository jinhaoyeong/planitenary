import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={clsx('eyebrow', className)}>{children}</span>
);

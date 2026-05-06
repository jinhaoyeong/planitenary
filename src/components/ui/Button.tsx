import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'ghost' | 'soft';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export const Button = ({ variant = 'primary', className, children, ...rest }: Props) => (
  <button
    {...rest}
    className={clsx(
      'pill-btn',
      variant === 'primary' && 'pill-primary',
      variant === 'ghost' && 'pill-ghost',
      variant === 'soft' && 'pill-soft',
      className
    )}
  >
    {children}
  </button>
);

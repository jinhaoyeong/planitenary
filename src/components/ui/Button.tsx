import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { AdaptiveButton } from './AdaptivePrimitives';

type Variant = 'primary' | 'ghost' | 'soft';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export const Button = ({ variant = 'primary', className, children, ...rest }: Props) => (
  <AdaptiveButton
    {...rest}
    variant={variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : 'secondary'}
    className={clsx(
      'pill-btn adaptive-button',
      variant === 'primary' && 'pill-primary accent-button',
      variant === 'ghost' && 'pill-ghost',
      variant === 'soft' && 'pill-soft',
      className
    )}
  >
    {children}
  </AdaptiveButton>
);

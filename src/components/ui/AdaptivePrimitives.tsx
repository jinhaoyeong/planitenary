import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { clsx } from 'clsx';

type SurfaceRole = 'page-panel' | 'section' | 'card' | 'compact-card' | 'modal';

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  role?: SurfaceRole;
  children: ReactNode;
}

export function AdaptiveSurface({ role = 'card', className, children, ...props }: SurfaceProps) {
  return (
    <div
      {...props}
      data-adaptive-role={role}
      className={clsx('adaptive-surface', `adaptive-surface-${role}`, className)}
    >
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface AdaptiveButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function AdaptiveButton({ variant = 'secondary', className, children, ...props }: AdaptiveButtonProps) {
  return (
    <button
      {...props}
      data-adaptive-role="button"
      data-adaptive-variant={variant}
      className={clsx('adaptive-button', `adaptive-button-${variant}`, className)}
    >
      {children}
    </button>
  );
}

interface AdaptiveChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function AdaptiveChip({ className, children, ...props }: AdaptiveChipProps) {
  return <span {...props} data-adaptive-role="chip" className={clsx('adaptive-chip', className)}>{children}</span>;
}

interface AdaptiveTabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export function AdaptiveTab({ active = false, className, children, ...props }: AdaptiveTabProps) {
  return (
    <button
      {...props}
      data-adaptive-role="tab"
      data-active={active ? 'true' : 'false'}
      className={clsx('adaptive-tab', className)}
    >
      {children}
    </button>
  );
}

type AdaptiveInputProps = InputHTMLAttributes<HTMLInputElement>;

export function AdaptiveInput({ className, ...props }: AdaptiveInputProps) {
  return <input {...props} data-adaptive-role="input" className={clsx('adaptive-input', className)} />;
}

interface AdaptiveMediaFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AdaptiveMediaFrame({ className, children, ...props }: AdaptiveMediaFrameProps) {
  return <div {...props} data-adaptive-role="media" className={clsx('adaptive-media-frame', className)}>{children}</div>;
}

interface AdaptiveIconTileProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AdaptiveIconTile({ className, children, ...props }: AdaptiveIconTileProps) {
  return <div {...props} data-adaptive-role="icon-tile" className={clsx('adaptive-icon-tile', className)}>{children}</div>;
}

interface AdaptiveBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function AdaptiveBadge({ className, children, ...props }: AdaptiveBadgeProps) {
  return <span {...props} data-adaptive-role="badge" className={clsx('adaptive-badge', className)}>{children}</span>;
}

export function AdaptiveModal({ className, children, ...props }: SurfaceProps) {
  return <AdaptiveSurface {...props} role="modal" className={className}>{children}</AdaptiveSurface>;
}

import type { ReactNode } from 'react';

interface ToggleRowProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Labelled switch row — bigger tap target than a bare native checkbox. */
export function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left"
      style={{
        backgroundColor: checked ? 'var(--accent-soft)' : 'var(--bg)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
        color: 'var(--ink)',
      }}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && (
          <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>{description}</span>
        )}
      </span>
      <span
        className="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--border)' }}
        aria-hidden="true"
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
          style={{ left: checked ? '1.375rem' : '0.125rem', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        />
      </span>
    </button>
  );
}

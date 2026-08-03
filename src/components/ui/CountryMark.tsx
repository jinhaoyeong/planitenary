import { Globe } from 'lucide-react';
import { clsx } from 'clsx';

interface CountryMarkProps {
  /** ISO 3166-1 alpha-2 code. Omit or empty for the unset globe mark. */
  code?: string | null;
  className?: string;
  /** Slightly tighter mark for dense list rows. */
  compact?: boolean;
}

/**
 * Platform-stable country mark: ISO code badge instead of flag emoji.
 * Flag emoji render as colourful icons on iOS and as letters on many
 * desktop browsers — this keeps every device looking the same.
 */
export function CountryMark({ code, className, compact = false }: CountryMarkProps) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized || normalized.length !== 2) {
    return (
      <span
        className={clsx(
          'country-mark country-mark--empty inline-flex items-center justify-center shrink-0',
          compact ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-xl',
          className,
        )}
        style={{
          backgroundColor: 'color-mix(in srgb, var(--ink) 6%, var(--bg))',
          color: 'var(--ink-muted)',
          border: '1px solid var(--border)',
        }}
        aria-hidden="true"
      >
        <Globe className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'country-mark inline-flex items-center justify-center shrink-0 font-semibold tracking-[0.08em]',
        compact ? 'h-7 min-w-7 px-1.5 rounded-lg text-[10px]' : 'h-8 min-w-8 px-2 rounded-xl text-[11px]',
        className,
      )}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--accent) 14%, var(--bg))',
        color: 'var(--accent)',
        border: '1px solid color-mix(in srgb, var(--accent) 28%, var(--border))',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
      aria-hidden="true"
    >
      {normalized}
    </span>
  );
}

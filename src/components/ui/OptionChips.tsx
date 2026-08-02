import { Check } from 'lucide-react';
import type { OptionMeta } from '../../lib/tripProfile';

interface OptionChipsProps<T extends string> {
  options: OptionMeta<T>[];
  selected: T[];
  onToggle: (id: T) => void;
  /** Single-select groups render without the check affordance. */
  single?: boolean;
  columns?: 2 | 3;
}

export function OptionChips<T extends string>({
  options,
  selected,
  onToggle,
  single = false,
  columns = 2,
}: OptionChipsProps<T>) {
  return (
    <div className={`grid gap-2 ${columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {options.map((option) => {
        const active = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            className="text-left rounded-2xl px-4 py-3 transition-colors min-h-16"
            style={{
              backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--ink)',
            }}
            aria-pressed={active}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{option.label}</span>
              {active && !single && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />}
            </span>
            <span className="mt-1 block text-xs" style={{ color: 'var(--ink-muted)' }}>{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

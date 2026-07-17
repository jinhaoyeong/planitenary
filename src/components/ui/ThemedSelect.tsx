import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

type SelectChangeEvent = { target: { value: string } };

interface ThemedSelectProps {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: SelectChangeEvent) => void;
  className?: string;
  style?: CSSProperties;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

interface SelectOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

export function ThemedSelect({
  children,
  value,
  defaultValue,
  onChange,
  className,
  style,
  id,
  disabled = false,
  'aria-label': ariaLabel,
}: ThemedSelectProps) {
  const generatedId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const options: SelectOption[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
    options.push({
      value: String(child.props.value ?? ''),
      label: child.props.children,
      disabled: Boolean(child.props.disabled),
    });
  });

  const selectedValue = String(value ?? defaultValue ?? options[0]?.value ?? '');
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const gutter = 8;
      const menuWidth = Math.min(Math.max(rect.width, 220), viewportWidth - gutter * 2);
      const spaceBelow = viewportTop + viewportHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - viewportTop - gutter;
      const opensUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const availableHeight = opensUp ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, availableHeight));
      const preferredLeft = rect.left + rect.width - menuWidth;
      setMenuStyle({
        top: opensUp ? Math.max(viewportTop + gutter, rect.top - maxHeight - 6) : rect.bottom + 6,
        left: Math.max(gutter, Math.min(preferredLeft, viewportWidth - menuWidth - gutter)),
        width: menuWidth,
        maxHeight,
      });
    };
    updatePosition();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);

  const selectOption = (option: SelectOption) => {
    if (option.disabled) return;
    onChange?.({ target: { value: option.value } });
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveSelection = (direction: 1 | -1) => {
    const enabled = options.filter((option) => !option.disabled);
    const currentIndex = enabled.findIndex((option) => option.value === selectedValue);
    const nextIndex = (Math.max(currentIndex, 0) + direction + enabled.length) % enabled.length;
    if (enabled[nextIndex]) selectOption(enabled[nextIndex]);
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={id ?? generatedId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(event.key === 'ArrowDown' ? 1 : -1);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        className={clsx('editorial-select themed-select-trigger min-h-11 max-w-full flex items-center justify-between gap-3 text-left', className)}
        style={style}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown className={clsx('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} style={{ color: 'var(--accent)' }} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-labelledby={id ?? generatedId}
          data-lenis-prevent
          data-lenis-prevent-wheel
          data-lenis-prevent-touch
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          className="fixed z-[200] overflow-y-auto overscroll-contain rounded-2xl border p-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            ...menuStyle,
            backgroundColor: 'color-mix(in srgb, var(--bg-elevated) 96%, transparent)',
            borderColor: 'var(--border)',
            color: 'var(--ink)',
            touchAction: 'pan-y',
          }}
        >
          {options.map((option) => {
            const active = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => selectOption(option)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40"
                style={{
                  backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--ink)',
                }}
                onMouseEnter={(event) => {
                  if (!active) event.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--ink) 6%, transparent)';
                }}
                onMouseLeave={(event) => {
                  if (!active) event.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span className="min-w-0 break-words">{option.label}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

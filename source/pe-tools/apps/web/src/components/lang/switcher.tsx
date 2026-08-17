/**
 * SWITCHER — the exclusive mode switch, promoted from ui/ (ruled 2026-08-16, R10).
 *
 * CONSUMERS: /family workspace (overlay ⇄ live), /family doc pane (text ⇄ sheet),
 * /design-system/swatch.
 *
 * RULINGS EMBODIED: the active choice is a FILL (`--r-select`, the ground ladder's fourth
 * rung), never a hue — selection is a place you are standing, not a state of the data, so it
 * spends nothing from the meaning band and cannot be confused with commit or drift. Hover is
 * the one veil. Each option's `title` is REQUIRED: a mode whose consequence is not stated is
 * a mystery toggle.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

export function Switcher<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string; title: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <span role="group" aria-label={ariaLabel} className={cn("dl-switcher", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          title={option.title}
          aria-pressed={value === option.value}
          className="dl-switcher-opt"
          data-on={value === option.value ? "" : undefined}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

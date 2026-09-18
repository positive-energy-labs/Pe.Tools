/**
 * SWITCHER — the exclusive mode switch, promoted from ui/ (ruled 2026-08-16, R10).
 *
 * CONSUMERS: /family workspace (overlay ⇄ live), /family doc pane (text ⇄ sheet),
 * /design-system/swatch.
 *
 * RULINGS EMBODIED: the active choice is a FILL (`--pe-select`, the ground ladder's fourth
 * rung), never a hue — selection is a place you are standing, not a state of the data, so it
 * spends nothing from the meaning band and cannot be confused with commit or drift. Hover is
 * the one veil. Each option's `title` is REQUIRED: a mode whose consequence is not stated is
 * a mystery toggle.
 */
import { tv } from "#/lib/tv";

import "./lang.css";

export const switcherRecipe = tv({
  slots: {
    // The group carries the item height and the options fill it: a switcher and a `ActionButton` in one
    // pane header must measure the same, and a 20px option inside a bordered group is 22px
    // (two-height law, annotation round 2026-08-31).
    base: "inline-flex h-(--item-h) shrink-0 items-center rounded-sm border border-line-2",
    option:
      "veil h-full cursor-pointer border-0 bg-transparent px-1.5 t-small face-mono tracking-[0.05em] text-ink-2",
  },
  variants: {
    state: {
      rest: {},
      active: { option: "on-select text-ink" },
      disabled: { option: "cursor-not-allowed text-ink-mute italic" },
    },
  },
});

export function Switcher<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string; title: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const { base } = switcherRecipe();
  return (
    <span role="group" aria-label={ariaLabel} className={base()}>
      {options.map((option) => {
        const { option: optionSlot } = switcherRecipe({
          state: option.disabled ? "disabled" : value === option.value ? "active" : "rest",
        });
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
            title={option.title}
            aria-pressed={value === option.value}
            className={optionSlot()}
            data-on={value === option.value ? "" : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

import { reachProps } from "./reach";
/**
 * The exclusive mode switch. The active choice is the select fill, never a hue; hover is the one
 * veil. Each option's `title` is required: a mode whose consequence is not stated is a mystery toggle.
 */
import type { ReactNode } from "react";

import { tv } from "../../lib/tv";

import "./lang.css";
import { TooltipHint } from "./tooltip";
import { teachText, useTeach } from "./use-teach";

export const switcherRecipe = tv({
  slots: {
    // A segmented control wears `dl-control`, so it measures identical to a field beside it. The
    // options fill the frame edge to edge; the picked one is the select fill.
    base: "dl-control inline-flex shrink-0 items-stretch overflow-hidden",
    option:
      // Options are words a person picks, so they read in the body face (law 6: mono is what a
      // machine measured); a measured count inside a label brings its own `face-mono`.
      "veil cursor-pointer border-0 bg-transparent px-(--control-pad-x) t-small text-ink-2 ",
  },
  variants: {
    state: {
      rest: {},
      active: { option: "on-select font-semibold text-ink" },
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
  /** A label may carry a measured count beside its word (a lane's zones and calls). */
  options: ReadonlyArray<{ value: T; label: ReactNode; title: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  useTeach({
    kind: "modes",
    label: ariaLabel,
    options: options.map((option) => ({
      key: option.value,
      label: teachText(option.label),
      says: option.title,
      active: option.value === value,
      disabled: option.disabled,
    })),
  });
  const { base } = switcherRecipe();
  return (
    <span role="group" aria-label={ariaLabel} className={base()}>
      {options.map((option) => {
        const { option: optionSlot } = switcherRecipe({
          state: option.disabled ? "disabled" : value === option.value ? "active" : "rest",
        });
        return (
          <TooltipHint content={option.title} key={option.value}>
            <button
              {...reachProps()}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={option.disabled}
              aria-pressed={value === option.value}
              className={optionSlot()}
              data-on={value === option.value ? "" : undefined}
            >
              {option.label}
            </button>
          </TooltipHint>
        );
      })}
    </span>
  );
}

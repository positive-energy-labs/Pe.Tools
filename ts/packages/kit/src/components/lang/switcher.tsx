import { reachProps } from "./reach";
import { useRef, type ReactNode } from "react";

import { tv } from "../../lib/tv";

import "./lang.css";
import { TooltipHint } from "./tooltip";
import { teachText, useTeach } from "./use-teach";

export const switcherRecipe = tv({
  slots: {
    base: "dl-control inline-flex shrink-0 items-stretch overflow-hidden",
    option: "veil cursor-pointer border-0 bg-transparent px-(--control-pad-x) t-small text-ink-2 ",
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
  options: ReadonlyArray<{ value: T; label: ReactNode; title: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  useTeach(
    {
      kind: "modes",
      label: ariaLabel,
      options: options.map((option) => ({
        key: option.value,
        label: teachText(option.label),
        says: option.title,
        active: option.value === value,
        disabled: option.disabled,
      })),
    },
    true,
    host,
  );
  const { base } = switcherRecipe();
  return (
    <span ref={host} role="group" aria-label={ariaLabel} className={base()}>
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

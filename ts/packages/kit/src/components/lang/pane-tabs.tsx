import type { ReactNode } from "react";

import "./pane.css";
import { TooltipHint } from "./tooltip";

/** A controlled pane-view selector. The pane owns its body and each choice keeps its explanation. */
export function PaneTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: ReactNode; title: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="dl-pane-tabs" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <TooltipHint content={option.title} key={option.value}>
          <button
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        </TooltipHint>
      ))}
    </div>
  );
}

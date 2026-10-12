/**
 * HelpTip: region-level orientation, one hover away, beside a region's title (never on a control;
 * control facts are a `title`). Prose is sans. The note portals to the body and is `keepMounted`
 * so `aria-describedby` is a stable association.
 */
import { useId } from "react";

import { Tooltip, UiTooltipProvider } from "#/components/lang/tooltip";
import { tv } from "#/lib/tv";

import "./lang.css";

export const helpTipRecipe = tv({
  slots: {
    mark: "grid size-[13px] cursor-help place-items-center rounded-sm border border-line-2 bg-transparent p-0 t-small face-mono text-ink-2",
  },
});

interface HelpTipProps {
  /** The orientation prose. A few sentences at most — a HelpTip is not a manual. */
  children: React.ReactNode;
}

export function HelpTip({ children }: HelpTipProps) {
  const noteId = useId();
  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger
          type="button"
          kind="icon"
          aria-label="What is this?"
          aria-describedby={noteId}
        >
          ?
        </Tooltip.Trigger>
        <Tooltip.Portal keepMounted>
          <Tooltip.Positioner side="bottom" align="start" sideOffset={4}>
            <Tooltip.Popup id={noteId} role="note">
              {children}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}

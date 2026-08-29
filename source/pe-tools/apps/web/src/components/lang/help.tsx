/**
 * HELP TIP — region-level orientation, one hover away.
 *
 * CONSUMERS: /design-system §04 head (first); the /param-tables variants; the family workspace
 * and the two family prototypes, where it holds the prose that used to hide in long titles.
 *
 * THE BOUNDARY (ruled 2026-08-16, kaitpw — "make ? help a first-class primitive"):
 * - A `title` carries a CONTROL-level fact: what pressing does, why it refuses. Terse,
 *   machine-adjacent. Native titles continue everywhere; this does not replace them.
 * - A HelpTip orients a REGION: what this pane/section/table IS and how to think about it.
 *   It sits beside the region's title — one per region, never on a control.
 * - Inline explanatory prose baked into chrome is NEITHER, and dies: its content moves here
 *   or into a title, or it was decoration.
 *
 * Prose inside is SANS — orientation is human language, not a machine measurement.
 *
 * The note rides the repo's popover foundation (`ui/tooltip` over Base UI), so it portals to the
 * body instead of clipping inside the scroll regions its consumers actually sit in. The portal
 * is `keepMounted`, which is what makes `aria-describedby` a stable association rather than one
 * that exists only while the note is open — the reference resolves even while the note is
 * `hidden`, which is the whole point of describing a control with text it does not display.
 */
import { useId } from "react";

import { Tooltip, UiTooltipProvider } from "#/components/ui/tooltip";
import { tv } from "#/lib/tv";

import "./lang.css";

export const helpTipRecipe = tv({
  slots: {
    mark: "grid size-[13px] cursor-help place-items-center rounded-sm border border-line-2 bg-transparent p-0 face-mono t-caption text-ink-2",
    popup:
      "z-popup w-max max-w-[38ch] border border-line-2 bg-artifact px-2 py-[5px] t-label text-ink-2 [--pe-on:var(--pe-artifact)]",
  },
});

export interface HelpTipProps {
  /** The orientation prose. A few sentences at most — a HelpTip is not a manual. */
  children: React.ReactNode;
}

export function HelpTip({ children }: HelpTipProps) {
  const noteId = useId();
  const { mark, popup } = helpTipRecipe();
  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger
          type="button"
          className={mark()}
          aria-label="What is this?"
          aria-describedby={noteId}
        >
          ?
        </Tooltip.Trigger>
        <Tooltip.Portal keepMounted>
          <Tooltip.Positioner side="bottom" align="start" sideOffset={4}>
            <Tooltip.Popup id={noteId} className={popup()} role="note">
              {children}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}

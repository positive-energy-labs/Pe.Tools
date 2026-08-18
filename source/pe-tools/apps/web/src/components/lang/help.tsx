/**
 * HELP TIP — region-level orientation, one hover away.
 *
 * CONSUMERS: /design-system §04 head (first); soon — pane/page titles and section heads across
 * the swept routes, as the replacement for inline explanatory prose.
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
 * ponytail: CSS-only hover/focus reveal, absolutely positioned — no popover library, no portal.
 * Known ceiling: it clips inside overflow containers; when the shared popover foundation lands,
 * this rides it. Section heads — its habitat — rarely clip.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

export interface HelpTipProps {
  /** The orientation prose. A few sentences at most — a HelpTip is not a manual. */
  children: React.ReactNode;
  className?: string;
}

export function HelpTip({ children, className }: HelpTipProps) {
  return (
    <span className={cn("dl-help", className)}>
      <button type="button" className="dl-help-mark" aria-label="What is this?">
        ?
      </button>
      <span className="dl-help-pop" role="note">
        {children}
      </span>
    </span>
  );
}

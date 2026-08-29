import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

export type PaneKind = "navigation" | "visual" | "content" | "inspector";

export interface PaneProps {
  kind: PaneKind;
  title?: ReactNode;
  meta?: ReactNode;
  /** Header-right verb cluster. Plain JSX — real verb bars need variants, busy states, and
   * computed refusal titles that a typed action list cannot express. */
  actions?: ReactNode;
  toolbar?: ReactNode;
  scroll?: "auto" | "clip" | "visible";
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Kind owns chrome and scroll behavior only. Borders are PLACEMENT and belong to the layout
 * (PaneWorkspace slots / PaneSplit divider) — a navigation pane can sit on either side. */
const paneClasses: Record<PaneKind, string> = {
  navigation: "bg-page",
  visual: "bg-artifact",
  content: "bg-page",
  inspector: "bg-page",
};

const bodyClasses: Record<PaneKind, string> = {
  navigation: "overflow-y-auto",
  visual: "relative overflow-hidden",
  content: "overflow-auto",
  inspector: "overflow-y-auto p-2",
};

const scrollClasses = {
  auto: "overflow-auto",
  clip: "overflow-hidden",
  visible: "overflow-visible",
};

/** Flat drafting-table surface. Kind owns chrome and scrolling, never placement or size. */
export function Pane({
  kind,
  title,
  meta,
  actions,
  toolbar,
  scroll,
  children,
  className,
  bodyClassName,
}: PaneProps) {
  const hasHeader = title != null || meta != null || actions != null;

  return (
    <section
      data-slot="pane"
      data-kind={kind}
      className={cn(
        "flex size-full min-h-0 min-w-0 flex-col overflow-hidden",
        paneClasses[kind],
        className,
      )}
    >
      {hasHeader && (
        <div
          data-slot="pane-header"
          className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title != null && (
              // Pane titles are human heads — small-caps tracked SANS, never mono (heads law).
              <h2 className="t-label t-upper min-w-0 truncate text-ink-2">{title}</h2>
            )}
            {meta != null && (
              <span className="face-mono t-value min-w-0 truncate text-ink-2">{meta}</span>
            )}
          </div>
          {actions != null && (
            <div data-slot="pane-actions" className="flex shrink-0 items-center gap-0.5">
              {actions}
            </div>
          )}
        </div>
      )}

      {toolbar != null && (
        <div
          data-slot="pane-toolbar"
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1"
        >
          {toolbar}
        </div>
      )}

      <div
        data-slot="pane-body"
        className={cn(
          "min-h-0 min-w-0 flex-1",
          scroll ? scrollClasses[scroll] : bodyClasses[kind],
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export { PaneSplit } from "./pane-resize";
export type { PaneCollapseSpec, PaneSizeSpec, PaneSplitProps } from "./pane-resize";
export { PaneWorkspace } from "./pane-workspace";
export type { PaneWorkspaceProps } from "./pane-workspace";

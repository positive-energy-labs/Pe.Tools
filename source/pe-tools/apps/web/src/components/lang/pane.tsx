import type { ReactNode } from "react";

import { HelpTip } from "#/components/lang/help";
import { VerbChrome } from "#/components/lang/verb";
import { tv, type VariantProps } from "#/lib/tv";

export type PaneKind = "navigation" | "visual" | "content" | "inspector";

export const paneRecipe = tv({
  slots: {
    root: "flex size-full min-h-0 min-w-0 flex-col overflow-hidden",
    // A pane body is a COLUMN, so a call site that docks a region under a scroller does not need
    // a second scroller to get one (annotation round, 2026-08-31 — two stacked bars in the right
    // sidebar were a pane body scrolling around a child that also scrolled).
    body: "flex min-h-0 min-w-0 flex-1 flex-col",
  },
  variants: {
    kind: {
      navigation: { root: "bg-page", body: "overflow-y-auto" },
      visual: { root: "bg-artifact", body: "relative overflow-hidden" },
      content: { root: "bg-page", body: "overflow-auto" },
      inspector: { root: "bg-page", body: "overflow-y-auto p-2" },
    },
    scroll: {
      auto: { body: "overflow-auto" },
      clip: { body: "overflow-hidden" },
      visible: { body: "overflow-visible" },
    },
  },
});

export interface PaneProps extends Pick<VariantProps<typeof paneRecipe>, "scroll"> {
  kind: PaneKind;
  headerSurface?: "page" | "artifact" | "recess" | "document";
  title?: ReactNode;
  /**
   * A SHORT machine fact about what the pane is showing — a count, a mode word, a key. It
   * renders truncated on one line beside the title. Meta that cannot fit is not meta: prose
   * that orients the region belongs in `help` (ruled at the annotation round, 2026-08-31 —
   * a header that overflows is the primitive's defect, not the call site's).
   */
  meta?: ReactNode;
  /** Region orientation, one hover away. Renders as the header's `HelpTip`. */
  help?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function Pane({
  kind,
  headerSurface,
  title,
  meta,
  help,
  actions,
  toolbar,
  scroll,
  children,
}: PaneProps) {
  const hasHeader = title != null || meta != null || help != null || actions != null;
  const { root, body } = paneRecipe({ kind, scroll });
  return (
    <section data-slot="pane" data-kind={kind} className={root()}>
      {hasHeader && (
        <div
          data-slot="pane-header"
          data-surface={headerSurface}
          className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title != null && <h2 className="t-small t-upper min-w-0 truncate">{title}</h2>}
            {meta != null && (
              <span
                title={typeof meta === "string" ? meta : undefined}
                className="face-mono min-w-0 truncate text-ink-2"
              >
                {meta}
              </span>
            )}
            {help != null && (
              <span className="shrink-0 self-center">
                <HelpTip>{help}</HelpTip>
              </span>
            )}
          </div>
          {actions != null && (
            <div data-slot="pane-actions" className="flex shrink-0 items-center gap-0.5">
              {/* A header is chrome: a verb's refusal hovers, it does not wrap (see `VerbChrome`). */}
              <VerbChrome value>{actions}</VerbChrome>
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
      <div data-slot="pane-body" className={body()}>
        {children}
      </div>
    </section>
  );
}

export { PaneSplit } from "./pane-resize";
export type { PaneCollapseSpec, PaneSizeSpec, PaneSplitProps } from "./pane-resize";
export { PaneWorkspace } from "./pane-workspace";
export type { PaneWorkspaceProps } from "./pane-workspace";

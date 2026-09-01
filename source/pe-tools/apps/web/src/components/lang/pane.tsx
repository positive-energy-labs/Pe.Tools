import type { ReactNode } from "react";

import { tv, type VariantProps } from "#/lib/tv";

export type PaneKind = "navigation" | "visual" | "content" | "inspector";

export const paneRecipe = tv({
  slots: {
    root: "flex size-full min-h-0 min-w-0 flex-col overflow-hidden",
    body: "min-h-0 min-w-0 flex-1",
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
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function Pane({ kind, title, meta, actions, toolbar, scroll, children }: PaneProps) {
  const hasHeader = title != null || meta != null || actions != null;
  const { root, body } = paneRecipe({ kind, scroll });
  return (
    <section data-slot="pane" data-kind={kind} className={root()}>
      {hasHeader && (
        <div
          data-slot="pane-header"
          className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {title != null && (
              <h2 className="t-label t-upper min-w-0 truncate text-ink-2">{title}</h2>
            )}
            {meta != null && <span className="face-mono min-w-0 truncate text-ink-2">{meta}</span>}
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

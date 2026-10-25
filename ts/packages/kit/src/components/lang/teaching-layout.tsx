import type { ComponentProps, ReactNode } from "react";
import { PaneSplit } from "./pane-resize";
import type { TeachingLayout } from "./teach";

/** Runtime policy supplies resize/fold state; the declaration owns topology and initial sizes. */
export function TeachingLayoutView({
  layout,
  panes,
  resize,
}: {
  layout: TeachingLayout;
  panes: Readonly<Record<string, ReactNode>>;
  resize: Readonly<
    Record<
      string,
      Omit<NonNullable<ComponentProps<typeof PaneSplit>["resize"]>, "defaultSize" | "target">
    >
  >;
}): ReactNode {
  if (layout.id in panes || !("axis" in layout)) return panes[layout.id];
  return (
    <PaneSplit
      axis={layout.axis}
      resize={{
        ...resize[layout.id],
        minSize: resize[layout.id]?.minSize ?? 0,
        target: layout.target,
        defaultSize: layout.size,
      }}
      start={<TeachingLayoutView layout={layout.start} panes={panes} resize={resize} />}
      end={<TeachingLayoutView layout={layout.end} panes={panes} resize={resize} />}
    />
  );
}

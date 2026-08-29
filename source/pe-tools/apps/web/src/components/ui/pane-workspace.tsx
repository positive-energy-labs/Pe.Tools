import { useRef, type CSSProperties, type ReactNode } from "react";

import { cn } from "#/lib/utils";
import { tv } from "#/lib/tv";

import { PaneResizeHandle, type PaneSizeSpec, usePaneFit, usePaneSize } from "./pane-resize";

export interface PaneWorkspaceProps {
  navigation?: ReactNode;
  visual: ReactNode;
  content: ReactNode;
  inspector?: ReactNode;
  inspectorSpan?: "visual" | "full";
  resize?: {
    navigation?: PaneSizeSpec;
    visual?: PaneSizeSpec;
    inspector?: PaneSizeSpec;
  };
  grow?: boolean;
}

const NAV_DEFAULT: PaneSizeSpec = { defaultSize: 288, minSize: 200 };
const VISUAL_DEFAULT: PaneSizeSpec = { defaultSize: 340, minSize: 140 };
const INSPECTOR_DEFAULT: PaneSizeSpec = { defaultSize: 320, minSize: 240 };

export const paneWorkspaceRecipe = tv({
  base: "grid size-full min-h-0 min-w-0 overflow-hidden",
  variants: { grow: { true: "min-h-0 flex-1" } },
});

/** Canonical takeoff-shaped workspace: navigation | visual/inspector over full-width content. */
export function PaneWorkspace({
  navigation,
  visual,
  content,
  inspector,
  inspectorSpan = "visual",
  resize,
  grow,
}: PaneWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigationSpec = resize?.navigation ?? NAV_DEFAULT;
  const visualSpec = resize?.visual ?? VISUAL_DEFAULT;
  const inspectorSpec = resize?.inspector ?? INSPECTOR_DEFAULT;
  const navigationState = usePaneSize(navigationSpec);
  const visualState = usePaneSize(visualSpec);
  const inspectorState = usePaneSize(inspectorSpec);
  const hasNavigationHandle = navigation != null && resize?.navigation != null;
  const hasVisualHandle = resize?.visual != null;
  const hasInspectorHandle = inspector != null && resize?.inspector != null;

  const rootSize = (axis: "horizontal" | "vertical") => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect ? (axis === "horizontal" ? rect.width : rect.height) : undefined;
  };

  usePaneFit(rootRef, (rect) => {
    navigationState.fit(rect.width);
    inspectorState.fit(rect.width);
    visualState.fit(rect.height);
  });

  const style = {
    gridTemplateColumns: `${navigation ? navigationState.renderedSize : 0}px ${hasNavigationHandle ? 8 : 0}px minmax(0, 1fr) ${hasInspectorHandle ? 8 : 0}px ${inspector ? inspectorState.renderedSize : 0}px`,
    gridTemplateRows: `${visualState.renderedSize}px ${hasVisualHandle ? 8 : 0}px minmax(0, 1fr)`,
  } satisfies CSSProperties;

  return (
    <div
      ref={rootRef}
      data-slot="pane-workspace"
      data-inspector-span={inspectorSpan}
      className={paneWorkspaceRecipe({ grow })}
      style={style}
    >
      {navigation != null && (
        <div
          className="min-h-0 min-w-0 overflow-hidden border-r border-line"
          style={{ gridColumn: 1, gridRow: "1 / 4" }}
        >
          {navigation}
        </div>
      )}

      {hasNavigationHandle && (
        <PaneResizeHandle
          axis="horizontal"
          value={navigationState.renderedSize}
          startValue={navigationState.collapsed ? navigationSpec.minSize : navigationState.size}
          min={navigationSpec.minSize}
          max={navigationSpec.maxSize}
          growth={1}
          containerSize={() => rootSize("horizontal")}
          onResize={navigationState.resizeTo}
          onReset={navigationState.reset}
          className="col-start-2 row-start-1 row-span-3"
        />
      )}

      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: 3, gridRow: 1 }}>
        {visual}
      </div>

      {inspector != null && (
        <div
          className="min-h-0 min-w-0 overflow-hidden border-l border-line"
          style={{ gridColumn: 5, gridRow: inspectorSpan === "full" ? "1 / 4" : 1 }}
        >
          {inspector}
        </div>
      )}

      {hasInspectorHandle && (
        <PaneResizeHandle
          axis="horizontal"
          value={inspectorState.renderedSize}
          startValue={inspectorState.collapsed ? inspectorSpec.minSize : inspectorState.size}
          min={inspectorSpec.minSize}
          max={inspectorSpec.maxSize}
          growth={-1}
          containerSize={() => rootSize("horizontal")}
          onResize={inspectorState.resizeTo}
          onReset={inspectorState.reset}
          className={cn("col-start-4 row-start-1", inspectorSpan === "full" && "row-span-3")}
        />
      )}

      {hasVisualHandle && (
        <PaneResizeHandle
          axis="vertical"
          value={visualState.renderedSize}
          startValue={visualState.collapsed ? visualSpec.minSize : visualState.size}
          min={visualSpec.minSize}
          max={visualSpec.maxSize}
          growth={1}
          containerSize={() => rootSize("vertical")}
          onResize={visualState.resizeTo}
          onReset={visualState.reset}
          className={cn("col-start-3 row-start-2", inspectorSpan === "visual" && "col-span-3")}
        />
      )}

      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={{ gridColumn: inspectorSpan === "visual" ? "3 / 6" : 3, gridRow: 3 }}
      >
        {content}
      </div>
    </div>
  );
}

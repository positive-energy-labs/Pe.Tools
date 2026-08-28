import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

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

/** Collapse leaves the pane's own chrome visible (`collapsedSize` ≈ toolbar height) so the
 * re-expand affordance lives IN the pane — no separate rail node to design. */
export interface PaneCollapseSpec {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  collapsedSize?: number;
  collapseBelow?: number;
}

export interface PaneSizeSpec {
  defaultSize: number;
  minSize: number;
  maxSize?: number;
  minOtherSize?: number;
  persist?: string;
  onSizeChange?: (size: number) => void;
  collapse?: PaneCollapseSpec;
}

interface PaneSizeState {
  size: number;
  collapsed: boolean;
  renderedSize: number;
  resizeTo: (size: number, containerSize: number | undefined, commit: boolean) => void;
  /** Re-clamp against a measured container. Hydrated/persisted sizes are clamped only here —
   * `minOtherSize` is meaningless until the container has a real size — and never persisted,
   * so a small window doesn't overwrite the size the user actually chose. */
  fit: (containerSize: number | undefined) => void;
  reset: () => void;
}

function clampSize(size: number, spec: PaneSizeSpec, containerSize?: number) {
  const containerMax =
    containerSize == null || containerSize <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(spec.minSize, containerSize - (spec.minOtherSize ?? 0));
  const max = Math.min(spec.maxSize ?? Number.POSITIVE_INFINITY, containerMax);
  return Math.round(Math.max(spec.minSize, Math.min(max, size)));
}

function storedSize(spec: PaneSizeSpec) {
  if (!spec.persist || typeof window === "undefined") return spec.defaultSize;
  try {
    const stored = window.localStorage.getItem(spec.persist);
    if (stored == null) return spec.defaultSize;
    const saved = Number(stored);
    return Number.isFinite(saved) ? clampSize(saved, spec) : spec.defaultSize;
  } catch {
    return spec.defaultSize;
  }
}

function usePaneSize(spec: PaneSizeSpec): PaneSizeState {
  const [internalSize, setInternalSize] = useState(() => storedSize(spec));
  const [collapsedInternal, setCollapsedInternal] = useState(false);
  const size = clampSize(internalSize, spec);
  const collapsed = spec.collapse?.collapsed ?? collapsedInternal;

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (spec.collapse?.collapsed === undefined) setCollapsedInternal(next);
      spec.collapse?.onCollapsedChange?.(next);
    },
    [spec.collapse],
  );

  useEffect(() => {
    setInternalSize((current) => clampSize(current, spec));
  }, [spec]);

  const resizeTo = useCallback(
    (requested: number, containerSize: number | undefined, commit: boolean) => {
      const threshold = spec.collapse?.collapseBelow;
      if (threshold != null && requested < threshold) {
        setCollapsed(true);
        return;
      }

      if (collapsed) setCollapsed(false);
      const next = clampSize(requested, spec, containerSize);
      setInternalSize(next);
      spec.onSizeChange?.(next);
      if (commit && spec.persist && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(spec.persist, String(next));
        } catch {
          // Persistence is best-effort; layout must remain usable when storage is unavailable.
        }
      }
    },
    [collapsed, setCollapsed, spec],
  );

  const specRef = useRef(spec);
  specRef.current = spec;
  const fit = useCallback((containerSize: number | undefined) => {
    if (containerSize == null || containerSize <= 0) return;
    setInternalSize((current) => clampSize(current, specRef.current, containerSize));
  }, []);

  const reset = useCallback(() => {
    setCollapsed(false);
    resizeTo(spec.defaultSize, undefined, true);
  }, [resizeTo, setCollapsed, spec.defaultSize]);

  return {
    size,
    collapsed,
    renderedSize: collapsed ? (spec.collapse?.collapsedSize ?? 0) : size,
    resizeTo,
    fit,
    reset,
  };
}

/** Keep a pane size honest against its measured container — at mount and on every container
 * resize — closing the gap where a persisted size starves the other side until first drag. */
function usePaneFit(
  ref: React.RefObject<HTMLDivElement | null>,
  measure: (rect: DOMRectReadOnly) => void,
) {
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measureRef.current(el.getBoundingClientRect());
    if (typeof ResizeObserver === "undefined") return; // jsdom — the initial measure is all there is
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measureRef.current(entry.contentRect);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

const KEYBOARD_STEP_PX = 16;

interface PaneResizeHandleProps {
  axis: "horizontal" | "vertical";
  value: number;
  startValue?: number;
  min: number;
  max?: number;
  growth: 1 | -1;
  containerSize: () => number | undefined;
  onResize: (size: number, containerSize: number | undefined, commit: boolean) => void;
  onReset: () => void;
  className?: string;
}

function PaneResizeHandle({
  axis,
  value,
  startValue = value,
  min,
  max,
  growth,
  containerSize,
  onResize,
  onReset,
  className,
}: PaneResizeHandleProps) {
  const drag = useRef<{ point: number; size: number; latest: number } | null>(null);
  const coordinate = (event: Pick<PointerEvent<HTMLDivElement>, "clientX" | "clientY">) =>
    axis === "horizontal" ? event.clientX : event.clientY;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { point: coordinate(event), size: startValue, latest: startValue };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.size + growth * (coordinate(event) - drag.current.point);
    drag.current.latest = next;
    onResize(next, containerSize(), false);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.latest;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResize(next, containerSize(), true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const negative = axis === "horizontal" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const positive = axis === "horizontal" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!negative && !positive && event.key !== "Home") return;
    event.preventDefault();
    if (event.key === "Home") {
      onReset();
      return;
    }
    const direction = positive ? 1 : -1;
    onResize(value + growth * direction * KEYBOARD_STEP_PX, containerSize(), true);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label="Resize pane"
      title="Drag or use arrow keys to resize · Home or double-click resets"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={cn(
        // Hover buys no hue (the one hover law): the gutter lifts with the neutral veil.
        "group z-20 flex touch-none items-center justify-center bg-recess/50 outline-none hover:veil focus-visible:veil",
        axis === "horizontal" ? "h-full w-2 cursor-col-resize" : "h-2 w-full cursor-row-resize",
        className,
      )}
    >
      <span
        className={cn(
          "bg-line-2 group-hover:bg-ink-2 group-focus-visible:bg-ink-2",
          axis === "horizontal" ? "h-8 w-px" : "h-px w-8",
        )}
      />
    </div>
  );
}

export interface PaneSplitProps {
  axis: "horizontal" | "vertical";
  start: ReactNode;
  end: ReactNode;
  resize?: PaneSizeSpec & { target: "start" | "end" };
  className?: string;
}

const NO_RESIZE: PaneSizeSpec = { defaultSize: 0, minSize: 0 };

/** Binary compositional escape hatch. Resize config is absent when the relationship is fixed. */
export function PaneSplit({ axis, start, end, resize, className }: PaneSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const state = usePaneSize(resize ?? NO_RESIZE);
  const horizontal = axis === "horizontal";
  const target = resize?.target ?? "start";
  const targetStyle: CSSProperties = horizontal
    ? { width: state.renderedSize }
    : { height: state.renderedSize };

  const measuredContainer = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect ? (horizontal ? rect.width : rect.height) : undefined;
  };

  usePaneFit(rootRef, (rect) => state.fit(horizontal ? rect.width : rect.height));

  const renderSide = (side: "start" | "end", child: ReactNode) => {
    const sized = resize != null && side === target;
    return (
      <div
        className={cn(
          "min-h-0 min-w-0 overflow-hidden",
          sized ? "shrink-0" : "flex-1",
          // A fixed split has no handle to draw the seam — the end side carries the hairline.
          resize == null && side === "end" && (horizontal ? "border-l" : "border-t"),
          resize == null && side === "end" && "border-line",
        )}
        style={sized ? targetStyle : undefined}
      >
        {child}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      data-slot="pane-split"
      data-axis={axis}
      className={cn(
        "flex size-full min-h-0 min-w-0 overflow-hidden",
        horizontal ? "flex-row" : "flex-col",
        className,
      )}
    >
      {renderSide("start", start)}
      {resize && (
        <PaneResizeHandle
          axis={axis}
          value={state.renderedSize}
          startValue={state.collapsed ? resize.minSize : state.size}
          min={resize.minSize}
          max={resize.maxSize}
          growth={target === "start" ? 1 : -1}
          containerSize={measuredContainer}
          onResize={state.resizeTo}
          onReset={state.reset}
        />
      )}
      {renderSide("end", end)}
    </div>
  );
}

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
  className?: string;
}

const NAV_DEFAULT: PaneSizeSpec = { defaultSize: 288, minSize: 200 };
const VISUAL_DEFAULT: PaneSizeSpec = { defaultSize: 340, minSize: 140 };
const INSPECTOR_DEFAULT: PaneSizeSpec = { defaultSize: 320, minSize: 240 };

/** Canonical takeoff-shaped workspace: navigation | visual/inspector over full-width content. */
export function PaneWorkspace({
  navigation,
  visual,
  content,
  inspector,
  inspectorSpan = "visual",
  resize,
  className,
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
      className={cn("grid size-full min-h-0 min-w-0 overflow-hidden", className)}
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

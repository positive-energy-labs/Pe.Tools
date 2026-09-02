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

import { tv } from "#/lib/tv";

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

export function usePaneSize(spec: PaneSizeSpec): PaneSizeState {
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
export function usePaneFit(
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
}

const paneResizeHandleRecipe = tv({
  slots: {
    root: "veil group z-raised flex touch-none items-center justify-center bg-recess/50 outline-none",
    bar: "bg-line-2 group-hover:bg-ink-2 group-focus-visible:bg-ink-2",
  },
  variants: {
    axis: {
      horizontal: { root: "h-full w-2 cursor-col-resize", bar: "h-8 w-px" },
      vertical: { root: "h-2 w-full cursor-row-resize", bar: "h-px w-8" },
    },
  },
});

export function PaneResizeHandle({
  axis,
  value,
  startValue = value,
  min,
  max,
  growth,
  containerSize,
  onResize,
  onReset,
}: PaneResizeHandleProps) {
  const { root, bar } = paneResizeHandleRecipe({ axis });
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
      className={root()}
    >
      <span className={bar()} />
    </div>
  );
}

export interface PaneSplitProps {
  axis: "horizontal" | "vertical";
  start: ReactNode;
  end: ReactNode;
  resize?: PaneSizeSpec & { target: "start" | "end" };
  grow?: boolean;
}

const NO_RESIZE: PaneSizeSpec = { defaultSize: 0, minSize: 0 };

export const paneSplitRecipe = tv({
  base: "flex size-full min-h-0 min-w-0 overflow-hidden",
  variants: {
    axis: { horizontal: "flex-row", vertical: "flex-col" },
    grow: { true: "min-h-0 flex-1" },
  },
});

/** Binary compositional escape hatch. Resize config is absent when the relationship is fixed. */
export function PaneSplit({ axis, start, end, resize, grow }: PaneSplitProps) {
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
        className={[
          "min-h-0 min-w-0 overflow-hidden",
          sized ? "shrink-0" : "flex-1",
          // A fixed split has no handle to draw the seam — the end side carries the hairline.
          resize == null && side === "end" && (horizontal ? "border-l" : "border-t"),
          resize == null && side === "end" && "border-line",
        ]
          .filter(Boolean)
          .join(" ")}
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
      className={paneSplitRecipe({ axis, grow })}
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

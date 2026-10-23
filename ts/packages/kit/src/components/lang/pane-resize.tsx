import {
  isValidElement,
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

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { Button } from "./button";
import { tv } from "../../lib/tv";
import { TooltipHint } from "./tooltip";

/** Collapse shrinks the target to `collapsedSize`. With `title` the split draws a rail there (the
 * title rotated under an expand press); without it the pane's own header stays as the affordance. */
interface PaneCollapseSpec {
  collapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  collapsedSize?: number;
  collapseBelow?: number;
  title?: string;
  /** The rail stays drawn but its expand press is inert, and says why (nothing to open yet). */
  refusal?: string;
}

interface PaneSizeSpec {
  defaultSize: number;
  minSize: number;
  maxSize?: number;
  minOtherSize?: number;
  persist?: string;
  collapse?: PaneCollapseSpec;
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
    const saved = Number(window.localStorage.getItem(spec.persist) ?? spec.defaultSize);
    return Number.isFinite(saved) ? clampSize(saved, spec) : spec.defaultSize;
  } catch {
    return spec.defaultSize;
  }
}

function usePaneSize(spec: PaneSizeSpec) {
  const [internalSize, setInternalSize] = useState(() => storedSize(spec));
  const collapsed = spec.collapse?.collapsed ?? false;

  const current = useRef(spec);
  current.current = spec;
  // Container fitting never persists: a small window must not overwrite the chosen size.
  const fit = useCallback((containerSize?: number) => {
    setInternalSize((size) => clampSize(size, current.current, containerSize));
  }, []);
  useEffect(() => fit(), [fit, spec.minSize, spec.maxSize]);

  const resizeTo = (requested: number, containerSize?: number) => {
    const threshold = spec.collapse?.collapseBelow;
    if (threshold != null && requested < threshold) {
      spec.collapse?.onCollapsedChange?.(true);
      return;
    }

    if (collapsed) spec.collapse?.onCollapsedChange?.(false);
    const next = clampSize(requested, spec, containerSize);
    setInternalSize(next);
    if (spec.persist && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(spec.persist, String(next));
      } catch {
        // Persistence is best-effort; layout must remain usable when storage is unavailable.
      }
    }
  };

  return {
    collapsed,
    renderedSize: collapsed ? (spec.collapse?.collapsedSize ?? 0) : clampSize(internalSize, spec),
    resizeTo,
    fit,
    reset: () => resizeTo(spec.defaultSize),
  };
}

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
}

// The handle IS the seam between two panes: a full-length hairline, so two panes on one ground
// never read as one field (chat polish, 2026-10-11 — the sidebar and the conversation had only an
// 8px gap and a 32px grip between them). Hover and focus darken the whole seam, not a grip.
const paneResizeHandleRecipe = tv({
  slots: {
    root: "group relative z-raised flex touch-none items-center justify-center outline-none",
    bar: "bg-line transition-colors duration-control group-hover:bg-ink-2 group-focus-visible:bg-ink-2 group-active:bg-ink motion-reduce:transition-none",
  },
  variants: {
    axis: {
      horizontal: { root: "h-full w-(--gutter) cursor-col-resize", bar: "h-full w-px" },
      vertical: { root: "h-(--gutter) w-full cursor-row-resize", bar: "h-px w-full" },
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
  const seam = useRef<HTMLDivElement>(null);
  const [extent, setExtent] = useState<number | null>(null);
  usePaneFit(seam, (rect) => {
    const size = axis === "horizontal" ? rect.height : rect.width;
    setExtent(size > 0 ? size : null);
  });
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
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onResize(next, containerSize(), true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const negative = axis === "horizontal" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const positive = axis === "horizontal" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!negative && !positive && event.key !== "Home") return;
    event.preventDefault();
    if (event.key === "Home") return onReset();
    const direction = positive ? 1 : -1;
    onResize(value + growth * direction * KEYBOARD_STEP_PX, containerSize(), true);
  };

  return (
    <TooltipHint content="Drag or use arrow keys to resize · Home or double-click resets">
      <div
        ref={seam}
        data-slot="pane-resize"
        data-axis={axis}
        role="separator"
        tabIndex={0}
        aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        data-surface="page"
        aria-label="Resize pane"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyDown={onKeyDown}
        onDoubleClick={onReset}
        className={root()}
      >
        <span className={bar()} />
        {extent != null && (
          <>
            <span
              data-slot="pane-resize-grip"
              data-corner="center"
              className={`absolute bg-line-2 ${axis === "horizontal" ? "h-(--control-h) w-px" : "h-px w-(--control-h)"}`}
              style={
                axis === "horizontal"
                  ? { top: extent / 2, left: "50%", translate: "-50% -50%" }
                  : { left: extent / 2, top: "50%", translate: "-50% -50%" }
              }
            />
            {(["tr", "bl"] as const).map((corner) => (
              <span
                key={corner}
                data-slot="pane-resize-grip"
                data-corner={corner}
                className={`absolute size-(--gutter) border-line-2 ${corner === "tr" ? "right-0 top-0 border-r border-t" : "bottom-0 left-0 border-b border-l"}`}
              />
            ))}
          </>
        )}
      </div>
    </TooltipHint>
  );
}

interface PaneSplitProps {
  axis: "horizontal" | "vertical";
  start: ReactNode;
  end: ReactNode;
  resize?: PaneSizeSpec & { target: "start" | "end" };
  /** A side that stays mounted and takes no track: its pane keeps its state while it is not drawn. */
  hide?: "start" | "end";
  grow?: boolean;
}

const NO_RESIZE: PaneSizeSpec = { defaultSize: 0, minSize: 0 };

export const paneSplitRecipe = tv({
  base: "grid size-full min-h-0 min-w-0 overflow-visible",
  variants: {
    axis: { horizontal: "", vertical: "" },
    grow: { true: "min-h-0 flex-1" },
  },
});

/** Binary compositional escape hatch. Null sides retain their wrappers but consume no track. */
export function PaneSplit({ axis, start, end, resize, hide, grow }: PaneSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const state = usePaneSize(resize ?? NO_RESIZE);
  const [stacked, setStacked] = useState(false);
  const horizontal = axis === "horizontal" && !stacked;
  const bothSides = start != null && end != null && hide == null;
  const target = resize?.target ?? "start";
  const tracks = !bothSides
    ? "minmax(0, 1fr)"
    : resize == null || stacked
      ? "minmax(0, 1fr) var(--gutter) minmax(0, 1fr)"
      : target === "start"
        ? `var(--pane-size, ${state.renderedSize}px) var(--gutter) minmax(0, 1fr)`
        : `minmax(0, 1fr) var(--gutter) var(--pane-size, ${state.renderedSize}px)`;
  const gridStyle: CSSProperties = horizontal
    ? { gridTemplateColumns: tracks }
    : { gridTemplateRows: tracks };

  const seamSize = () =>
    rootRef.current
      ? parseFloat(getComputedStyle(rootRef.current).getPropertyValue("--gutter")) || 0
      : 0;
  const measuredContainer = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect ? (horizontal ? rect.width : rect.height) - seamSize() : undefined;
  };

  usePaneFit(rootRef, (rect) => {
    const gutter = seamSize();
    const constrained =
      bothSides &&
      axis === "horizontal" &&
      resize != null &&
      rect.width > 0 &&
      rect.width < resize.minSize + (resize.minOtherSize ?? 0) + gutter;
    // A supporting rail yields before the subject loses its minimum width. Splits without a
    // collapse affordance stack instead, so neither mounted pane becomes a zero-width field.
    const stack = constrained && resize?.collapse?.title == null;
    setStacked(stack);
    if (constrained && resize?.collapse?.title != null && !state.collapsed)
      resize.collapse.onCollapsedChange?.(true);
    if (!stack) state.fit((axis === "horizontal" ? rect.width : rect.height) - gutter);
  });

  const railTitle = resize?.collapse?.title;
  const renderSide = (side: "start" | "end", child: ReactNode) => {
    const rail = railTitle != null && state.collapsed && side === target && child != null;
    const style = horizontal
      ? { gridColumn: bothSides ? (side === "start" ? 1 : 3) : 1, gridRow: 1 }
      : { gridColumn: 1, gridRow: bothSides ? (side === "start" ? 1 : 3) : 1 };
    return (
      <>
        {rail && (
          <div
            data-slot="pane-rail"
            // A rail lies along its split: upright beside a column, flat under a row.
            className={
              horizontal
                ? "flex min-h-0 flex-col items-center gap-2 py-2"
                : "flex min-w-0 items-center gap-2 px-2"
            }
            style={style}
          >
            <Button
              label={`Expand ${railTitle}`}
              icon={
                horizontal
                  ? side === "start"
                    ? ChevronRight
                    : ChevronLeft
                  : side === "start"
                    ? ChevronDown
                    : ChevronUp
              }
              refusal={resize?.collapse?.refusal}
              onClick={() => resize?.collapse?.onCollapsedChange?.(false)}
            />
            <span
              data-slot="pane-rail-title"
              className={`${horizontal ? "[writing-mode:vertical-rl]" : "min-w-0 truncate"} data-[disabled]:text-ink-mute`}
              data-disabled={resize?.collapse?.refusal != null || undefined}
            >
              {railTitle}
            </span>
          </div>
        )}
        {/* A collapsed side under a rail stays mounted, so its pane keeps its state. */}
        <div
          data-surface={
            bothSides &&
            (resize
              ? side === resize.target
              : !(isValidElement<{ grow?: boolean }>(child) && child.props.grow))
              ? "support"
              : undefined
          }
          className={
            child == null || hide === side || rail
              ? "hidden"
              : "flex min-h-0 min-w-0 flex-col overflow-visible"
          }
          style={style}
        >
          {child}
        </div>
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      data-slot="pane-split"
      data-axis={horizontal ? "horizontal" : "vertical"}
      data-surface="page"
      className={paneSplitRecipe({ axis, grow })}
      style={gridStyle}
    >
      {renderSide("start", start)}
      {bothSides && resize && !stacked && (
        <div
          className="size-full min-h-0 min-w-0"
          style={horizontal ? { gridColumn: 2, gridRow: 1 } : { gridColumn: 1, gridRow: 2 }}
        >
          <PaneResizeHandle
            axis={horizontal ? "horizontal" : "vertical"}
            value={state.renderedSize}
            startValue={state.collapsed ? resize.minSize : state.renderedSize}
            min={resize.minSize}
            max={resize.maxSize}
            growth={target === "start" ? 1 : -1}
            containerSize={measuredContainer}
            onResize={(requested, container, commit) => {
              // Pointer motion belongs to layout; React owns only the released size/collapse.
              if (commit) {
                rootRef.current?.style.removeProperty("--pane-size");
                state.resizeTo(requested, container);
              } else
                rootRef.current?.style.setProperty(
                  "--pane-size",
                  `${clampSize(requested, resize, container)}px`,
                );
            }}
            onReset={state.reset}
          />
        </div>
      )}
      {renderSide("end", end)}
    </div>
  );
}

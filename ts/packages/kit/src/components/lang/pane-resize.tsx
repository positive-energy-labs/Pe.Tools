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
  /** What the collapsed pane holds open (its tabs), drawn on the rail under the title. */
  head?: ReactNode;
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
    if (threshold != null && requested < threshold) return spec.collapse?.onCollapsedChange?.(true);

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

/** Keep drawing buffers and projection observers at their committed layout until release. */
function holdPictures(
  split: HTMLElement | null,
  axis: "horizontal" | "vertical",
  growth: number,
  resize: (size: number) => number,
) {
  const pictures = [...(split?.querySelectorAll<HTMLElement>("[data-picture]") ?? [])]
    .filter((node) => !node.parentElement?.closest("[data-picture]"))
    .flatMap((node) => {
      const { clientWidth: width, clientHeight: height } = node;
      if (!width || !height) return [];
      const style = node.style.cssText;
      const sign = split?.firstElementChild?.contains(node) ? growth : -growth;
      return [{ node, width, height, style, sign }];
    });
  for (const { node, width, height } of pictures) {
    node.style.cssText += `;width:${width}px;height:${height}px;flex:none;transform-origin:top left`;
    node.dataset.paneResizing = "";
  }
  let frame = 0;
  return (size?: number) => {
    if (frame) cancelAnimationFrame(frame);
    if (size == null) {
      for (const { node, style } of pictures) {
        node.style.cssText = style;
        delete node.dataset.paneResizing;
      }
    } else
      frame = requestAnimationFrame(() => {
        const delta = resize(size);
        for (const { node, width, height, sign } of pictures)
          node.style.scale = `${1 + (axis === "horizontal" ? (delta * sign) / width : 0)} ${1 + (axis === "vertical" ? (delta * sign) / height : 0)}`;
      });
  };
}

interface PaneResizeHandleProps {
  axis: "horizontal" | "vertical";
  split: React.RefObject<HTMLDivElement | null>;
  state: ReturnType<typeof usePaneSize>;
  spec: PaneSizeSpec & { target: "start" | "end" };
  containerSize: () => number | undefined;
}

function PaneResizeHandle({ axis, split, state, spec, containerSize }: PaneResizeHandleProps) {
  const value = state.renderedSize,
    growth = spec.target === "start" ? 1 : -1;
  const onResize = (requested: number, container: number | undefined, commit: boolean) => {
    // Restore the committed size before a refused/no-op commit can strand the preview.
    const size = commit ? value : clampSize(requested, spec, container);
    split.current?.style.setProperty("--pane-size", `${size}px`);
    if (commit) state.resizeTo(requested, container);
    return size;
  };
  const drag = useRef<{
    point: number;
    size: number;
    latest: number;
    container: number | undefined;
    paint: ReturnType<typeof holdPictures>;
  } | null>(null);
  useEffect(() => () => drag.current?.paint(), []);
  const coordinate = (event: Pick<PointerEvent<HTMLDivElement>, "clientX" | "clientY">) =>
    axis === "horizontal" ? event.clientX : event.clientY;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const container = containerSize(),
      startValue = state.collapsed ? spec.minSize : value;
    drag.current = {
      point: coordinate(event),
      size: startValue,
      latest: startValue,
      container,
      paint: holdPictures(
        event.currentTarget.closest('[data-slot="pane-split"]'),
        axis,
        growth,
        (size) => onResize(size, container, false) - value,
      ),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.size + growth * (coordinate(event) - drag.current.point);
    drag.current.latest = next;
    drag.current.paint(next);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { latest, container, paint } = drag.current;
    paint();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onResize(latest, container, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const negative = axis === "horizontal" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const positive = axis === "horizontal" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!negative && !positive && event.key !== "Home") return;
    event.preventDefault();
    if (event.key === "Home") return state.reset();
    const direction = positive ? 1 : -1;
    onResize(value + growth * direction * 16, containerSize(), true);
  };

  return (
    <TooltipHint content="Drag or use arrow keys to resize · Home or double-click resets">
      <div
        data-slot="pane-resize"
        data-axis={axis}
        role="separator"
        tabIndex={0}
        aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
        aria-valuemin={spec.minSize}
        aria-valuemax={spec.maxSize}
        aria-valuenow={Math.round(value)}
        data-surface="page"
        aria-label="Resize pane"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyDown={onKeyDown}
        onDoubleClick={state.reset}
        className={`group relative z-raised flex touch-none items-center justify-center ${axis === "horizontal" ? "h-full w-(--gutter) cursor-col-resize" : "h-(--gutter) w-full cursor-row-resize"}`}
      >
        <span
          className={`bg-line transition-colors duration-control group-hover:bg-ink-2 group-active:bg-ink motion-reduce:transition-none ${axis === "horizontal" ? "h-full w-px" : "h-px w-full"}`}
        />
        <span
          data-slot="pane-resize-grip"
          data-corner="center"
          className={`absolute bg-line-2 ${axis === "horizontal" ? "h-(--control-h) w-px" : "h-px w-(--control-h)"}`}
          style={{ top: "50%", left: "50%", translate: "-50% -50%" }}
        />
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
        ? "var(--pane-size) var(--gutter) minmax(0, 1fr)"
        : "minmax(0, 1fr) var(--gutter) var(--pane-size)";
  const gridStyle = {
    "--pane-size": `${state.renderedSize}px`,
    [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]: tracks,
  } as CSSProperties;

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
    // Yield a supporting rail, or stack when there is no collapse affordance.
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
            {resize?.collapse?.head != null && (
              <div
                data-slot="pane-rail-head"
                className={`flex min-h-0 min-w-0 gap-1 overflow-hidden ${horizontal ? "flex-col items-center [writing-mode:vertical-rl]" : "items-center"}`}
              >
                {resize.collapse.head}
              </div>
            )}
          </div>
        )}
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
      className={paneSplitRecipe({ grow })}
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
            split={rootRef}
            state={state}
            spec={resize}
            containerSize={measuredContainer}
          />
        </div>
      )}
      {renderSide("end", end)}
    </div>
  );
}

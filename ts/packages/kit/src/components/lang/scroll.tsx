import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";
import { canvasColor } from "./minimap";
import { paint, project, type Ink, type Span } from "./scroll-project";
import "./lang.css";

export type { Mark, Span, Tone } from "./scroll-project";

/**
 * The one scroll container. It owns the box, hides the native bar on it and draws the projection
 * scrollbar as a sticky child, so native and ours cannot coexist. Descendants publish spans in
 * scroller pixels through `useProjection`; the frame rides a CSS scroll timeline (one passive
 * transform write per frame where the engine lacks it) and never a React commit.
 */
interface Registry {
  element: HTMLElement;
  sources: Map<object, () => readonly Span[]>;
  invalidate(): void;
  /** `--item-h` of this scroller, read once: a virtual list's estimate before rows measure. */
  rowHeight(): number;
}
const ScrollContext = createContext<Registry | null>(null);

/** The element that scrolls this subtree, or null outside a `Scroll`. */
export const useScroller = (): HTMLElement | null => useContext(ScrollContext)?.element ?? null;

/** The enclosing `Scroll`'s row height, for virtual estimates; 20 outside a `Scroll`. */
export const useRowHeight = (): number => useContext(ScrollContext)?.rowHeight() ?? 20;

/**
 * Development: a list scrolls in its own `Scroll`. An overflow box between them (a pane under
 * `scroll="clip"`, a route's own overflow div) would own the scroll the scrollbar maps.
 */
export function assertScrollOwner(el: HTMLElement, owner: HTMLElement | null, what: string) {
  for (let p = el.parentElement; p && p !== owner; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll")
      throw new Error(
        `${what} scrolls in <${p.tagName.toLowerCase()} class="${p.className}"> instead of its Scroll; render it inside <Scroll> (a Pane body) or give it maxHeight`,
      );
  }
}

/** Publish spans to the enclosing scrollbar; `spans` is read when projecting, never per scroll. */
export function useProjection(spans: (() => readonly Span[]) | null, version: unknown) {
  const registry = useContext(ScrollContext);
  const key = useRef({});
  const read = useRef(spans);
  read.current = spans;
  useLayoutEffect(() => {
    if (!registry) return;
    const token = key.current;
    registry.sources.set(token, () => read.current?.() ?? []);
    return () => {
      registry.sources.delete(token);
      registry.invalidate();
    };
  }, [registry]);
  useLayoutEffect(() => registry?.invalidate(), [registry, version]);
}

/** Spans of elements inside a scroller, read from layout: for bodies that draw every row. */
export function domSpans(
  scroller: HTMLElement,
  elements: Iterable<Element>,
  mark: (element: Element) => Span["mark"],
): Span[] {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop + scroller.clientTop;
  return Array.from(elements, (element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top - origin, height: rect.height, mark: mark(element) };
  });
}

const TIMELINE = typeof CSS !== "undefined" && !!CSS.supports?.("animation-timeline: scroll()");

type Parts = {
  strip: HTMLDivElement | null;
  marks: HTMLCanvasElement | null;
  lit: HTMLCanvasElement | null;
  frame: HTMLSpanElement | null;
  xFrame: HTMLSpanElement | null;
  field: HTMLDivElement | null;
};

function attach(el: HTMLElement, parts: Parts, sources: Registry["sources"]) {
  const { strip, marks, lit, frame, xFrame, field } = parts;
  if (!strip || !marks || !lit || !frame) throw new Error("Scroll mounted without its scrollbar");
  // Layout is read only in the ResizeObserver callback (after layout) and offsets only in the
  // scroll handlers; frame callbacks draw from these cached numbers, so a seam drag that has just
  // written a pane size never pays a forced layout here.
  let clientH = 0;
  let scrollH = 0;
  let clientW = 0;
  let scrollW = 0;
  let top = 0;
  let left = 0;
  let width = 1;
  let bins = 0;
  let travel = 0;
  let travelX = 0;
  let ink: Ink | null = null;
  let raf = 0;
  let following = 0;
  const fraction = () => {
    const max = scrollH - clientH;
    return max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
  };
  const follow = () => {
    following = 0;
    const y = fraction() * travel;
    frame.style.transform = `translateY(${y}px)`;
    lit.style.clipPath = `inset(${y}px 0 ${travel - y}px 0)`;
    if (xFrame) {
      const max = scrollW - clientW;
      xFrame.style.transform = `translateX(${max > 0 ? (left / max) * travelX : 0}px)`;
    }
  };
  const draw = () => {
    raf = 0;
    const ctx = marks.getContext("2d");
    if (!ctx || !bins || !ink) return;
    const all = function* () {
      for (const read of sources.values()) yield* read();
    };
    paint(ctx, project(all(), scrollH, bins), width, ink);
    const litCtx = lit.getContext("2d");
    litCtx?.clearRect(0, 0, width, bins);
    litCtx?.drawImage(marks, 0, 0);
  };
  const invalidate = () => {
    // A seam drag holds its panes; the observer delivers the final size at release.
    if (!raf && !el.closest("[data-pane-resizing]")) raf = requestAnimationFrame(draw);
  };
  const geometry = () => {
    clientH = el.clientHeight;
    scrollH = el.scrollHeight;
    top = el.scrollTop;
    const scrolls = scrollH > clientH + 1;
    el.toggleAttribute("data-scrolls", scrolls);
    const frameH = scrolls ? Math.max(2, (clientH * clientH) / scrollH) : clientH;
    travel = clientH - frameH;
    strip.style.setProperty("--scrollbar-h", `${clientH}px`);
    strip.style.setProperty("--frame-h", `${frameH}px`);
    strip.style.setProperty("--frame-travel", `${travel}px`);
    if (xFrame) {
      clientW = el.clientWidth;
      scrollW = el.scrollWidth;
      left = el.scrollLeft;
      const scrollsX = scrollW > clientW + 1;
      el.toggleAttribute("data-scrolls-x", scrollsX);
      const frameW = scrollsX ? Math.max(2, (clientW * clientW) / scrollW) : clientW;
      travelX = clientW - frameW;
      xFrame.style.setProperty("--frame-w", `${frameW}px`);
      xFrame.style.setProperty("--frame-travel-x", `${travelX}px`);
    }
    if (
      process.env.NODE_ENV !== "production" &&
      el.offsetWidth - el.clientWidth - 2 * el.clientLeft > 0
    )
      console.error("Scroll: a native scrollbar gutter came back on", el);
    const dpr = window.devicePixelRatio || 1;
    width = Math.round(strip.clientWidth * dpr) || 1;
    bins = Math.round(clientH * dpr);
    for (const canvas of [marks, lit]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== bins) canvas.height = bins;
    }
    // ponytail: ink resolves on resize, not on a theme toggle (owed: a theme subscription).
    const ctx = marks.getContext("2d");
    ink = ctx && {
      alarm: canvasColor(ctx, "alarm"),
      caution: canvasColor(ctx, "caution"),
      ink: canvasColor(ctx, "ink"),
      line: canvasColor(ctx, "line-2"),
    };
    if (!TIMELINE) follow();
    invalidate();
  };
  const onScroll = () => {
    top = el.scrollTop;
    left = el.scrollLeft;
    if (!following) following = requestAnimationFrame(follow);
  };
  const onScrollEnd = () => {
    top = el.scrollTop;
    strip.setAttribute("aria-valuenow", String(Math.round(100 * fraction())));
  };
  if (!TIMELINE) el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("scrollend", onScrollEnd);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(geometry);
  observer?.observe(el);
  if (field) observer?.observe(field);
  // The observer's first delivery is the initial geometry; without one (jsdom), measure now.
  if (!observer) geometry();
  return {
    invalidate,
    detach() {
      observer?.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(following);
    },
  };
}

export interface ScrollProps extends Omit<ComponentProps<"div">, "children"> {
  children?: ReactNode;
  /** Layout of the field the children fill; the scroller itself takes `className`. */
  fieldClassName?: string;
  maxHeight?: string;
  /** Tables also draw a frame-only strip for the inline axis. */
  axis?: "block" | "both";
}

export function Scroll({
  children,
  className,
  fieldClassName,
  maxHeight,
  axis = "block",
  style,
  ref,
  ...rest
}: ScrollProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const id = useId();
  const parts = useRef<Parts>({
    strip: null,
    marks: null,
    lit: null,
    frame: null,
    xFrame: null,
    field: null,
  });
  const sources = useRef(new Map<object, () => readonly Span[]>()).current;
  const controller = useRef<ReturnType<typeof attach> | null>(null);
  const registry = useMemo<Registry | null>(() => {
    if (!element) return null;
    // ponytail: read once per element; a density toggle keeps the old estimate until rows measure.
    let row = 0;
    return {
      element,
      sources,
      invalidate: () => controller.current?.invalidate(),
      rowHeight: () =>
        (row ||= parseFloat(getComputedStyle(element).getPropertyValue("--item-h")) || 20),
    };
  }, [element, sources]);
  useLayoutEffect(() => {
    if (!element) return;
    controller.current = attach(element, parts.current, sources);
    return () => {
      controller.current?.detach();
      controller.current = null;
    };
  }, [element, sources]);
  const press = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !element) return;
    const strip = event.currentTarget;
    const rect = strip.getBoundingClientRect();
    const max = element.scrollHeight - element.clientHeight;
    if (max <= 0 || !rect.height) return;
    event.preventDefault();
    const frameH = parseFloat(strip.style.getPropertyValue("--frame-h")) || 0;
    const travel = rect.height - frameH;
    const y = event.clientY - rect.top;
    let grab = y - travel * (element.scrollTop / max);
    if (grab < 0 || grab > frameH) {
      // Pressed off the frame: centre the view there, then the same press drags.
      element.scrollTop = (y / rect.height) * element.scrollHeight - element.clientHeight / 2;
      grab = frameH / 2;
    }
    strip.setPointerCapture(event.pointerId);
    strip.toggleAttribute("data-dragging", true);
    const move = (e: PointerEvent) => {
      element.scrollTop = travel > 0 ? ((e.clientY - rect.top - grab) / travel) * max : 0;
    };
    const up = () => {
      strip.removeEventListener("pointermove", move);
      strip.removeEventListener("pointerup", up);
      strip.removeEventListener("pointercancel", up);
      strip.toggleAttribute("data-dragging", false);
    };
    strip.addEventListener("pointermove", move);
    strip.addEventListener("pointerup", up);
    strip.addEventListener("pointercancel", up);
  };
  return (
    <div
      {...rest}
      ref={(node) => {
        setElement(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      id={rest.id ?? id}
      data-scroll=""
      data-axis={axis}
      className={cn("relative min-h-0 min-w-0", className)}
      style={maxHeight ? { ...style, maxHeight } : style}
    >
      <div data-scrollbar-host="">
        <div
          ref={(node) => {
            parts.current.strip = node;
          }}
          data-scrollbar=""
          role="scrollbar"
          aria-controls={rest.id ?? id}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          onPointerDown={press}
        >
          <canvas
            ref={(node) => {
              parts.current.marks = node;
            }}
            data-scrollbar-marks=""
            aria-hidden
          />
          <canvas
            ref={(node) => {
              parts.current.lit = node;
            }}
            data-scrollbar-marks="lit"
            aria-hidden
          />
          <span
            ref={(node) => {
              parts.current.frame = node;
            }}
            data-scrollbar-frame=""
            aria-hidden
          />
        </div>
      </div>
      <div
        ref={(node) => {
          parts.current.field = node;
        }}
        data-scroll-field=""
        className={cn("flex min-w-0 shrink-0 grow flex-col", fieldClassName)}
      >
        <ScrollContext value={registry}>{children}</ScrollContext>
      </div>
      {axis === "both" ? (
        <div data-scrollbar-host="x">
          <span
            ref={(node) => {
              parts.current.xFrame = node;
            }}
            data-scrollbar-frame="x"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lines between anchored elements inside one positioned container (the patch bay's cables). An
 * anchor is any element under `container` carrying `data-key` (a `Row`, a table row, a card); a
 * link names two keys, each optionally with fallbacks tried in order (a row filtered out of its
 * table hands its line to the table's foot). Ends are measured on mount, on every render, on
 * scroll in any nested scroller and on resize; an end scrolled out of its scroller clamps to that
 * scroller's edge and draws hollow, so no line dangles. `layout="row"` curves between two columns;
 * `layout="stack"` routes down a right-hand gutter between two stacked lanes. The container must be
 * `position: relative`; mount this after the content it connects, so it paints over it.
 */
import { useLayoutEffect, useState, type ReactNode } from "react";

import "./lang.css";

type ConnectorTone = "commit" | "pea" | "caution" | "alarm" | "done";

export interface Connection {
  key: string;
  from: string | readonly string[];
  to: string | readonly string[];
  /** The house meaning tone; absent, the line is ink-2. */
  tone?: ConnectorTone;
  dashed?: boolean;
  /** The 2px boundary weight instead of the hairline: the one lit link. */
  strong?: boolean;
  /** 0..1 of the length from `from`, a translucent band under the line (a grant counting down). */
  band?: number;
  /** Drawn upright at the line's midpoint, interactive (an adapter, a receipt count). */
  label?: ReactNode;
  title?: string;
  /** Present, the line is a press (its hit area is wider than the hairline). */
  onClick?: () => void;
}

type Side = "left" | "right" | "center";

interface End {
  x: number;
  y: number;
  /** Clamped to a scroller's edge: the anchor is out of view. */
  off: boolean;
}

interface Drawn {
  link: Connection;
  a: End;
  b: End;
  d: string;
  mid: { x: number; y: number };
}

const EDGE = 2;
const GUTTER = 11;
const BEND = 6;

const scrolls = (style: CSSStyleDeclaration) =>
  /auto|scroll/.test(`${style.overflow} ${style.overflowY} ${style.overflowX}`);

/** The scrollers between an anchor and the container, nearest first, the container last if it scrolls. */
function scrollersOf(anchor: Element, container: HTMLElement): Element[] {
  const out: Element[] = [];
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    if (node === container) break;
    if (scrolls(getComputedStyle(node))) out.push(node);
  }
  if (scrolls(getComputedStyle(container))) out.push(container);
  return out;
}

function endOf(
  anchor: Element,
  side: Side,
  container: HTMLElement,
  box: DOMRect,
  inset: (scroller: Element) => { top?: number; bottom?: number } | number,
): End {
  const rect = anchor.getBoundingClientRect();
  let x = side === "left" ? rect.left : side === "right" ? rect.right : rect.left + rect.width / 2;
  let y = rect.top + rect.height / 2;
  let off = false;
  for (const scroller of scrollersOf(anchor, container)) {
    const bounds = scroller.getBoundingClientRect();
    const said = inset(scroller);
    const top = (typeof said === "number" ? said : (said.top ?? 0)) + EDGE;
    const bottom = (typeof said === "number" ? said : (said.bottom ?? 0)) + EDGE;
    const lo = bounds.top + top;
    const hi = bounds.bottom - bottom;
    if (y < lo) ((y = lo), (off = true));
    if (y > hi) ((y = hi), (off = true));
    // A row's edge is its scroller's edge: x clamps to the edge itself, with no inset.
    if (x < bounds.left) ((x = bounds.left), (off = true));
    if (x > bounds.right) ((x = bounds.right), (off = true));
  }
  return { x: x - box.left, y: y - box.top, off };
}

function pathOf(a: End, b: End, layout: "row" | "stack", lane: number, width: number) {
  if (layout === "row") {
    const dx = Math.max(24, Math.abs(b.x - a.x) * 0.5);
    return {
      d: `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }
  // The gutter: lines run down the container's right edge beside the stacked lanes, one lane each.
  const g = width - GUTTER - 2 * (lane % 4);
  const mid = { x: g, y: (a.y + b.y) / 2 };
  if (b.y < a.y + 2 * BEND)
    return { d: `M${a.x},${a.y} L${g},${a.y} L${g},${b.y} L${b.x},${b.y}`, mid };
  return {
    d: `M${a.x},${a.y} H${g - BEND} Q${g},${a.y} ${g},${a.y + BEND} V${b.y - BEND} Q${g},${b.y} ${g - BEND},${b.y} H${b.x}`,
    mid,
  };
}

const same = (previous: Drawn[], next: Drawn[]) =>
  previous.length === next.length &&
  previous.every(
    (was, index) =>
      was.link === next[index]!.link &&
      was.d === next[index]!.d &&
      was.a.off === next[index]!.a.off &&
      was.b.off === next[index]!.b.off,
  );

const noInset = () => 0;

export function Connectors({
  container,
  links,
  layout = "row",
  inset = noInset,
}: {
  container: HTMLElement | null;
  links: readonly Connection[];
  layout?: "row" | "stack";
  /** How far inside a scroller's top and bottom edge a clamped end sits: a sticky table head's
   *  height, measured from the scroller. Default 0. */
  inset?: (scroller: Element) => { top?: number; bottom?: number } | number;
}) {
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const [tick, setTick] = useState(0);

  // Measured on every render (the anchors may have moved without this overlay's props changing)
  // and on every scroll or resize tick; the equality guard keeps a second pass from setting state.
  useLayoutEffect(() => {
    if (!container) return;
    {
      const box = container.getBoundingClientRect();
      if (!box.width) return;
      const anchors = new Map<string, Element>();
      for (const element of container.querySelectorAll<HTMLElement>("[data-key]")) {
        const key = element.dataset.key!;
        if (!anchors.has(key)) anchors.set(key, element);
      }
      const find = (names: string | readonly string[]) => {
        for (const name of typeof names === "string" ? [names] : names) {
          const hit = anchors.get(name);
          if (hit) return hit;
        }
        return null;
      };
      const next: Drawn[] = [];
      links.forEach((link, index) => {
        const from = find(link.from);
        const to = find(link.to);
        if (!from || !to) return;
        const a = endOf(from, "right", container, box, inset);
        const b = endOf(to, layout === "row" ? "left" : "right", container, box, inset);
        next.push({ link, a, b, ...pathOf(a, b, layout, index, box.width) });
      });
      setDrawn((previous) => (same(previous, next) ? previous : next));
    }
  });

  useLayoutEffect(() => {
    if (!container) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((was) => was + 1);
      });
    };
    // Scroll does not bubble; a capturing listener on the container still hears every nested scroller.
    container.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(container);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [container]);
  void tick;

  return (
    <div className="pointer-events-none absolute inset-0" data-slot="connectors" aria-hidden>
      <svg className="absolute inset-0 size-full overflow-visible">
        {drawn.map(({ link, a, b, d }) => (
          <g
            key={link.key}
            className="dl-connector"
            data-tone={link.tone}
            data-dashed={link.dashed ? "" : undefined}
            data-strong={link.strong ? "" : undefined}
          >
            {link.band != null ? (
              <path
                d={d}
                pathLength={100}
                strokeDasharray={`${Math.max(0, Math.min(1, link.band)) * 100} 100`}
                className="dl-connector-band"
              />
            ) : null}
            <path d={d} className="dl-connector-line">
              {link.title ? <title>{link.title}</title> : null}
            </path>
            {link.onClick ? (
              <path d={d} className="dl-connector-hit" onClick={link.onClick}>
                {link.title ? <title>{link.title}</title> : null}
              </path>
            ) : null}
            <circle
              cx={a.x}
              cy={a.y}
              r={3}
              className="dl-connector-end"
              data-off={a.off ? "" : undefined}
            />
            <circle
              cx={b.x}
              cy={b.y}
              r={3}
              className="dl-connector-end"
              data-off={b.off ? "" : undefined}
            />
          </g>
        ))}
      </svg>
      {drawn.map(({ link, mid }) =>
        link.label != null ? (
          <span
            key={link.key}
            className="dl-connector-label"
            data-tone={link.tone}
            style={{ left: mid.x, top: mid.y }}
          >
            {link.label}
          </span>
        ) : null,
      )}
    </div>
  );
}

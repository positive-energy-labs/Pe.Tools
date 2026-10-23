import { MinimapViewport } from "./minimap-viewport";
import { memo, useId, useLayoutEffect, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useScopeGestures } from "../../keys";
import "./lang.css";

// M1: 200 is the first useful scale for a gutter overview; recalibrate on real collections.
export const MINIMAP_FROM = 200;
export type MinimapRange = { start: number; end: number };
export type MinimapMark = { index: number; damage?: string; head?: boolean };

/** Row ordinals, never row measurements. The virtualizer owns the viewport range. */
export function useMinimap({
  count,
  range,
  onJump,
}: {
  count: number;
  range: MinimapRange | null;
  onJump: (index: number) => void;
}) {
  const jump = (fraction: number) =>
    onJump(Math.max(0, Math.min(count - 1, Math.floor(fraction * count))));
  const point = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height) jump((event.clientY - rect.top) / rect.height);
  };
  return {
    visible: count >= MINIMAP_FROM,
    viewport: {
      top: `${(100 * (range?.start ?? 0)) / Math.max(1, count)}%`,
      height: `${(100 * (range ? range.end - range.start + 1 : 0)) / Math.max(1, count)}%`,
    },
    controls: {
      role: "scrollbar" as const,
      tabIndex: 0,
      "aria-label": "Jump to a row",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": 1,
      "aria-valuemax": count,
      "aria-valuenow": (range?.start ?? 0) + 1,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        const index = range?.start ?? 0;
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[
          event.key
        ];
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onJump(Math.max(0, Math.min(count - 1, next)));
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        point(event);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      },
    },
  };
}

/** The zero-height sticky host reserves a gutter and never changes the row scroll extent. */
export function Minimap({
  count,
  range,
  onJump,
  marks,
  scroller,
  height,
}: {
  count: number;
  range: MinimapRange | null;
  onJump: (index: number) => void;
  marks: readonly MinimapMark[];
  scroller: HTMLElement | null;
  height: number;
}) {
  const map = useMinimap({ count, range, onJump });
  const id = useId();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useScopeGestures(map.visible ? [{ pointer: "drag", label: "jump to a row" }] : [], host);
  useLayoutEffect(() => {
    if (!map.visible || !scroller) return;
    const ownsId = !scroller.id;
    if (ownsId) scroller.id = id;
    const node = document.createElement("div");
    node.setAttribute("data-minimap-host", "");
    scroller.prepend(node);
    scroller.setAttribute("data-minimap-owner", "");
    setHost(node);
    return () => {
      node.remove();
      if (ownsId && scroller.id === id) scroller.removeAttribute("id");
      if (!scroller.querySelector("[data-minimap-host]"))
        scroller.removeAttribute("data-minimap-owner");
      setHost(null);
    };
  }, [map.visible, scroller, id]);
  if (!map.visible || !host) return null;
  return createPortal(
    <div data-minimap="" aria-controls={scroller?.id || id} {...map.controls} style={{ height }}>
      <MinimapViewport style={map.viewport} />
      <MinimapMarks marks={marks} count={count} />
    </div>,
    host,
  );
}

const MinimapMarks = memo(function MinimapMarks({
  marks,
  count,
}: {
  marks: readonly MinimapMark[];
  count: number;
}) {
  const combined = new Map<number, MinimapMark>();
  for (const mark of marks)
    combined.set(mark.index, {
      ...mark,
      head: mark.head || combined.get(mark.index)?.head,
      damage: mark.damage || combined.get(mark.index)?.damage,
    });
  return (
    <>
      {[...combined.values()].map((mark) => (
        <i
          key={`${mark.index}:${mark.head ? "head" : "damage"}`}
          aria-hidden
          data-minimap-head={mark.head || undefined}
          data-damage={mark.damage || undefined}
          style={{ top: `${(100 * mark.index) / count}%` }}
        />
      ))}
    </>
  );
});

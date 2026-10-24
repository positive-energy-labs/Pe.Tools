import { MinimapViewport } from "./minimap-viewport";
import { memo, useId, useLayoutEffect, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ScopeGestures } from "../../keys";
import "./lang.css";
import "./damage-beat";

// M1: 200 is the first useful scale for a gutter overview; recalibrate on real collections.
export const MINIMAP_FROM = 200;
export type MinimapRange = { start: number; end: number };
export type MinimapMark = { index: number; damage?: string; head?: boolean };

type MinimapProps = {
  count: number;
  range: MinimapRange | null;
  onJump: (index: number) => void;
  marks: readonly MinimapMark[];
  scroller: HTMLElement | null;
  height: number;
};

/** The zero-height sticky host reserves a gutter and never changes the row scroll extent. */
export function Minimap({ count, range, onJump, marks, scroller, height }: MinimapProps) {
  const jump = (fraction: number) =>
    onJump(Math.max(0, Math.min(count - 1, Math.floor(fraction * count))));
  const point = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height) jump((event.clientY - rect.top) / rect.height);
  };
  const visible = count >= MINIMAP_FROM;
  const id = useId();
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!visible || !scroller) return;
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
  }, [visible, scroller, id]);
  if (!visible || !host) return null;
  return createPortal(
    <div
      data-minimap="rows"
      aria-controls={scroller?.id || id}
      role="scrollbar"
      tabIndex={0}
      aria-label="Jump to a row"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={(range?.start ?? 0) + 1}
      onKeyDown={(event) => {
        const index = range?.start ?? 0;
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[
          event.key
        ];
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onJump(Math.max(0, Math.min(count - 1, next)));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        point(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={{ height }}
    >
      <ScopeGestures gestures={[{ pointer: "drag", label: "jump to a row" }]} host={host} />
      <MinimapViewport
        style={{
          top: `${(100 * (range?.start ?? 0)) / Math.max(1, count)}%`,
          height: `${(100 * (range ? range.end - range.start + 1 : 0)) / Math.max(1, count)}%`,
        }}
      />
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
  const combined = new Map<number, string | undefined>();
  for (const { index, damage } of marks) combined.set(index, damage || combined.get(index));
  const heads: React.ReactElement[] = [],
    damaged: React.ReactElement[] = [];
  for (const [index, damage] of combined) {
    const mark = (
      <i
        key={index}
        aria-hidden
        data-damage={damage}
        style={{ top: `${(100 * index) / count}%` }}
      />
    );
    (damage ? damaged : heads).push(mark);
  }
  return (
    <>
      {heads}
      {damaged.length > 0 && <span data-damage-surface="minimap">{damaged}</span>}
    </>
  );
});

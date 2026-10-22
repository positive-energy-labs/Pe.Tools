import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import type { Bounds2, Viewport2 } from "./affine-frame";

const ZOOM = [0.02, 24] as const;
export const PLAN_CLICK_PX = 5;

export function fitView(box: Bounds2, size: Viewport2, pad = 0): PlaneViewport {
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(
    ZOOM[1],
    Math.max(ZOOM[0], Math.min((size.width - 2 * pad) / w, (size.height - 2 * pad) / h)),
  );
  return {
    kind: "plane",
    scale,
    tx: (size.width - w * scale) / 2 - box.minX * scale,
    ty: (size.height - h * scale) / 2 - box.minY * scale,
  };
}

/** Page owns the pose. A null pose fits at render; the first gesture starts from that fit. */
export function usePlaneViewport(
  viewport: PlaneViewport | null,
  fit: Bounds2 | null,
  onViewport: (next: PlaneViewport, how: "gesture" | "move") => void,
) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Viewport2 | null>(null);
  const view =
    viewport ??
    (fit && size ? fitView(fit, size) : { kind: "plane" as const, scale: 1, tx: 0, ty: 0 });
  const latest = useRef({ view, onViewport });
  latest.current = { view, onViewport };
  const pending = useRef<PlaneViewport | null>(null);
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; view: PlaneViewport } | null>(null);
  const dragDistance = useRef(0);
  const [dragging, setDragging] = useState(false);
  const move = useCallback((next: PlaneViewport, how: "gesture" | "move") => {
    if (how === "move") {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
      latest.current.onViewport(next, how);
      return;
    }
    pending.current = next;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const pose = pending.current;
        pending.current = null;
        if (pose) latest.current.onViewport(pose, "gesture");
      });
  }, []);
  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(host);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const v = pending.current ?? latest.current.view;
      const scale = Math.min(
        ZOOM[1],
        Math.max(ZOOM[0], v.scale * Math.exp(-event.deltaY * 0.0015)),
      );
      move(
        {
          kind: "plane",
          scale,
          tx: x - ((x - v.tx) * scale) / v.scale,
          ty: y - ((y - v.ty) * scale) / v.scale,
        },
        "gesture",
      );
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
    };
  }, [host, move]);
  return {
    setHost,
    size,
    view,
    move,
    dragging,
    dragDistance,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          view: pending.current ?? latest.current.view,
        };
        dragDistance.current = 0;
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        dragDistance.current = Math.max(dragDistance.current, Math.abs(dx) + Math.abs(dy));
        if (dragDistance.current < PLAN_CLICK_PX) return;
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        move({ ...start.view, tx: start.view.tx + dx, ty: start.view.ty + dy }, "gesture");
      },
      onPointerUp: () => {
        drag.current = null;
        setDragging(false);
      },
      onPointerCancel: () => {
        drag.current = null;
        setDragging(false);
      },
    },
  };
}

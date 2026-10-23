/**
 * A DOM picture (the schematic) under the 2D half of the pointer scheme (`gestures.ts`): drag pans,
 * the wheel and a pinch zoom to the cursor, a two-finger scroll pans, double-click fits. No orbit.
 * The pose is local to the picture, not a Page key: a schematic's pan is not an address.
 * A press that moved past a few px was a drag, and its click never reaches the content.
 */
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { useScopeGestures } from "@pe/kit/keys";
import type { PlaneViewport } from "@pe/agent-contracts";

import type { Viewport2 } from "#/lib/affine-frame";
import { createWheelReader, PLANE_GESTURES, wheelPlane } from "./gestures";
import { clampZoom } from "./plane";
import { PLAN_CLICK_PX } from "./use-plane-viewport";

/** The content at 1:1 from the top-left, or shrunk to fit when it is larger than the box. */
export function restingView(content: Viewport2, box: Viewport2): PlaneViewport {
  const scale = Math.min(1, box.width / content.width, box.height / content.height);
  return { kind: "plane", scale: clampZoom(scale), tx: 0, ty: 0 };
}

export function PanZoom({
  content,
  children,
  className = "",
}: {
  /** The content's own size in px. */
  content: Viewport2;
  children: ReactNode;
  className?: string;
}) {
  useScopeGestures(PLANE_GESTURES);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Viewport2 | null>(null);
  const [own, setOwn] = useState<PlaneViewport | null>(null);
  const view =
    own ?? (box ? restingView(content, box) : { kind: "plane" as const, scale: 1, tx: 0, ty: 0 });
  const latest = useRef(view);
  latest.current = view;
  const drag = useRef<{ x: number; y: number; view: PlaneViewport } | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setBox(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(host);
    const reader = createWheelReader();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const next = wheelPlane(
        latest.current,
        reader(event),
        event,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      latest.current = next;
      setOwn(next);
    };
    const preventGesture = (event: Event) => event.preventDefault();
    host.addEventListener("wheel", wheel, { passive: false });
    host.addEventListener("gesturestart", preventGesture, { passive: false });
    host.addEventListener("gesturechange", preventGesture, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("gesturestart", preventGesture);
      host.removeEventListener("gesturechange", preventGesture);
    };
  }, [host]);

  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      ref={setHost}
      className={`relative size-full min-h-0 touch-none select-none overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      data-pan-zoom=""
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 && event.button !== 1) return;
        drag.current = { x: event.clientX, y: event.clientY, view: latest.current };
        moved.current = false;
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!moved.current && Math.hypot(dx, dy) <= PLAN_CLICK_PX) return;
        if (!moved.current) event.currentTarget.setPointerCapture?.(event.pointerId);
        moved.current = true;
        setDragging(true);
        setOwn({ ...start.view, tx: start.view.tx + dx, ty: start.view.ty + dy });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      // A drag ends in a click on whatever it ended over; the content never sees it.
      onClickCapture={(event) => {
        if (!moved.current) return;
        moved.current = false;
        event.stopPropagation();
      }}
      onDoubleClick={() => setOwn(null)}
    >
      <div
        style={{
          width: content.width,
          height: content.height,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

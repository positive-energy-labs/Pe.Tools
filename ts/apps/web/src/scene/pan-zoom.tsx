/** A local DOM picture under the shared plane viewport; its pose stays outside the Page address. */
import { useState, type ReactNode } from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import type { Viewport2 } from "#/lib/affine-frame";
import { clampZoom } from "./plane";
import { PLAN_CLICK_PX, usePlaneViewport } from "./use-plane-viewport";

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
  const [own, setOwn] = useState<PlaneViewport | null>(null);
  const { setHost, view, handlers, dragging, dragDistance } = usePlaneViewport(
    own,
    null,
    setOwn,
    (size) => restingView(content, size),
  );
  return (
    <div
      ref={setHost}
      className={`relative size-full min-h-0 touch-none select-none overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      data-pan-zoom=""
      {...handlers}
      onClickCapture={(event) => {
        if (dragDistance.current < PLAN_CLICK_PX) return;
        dragDistance.current = 0;
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

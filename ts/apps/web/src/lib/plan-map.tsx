import { useCallback, useEffect, useState } from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import type { FloaterSpec } from "@pe/kit/lang/floater";
import { PlaneMinimap } from "#/components/lang/minimap";
import type { AffineFrame, Viewport2 } from "./affine-frame";
import type { TakeoffPlanImage } from "#/takeoff/level-plan";

/** The same registered plan underlay and region paths as the field, in its world pixels. */
export function usePlanMap(
  viewport: PlaneViewport,
  onViewport: (next: PlaneViewport, how: "gesture" | "move") => void,
  world: { width: number; height: number; frame: AffineFrame } | null,
  size: Viewport2 | null,
  shapes: readonly { d: string; ink: string }[],
  plan: TakeoffPlanImage | null,
): FloaterSpec {
  const [open, onOpenChange] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!plan) return;
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = plan.href;
    return () => {
      next.onload = null;
    };
  }, [plan?.href]);
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      if (!world) return;
      ctx.save();
      ctx.scale(scale, scale);
      if (image && plan) {
        const [ax, ay] = world.frame.toViewport(plan.registration.topLeft);
        const [bx, by] = world.frame.toViewport(plan.registration.topRight);
        const [cx, cy] = world.frame.toViewport(plan.registration.bottomLeft);
        ctx.save();
        ctx.transform(
          (bx - ax) / image.width,
          (by - ay) / image.width,
          (cx - ax) / image.height,
          (cy - ay) / image.height,
          ax,
          ay,
        );
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }
      ctx.lineWidth = 1 / scale;
      for (const shape of shapes) {
        ctx.canvas.style.color = shape.ink;
        ctx.strokeStyle = getComputedStyle(ctx.canvas).color;
        ctx.stroke(new Path2D(shape.d));
      }
      ctx.canvas.style.color = "";
      ctx.restore();
    },
    [world, shapes, image, plan],
  );
  return {
    key: "map",
    label: "map",
    chord: "M",
    place: "br",
    open,
    onOpenChange,
    says: "Show the whole plan; click to move, drag to pan.",
    render: () =>
      world && size ? (
        <PlaneMinimap
          viewport={viewport}
          onViewport={onViewport}
          extent={world}
          viewportSize={size}
          paint={paint}
        />
      ) : null,
  };
}

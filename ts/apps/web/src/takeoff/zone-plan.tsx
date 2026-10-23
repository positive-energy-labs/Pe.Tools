import { contentViewport, fitFrame, type Bounds2 } from "#/lib/affine-frame";
import { pathD } from "#/takeoff/model";
import { revitTarget } from "@pe/kit/lang/row";
import { cn } from "@pe/kit/lib/utils";

export function ZoneThumb({
  zone,
  className,
}: {
  zone: {
    elementId?: number | null;
    loops: readonly (readonly (readonly [number, number])[])[];
    bounds: Bounds2;
    color?: string;
  };
  className?: string;
}) {
  const b = zone.bounds;
  const { viewport, padding } = contentViewport(b, 0.06);
  const frame = fitFrame(b, viewport, { padding, yAxis: "up" });
  return (
    <svg
      {...revitTarget(zone.elementId == null ? [] : [zone.elementId])}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("size-8", className)}
      aria-hidden
    >
      <path
        d={pathD(zone.loops, frame)}
        fillRule="evenodd"
        // Monotone, as on the plan (SURFACE-PHILOSOPHY I3): the outline is the zone's identity.
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

import { contentViewport, fitFrame, type Bounds2 } from "#/lib/affine-frame";
import { pathD } from "#/takeoff/model";
import { cn } from "#/lib/utils";

export function ZoneThumb({
  zone,
  className,
}: {
  zone: {
    loops: readonly (readonly (readonly [number, number])[])[];
    bounds: Bounds2;
    color: string;
  };
  className?: string;
}) {
  const b = zone.bounds;
  const { viewport, padding } = contentViewport(b, 0.06);
  const frame = fitFrame(b, viewport, { padding, yAxis: "up" });
  return (
    <svg
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("size-8 shrink-0", className)}
      aria-hidden
    >
      <path
        d={pathD(zone.loops, frame)}
        fillRule="evenodd"
        fill={`color-mix(in srgb, rgb(${zone.color}) 30%, transparent)`}
        stroke={`rgb(${zone.color})`}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

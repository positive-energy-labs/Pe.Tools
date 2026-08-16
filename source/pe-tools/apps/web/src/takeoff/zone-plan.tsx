/**
 * The zone's own shape, at glyph size — SHAPE IS IDENTITY (SURFACE-PHILOSOPHY §4: real outlines,
 * not colour squares), so a zone in the rail and the same zone on the plan are recognisably one
 * thing. Y-flipped and fitted to its own bounds; geometry changes happen in Revit, never here.
 *
 * The full-size `ZonePlan` and its legend lived here too and were deleted in the design-language
 * sweep: nothing had imported them since the atlas absorbed both questions (`LevelPlan` answers
 * "where in the house", `ZonePeek` answers "where in the zone"), and they carried three
 * old-vocabulary spends plus a dashed border meaning "needs a decision".
 */
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

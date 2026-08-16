/**
 * Spatial index for the decision queue — never a drawing tool.
 *
 * One zone at a time: its declared Zoning Region loops, the rooms this run detected, the held
 * residue, and the Room Region FRs that actually exist in the model. Everything shares one
 * Y-flipped frame derived from the zone's bounds, so a room's position on screen is its position
 * in the model. Clicking selects a decision; geometry changes happen in Revit, never here.
 */
import { useMemo } from "react";

import { fmtNum } from "#/components/master-table/model";
import { contentViewport, fitFrame, type Bounds2, unionBounds } from "#/lib/affine-frame";
import { loopBounds, pathD, type PartitionRun, type Zone } from "#/takeoff/model";
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

export function ZonePlan({
  zone,
  run,
  selectedSubject,
  onSelect,
}: {
  zone: Zone;
  run: PartitionRun | null;
  selectedSubject: string | null;
  onSelect: (subject: string) => void;
}) {
  const bounds = useMemo<Bounds2>(() => {
    let b = zone.bounds;
    for (const room of run?.rooms ?? []) b = unionBounds(b, loopBounds([room.outer]));
    for (const residue of run?.residues ?? []) b = unionBounds(b, loopBounds([residue.outer]));
    return b;
  }, [zone, run]);

  const font = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6) / 42;
  const { viewport, padding } = contentViewport(bounds, 0.05);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });

  return (
    <svg
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="size-full bg-card"
    >
      <title>{`${zone.key} — declared zone and detected rooms`}</title>

      {/* The designer's declared scope. Nothing may be claimed outside it. */}
      <path
        d={pathD(zone.loops, frame)}
        fillRule="evenodd"
        fill={`color-mix(in srgb, rgb(${zone.color}) 10%, transparent)`}
        stroke={`rgb(${zone.color})`}
        strokeWidth={1.5}
        strokeOpacity={0.8}
        vectorEffect="non-scaling-stroke"
      />

      {/* Held residue: abstention stays visible; a held area beats a guessed one. */}
      {(run?.residues ?? []).map((residue) => (
        <path
          key={residue.id}
          d={pathD([residue.outer], frame)}
          fill="color-mix(in srgb, var(--muted-foreground) 14%, transparent)"
          stroke="var(--muted-foreground)"
          strokeOpacity={0.4}
          strokeDasharray="4 3"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {(run?.rooms ?? []).map((room) => {
        const flagged = room.flags.length > 0;
        const selected = room.id === selectedSubject;
        const [labelX, labelY] = frame.toViewport(room.label);
        const accent = selected
          ? "var(--primary)"
          : flagged
            ? "var(--cat-clay)"
            : "var(--cat-blue)";
        return (
          <g key={room.id} className="cursor-pointer" onClick={() => onSelect(room.id)}>
            <path
              d={pathD([room.outer], frame)}
              fill={`color-mix(in srgb, ${accent} ${selected ? 30 : 14}%, transparent)`}
              stroke={accent}
              strokeOpacity={0.85}
              strokeWidth={selected ? 2 : flagged ? 1.5 : 1}
              strokeDasharray={flagged && !selected ? "5 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            {room.rawSqft > 20 && (
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fontSize={font}
                className="pointer-events-none select-none"
                fill="var(--foreground)"
              >
                <tspan x={labelX} fontWeight={600}>
                  {room.id}
                </tspan>
                <tspan x={labelX} dy={font * 1.15} fillOpacity={0.7}>
                  {fmtNum(room.rawSqft, 0)} sf
                </tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function PlanLegend({ run }: { run: PartitionRun | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Chip color="var(--cat-blue)" label="accepted room" />
      <Chip color="var(--cat-clay)" label="flagged — needs a decision" dashed />
      {(run?.residues.length ?? 0) > 0 && (
        <Chip color="var(--muted-foreground)" label="held residue" dashed />
      )}
      <Chip color="var(--primary)" label="selected" />
    </div>
  );
}

function Chip({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="tele inline-flex items-center gap-1 text-muted-foreground">
      <span
        className={cn("inline-block size-2.5 rounded-[1px] border", dashed && "border-dashed")}
        style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, borderColor: color }}
      />
      {label}
    </span>
  );
}

/**
 * /rhvac plan overlay — per-level SVG of the takeoff room polygons, colored by
 * match state (matched to an rhvac room / unmatched candidate), with the rhvac
 * rooms that have no polygon listed separately. Click a matched polygon to
 * select that room in the grid; the focused room's polygon highlights. Plain
 * SVG: viewBox fit per level, wheel zoom about the cursor, drag to pan.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { fmtNum } from "#/rhvac/cells";
import { levelBounds, shapeCentroid, shapePathD, type Bounds } from "#/rhvac/takeoff";
import { candidateKey, type RhvacRoom, type RhvacTakeoffData } from "#/rhvac/types";
import { cn } from "#/lib/utils";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const fitView = (bounds: Bounds): ViewBox => {
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.04;
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad, // flipped-Y space shares the same numeric range
    w: bounds.maxX - bounds.minX + pad * 2,
    h: bounds.maxY - bounds.minY + pad * 2,
  };
};

export interface PlanPaneProps {
  takeoff: RhvacTakeoffData | null;
  takeoffError: string | null;
  rooms: RhvacRoom[];
  /** "<level>:<roomId>" → room identifier (built against baseline room numbers). */
  matchByCandidate: ReadonlyMap<string, number>;
  /** identifier → curated skip reason for rooms deliberately without a polygon. */
  skipReasonById: ReadonlyMap<number, string>;
  focusedId: number | null;
  onPickRoom: (identifier: number) => void;
}

export function PlanPane(props: PlanPaneProps) {
  const { takeoff, rooms, matchByCandidate, focusedId } = props;
  const [levelIndex, setLevelIndex] = useState(0);

  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.identifier, r])), [rooms]);
  const matchedIds = useMemo(() => new Set(matchByCandidate.values()), [matchByCandidate]);
  const unmatchedRooms = useMemo(
    () => rooms.filter((r) => !matchedIds.has(r.identifier)),
    [rooms, matchedIds],
  );

  if (!takeoff) {
    return (
      <div className="space-y-2 p-3 text-xs text-muted-foreground">
        <p>No takeoff plan loaded.</p>
        {props.takeoffError && (
          <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-2 text-destructive">
            {props.takeoffError}
          </p>
        )}
      </div>
    );
  }

  const level = takeoff.levels[Math.min(levelIndex, takeoff.levels.length - 1)];
  if (!level) return <p className="p-3 text-xs text-muted-foreground">Takeoff has no levels.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {takeoff.levels.map((l, i) => (
          <Button
            key={l.levelName}
            size="xs"
            variant={i === levelIndex ? "secondary" : "ghost"}
            onClick={() => setLevelIndex(i)}
            title={l.levelName}
          >
            {l.levelName.split("/").pop() ?? l.levelName}
          </Button>
        ))}
      </div>

      <LevelSvg
        key={level.levelName}
        level={level}
        roomsById={roomsById}
        matchByCandidate={matchByCandidate}
        focusedId={focusedId}
        onPickRoom={props.onPickRoom}
      />

      <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] px-2.5 py-1">
        <LegendChip color="var(--cat-blue)" label="matched" />
        <LegendChip color="var(--cat-kiln)" label="unmatched" />
        <LegendChip color="var(--primary)" label="selected" />
        <span className="tele ml-auto text-muted-foreground">wheel zoom · drag pan</span>
      </div>

      {unmatchedRooms.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-[var(--line)] px-2.5 py-1.5">
          <p className="section-label mb-1">
            rooms with no polygon
            <span className="tele ml-1.5 normal-case text-muted-foreground">
              {unmatchedRooms.length}
            </span>
          </p>
          <ul className="space-y-px">
            {unmatchedRooms.map((room) => (
              <li key={room.identifier}>
                <button
                  type="button"
                  className={cn(
                    "tele w-full truncate rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    focusedId === room.identifier && "bg-primary/10",
                  )}
                  title={props.skipReasonById.get(room.identifier) ?? "not in the curated room map"}
                  onClick={() => props.onPickRoom(room.identifier)}
                >
                  #{room.number} {room.name}
                  {props.skipReasonById.has(room.identifier) && (
                    <span className="ml-1 text-muted-foreground">(skipped)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="tele inline-flex items-center gap-1 text-muted-foreground">
      <span
        className="inline-block size-2.5 rounded-[1px] border"
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          borderColor: color,
        }}
      />
      {label}
    </span>
  );
}

function LevelSvg({
  level,
  roomsById,
  matchByCandidate,
  focusedId,
  onPickRoom,
}: {
  level: RhvacTakeoffData["levels"][number];
  roomsById: ReadonlyMap<number, RhvacRoom>;
  matchByCandidate: ReadonlyMap<string, number>;
  focusedId: number | null;
  onPickRoom: (identifier: number) => void;
}) {
  const bounds = useMemo(() => levelBounds(level), [level]);
  const initial = useMemo(() => (bounds ? fitView(bounds) : null), [bounds]);
  const [view, setView] = useState<ViewBox | null>(initial);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggedRef = useRef(false);

  const shapes = useMemo(() => {
    if (!bounds) return [];
    return level.rooms.map((shape) => {
      const identifier = matchByCandidate.get(candidateKey(level.levelName, shape.id));
      return {
        shape,
        identifier,
        d: shapePathD(shape, bounds),
        centroid: shapeCentroid(shape, bounds),
      };
    });
  }, [level, bounds, matchByCandidate]);

  // Wheel zoom about the cursor — native non-passive listener (React's onWheel
  // is passive, so preventDefault would be ignored and the pane would scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !initial) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const cur = v ?? initial;
        const rect = el.getBoundingClientRect();
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        const w = Math.min(initial.w * 3, Math.max(initial.w / 40, cur.w * factor));
        const scale = w / cur.w;
        const px = cur.x + ((e.clientX - rect.left) / rect.width) * cur.w;
        const py = cur.y + ((e.clientY - rect.top) / rect.height) * cur.h;
        return { x: px - (px - cur.x) * scale, y: py - (py - cur.y) * scale, w, h: cur.h * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [initial]);

  if (!bounds || !initial)
    return <p className="p-3 text-xs text-muted-foreground">Level has no polygons.</p>;
  const v = view ?? initial;
  const fontSize = initial.w / 70;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    draggedRef.current = false;
    const start = { x: e.clientX, y: e.clientY, view: v };
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = ((ev.clientX - start.x) / rect.width) * start.view.w;
      const dy = ((ev.clientY - start.y) / rect.height) * start.view.h;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 4) {
        // Capture only once a real drag starts — capturing on pointerdown retargets
        // the click to the svg, so polygon onClick never fires.
        if (!draggedRef.current) el.setPointerCapture(ev.pointerId);
        draggedRef.current = true;
      }
      setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
    };
    const up = (ev: PointerEvent) => {
      if (draggedRef.current) el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className="min-h-0 flex-1 touch-none bg-card"
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setView(initial)}
    >
      <title>{level.levelName}</title>
      {shapes.map(({ shape, identifier, d, centroid }) => {
        const room = identifier !== undefined ? roomsById.get(identifier) : undefined;
        const selected = identifier !== undefined && identifier === focusedId;
        const stroke = selected ? "var(--primary)" : room ? "var(--cat-blue)" : "var(--cat-kiln)";
        const fill = selected
          ? "color-mix(in srgb, var(--primary) 28%, transparent)"
          : room
            ? "color-mix(in srgb, var(--cat-blue) 12%, transparent)"
            : "color-mix(in srgb, var(--cat-kiln) 10%, transparent)";
        return (
          <g
            key={shape.id}
            className={cn(identifier !== undefined && "cursor-pointer")}
            onClick={() => {
              if (draggedRef.current || identifier === undefined) return;
              onPickRoom(identifier);
            }}
          >
            <path
              d={d}
              fillRule="evenodd"
              fill={fill}
              stroke={stroke}
              strokeOpacity={0.6}
              strokeWidth={selected ? 2 : 1}
              vectorEffect="non-scaling-stroke"
            />
            {shape.rawSqft > 30 && (
              <text
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                fontSize={fontSize}
                className="pointer-events-none select-none"
                fill={room ? "var(--foreground)" : "var(--muted-foreground)"}
              >
                <tspan x={centroid[0]} fontWeight={600}>
                  {room ? `#${room.number}` : shape.id}
                </tspan>
                <tspan x={centroid[0]} dy={fontSize * 1.1} fillOpacity={0.75}>
                  {fmtNum(shape.rawSqft, 0)} sf
                </tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

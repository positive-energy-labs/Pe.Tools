/**
 * The detail inset of the subject scene: the engineer's `see detail` callout. When the subject's
 * places crowd on screen the drawing draws that region again, normalized: places as named boxes
 * in path order, legs as orthogonal lines between them, levels as bands. Always visible while the
 * crowd lasts, never a hover popover; it sits in a corner of the drawing in screen space.
 */
import { boundsOf, type Bounds2, type Point2 } from "#/lib/affine-frame";
import { token } from "@pe/kit/lib/token";
import type { Leg, Place, SubjectCut } from "./legs";

/**
 * A place carries a glyph (12 px) and its name (about 60 px of caption). Three places inside a
 * 64 px square can still keep their names apart with offsets; a fourth cannot, so four or more
 * places within 64 px of one another is the crowd the inset redraws.
 */
export const DENSE_PX = 64;
export const DENSE_N = 4;

export interface ScreenPlace {
  id: number;
  x: number;
  y: number;
}

/** The densest crowd of places, or null when no `n` places sit within `px` of one. */
export function denseRegion(
  places: readonly ScreenPlace[],
  px = DENSE_PX,
  n = DENSE_N,
): { ids: Set<number>; box: Bounds2 } | null {
  let best: ScreenPlace[] = [];
  for (const centre of places) {
    const near = places.filter((p) => Math.hypot(p.x - centre.x, p.y - centre.y) <= px);
    if (near.length > best.length) best = near;
  }
  if (best.length < n) return null;
  return {
    ids: new Set(best.map((p) => p.id)),
    box: boundsOf(best.map((p): Point2 => [p.x, p.y])),
  };
}

export interface SchematicProps {
  cut: SubjectCut;
  /** The places drawn, by element id; the whole subject when absent. */
  ids?: ReadonlySet<number>;
  levels: readonly { id: number; name: string }[];
  levelAt: ReadonlyMap<number, number | null>;
  selected: ReadonlySet<number>;
  onSelect: (id: number) => void;
  width: number;
  height: number;
}

const BOX_W = 56;
const BOX_H = 16;
const PAD = 10;
const LABEL_W = 38;

/** The leg from `a` to `b` in path order, if the cut has one. */
const legBetween = (cut: SubjectCut, a: Place, b: Place): Leg | undefined =>
  cut.legs.find((leg) => leg.from === a && leg.to === b);

/** Places as boxes in path order, legs as orthogonal lines, levels as bands. Pure SVG, screen px. */
export function Schematic({
  cut,
  ids,
  levels,
  levelAt,
  selected,
  onSelect,
  width,
  height,
}: SchematicProps) {
  const places = cut.nodes.filter((place) => !ids || ids.has(place.id));
  const rows = [...levels].reverse();
  const rowOf = (place: Place) => {
    const i = rows.findIndex((level) => level.id === (levelAt.get(place.id) ?? null));
    return i === -1 ? rows.length : i;
  };
  const bands = rows.length + (places.some((p) => rowOf(p) === rows.length) ? 1 : 0);
  const bandH = (height - 2 * PAD) / Math.max(bands, 1);
  const stepX = places.length > 1 ? (width - 2 * PAD - LABEL_W - BOX_W) / (places.length - 1) : 0;
  const at = (i: number, place: Place): Point2 => [
    PAD + LABEL_W + i * stepX + BOX_W / 2,
    PAD + rowOf(place) * bandH + bandH / 2,
  ];
  return (
    <g data-inset="schematic" fontSize={9} className="face-mono">
      <rect width={width} height={height} fill={token("page")} stroke={token("line-2")} />
      {Array.from({ length: bands }, (_, i) => (
        <g key={i}>
          <rect
            x={0.5}
            y={PAD + i * bandH}
            width={width - 1}
            height={bandH}
            fill={i % 2 ? token("recess") : "none"}
            opacity={0.6}
          />
          <text x={PAD / 2} y={PAD + i * bandH + bandH / 2} dy="0.35em" fill={token("ink-mute")}>
            {rows[i]?.name ?? "no level"}
          </text>
        </g>
      ))}
      {places.slice(1).map((place, i) => {
        const from = places[i]!;
        const leg = legBetween(cut, from, place);
        const [x1, y1] = at(i, from);
        const [x2, y2] = at(i + 1, place);
        const on = leg?.ids.some((id) => selected.has(id)) ?? false;
        return (
          <path
            key={`${from.id}-${place.id}`}
            data-inset-leg={leg ? leg.name : "gap"}
            d={`M${x1 + BOX_W / 2} ${y1}L${(x1 + x2) / 2} ${y1}L${(x1 + x2) / 2} ${y2}L${x2 - BOX_W / 2} ${y2}`}
            fill="none"
            stroke={on ? token("select") : leg ? token("ink") : token("ink-mute")}
            strokeWidth={on ? 3 : leg ? 1.5 : 1}
            className={leg ? undefined : "dash-void"}
          />
        );
      })}
      {places.map((place, i) => {
        const [x, y] = at(i, place);
        const on = selected.has(place.id);
        return (
          <g
            key={`${place.id}-${i}`}
            data-inset-place={place.id}
            transform={`translate(${x - BOX_W / 2} ${y - BOX_H / 2})`}
            style={{ cursor: "pointer" }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(place.id);
            }}
          >
            <rect
              width={BOX_W}
              height={BOX_H}
              fill={token("page")}
              stroke={on ? token("select") : token("ink-2")}
              strokeWidth={on ? 2.5 : 1}
              strokeDasharray={place.kind === "level" || place.kind === "open" ? "2 2" : undefined}
            />
            <text x={BOX_W / 2} y={BOX_H / 2} dy="0.35em" textAnchor="middle" fill={token("ink")}>
              {place.name.length > 9 ? `${place.name.slice(0, 8)}…` : place.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

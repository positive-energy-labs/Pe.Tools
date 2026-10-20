/**
 * The detail inset of the subject scene: the engineer's `see detail` callout. When the subject's
 * places crowd on screen the drawing draws that region again as a one-line schematic: places as
 * named ticks in walking order on one thin line, levels as labelled bands. Always visible while the
 * crowd lasts, never a hover popover; it sits in a corner of the drawing in screen space.
 */
import type { ReactNode } from "react";

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
  /** One quiet line over the bands (why the inset is up); absent draws no header row. */
  caption?: ReactNode;
}

/** The kit's row rhythm: the caption is one row, a level band is two. */
const ROW = 24;
const BAND = ROW * 2;
const PAD = 8;
/** The band label column: a level's name, the timetable's station column. */
const LABEL_W = 76;
const TICK = 5;
/** Open Sans at the small rung runs about this wide per character. */
const CHAR_PX = 6.2;

const small = { fontSize: "var(--type-small-size)" } as const;

const fit = (text: string, px: number) => {
  const n = Math.max(3, Math.floor(px / CHAR_PX));
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

/** The leg from `a` to `b` in path order, if the cut has one. */
const legBetween = (cut: SubjectCut, a: Place, b: Place): Leg | undefined =>
  cut.legs.find((leg) => leg.from === a && leg.to === b);

/** The places drawn and the level bands they fall in, top level first; only bands with a place. */
function layoutOf({ cut, ids, levels, levelAt }: Pick<SchematicProps, "cut" | "ids" | "levels" | "levelAt">) {
  const places = cut.nodes.filter((place) => !ids || ids.has(place.id));
  const all = [...levels].reverse();
  const levelOf = (place: Place) => {
    const id = levelAt.get(place.id) ?? null;
    return all.findIndex((level) => level.id === id);
  };
  const used = new Set(places.map(levelOf));
  const bands = [
    ...all.filter((_, i) => used.has(i)).map((level) => level.name),
    ...(used.has(-1) ? ["no level"] : []),
  ];
  const bandOf = (place: Place) => {
    const i = levelOf(place);
    return i === -1 ? bands.length - 1 : bands.indexOf(all[i]!.name);
  };
  return { places, bands, bandOf };
}

/** The height a schematic wants at the kit's rhythm: a caption row and two rows per level band. */
export const schematicHeight = (props: Pick<SchematicProps, "cut" | "ids" | "levels" | "levelAt">) =>
  ROW + layoutOf(props).bands.length * BAND + PAD;

/**
 * A one-line schematic: the subject's places in walking order along a thin line, one band per
 * level (a riser is the line stepping between bands), place ticks named above and below in turn.
 * Pure SVG, screen px.
 */
export function Schematic({
  cut,
  ids,
  levels,
  levelAt,
  selected,
  onSelect,
  width,
  height,
  caption,
}: SchematicProps) {
  const { places, bands, bandOf } = layoutOf({ cut, ids, levels, levelAt });
  const top = caption ? ROW : 0;
  const bandH = (height - top - PAD / 2) / Math.max(bands.length, 1);
  const x0 = LABEL_W + PAD * 2;
  const x1 = width - PAD * 2;
  const stepX = places.length > 1 ? (x1 - x0) / (places.length - 1) : 0;
  // Names alternate above and below the line, so each has two steps of room.
  const room = places.length > 1 ? stepX * 2 - PAD : x1 - x0;
  const at = (i: number, place: Place): Point2 => [
    places.length > 1 ? x0 + i * stepX : (x0 + x1) / 2,
    top + bandOf(place) * bandH + bandH / 2,
  ];
  const segments = places.slice(1).map((place, i) => {
    const from = places[i]!;
    const leg = legBetween(cut, from, place);
    const [ax, ay] = at(i, from);
    const [bx, by] = at(i + 1, place);
    const mid = (ax + bx) / 2;
    return {
      key: `${from.id}-${place.id}`,
      leg,
      on: leg?.ids.some((id) => selected.has(id)) ?? false,
      d: ay === by ? `M${ax} ${ay}H${bx}` : `M${ax} ${ay}H${mid}V${by}H${bx}`,
    };
  });
  return (
    <g data-inset="schematic" style={small}>
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        fill={token("page")}
        stroke={token("line-2")}
      />
      {caption ? (
        <text x={PAD} y={ROW / 2} dy="0.35em" fill={token("ink-2")} data-inset-caption="">
          {caption}
        </text>
      ) : null}
      {bands.map((name, i) => {
        const y = top + i * bandH;
        return (
          <g key={name} data-inset-band={name}>
            {i || caption ? (
              <line x1={0} x2={width} y1={y} y2={y} stroke={token("line")} />
            ) : null}
            <text x={PAD} y={y + bandH / 2} dy="0.35em" fill={token("ink-2")}>
              <title>{name}</title>
              {fit(name, LABEL_W)}
            </text>
          </g>
        );
      })}
      {segments.map(({ key, d, on }) =>
        on ? (
          <path key={`h${key}`} d={d} fill="none" stroke={token("select")} strokeWidth={8} strokeLinecap="round" />
        ) : null,
      )}
      {segments.map(({ key, leg, d }) => (
        <path
          key={key}
          data-inset-leg={leg ? leg.name : "gap"}
          d={d}
          fill="none"
          stroke={leg ? token("ink") : token("ink-mute")}
          strokeWidth={1}
          className={leg ? undefined : "dash-void"}
        >
          <title>{leg ? leg.name : "gap: no connector between these places"}</title>
        </path>
      ))}
      {places.map((place, i) => {
        const [x, y] = at(i, place);
        const on = selected.has(place.id);
        const above = i % 2 === 0;
        const ring = place.kind === "level" || place.kind === "open";
        // The end names hang inward so they never cross the inset's edge.
        const anchor =
          places.length < 2 ? "middle" : i === 0 ? "start" : i === places.length - 1 ? "end" : "middle";
        return (
          <g
            key={`${place.id}-${i}`}
            data-inset-place={place.id}
            data-selected={on ? "" : undefined}
            transform={`translate(${x} ${y})`}
            style={{ cursor: "pointer" }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(place.id);
            }}
          >
            <title>{place.name}</title>
            <rect x={anchor === "start" ? -6 : anchor === "end" ? 6 - room : -room / 2} y={above ? -ROW + 2 : 0} width={room} height={ROW - 2} fill={on ? token("select") : "transparent"} />
            {ring ? (
              <circle
                r={3}
                fill={token("page")}
                stroke={token("ink-2")}
                className={place.kind === "open" ? "dash-void" : undefined}
              />
            ) : (
              <line y1={-TICK} y2={TICK} stroke={token("ink")} strokeWidth={1.5} />
            )}
            <text
              x={anchor === "start" ? -4 : anchor === "end" ? 4 : 0}
              y={above ? -TICK - 4 : TICK + 4}
              dy={above ? undefined : "0.8em"}
              textAnchor={anchor}
              fill={token("ink")}
            >
              {fit(place.name, room)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

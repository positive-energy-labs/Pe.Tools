/**
 * The solver's layer 1 on the rooms plan (`rooms.trace`): rails, openings, the network and the
 * faces, each a layer the URL names (`?layers=rails,openings`). Drawn in the plan's world px, over
 * Revit's picture, never instead of it.
 */
import type { RoomsTrace } from "@pe/host-contracts/generated";

import { FactChip } from "#/components/lang/chip";
import { tokenRef } from "#/lib/token";
import type { Point2 } from "#/lib/affine-frame";

export type TraceData = RoomsTrace.Res.Response;
/** The trace as read: the data, or (`none`) why there is none; both null while reading. */
export type TraceRead = { data: TraceData | null; none: string | null };
type Rail = RoomsTrace.Res.RoomsTraceRail;
type SegKind = RoomsTrace.Res.RoomsSegKind;

export const LAYERS = ["rails", "openings", "network", "faces"] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_SAYS: Record<Layer, string> = {
  rails: "every wall rail the solver read, a grey band of its thickness with its axis",
  openings: "each gap the solver read as an opening, by kind: door, headed, cased, closed",
  network: "the network segments the faces were cut from, by kind",
  faces: "layer 1's faces before judgment, per zone",
};

/** The URL's `layers` (`rails,faces`): the known names it holds, in legend order. */
export const layersOf = (search: string): Layer[] => {
  const named = search.split(",").map((name) => name.trim());
  return LAYERS.filter((layer) => named.includes(layer));
};

/** `layers` with one layer flipped, as the URL writes it; none on is absent. */
export const toggleLayer = (on: readonly Layer[], layer: Layer): string =>
  LAYERS.filter((item) => (item === layer) !== on.includes(item)).join(",");

/** The one host error that means "nothing partitioned here yet"; every other error is an error. */
export const NO_TRACE = /traced (no|a) zone on/;

/** Every zone file carries the whole capture's rails; each rail once, by its (A, B). */
export const railsOf = (trace: TraceData): Rail[] => {
  const seen = new Map<string, Rail>();
  for (const zone of trace.zones)
    for (const rail of zone.trace.rails) {
      const key = `${rail.a.join(",")}|${rail.b.join(",")}`;
      if (!seen.has(key)) seen.set(key, rail);
    }
  return [...seen.values()];
};

/** Kind to ink. Zone and Wall are the network's own; the rest are an opening's. */
const KIND_INK: Record<SegKind, string> = {
  Door: tokenRef("alarm"),
  Headed: tokenRef("caution"),
  Cased: tokenRef("viz-1"),
  Closed: tokenRef("done"),
  Wall: tokenRef("ink"),
  Zone: tokenRef("ink-mute"),
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const ft = (value: number | null | undefined) =>
  value == null ? "none" : `${value.toFixed(2)} ft`;

/** The trace in world px: `toWorld` is the plan's model-feet frame, `pxPerFt` its scale. */
export function TraceLayers({
  trace,
  on,
  toWorld,
  pxPerFt,
}: {
  trace: TraceData;
  on: readonly Layer[];
  toWorld: (point: Point2) => Point2;
  pxPerFt: number;
}) {
  const at = (point: readonly number[]) => toWorld([point[0]!, point[1]!]);
  const line = (a: readonly number[], b: readonly number[]) => {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    return { x1, y1, x2, y2 };
  };
  return (
    <g aria-label="solver layers" style={{ pointerEvents: "none" }}>
      {on.includes("rails") ? (
        <g data-layer="rails">
          {railsOf(trace).map((rail, i) => (
            <g key={i} data-rail={rail.elementId}>
              <line
                {...line(rail.a, rail.b)}
                style={{
                  stroke: tokenRef("ink-mute"),
                  strokeOpacity: 0.35,
                  strokeWidth: rail.thicknessFt * pxPerFt,
                }}
              />
              <line
                {...line(rail.a, rail.b)}
                style={{ stroke: tokenRef("ink-2"), strokeWidth: "calc(var(--sw) * 1px)" }}
              />
            </g>
          ))}
        </g>
      ) : null}
      {on.includes("network") ? (
        <g data-layer="network">
          {trace.zones.flatMap((zone) =>
            zone.trace.segments.map((segment, i) => (
              <line
                key={`${zone.zoneGuid}-${i}`}
                data-segment={segment.kind}
                {...line(segment.a, segment.b)}
                className={segment.kind === "Zone" ? "dash-reference" : undefined}
                style={{ stroke: KIND_INK[segment.kind], strokeWidth: "calc(var(--sw) * 1px)" }}
              />
            )),
          )}
        </g>
      ) : null}
      {on.includes("openings") ? (
        <g data-layer="openings" style={{ pointerEvents: "auto" }}>
          {trace.zones.flatMap((zone) =>
            zone.trace.openings.map((opening, i) => (
              <line
                key={`${zone.zoneGuid}-${i}`}
                data-opening={opening.kind}
                {...line(opening.a, opening.b)}
                style={{
                  stroke: KIND_INK[opening.kind],
                  strokeWidth: "calc(var(--sw) * 4px)",
                  strokeLinecap: "round",
                }}
              >
                <title>{`${opening.kind} · ${ft(opening.widthFt)} · ${opening.doorPieces} door pieces · header ${pct(opening.headerFraction)} · wall ${pct(opening.wallFraction)}`}</title>
              </line>
            )),
          )}
        </g>
      ) : null}
    </g>
  );
}

/**
 * The faces layer. ponytail: the trace carries a face's facts but not its loop (the loop lives on
 * the answer's Room, which the zone file does not keep), so faces are read as a strip of chips per
 * zone, not drawn on the plan.
 */
export function TraceFaces({ trace }: { trace: TraceData }) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-1" aria-label="solver faces">
      {trace.zones.flatMap((zone) =>
        zone.trace.faces.map((face) => (
          <FactChip
            key={`${zone.zoneGuid}-${face.index}`}
            title={`${face.kind} · backed ${pct(face.backed)} · floating ${ft(face.floatingFt)} · ${face.narrow ? "narrow" : "not narrow"} · band ${ft(face.bandWidthFt)}${face.ownEdgeEmpty ? " · own edge empty" : ""}`}
          >
            <span data-face={face.kind}>{`${zone.label}·F${face.index + 1} ${face.kind}`}</span>
          </FactChip>
        )),
      )}
    </div>
  );
}

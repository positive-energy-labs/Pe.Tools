/**
 * The rooms plan: Revit's picture of the view (as exported, never redrawn) under one path per
 * zone, room and held region, inked by the region's state, on a pan-zoom canvas. Every room and
 * held region wears a numbered callout whose label is the table's. Click selects, shift-click adds,
 * hover pairs with the table row, a click on empty ground clears; wheel zooms at the cursor.
 */
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import {
  boundsOf,
  contentViewport,
  fitFrame,
  type Bounds2,
  type Point2,
  type Viewport2,
} from "#/lib/affine-frame";
import { token } from "#/lib/token";
import { PlanImageLayer, type TakeoffPlanImage } from "#/takeoff/level-plan";
import { pathD } from "#/takeoff/model";
import { PLAN_REFUSAL, type PlanRefusal } from "#/takeoff/plan-image";
import {
  LAYER_SAYS,
  LAYERS,
  toggleLayer,
  TraceFaces,
  TraceLayers,
  type Layer,
  type TraceRead,
} from "./layers";
import { CALLOUT_FONT_PX, holdsPin, PIN_R, placeCallouts, type CalloutItem } from "./callouts";

export type RoomsRegion = RoomsSnapshot.Res.RoomsRegion;

/** A wire point as model XY in feet; anything else is not a point, and says so. */
const xy = (point: readonly number[]): Point2 => {
  if (point.length !== 2 || !point.every(Number.isFinite))
    throw Error(`rooms.snapshot point is not model XY: [${point.join(", ")}]`);
  return [point[0]!, point[1]!];
};
const loopOf = (loop: readonly (readonly number[])[]) => loop.map(xy);

export type RegionState = "zone" | "locked" | "stale" | "held" | "machine" | "unassigned";

/** The legend order. Unassigned is not an ink: it counts rooms outside every zone. */
export const REGION_STATES = ["zone", "locked", "stale", "held", "machine", "unassigned"] as const;

/** The ink order: the first that holds wins. A person's region outranks a stale one. */
export const regionState = (
  region: Pick<RoomsRegion, "locked" | "stale" | "role">,
): Exclude<RegionState, "unassigned"> =>
  region.role === "zone"
    ? "zone"
    : region.locked
      ? "locked"
      : region.stale
        ? "stale"
        : region.role === "held"
          ? "held"
          : "machine";

/** A room no zone on its view contains: partition never touches it. */
export const unassigned = (region: Pick<RoomsRegion, "role" | "zone">) =>
  region.role === "room" && region.zone == null;

/**
 * Each state's ink role, dash and what it means. A zone is a reference boundary, unfilled: scope,
 * not a room. Held is absent ink, dashed void: residue, not a room. Unassigned has no ink of its
 * own; the room wears its state's.
 */
export const REGION_INK: Record<
  RegionState,
  { ink: string | null; dash: "dash-reference" | "dash-void" | null; says: string }
> = {
  zone: {
    ink: "ink-mute",
    dash: "dash-reference",
    says: "a zone: partition splits it into rooms around the rooms already in it",
  },
  locked: {
    ink: "ink",
    dash: null,
    says: "a person drew, edited or designated this region; partition keeps it as drawn",
  },
  stale: {
    ink: "caution",
    dash: null,
    says: "the walls under this region moved since it was drawn",
  },
  held: {
    ink: "ink-mute",
    dash: "dash-void",
    says: "held residue: area partition could not place in a room",
  },
  machine: {
    ink: "ink-2",
    dash: null,
    says: "drawn by partition and untouched since",
  },
  unassigned: {
    ink: null,
    dash: null,
    says: "a room outside every zone, drawn in its state's ink; partition never touches it",
  },
};

/** A region's label: its name, else `R{n}` by its place in the table's order. */
export const regionLabel = (region: RoomsRegion, index: number) => region.name || `R${index + 1}`;

/** A region with its label, as the table orders and numbers it. */
export interface RoomRow {
  region: RoomsRegion;
  label: string;
}

/** The URL's `focus` (`R12,R3`) against the table's labels: the rows it names, and what none wears. */
export function focusOf(rows: readonly RoomRow[], focus: string) {
  const labels = [
    ...new Set(
      focus
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
  return {
    rows: rows.filter((row) => labels.includes(row.label)),
    missing: labels.filter((label) => !rows.some((row) => row.label === label)),
  };
}

const planCorners = (plan: TakeoffPlanImage): Point2[] => {
  const { topLeft: a, topRight: b, bottomLeft: c } = plan.registration;
  return [a, b, c, [b[0] + c[0] - a[0], b[1] + c[1] - a[1]]];
};

// ponytail: the world is drawn at 4 px per foot; zoom 0.02 to 24 spans 0.08 to 96 screen px per foot.
export const WORLD_PX_PER_FT = 4;
const ZOOM = [0.02, 24] as const;
const CLICK_PX = 5;
const ZOOM_PAD_PX = 48;
/** w16's fill: alpha 70/255 of the state ink. */
const FILL_PCT = 27;
const FILL_HOT_PCT = 40;

type View = { scale: number; tx: number; ty: number };

/** The view that fits a world-px box in the pane, centred, with `pad` screen px around it. */
export const fitView = (box: Bounds2, size: Viewport2, pad: number): View => {
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(
    ZOOM[1],
    Math.max(ZOOM[0], Math.min((size.width - 2 * pad) / w, (size.height - 2 * pad) / h)),
  );
  return {
    scale,
    tx: (size.width - w * scale) / 2 - box.minX * scale,
    ty: (size.height - h * scale) / 2 - box.minY * scale,
  };
};

export function RoomsPlan({
  rows,
  plan,
  planRefusal,
  planError,
  empty,
  selected,
  hovered,
  zoomTo,
  focusMissing,
  onSelect,
  onHover,
  trace,
  layers,
  setLayers,
}: {
  /** The regions on the drawn view, labelled as the table labels them. */
  rows: readonly RoomRow[];
  plan: TakeoffPlanImage | null;
  planRefusal: PlanRefusal | null;
  planError: string | null;
  /** Why nothing can be drawn yet (no document, no view, snapshot failed); null = draw. */
  empty: { says: string; exit: string } | null;
  selected: ReadonlySet<string>;
  hovered: string | null;
  /** Region guids the URL's `focus` names: the view zooms to their union once they are drawn. */
  zoomTo: readonly string[];
  /** Labels the URL's `focus` names that no region wears. */
  focusMissing: readonly string[];
  /** A click selects one region; a shift-click adds or removes it (merge takes two or more). */
  onSelect: (guid: string | null, add: boolean) => void;
  onHover: (guid: string | null) => void;
  /** `rooms.trace` for the drawn view; `none` names why there is nothing to draw. */
  trace: TraceRead;
  /** The URL's layers, on; `setLayers` writes the URL's `layers` back. */
  layers: readonly Layer[];
  setLayers: (next: string) => void;
}) {
  const bounds = useMemo(() => {
    const points: Point2[] = rows.flatMap((row) => loopOf(row.region.outer));
    if (plan) points.push(...planCorners(plan));
    return points.length ? boundsOf(points) : null;
  }, [rows, plan]);
  const counts = useMemo(() => {
    const n: Record<RegionState, number> = {
      zone: 0,
      locked: 0,
      stale: 0,
      held: 0,
      machine: 0,
      unassigned: 0,
    };
    for (const row of rows) {
      n[regionState(row.region)] += 1;
      if (unassigned(row.region)) n.unassigned += 1;
    }
    return n;
  }, [rows]);

  /** The world: model feet to world px, y up, at a fixed density; the view pans and zooms it. */
  const world = useMemo(() => {
    if (!bounds) return null;
    const { viewport, padding } = contentViewport(bounds, 0.03);
    const width = viewport.width * WORLD_PX_PER_FT;
    const height = viewport.height * WORLD_PX_PER_FT;
    const frame = fitFrame(
      bounds,
      { width, height },
      {
        padding: padding * WORLD_PX_PER_FT,
        yAxis: "up",
      },
    );
    const shapes = rows.map(({ region, label }) => {
      const loops = [loopOf(region.outer), ...region.holes.map(loopOf)];
      return {
        region,
        label,
        state: regionState(region),
        d: pathD(loops, frame),
        box: boundsOf(loops[0]!.map(frame.toViewport)),
        anchor: frame.toViewport(xy(region.label)),
      };
    });
    // Fit to Revit's crop when there is one: a region far outside it stays drawn and pannable, but
    // never squeezes the plan into a strip.
    const fit: Bounds2 = plan
      ? boundsOf(planCorners(plan).map(frame.toViewport))
      : { minX: 0, minY: 0, maxX: width, maxY: height };
    const [ox] = frame.toViewport([0, 0]);
    const [fx] = frame.toViewport([1, 0]);
    return { frame, width, height, shapes, fit, pxPerFt: Math.abs(fx - ox) };
  }, [bounds, rows, plan]);

  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Viewport2 | null>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragDist = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(host);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(
          ZOOM[1],
          Math.max(ZOOM[0], v.scale * Math.exp(-event.deltaY * 0.0015)),
        );
        return {
          scale,
          tx: cx - ((cx - v.tx) * scale) / v.scale,
          ty: cy - ((cy - v.ty) * scale) / v.scale,
        };
      });
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", onWheel);
    };
  }, [host]);

  // Fit on load: once per drawn view, not on every snapshot refresh.
  const fitKey = `${rows[0]?.region.view ?? ""}|${plan ? "plan" : ""}`;
  const fitted = useRef("");
  useEffect(() => {
    if (!world || !size || fitted.current === fitKey) return;
    fitted.current = fitKey;
    setView(fitView(world.fit, size, 0));
  }, [world, size, fitKey]);

  // Focus: zoom to the named regions' union once, when they are drawn.
  const zoomKey = zoomTo.join(",");
  const zoomed = useRef("");
  useEffect(() => {
    if (!world || !size || !zoomKey || zoomed.current === zoomKey) return;
    const boxes = world.shapes
      .filter((shape) => zoomTo.includes(shape.region.guid))
      .flatMap((shape) => [
        [shape.box.minX, shape.box.minY] as const,
        [shape.box.maxX, shape.box.maxY] as const,
      ]);
    if (!boxes.length) return;
    zoomed.current = zoomKey;
    setView(fitView(boundsOf(boxes), size, ZOOM_PAD_PX));
  }, [world, size, zoomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const callouts = useMemo(() => {
    if (!world || !size) return [];
    const toScreen = ([x, y]: Point2): Point2 => [
      x * view.scale + view.tx,
      y * view.scale + view.ty,
    ];
    const items: (CalloutItem & { guid: string; ink: string })[] = world.shapes
      .filter((shape) => shape.state !== "zone")
      .map(({ region, label, state, box, anchor }) => ({
        guid: region.guid,
        ink: token(REGION_INK[state].ink!),
        label,
        anchor: toScreen(anchor),
        text: `${region.sqft.toFixed(0)} sf${region.role === "held" && region.reason ? ` · ${region.reason}` : ""}`,
        fits: holdsPin(Math.min(box.maxX - box.minX, box.maxY - box.minY) * view.scale, PIN_R),
      }));
    return placeCallouts(items, size, PIN_R).map((callout) => ({
      ...callout,
      ...items.find((item) => item.label === callout.label && item.anchor === callout.anchor)!,
    }));
  }, [world, size, view]);

  const legend = (
    <div className="flex flex-wrap items-center gap-1 px-1 py-1" aria-label="plan legend">
      {REGION_STATES.map((state) => (
        <FactChip
          key={state}
          tone={state === "stale" ? "caution" : "meta"}
          title={REGION_INK[state].says}
        >
          <span className="flex items-center gap-1">
            {REGION_INK[state].ink ? (
              <svg aria-hidden width="10" height="10" viewBox="0 0 10 10">
                <rect
                  x="1"
                  y="1"
                  width="8"
                  height="8"
                  fill="none"
                  stroke={token(REGION_INK[state].ink!)}
                  className={REGION_INK[state].dash ?? undefined}
                />
              </svg>
            ) : null}
            {state} <span className="face-mono">{counts[state]}</span>
          </span>
        </FactChip>
      ))}
      {LAYERS.map((layer) => {
        const on = layers.includes(layer);
        return (
          <Press
            key={layer}
            type="button"
            frame="line"
            size="caption"
            state={on ? "selected" : "rest"}
            aria-pressed={on}
            disabled={!trace.data}
            title={trace.data ? LAYER_SAYS[layer] : (trace.none ?? "reading the trace")}
            onClick={() => setLayers(toggleLayer(layers, layer))}
          >
            {layer}
          </Press>
        );
      })}
      {!trace.data && trace.none ? (
        <FactChip title="partition this view to write a trace">{trace.none}</FactChip>
      ) : null}
    </div>
  );

  const notice = (
    <>
      {trace.data && layers.includes("faces") ? <TraceFaces trace={trace.data} /> : null}
      {planRefusal ? (
        <OutcomeLine
          kind="refused"
          label={`no plan image · ${planRefusal}`}
          says={PLAN_REFUSAL[planRefusal]}
        />
      ) : planError ? (
        <OutcomeLine kind="error" label="plan image unread" says={planError} />
      ) : null}
      {focusMissing.length ? (
        <OutcomeLine
          kind="refused"
          label={`focus · ${focusMissing.join(", ")}`}
          says="no region in this snapshot wears that label"
        />
      ) : null}
    </>
  );

  if (empty || !world)
    return (
      <div className="flex size-full min-h-0 flex-col">
        {legend}
        {notice}
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState
            story="scope"
            exit={empty?.exit ?? "draw a zone on this view in Revit, then press partition"}
          >
            {empty?.says ?? "no zones, rooms or plan image on this view yet"}
          </EmptyState>
        </div>
      </div>
    );

  const worldStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: world.width,
    height: world.height,
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
    transformOrigin: "0 0",
    ...({ "--sw": String(1 / view.scale) } as CSSProperties),
  };
  const font = CALLOUT_FONT_PX;

  return (
    <div className="flex size-full min-h-0 flex-col">
      {legend}
      {notice}
      <div
        ref={setHost}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
          dragDist.current = 0;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const dx = event.clientX - d.x;
          const dy = event.clientY - d.y;
          dragDist.current = Math.max(dragDist.current, Math.abs(dx) + Math.abs(dy));
          if (dragDist.current >= CLICK_PX) event.currentTarget.setPointerCapture(event.pointerId);
          setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onClick={() => {
          if (dragDist.current < CLICK_PX) onSelect(null, false);
        }}
      >
        <div style={worldStyle}>
          <svg
            width={world.width}
            height={world.height}
            viewBox={`0 0 ${world.width} ${world.height}`}
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
            role="img"
            aria-label="rooms plan"
          >
            <title>Room regions on the plan view</title>
            {plan ? <PlanImageLayer plan={plan} frame={world.frame} /> : null}
            {world.shapes.map(({ region, label, state, d }) => {
              const ink = token(REGION_INK[state].ink!);
              const on = selected.has(region.guid);
              const hot = hovered === region.guid;
              const width = on ? 3 : 2;
              return (
                <path
                  key={region.guid}
                  data-state={state}
                  data-unassigned={unassigned(region) || undefined}
                  d={d}
                  fillRule="evenodd"
                  fill={
                    state === "zone"
                      ? "none"
                      : `color-mix(in srgb, ${ink} ${on || hot ? FILL_HOT_PCT : FILL_PCT}%, transparent)`
                  }
                  stroke={ink}
                  className={REGION_INK[state].dash ?? undefined}
                  style={{
                    strokeWidth: `calc(var(--sw) * ${width}px)`,
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => onHover(region.guid)}
                  onMouseLeave={() => onHover(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (dragDist.current < CLICK_PX) onSelect(region.guid, event.shiftKey);
                  }}
                >
                  <title>{`${label} · ${region.sqft.toFixed(0)} sf · ${state}${unassigned(region) ? " · unassigned" : ""}`}</title>
                </path>
              );
            })}
            {trace.data ? (
              <TraceLayers
                trace={trace.data}
                on={layers}
                toWorld={world.frame.toViewport}
                pxPerFt={world.pxPerFt}
              />
            ) : null}
          </svg>
        </div>
        {size ? (
          <svg
            width={size.width}
            height={size.height}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
            aria-label="region callouts"
          >
            {callouts.map((callout) => {
              const on = selected.has(callout.guid);
              const hot = hovered === callout.guid;
              const [ax, ay] = callout.anchor;
              const [px, py] = callout.pin;
              const textX = px + callout.pinWidth / 2 + 8;
              return (
                <g
                  key={callout.guid}
                  data-callout={callout.label}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onMouseEnter={() => onHover(callout.guid)}
                  onMouseLeave={() => onHover(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (dragDist.current < CLICK_PX) onSelect(callout.guid, event.shiftKey);
                  }}
                >
                  {callout.leader ? (
                    <>
                      <line
                        x1={ax}
                        y1={ay}
                        x2={px}
                        y2={py}
                        stroke={callout.ink}
                        strokeWidth={1.5}
                      />
                      <circle cx={ax} cy={ay} r={2.5} fill={callout.ink} />
                    </>
                  ) : null}
                  <rect
                    x={px}
                    y={py - PIN_R * 0.75}
                    width={callout.box[2] - px - 4}
                    height={PIN_R * 1.5}
                    rx={4}
                    fill={token("page")}
                    fillOpacity={0.92}
                    stroke={callout.ink}
                    strokeWidth={on || hot ? 2 : 1}
                  />
                  <rect
                    x={px - callout.pinWidth / 2}
                    y={py - PIN_R}
                    width={callout.pinWidth}
                    height={PIN_R * 2}
                    rx={PIN_R}
                    fill={callout.ink}
                    stroke={on ? token("ink") : token("page")}
                    strokeWidth={on ? 3 : 1.5}
                  />
                  <text
                    x={px}
                    y={py}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={font}
                    fontFamily="var(--font-mono)"
                    fill={token("page")}
                  >
                    {callout.label}
                  </text>
                  <text
                    x={textX}
                    y={py}
                    dominantBaseline="central"
                    fontSize={font}
                    fontFamily="var(--font-mono)"
                    fill={token("ink")}
                  >
                    {callout.text}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

import { RegistryContext } from "@effect/atom-react";
import {
  AttentionDocument,
  elementKey,
  mention,
  setHovered,
  useAttention,
} from "@pe/kit/lang/attention";
import { GoToPopup } from "@pe/kit/lang/go-to";
/** Revit's registered picture under selectable room regions, paired with the table. */
import { SvgTip } from "@pe/kit/lang/tooltip";
import { useContext, type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import { PictureStage, stageViewport } from "#/scene/stage-controller";
import { PictureReadout } from "@pe/kit/lang/readout";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";

import { Legend, legendWord } from "@pe/kit/lang/legend";
import type { PaneApi } from "../../../../packages/kit/src/components/lang/graph-layout";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { PLAN_CLICK_PX as CLICK_PX, usePlaneViewport } from "#/scene/use-plane-viewport";
import { usePlanMap } from "#/lib/plan-map";
import type { RoomsPage } from "./graph";

import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { boundsOf, contentViewport, fitFrame, type Bounds2, type Point2 } from "#/lib/affine-frame";
import { token } from "@pe/kit/lib/token";
import { PlanImageLayer, planCorners, type TakeoffPlanImage } from "#/takeoff/level-plan";
import { pathD } from "#/takeoff/model";
import { PLAN_REFUSAL, type PlanRefusal } from "#/takeoff/plan";
import { ROOMS_LAYERS, toggleLayer } from "@pe/agent-contracts";
import { LAYER_SAYS, TraceFaces, TraceLayers, type Layer, type TraceRead } from "./layers";
import { CALLOUT_FONT_PX, holdsPin, PIN_R, placeCallouts, type CalloutItem } from "./callouts";
import type { PlanGeo } from "./sketch";
import { useRouteLease } from "#/route/view-bridge";

export interface RoomsPlanLease {
  thread?: string;
  ready: boolean;
  context: Record<string, unknown>;
}

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
const REGION_STATES = ["zone", "locked", "stale", "held", "machine", "unassigned"] as const;

/**
 * The outline's ink order: the first that holds wins, so a person's region outranks a stale one.
 * Stale evidence under a locked region still shows, in its fill, count and readout (`lockedStale`).
 */
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

/** A locked region whose walls moved since: both facts hold and both are shown. */
export const lockedStale = (region: Pick<RoomsRegion, "locked" | "stale" | "role">) =>
  regionState(region) === "locked" && region.stale;

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

// ponytail: the world is drawn at 4 px per foot; zoom 0.02 to 24 spans 0.08 to 96 screen px per foot.
const PLAN_PX_PER_FT = 4;
const ZOOM_PAD_PX = 48;
/** w16's fill: alpha 70/255 of the state ink. */
const FILL_PCT = 27;
const FILL_HOT_PCT = 40;

export function RoomsPlan({
  renderPane,
  fixture = false,
  lease,
  rows,
  plan,
  planRefusal,
  planError,
  empty,
  zoomTo,
  focusMissing,
  onSelect,
  trace,
  page,
  setPage,
  overlay,
}: {
  renderPane: PaneApi;
  /** A synthetic plan (`?demo=plan`): said in the pane's meta, where the view is named. */
  fixture?: boolean;
  lease?: RoomsPlanLease;
  /** Drawn over the plan in screen px (the feedback layer), given the plan's frame. */
  overlay?: (geo: PlanGeo) => ReactNode;
  /** The regions on the drawn view, labelled as the table labels them. */
  rows: readonly RoomRow[];
  plan: TakeoffPlanImage | null;
  planRefusal: PlanRefusal | null;
  planError: string | null;
  /** Why nothing can be drawn yet (no document, no view, snapshot failed); null = draw. */
  empty: { says: string; exit: string } | null;
  /** Region guids the URL's `focus` names: the view zooms to their union once they are drawn. */
  zoomTo: readonly string[];
  /** Labels the URL's `focus` names that no region wears. */
  focusMissing: readonly string[];
  /** A click selects one region; a shift-click adds or removes it (merge takes two or more). */
  onSelect: (guid: string | null, add: boolean) => void;
  /** `rooms.trace` for the drawn view; `none` names why there is nothing to draw. */
  trace: TraceRead;
  page: RoomsPage;
  setPage: (next: Partial<RoomsPage>, move?: { history: "push" | "replace" }) => void;
}) {
  const doc = useContext(AttentionDocument) ?? "";
  const registry = useContext(RegistryContext);
  const attention = useAttention(doc);
  const selected = new Set(
    rows
      .filter((row) => attention.selected.has(elementKey(row.region.elementId)))
      .map((row) => row.region.guid),
  );
  const onHover = (guid: string | null) =>
    setHovered(registry, guid == null ? null : { doc, key: `room:${guid}` });
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
      if (lockedStale(row.region)) n.stale += 1;
      if (unassigned(row.region)) n.unassigned += 1;
    }
    return n;
  }, [rows]);

  /** The world: model feet to world px, y up, at a fixed density; the view pans and zooms it. */
  const world = useMemo(() => {
    if (!bounds) return null;
    const { viewport, padding } = contentViewport(bounds, 0.03);
    const width = viewport.width * PLAN_PX_PER_FT;
    const height = viewport.height * PLAN_PX_PER_FT;
    const frame = fitFrame(
      bounds,
      { width, height },
      {
        padding: padding * PLAN_PX_PER_FT,
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

  const picked = world?.shapes.filter((shape) => selected.has(shape.region.guid)) ?? [];
  const readout = picked.length ? (
    <PictureReadout
      title={
        picked.length === 1
          ? [
              picked[0]!.label,
              picked[0]!.region.name && picked[0]!.region.name !== picked[0]!.label
                ? picked[0]!.region.name
                : null,
              picked[0]!.region.type,
            ]
              .filter(Boolean)
              .join(" · ")
          : `${picked.length} regions`
      }
      onClear={() => onSelect(null, false)}
    >
      <span className="face-mono whitespace-nowrap" data-rooms-readout="">
        {picked.length === 1
          ? `${picked[0]!.state} · ${picked[0]!.region.role} · ${picked[0]!.region.sqft.toFixed(0)} sf`
          : `${picked.map((shape) => shape.label).join(", ")} · ${picked.reduce((sf, shape) => sf + shape.region.sqft, 0).toFixed(0)} sf`}
      </span>
    </PictureReadout>
  ) : null;
  const viewport = usePlaneViewport(
    page.viewport,
    world?.fit ?? null,
    stageViewport<PlaneViewport>(setPage),
    readout,
  );
  const {
    setHost,
    host,
    size,
    view,
    move,
    frame: frameBox,
    dragging,
    dragDistance: dragDist,
    handlers,
  } = viewport;
  const layers = page.layers;
  const mapShapes = useMemo(
    () =>
      world?.shapes.map((shape) => ({ d: shape.d, ink: token(REGION_INK[shape.state].ink!) })) ??
      [],
    [world],
  );
  const map = usePlanMap(view, move, world, size, mapShapes, plan);
  const pane = {
    title: "plan",

    meta:
      [page.view, fixture ? "fixture · no Revit capture" : null].filter(Boolean).join(" · ") ||
      undefined,
    floaters: [map],
    layers: {
      value: layers,
      options: ROOMS_LAYERS.map((key) => ({ key, label: key, says: LAYER_SAYS[key] })),
      onToggle: (key: string) =>
        setPage(
          { layers: toggleLayer(ROOMS_LAYERS, page.layers, key as Layer) },
          { history: "push" },
        ),
    },
  };

  // Focus: zoom to the named regions' union once, when they are drawn.
  const zoomKey = page.focus;
  const zoomed = useRef("");
  useEffect(() => {
    if (!zoomKey) {
      zoomed.current = "";
      return;
    }
    if (!world || !size || zoomed.current === zoomKey) return;
    const boxes = world.shapes
      .filter((shape) => zoomTo.includes(shape.region.guid))
      .flatMap((shape) => [
        [shape.box.minX, shape.box.minY] as const,
        [shape.box.maxX, shape.box.maxY] as const,
      ]);
    const to = boxes.length ? frameBox(boundsOf(boxes), ZOOM_PAD_PX) : null;
    if (!to) return;
    zoomed.current = zoomKey;
    move(to, "move");
  }, [world, size, zoomKey, zoomTo, move]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPoints =
    world?.shapes
      .filter((shape) => selected.has(shape.region.guid))
      .flatMap((shape) => [
        [shape.box.minX, shape.box.minY] as const,
        [shape.box.maxX, shape.box.maxY] as const,
      ]) ?? [];

  // The lease's one key is the viewport (`roomsAddress.agent`); the rest stays the person's.
  useRouteLease("rooms", [page, setPage], {
    thread: lease?.thread,
    visible:
      !!lease?.ready &&
      !empty &&
      !!world &&
      !!size &&
      (!page.focus || !zoomTo.length || zoomed.current === page.focus),
    context: {
      ...lease?.context,
      size,
      frame: world?.frame.transform ?? null,
      plan: plan ? { href: plan.href, registration: plan.registration } : null,
    },
    facts: {
      pose: view,
      size,
      fit: world?.fit ?? null,
      frame: world?.frame.transform ?? null,
      units: "model XY feet; affine frame to world pixels; viewport scale and screen translations",
      counts,
      totalRegions: rows.length,
      truncated: rows.length > 100,
      regions: (world?.shapes ?? []).slice(0, 100).map((shape) => ({
        guid: shape.region.guid,
        label: shape.label,
        role: shape.region.role,
        bounds: shape.box,
      })),
    },
  });

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

  const geo = useMemo((): PlanGeo | null => {
    if (!world || !size) return null;
    const [ox, oy] = world.frame.toViewport([0, 0]);
    const [ux, uy] = world.frame.toViewport([1, 1]);
    return {
      size,
      toScreen: (ft) => {
        const [x, y] = world.frame.toViewport(ft);
        return [x * view.scale + view.tx, y * view.scale + view.ty];
      },
      toFeet: ([x, y]) => [
        ((x - view.tx) / view.scale - ox) / (ux - ox),
        ((y - view.ty) / view.scale - oy) / (uy - oy),
      ],
      pins: new Map(callouts.map((callout) => [callout.guid, callout.pin])),
    };
  }, [world, size, view, callouts]);

  const legend = (
    <Legend
      label="rooms"
      rows={REGION_STATES.map((state) => ({
        key: state,
        stroke: {
          ink: token(REGION_INK[state].ink ?? "ink-mute"),
          width: 1,
          shape: "box",
          className: REGION_INK[state].dash ?? undefined,
        },
        word: legendWord(state),
        count: counts[state],
        says: REGION_INK[state].says,
      }))}
    />
  );

  const notice = (
    <>
      {!trace.data && trace.none ? (
        <OutcomeLine
          kind="advisory"
          label={trace.none}
          says="Partition this view to write a trace"
        />
      ) : null}
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

  const pictureStage = {
    goTo: (
      <GoToPopup
        items={() =>
          rows.map((row) => ({
            key: row.region.guid,
            name: row.region.name || row.label,
            id: row.region.elementId ?? row.region.guid,
            detail: `${row.label} ${row.region.guid}`,
          }))
        }
        hover={(item) => onHover(item?.key ?? null)}
        onGo={(item) => {
          onSelect(item.key, false);
          const shape = world?.shapes.find((shape) => shape.region.guid === item.key);
          if (shape) {
            const to = frameBox(shape.box, ZOOM_PAD_PX);
            if (to) move(to, "move");
          }
        }}
      />
    ),
    kind: "plane" as const,
    host,
    viewport,
    bounds: world?.fit ?? null,
    selectedBounds: selectedPoints.length ? boundsOf(selectedPoints) : null,
    clearSelection: () => {
      if (selected.size) onSelect(null, false);
    },
  };
  if (empty || !world)
    return (
      <PictureStage {...pictureStage}>
        {(stage) =>
          renderPane(
            <>
              {notice}
              <div className="flex flex-1 items-center justify-center px-4">
                <EmptyState
                  story="scope"
                  exit={empty?.exit ?? "draw a zone on this view in Revit, then press partition"}
                >
                  {empty?.says ?? "no zones, rooms or plan image on this view yet"}
                </EmptyState>
              </div>
            </>,
            { ...pane, actions: stage.goTo, legend },
          )
        }
      </PictureStage>
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
    <PictureStage {...pictureStage}>
      {(stage) =>
        renderPane(
          <>
            {notice}
            <div
              ref={setHost}
              data-rooms-plan=""
              className="relative min-h-0 flex-1 overflow-hidden"
              style={{ cursor: dragging ? "grabbing" : "grab" }}
              {...handlers}
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
                  <SvgTip content={"room regions"} />
                  {plan ? <PlanImageLayer plan={plan} frame={world.frame} /> : null}
                  {world.shapes.map(({ region, state, d }) => {
                    const ink = token(REGION_INK[state].ink!);
                    const stale = lockedStale(region);
                    const fillInk = stale ? token(REGION_INK.stale.ink!) : ink;
                    const on = selected.has(region.guid);
                    const hot =
                      attention.hovered.has(elementKey(region.elementId)) ||
                      attention.lit.has(elementKey(region.elementId));
                    const width = on ? 3 : 2;
                    return (
                      <path
                        key={region.guid}
                        {...revitTarget([region.elementId])}
                        data-state={state}
                        data-unassigned={unassigned(region) || undefined}
                        data-stale={stale || undefined}
                        d={d}
                        fillRule="evenodd"
                        fill={
                          state === "zone"
                            ? "none"
                            : `color-mix(in srgb, ${fillInk} ${on || hot ? FILL_HOT_PCT : FILL_PCT}%, transparent)`
                        }
                        stroke={ink}
                        className={REGION_INK[state].dash ?? undefined}
                        style={{
                          strokeWidth: `calc(var(--sw) * ${width}px)`,
                          cursor: "pointer",
                        }}
                        {...mention({ doc, key: `room:${region.guid}` })}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (dragDist.current < CLICK_PX) onSelect(region.guid, event.shiftKey);
                        }}
                      >
                        <SvgTip content={stale ? "locked · stale" : state} />
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
                    const region = rows.find((row) => row.region.guid === callout.guid)?.region;
                    const hot =
                      !!region &&
                      (attention.hovered.has(elementKey(region.elementId)) ||
                        attention.lit.has(elementKey(region.elementId)));
                    const [ax, ay] = callout.anchor;
                    const [px, py] = callout.pin;
                    const textX = px + callout.pinWidth / 2 + 8;
                    return (
                      <g
                        key={callout.guid}
                        {...revitTarget([
                          world.shapes.find((shape) => shape.region.guid === callout.guid)!.region
                            .elementId,
                        ])}
                        data-callout={callout.label}
                        style={{ pointerEvents: "auto", cursor: "pointer" }}
                        {...mention({ doc, key: `room:${callout.guid}` })}
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
              {geo && overlay ? overlay(geo) : null}
              {/* Surfaces over the plan claim their own pointer: a press on them never pans. */}
              <div onPointerDown={(e) => e.stopPropagation()}>{viewport.readout}</div>
            </div>
          </>,
          { ...pane, actions: stage.goTo, legend },
        )
      }
    </PictureStage>
  );
}

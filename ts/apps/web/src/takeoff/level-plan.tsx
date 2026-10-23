import { GoToPopup } from "@pe/kit/lang/list-popup";
import { SvgTip } from "@pe/kit/lang/tooltip";
import { useMemo, type ReactNode } from "react";
import { PictureStage } from "#/scene/stage-controller";
import type { PlaneViewport } from "@pe/agent-contracts";
import { Pane } from "@pe/kit/lang/pane";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { usePlaneViewport, PLAN_CLICK_PX } from "#/scene/use-plane-viewport";
import { usePlanMap } from "#/lib/plan-map";
import { Legend, legendWord, type LegendRow } from "@pe/kit/lang/legend";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { PLAN_REFUSAL, type PlanRefusal } from "#/takeoff/plan-image";
import { token } from "@pe/kit/lib/token";
import {
  contentViewport,
  boundsOf,
  type Point2,
  fitFrame,
  type AffineFrame,
  type Bounds2,
  unionBounds,
} from "#/lib/affine-frame";
import { loopBounds, pathD } from "#/takeoff/model";
import { PLAN_MIN_SQFT, onPlan } from "#/takeoff/room-actions";
import {
  ABSENT_INK,
  CURSOR_INK,
  ROOM_STATES,
  STATE_META,
  stateInk,
  type RoomState,
} from "#/takeoff/room-state";
import type { ModelRoom, ModelZone } from "#/takeoff/world";
import type { TakeoffPage } from "./actions";
import { useRouteLease } from "#/route/view-bridge";

/** Revit's plan export: pixel size and where three corners sit in model feet. */
type PlanRegistration = {
  imageSha256?: string;
  width: number;
  height: number;
  topLeft: [number, number];
  topRight: [number, number];
  bottomLeft: [number, number];
};

function planCanvasTransform(
  plan: PlanRegistration,
  vp: { minX: number; maxY: number; pxPerFt: number },
): [number, number, number, number, number, number] {
  return [
    ((plan.topRight[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.width,
    (-(plan.topRight[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.width,
    ((plan.bottomLeft[0] - plan.topLeft[0]) * vp.pxPerFt) / plan.height,
    (-(plan.bottomLeft[1] - plan.topLeft[1]) * vp.pxPerFt) / plan.height,
    (plan.topLeft[0] - vp.minX) * vp.pxPerFt,
    (vp.maxY - plan.topLeft[1]) * vp.pxPerFt,
  ];
}

/** A level's plan image and where Revit says its pixels sit in the model. */
export interface TakeoffPlanImage {
  href: string;
  registration: PlanRegistration;
}

/** Model feet at the registered image's four corners, including a rotated crop. */
export const planCorners = (plan: TakeoffPlanImage): Point2[] => {
  const { topLeft: a, topRight: b, bottomLeft: c } = plan.registration;
  return [a, b, c, [b[0] + c[0] - a[0], b[1] + c[1] - a[1]]];
};

/**
 * The plan frame as the registration's viewport. `fitFrame` maps model (x, y) to
 * (tx + s·x, ty − s·y), which is `toPx` with pxPerFt = s, minX = −tx/s, maxY = ty/s: the SVG's
 * own frame, handed to `planCanvasTransform` unchanged. Revit's registration stays the authority.
 */
function planViewport(frame: AffineFrame) {
  const [tx, ty] = frame.toViewport([0, 0]);
  return { minX: -tx / frame.scale, maxY: ty / frame.scale, pxPerFt: frame.scale };
}

/** The one plan image layer, under the zones, in the zones' coordinate frame. */
export function PlanImageLayer({ plan, frame }: { plan: TakeoffPlanImage; frame: AffineFrame }) {
  const { registration } = plan;
  return (
    <image
      data-layer="plan-image"
      href={plan.href}
      width={registration.width}
      height={registration.height}
      transform={`matrix(${planCanvasTransform(registration, planViewport(frame)).join(",")})`}
      preserveAspectRatio="none"
      pointerEvents="none"
    />
  );
}

export function LevelPlan({
  lease,
  viewport: pageViewport,
  onViewport,
  above,
  readout,
  plan,
  planRefusal,
  planError,
  planNote,
  zones,
  shown,
  selectedKey,
  cursor,
  stateOf,
  onSelectZone,
  onHover,
  onCursor,
}: {
  lease?: {
    thread?: string;
    visible: boolean;
    /** The takeoffs Page; its lease's one key is the viewport (`takeoffsAddress.agent`). */
    page: readonly [TakeoffPage, (next: Partial<TakeoffPage>, move: { history: "push" }) => void];
    context: Record<string, unknown>;
  };
  viewport: PlaneViewport | null;
  onViewport: (next: PlaneViewport, how: "gesture" | "move") => void;
  above?: ReactNode;
  /** The fixed top-left readout over the plan: the level's totals, or the selected zone. */
  readout?: ReactNode;
  /** Absent until a plan image reaches the route; the zones draw alone. */
  plan?: TakeoffPlanImage | null;
  /** The host's named reason the view has no registered image; said, never drawn as nothing. */
  planRefusal?: PlanRefusal | null;
  /** The view-image read itself failed. */
  planError?: string | null;
  /** Why the plan draws no image though zones are drawn (`planView`): said in the same slot. */
  planNote?: string | null;
  zones: ModelZone[];
  /** Zones the table's query keeps; the rest dim. null = no query. */
  shown: ReadonlySet<string> | null;
  selectedKey: string | null;
  cursor: string | null;
  stateOf: (room: ModelRoom) => RoomState;
  onSelectZone: (z: ModelZone | null) => void;
  onHover: (id: string) => void;
  onCursor: (z: ModelZone, guid: string) => void;
}) {
  const drawn = useMemo(() => zones.filter(onPlan), [zones]);
  const skipped = zones.length - drawn.length;

  const bounds = useMemo<Bounds2 | null>(() => {
    if (drawn.length === 0) return null;
    let b: Bounds2 = drawn[0]!.zone.bounds;
    for (const z of drawn) {
      b = unionBounds(b, z.zone.bounds);
      for (const r of z.rooms) if (r.outer) b = unionBounds(b, loopBounds([r.outer]));
      for (const s of z.residues) b = unionBounds(b, loopBounds([s.outer]));
    }
    return plan ? unionBounds(b, boundsOf(planCorners(plan))) : b;
  }, [drawn, plan]);

  const world = useMemo(() => {
    if (!bounds) return null;
    const { viewport, padding } = contentViewport(bounds, 0.03);
    const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
    const fit = plan
      ? boundsOf(planCorners(plan).map(frame.toViewport))
      : { minX: 0, minY: 0, maxX: viewport.width, maxY: viewport.height };
    return { ...viewport, frame, fit };
  }, [bounds, plan]);
  const viewport = usePlaneViewport(pageViewport, world?.fit ?? null, onViewport);
  const { setHost, host, size, view, move, handlers, dragDistance, dragging } = viewport;
  // No lease: nothing to publish (`visible` is false), so an empty Page stands in.
  useRouteLease<"takeoffs", Partial<TakeoffPage>>("takeoffs", lease?.page ?? [{}, () => {}], {
    thread: lease?.thread,
    visible: !!lease?.visible && !!world && !!size,
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
      units: "model XY feet; affine frame to world units; viewport scale and screen translations",
      planRefusal: planRefusal ?? null,
      planError: planError ?? null,
      planNote: planNote ?? null,
      totalZones: zones.length,
      drawnZones: drawn.length,
      skippedZones: skipped,
      truncated: drawn.length > 100,
      totalRooms: drawn.reduce((total, zone) => total + zone.rooms.length, 0),
      roomsTruncated: drawn.reduce((total, zone) => total + zone.rooms.length, 0) > 100,
      rooms: drawn
        .flatMap((zone) => zone.rooms.map((room) => ({ zone, room })))
        .slice(0, 100)
        .map(({ zone, room }) => ({
          guid: room.guid,
          name: room.name,
          zone: zone.zone.guid,
          bounds: room.outer ? loopBounds([room.outer]) : null,
        })),
      zones: drawn.slice(0, 100).map((zone) => ({
        guid: zone.zone.guid,
        name: zone.name,
        bounds: zone.zone.bounds,
        dimmed: shown !== null && !shown.has(zone.zone.guid),
        rooms: zone.rooms.length,
      })),
    },
  });
  const shapes = useMemo(
    () =>
      world
        ? drawn.flatMap((z) => [
            { d: pathD(z.zone.loops, world.frame), ink: token("ink-2") },
            ...z.rooms
              .filter((room) => room.outer)
              .map((room) => ({
                d: pathD([room.outer!, ...room.holes], world.frame),
                ink: stateInk(stateOf(room)),
              })),
          ])
        : [],
    [world, drawn, stateOf],
  );
  const map = usePlanMap(view, move, world, size, shapes, plan ?? null);
  const selectedZone = drawn.find((z) => z.zone.guid === selectedKey) ?? null;
  const selectedBox = selectedZone?.zone.bounds;

  const pane = {
    id: "plan",
    title: "plan",
    scroll: "clip" as const,
    flush: true,
    floaters: [map],
    actions: (
      <GoToPopup
        items={() =>
          drawn.flatMap((zone) => [
            {
              key: zone.zone.guid,
              name: zone.zone.key,
              id: zone.zone.elementId ?? zone.zone.guid,
              group: "Zones",
              zone,
              room: null as ModelRoom | null,
            },
            ...zone.rooms.map((room) => ({
              key: room.guid,
              name: room.name,
              id: room.elementId ?? room.guid,
              group: "Rooms",
              zone,
              room,
            })),
          ])
        }
        hover={(item) => onHover(item?.key ?? "")}
        onGo={(item) => {
          onSelectZone(item.zone);
          if (item.room) onCursor(item.zone, item.room.guid);
          const box = item.room?.outer ? loopBounds([item.room.outer]) : item.zone.zone.bounds;
          if (world) {
            const to = viewport.frame(
              boundsOf([
                world.frame.toViewport([box.minX, box.minY]),
                world.frame.toViewport([box.maxX, box.maxY]),
              ]),
              24,
            );
            if (to) move(to, "move");
          }
        }}
      />
    ),
  };
  const pictureStage = {
    kind: "plane" as const,
    host,
    viewport,
    bounds: world?.fit ?? null,
    selectedBounds:
      selectedBox && world
        ? boundsOf([
            world.frame.toViewport([selectedBox.minX, selectedBox.minY]),
            world.frame.toViewport([selectedBox.maxX, selectedBox.maxY]),
          ])
        : null,
    clearSelection: () => {
      if (selectedKey) onSelectZone(null);
    },
  };
  if (!bounds || !world)
    return (
      <PictureStage {...pictureStage}>
        <Pane {...pane}>
          {above}
          <div className="flex size-full items-center justify-center px-4">
            {zones.length > 0 ? (
              <EmptyState story="filter" exit="see the rail — they stay listed there, marked">
                all {zones.length} zone{zones.length === 1 ? "" : "s"} on this level are sub-
                {PLAN_MIN_SQFT} sf scribbles, drawn far from the cluster
              </EmptyState>
            ) : (
              <EmptyState
                story="scope"
                exit="adopt zones from a zoning-plan view, or pick another level above"
              >
                nothing has been adopted on this level yet
              </EmptyState>
            )}
          </div>
        </Pane>
      </PictureStage>
    );

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 95;
  const frame = world.frame;
  return (
    <PictureStage {...pictureStage}>
      <Pane
        {...pane}
        legend={
          <Legend
            label="rooms"
            rows={[
              ...ROOM_STATES.map(
                (s): LegendRow => ({
                  key: s,
                  word: legendWord(STATE_META[s].label),
                  says: STATE_META[s].note,
                  stroke: {
                    ink: stateInk(s),
                    width: 1,
                    shape: "box",
                    fill: `color-mix(in srgb, ${stateInk(s)} 16%, transparent)`,
                  },
                }),
              ),
              {
                key: "held",
                word: legendWord("held residue"),
                stroke: { ink: ABSENT_INK, width: 1, shape: "box", className: "dash-void" },
              },
              {
                key: "cursor",
                word: legendWord("cursor"),
                stroke: { ink: CURSOR_INK, width: 1, shape: "box" },
              },
              ...(skipped > 0
                ? [
                    {
                      key: "off-plan",
                      word: legendWord("off-plan"),
                      count: skipped,
                      stroke: {
                        ink: ABSENT_INK,
                        width: 1,
                        shape: "box" as const,
                        className: "dash-void",
                      },
                    },
                  ]
                : []),
            ]}
          />
        }
      >
        {above}
        {planRefusal ? (
          <OutcomeLine
            kind="refused"
            label={`no plan image · ${planRefusal}`}
            says={PLAN_REFUSAL[planRefusal]}
          />
        ) : planError ? (
          <OutcomeLine kind="error" label="plan image unread" says={planError} />
        ) : planNote ? (
          <OutcomeLine kind="advisory" label="no plan image" says={planNote} />
        ) : null}
        <div
          ref={setHost}
          data-takeoff-plan=""
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ cursor: dragging ? "grabbing" : "grab" }}
          {...handlers}
          onClickCapture={(event) => {
            if (dragDistance.current >= PLAN_CLICK_PX) {
              event.stopPropagation();
              event.preventDefault();
            }
          }}
        >
          <svg
            width={world.width}
            height={world.height}
            viewBox={`0 0 ${world.width} ${world.height}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <SvgTip content={"level plan"} />

            {plan ? <PlanImageLayer plan={plan} frame={frame} /> : null}

            {drawn.map((z) => {
              const dimmed = shown !== null && !shown.has(z.zone.guid);
              const on = z.zone.guid === selectedKey;
              // Monotone (I3): a zone's Revit colour names nothing the label does not; ink only.
              const ink = token("ink");
              const [zoneLabelX, zoneLabelY] = frame.toViewport([
                (z.zone.bounds.minX + z.zone.bounds.maxX) / 2,
                (z.zone.bounds.minY + z.zone.bounds.maxY) / 2,
              ]);
              return (
                <g
                  key={z.zone.key}
                  opacity={dimmed ? 0.15 : 1}
                  onMouseEnter={() => onHover(z.zone.guid)}
                  onMouseLeave={() => onHover("")}
                >
                  <path
                    {...revitTarget(z.zone.elementId == null ? [] : [z.zone.elementId])}
                    d={pathD(z.zone.loops, frame)}
                    fillRule="evenodd"
                    fill={on ? `color-mix(in srgb, ${ink} 6%, transparent)` : "transparent"}
                    stroke={ink}
                    strokeWidth={on ? 2 : 1}
                    strokeOpacity={on ? 0.9 : 0.4}
                    vectorEffect="non-scaling-stroke"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!dimmed) onSelectZone(z);
                    }}
                  />

                  {z.residues.map((s) => (
                    <path
                      key={s.id}
                      d={pathD([s.outer, ...s.holes], frame)}
                      fillRule="evenodd"
                      fill={`color-mix(in srgb, ${ABSENT_INK} 12%, transparent)`}
                      stroke={ABSENT_INK}
                      strokeOpacity={0.35}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}

                  {z.rooms.map((room) => {
                    const state = stateOf(room);
                    const isCursor = room.guid === cursor;
                    const tone = isCursor ? CURSOR_INK : stateInk(state);
                    const [labelX, labelY] = frame.toViewport(room.label);
                    const click = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!dimmed) onCursor(z, room.guid);
                    };
                    if (!room.outer)
                      return (
                        <circle
                          key={room.guid}
                          {...revitTarget(room.elementId == null ? [] : [room.elementId])}
                          data-damage={state === "call" && !isCursor ? "" : undefined}
                          cx={labelX}
                          cy={labelY}
                          r={span / 260}
                          fill={`color-mix(in srgb, ${tone} 45%, transparent)`}
                          stroke={tone}
                          strokeWidth={isCursor ? 2 : 1}
                          vectorEffect="non-scaling-stroke"
                          onClick={click}
                        >
                          <SvgTip content={STATE_META[state].label} />
                        </circle>
                      );
                    return (
                      <g
                        key={room.guid}
                        {...revitTarget(room.elementId == null ? [] : [room.elementId])}
                        onClick={click}
                      >
                        <path
                          data-damage={state === "call" && !isCursor ? "" : undefined}
                          d={pathD([room.outer, ...room.holes], frame)}
                          fillRule="evenodd"
                          fill={`color-mix(in srgb, ${tone} ${isCursor ? 34 : state === "unreviewed" ? 7 : 13}%, transparent)`}
                          stroke={tone}
                          strokeOpacity={0.85}
                          strokeWidth={isCursor ? 2.5 : 1}
                          vectorEffect="non-scaling-stroke"
                        >
                          <SvgTip content={STATE_META[state].label} />
                        </path>
                        {on && room.sqft > 40 && (
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor="middle"
                            fontSize={font}
                            fill={token("ink")}
                          >
                            <tspan x={labelX} fontWeight="var(--weight-strong)">
                              {room.name}
                            </tspan>
                            <tspan x={labelX} dy={font * 1.15} fillOpacity={0.65}>
                              {room.sqft} sf
                            </tspan>
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {!on && (
                    <text
                      {...revitTarget(z.zone.elementId == null ? [] : [z.zone.elementId])}
                      x={zoneLabelX}
                      y={zoneLabelY}
                      textAnchor="middle"
                      fontSize={font * 0.95}
                      fill={token("ink")}
                      fillOpacity={0.55}
                    >
                      {z.zone.key}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Surfaces over the plan claim their own pointer: a press on them never pans or clears. */}
          <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {readout}
          </div>
        </div>
      </Pane>
    </PictureStage>
  );
}

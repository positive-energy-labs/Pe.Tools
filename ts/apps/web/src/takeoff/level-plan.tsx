import { useMemo } from "react";
import { Key } from "#/components/anatomy";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { PLAN_REFUSAL, type PlanRefusal } from "#/takeoff/plan-image";
import { token } from "#/lib/token";
import {
  contentViewport,
  fitFrame,
  type AffineFrame,
  type Bounds2,
  unionBounds,
} from "#/lib/affine-frame";
import { planCanvasTransform, type PlanRegistration } from "#/runs/world";
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
import type { Phase, ModelRoom, ModelZone } from "#/takeoff/world";

/** A level's plan image and where Revit says its pixels sit in the model. */
export interface TakeoffPlanImage {
  href: string;
  registration: PlanRegistration;
}

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
function PlanImageLayer({ plan, frame }: { plan: TakeoffPlanImage; frame: AffineFrame }) {
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
  plan,
  planRefusal,
  planError,
  planNote,
  zones,
  stageFilter,
  selectedKey,
  cursor,
  stateOf,
  onSelectZone,
  onHover,
  onCursor,
  onClear,
}: {
  /** Absent until a plan image reaches the route; the zones draw alone. */
  plan?: TakeoffPlanImage | null;
  /** The host's named reason the view has no registered image; said, never drawn as nothing. */
  planRefusal?: PlanRefusal | null;
  /** The view-image read itself failed. */
  planError?: string | null;
  /** Why the plan draws no image though zones are drawn (`planView`): said in the same slot. */
  planNote?: string | null;
  zones: ModelZone[];
  stageFilter: Phase | null;
  selectedKey: string | null;
  cursor: string | null;
  stateOf: (room: ModelRoom) => RoomState;
  onSelectZone: (z: ModelZone) => void;
  onHover: (id: string) => void;
  onCursor: (z: ModelZone, guid: string) => void;
  onClear: () => void;
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
    return b;
  }, [drawn]);

  if (!bounds)
    return (
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
    );

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 95;
  const { viewport, padding } = contentViewport(bounds, 0.03);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });

  return (
    <div className="flex size-full min-h-0 flex-col">
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
      <svg
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1"
      >
        <title>Level plan — declared zones, detected rooms, held residue</title>

        <rect
          x={0}
          y={0}
          width={viewport.width}
          height={viewport.height}
          fill="transparent"
          onClick={onClear}
        />
        {plan ? <PlanImageLayer plan={plan} frame={frame} /> : null}

        {drawn.map((z) => {
          const dimmed = stageFilter !== null && z.stage !== stageFilter;
          const on = z.zone.key === selectedKey;
          const rgb = `rgb(${z.zone.color})`;
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
                d={pathD(z.zone.loops, frame)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${rgb} ${on ? 16 : 8}%, transparent)`}
                stroke={rgb}
                strokeWidth={on ? 2.5 : 1}
                strokeOpacity={on ? 1 : 0.55}
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
                      cx={labelX}
                      cy={labelY}
                      r={span / 260}
                      fill={`color-mix(in srgb, ${tone} 45%, transparent)`}
                      stroke={tone}
                      strokeWidth={isCursor ? 2 : 1}
                      vectorEffect="non-scaling-stroke"
                      onClick={click}
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${STATE_META[state].label} (no detected boundary)`}</title>
                    </circle>
                  );
                return (
                  <g key={room.guid} onClick={click}>
                    <path
                      d={pathD([room.outer, ...room.holes], frame)}
                      fillRule="evenodd"
                      fill={`color-mix(in srgb, ${tone} ${isCursor ? 34 : state === "unreviewed" ? 7 : 13}%, transparent)`}
                      stroke={tone}
                      strokeOpacity={0.85}
                      strokeWidth={isCursor ? 2.5 : state === "call" ? 1.75 : 1}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${room.name} — ${room.sqft} sf · ${STATE_META[state].label}`}</title>
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

      <div
        className="hairline-t pointer-events-none flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-0.5"
        data-surface="recess"
      >
        {ROOM_STATES.map((s) => (
          <Key key={s} tone={stateInk(s)} label={STATE_META[s].label} />
        ))}
        <Key tone={ABSENT_INK} label="held residue" seam />
        <Key tone={CURSOR_INK} label="cursor" />
        {skipped > 0 && (
          <span className="t-small face-mono">
            {skipped} sub-{PLAN_MIN_SQFT} sf scribble{skipped === 1 ? "" : "s"} off-plan — see the
            rail
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The rooms plan: the view's registered plan image under one path per Room Region, inked by the
 * region's state. Click selects, hover pairs with the table row, a click on empty ground clears.
 */
import { useMemo } from "react";
import type { RoomsRegion } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { boundsOf, contentViewport, fitFrame, type Point2 } from "#/lib/affine-frame";
import { token } from "#/lib/token";
import { PlanImageLayer, type TakeoffPlanImage } from "#/takeoff/level-plan";
import { pathD } from "#/takeoff/model";
import { PLAN_REFUSAL, type PlanRefusal } from "#/takeoff/plan-image";

export type RegionState = "locked" | "stale" | "held" | "machine";

/** The ink order: the first that holds wins. A person's region outranks a stale one. */
export const REGION_STATES = ["locked", "stale", "held", "machine"] as const;

export const regionState = (region: Pick<RoomsRegion, "locked" | "stale" | "role">): RegionState =>
  region.locked ? "locked" : region.stale ? "stale" : region.role === "held" ? "held" : "machine";

/** Each state's ink role and what it means. Held is absent ink, dashed void: residue, not a room. */
export const REGION_INK: Record<RegionState, { ink: string; dashed: boolean; says: string }> = {
  locked: {
    ink: "ink",
    dashed: false,
    says: "a person drew or edited this region; partition keeps it as drawn",
  },
  stale: {
    ink: "caution",
    dashed: false,
    says: "the walls under this region moved since it was drawn",
  },
  held: {
    ink: "ink-mute",
    dashed: true,
    says: "held residue: area partition could not place in a room",
  },
  machine: {
    ink: "ink-2",
    dashed: false,
    says: "drawn by partition and untouched since",
  },
};

/** A region's label: its name, else `R{n}` by its place in the table's order. */
export const regionLabel = (region: RoomsRegion, index: number) => region.name || `R${index + 1}`;

/** A region with its label, as the table orders and numbers it. */
export interface RoomRow {
  region: RoomsRegion;
  label: string;
}

const planCorners = (plan: TakeoffPlanImage): Point2[] => {
  const { topLeft: a, topRight: b, bottomLeft: c } = plan.registration;
  return [a, b, c, [b[0] + c[0] - a[0], b[1] + c[1] - a[1]]];
};

export function RoomsPlan({
  rows,
  plan,
  planRefusal,
  planError,
  empty,
  selected,
  hovered,
  onSelect,
  onHover,
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
  onSelect: (guid: string | null) => void;
  onHover: (guid: string | null) => void;
}) {
  const bounds = useMemo(() => {
    const points: Point2[] = rows.flatMap((row) => row.region.outer);
    if (plan) points.push(...planCorners(plan));
    return points.length ? boundsOf(points) : null;
  }, [rows, plan]);
  const counts = useMemo(() => {
    const n: Record<RegionState, number> = { locked: 0, stale: 0, held: 0, machine: 0 };
    for (const row of rows) n[regionState(row.region)] += 1;
    return n;
  }, [rows]);

  const legend = (
    <div className="flex flex-wrap items-center gap-1 px-1 py-1" aria-label="plan legend">
      {REGION_STATES.map((state) => (
        <FactChip
          key={state}
          tone={state === "stale" ? "caution" : "meta"}
          title={REGION_INK[state].says}
        >
          <span className="flex items-center gap-1">
            <svg aria-hidden width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                fill="none"
                stroke={token(REGION_INK[state].ink)}
                className={REGION_INK[state].dashed ? "dash-void" : undefined}
              />
            </svg>
            {state} <span className="face-mono">{counts[state]}</span>
          </span>
        </FactChip>
      ))}
    </div>
  );

  const notice = planRefusal ? (
    <OutcomeLine
      kind="refused"
      label={`no plan image · ${planRefusal}`}
      says={PLAN_REFUSAL[planRefusal]}
    />
  ) : planError ? (
    <OutcomeLine kind="error" label="plan image unread" says={planError} />
  ) : null;

  if (empty || !bounds)
    return (
      <div className="flex size-full min-h-0 flex-col">
        {legend}
        {notice}
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState
            story="scope"
            exit={empty?.exit ?? "press partition to split this view's level into rooms"}
          >
            {empty?.says ?? "no room regions and no plan image on this view yet"}
          </EmptyState>
        </div>
      </div>
    );

  const { viewport, padding } = contentViewport(bounds, 0.03);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 90;

  return (
    <div className="flex size-full min-h-0 flex-col">
      {legend}
      {notice}
      <svg
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label="rooms plan"
      >
        <title>Room regions on the plan view</title>
        <rect
          x={0}
          y={0}
          width={viewport.width}
          height={viewport.height}
          fill="transparent"
          onClick={() => onSelect(null)}
        />
        {plan ? <PlanImageLayer plan={plan} frame={frame} /> : null}
        {rows.map(({ region, label }) => {
          const state = regionState(region);
          const ink = token(REGION_INK[state].ink);
          const { dashed } = REGION_INK[state];
          const on = selected.has(region.guid);
          const hot = hovered === region.guid;
          const [lx, ly] = frame.toViewport(region.label);
          return (
            <g
              key={region.guid}
              data-state={state}
              onMouseEnter={() => onHover(region.guid)}
              onMouseLeave={() => onHover(null)}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(region.guid);
              }}
            >
              <path
                d={pathD([region.outer, ...region.holes], frame)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${ink} ${on ? 30 : hot ? 20 : 8}%, transparent)`}
                stroke={ink}
                strokeWidth={on ? 2.5 : state === "locked" ? 1.75 : 1}
                className={dashed ? "dash-void" : undefined}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${label} · ${region.sqft.toFixed(0)} sf · ${state}`}</title>
              </path>
              {state !== "held" ? (
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  fontSize={font}
                  fill={token("ink")}
                  pointerEvents="none"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

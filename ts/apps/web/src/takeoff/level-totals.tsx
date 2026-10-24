import { fmtNum } from "@pe/kit/table/model";
import { memberKey, useMention } from "@pe/kit/lang/attention";
import { regionKey } from "./attention";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { ROOM_STATES, STATE_META, stateInk, type RoomState } from "#/takeoff/room-state";
import type { ModelRoom, ModelZone } from "#/takeoff/world";

/**
 * The plan readout with no zone selected: the level's totals, always on (the level is the unit
 * the person works in), as one bar and one line so it covers as little plan as it can. It replaces
 * a toggled card that covered the plan's corner.
 */
export function LevelTotals({
  zones,
  stateOf,
}: {
  zones: ModelZone[];
  stateOf: (room: ModelRoom) => RoomState;
}) {
  const mention = useMention();
  const area: Record<RoomState, number> = { call: 0, unreviewed: 0, data: 0, synced: 0 };
  let calls = 0;
  for (const r of zones.flatMap((z) => z.rooms)) {
    const s = stateOf(r);
    area[s] += r.sqft;
    if (s === "call") calls += 1;
  }
  const unpartitioned = zones.filter((z) => z.rooms.length === 0);
  const unpartitionedSqft = unpartitioned.reduce((s, z) => s + z.zone.declaredSqft, 0);
  const totalArea = ROOM_STATES.reduce((s, k) => s + area[k], 0) + unpartitionedSqft;
  const partitioned = zones.length - unpartitioned.length;
  let residual = 0;
  for (const z of zones) {
    const run = z.runs[z.runs.length - 1];
    if (run)
      residual += run.declaredSqft - (run.roomSqft + run.excludedSqft + z.heldSqft + run.voidSqft);
  }
  const open = Math.abs(residual) >= 1;

  return (
    <div
      className="flex flex-col gap-1"
      data-level-totals=""
      {...mention(memberKey(zones.map((z) => regionKey(z.zone.guid))))}
    >
      <div className="flex h-1.5 w-full items-stretch gap-px overflow-hidden">
        {ROOM_STATES.map((s) =>
          area[s] > 0 ? (
            <TooltipHint content={`${STATE_META[s].label} · ${fmtNum(area[s], 0)} sf`} key={s}>
              <span
                style={{
                  width: `${(area[s] / Math.max(totalArea, 1)) * 100}%`,
                  backgroundColor: stateInk(s),
                  opacity: s === "unreviewed" ? 0.35 : 0.9,
                }}
              />
            </TooltipHint>
          ) : null,
        )}
        {unpartitionedSqft > 0 && (
          <TooltipHint content={`not partitioned · ${fmtNum(unpartitionedSqft, 0)} sf`}>
            <span
              className="hairline-x-2 hairline-y-2"
              style={{ width: `${(unpartitionedSqft / Math.max(totalArea, 1)) * 100}%` }}
            />
          </TooltipHint>
        )}
      </div>
      <span className="face-mono whitespace-nowrap">
        {fmtNum(totalArea, 0)} sf · {partitioned}/{zones.length} partitioned
        {calls > 0 ? (
          <span data-tone="alarm">
            {" "}
            · {calls} call{calls === 1 ? "" : "s"}
          </span>
        ) : null}
        {open ? <span data-tone="alarm"> · {fmtNum(residual, 0)} sf unaccounted</span> : null}
      </span>
    </div>
  );
}

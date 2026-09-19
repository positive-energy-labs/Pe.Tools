import { StatLine } from "#/components/anatomy";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Press } from "#/components/lang/press";
import { fmtNum } from "#/components/master-table/model";
import { ROOM_STATES, STATE_META, stateInk, type RoomState } from "#/takeoff/room-state";
import type { ModelRoom, ModelZone } from "#/takeoff/world";

export function LevelStats({
  level,
  zones,
  stateOf,
  onClose,
}: {
  level: string;
  zones: ModelZone[];
  stateOf: (room: ModelRoom) => RoomState;
  onClose: () => void;
}) {
  const rooms = zones.flatMap((z) => z.rooms);
  const area: Record<RoomState, number> = { call: 0, unreviewed: 0, data: 0, synced: 0 };
  let calls = 0;
  for (const r of rooms) {
    const s = stateOf(r);
    area[s] += r.sqft;
    if (s === "call") calls += 1;
  }
  const unpartitioned = zones.filter((z) => z.rooms.length === 0);
  const unpartitionedSqft = unpartitioned.reduce((s, z) => s + z.zone.declaredSqft, 0);
  const totalArea = ROOM_STATES.reduce((s, k) => s + area[k], 0) + unpartitionedSqft;

  const partitioned = zones.length - unpartitioned.length;
  const reviewed = zones.filter(
    (z) => z.rooms.length > 0 && z.rooms.every((r) => stateOf(r) !== "call"),
  ).length;
  const synced = zones.filter(
    (z) => z.rooms.length > 0 && z.rooms.every((r) => stateOf(r) === "synced"),
  ).length;

  const held = zones.reduce((s, z) => s + z.heldSqft, 0);
  let residual = 0;
  for (const z of zones) {
    const run = z.runs[z.runs.length - 1];
    if (!run) continue;
    residual += run.declaredSqft - (run.roomSqft + run.excludedSqft + z.heldSqft + run.voidSqft);
  }

  const pct = (n: number) => (zones.length === 0 ? 0 : Math.round((n / zones.length) * 100));

  return (
    <div className="absolute top-1 right-1 z-raised w-52">
      <ArtifactFrame
        head={
          <>
            <span className="t-small t-upper min-w-0 flex-1 truncate">{level} — level totals</span>
            <Press type="button" onClick={onClose} tone="quiet" size="value">
              ×
            </Press>
          </>
        }
      >
        <div className="px-2 py-1">
          <div className="flex h-1.5 w-full items-stretch gap-px overflow-hidden">
            {ROOM_STATES.map((s) =>
              area[s] > 0 ? (
                <span
                  key={s}
                  title={`${STATE_META[s].label} — ${fmtNum(area[s], 0)} sf`}
                  style={{
                    width: `${(area[s] / Math.max(totalArea, 1)) * 100}%`,
                    backgroundColor: stateInk(s),
                    opacity: s === "unreviewed" ? 0.35 : 0.9,
                  }}
                />
              ) : null,
            )}

            {unpartitionedSqft > 0 && (
              <span
                className="hairline-x-2 hairline-y-2"
                title={`not partitioned — ${fmtNum(unpartitionedSqft, 0)} sf declared, no rooms yet`}
                style={{ width: `${(unpartitionedSqft / Math.max(totalArea, 1)) * 100}%` }}
              />
            )}
          </div>
          <p className="t-small face-mono mt-0.5">
            {fmtNum(totalArea, 0)} sf declared on this level, by room state
          </p>

          <div className="mt-1">
            <StatLine
              label="partitioned"
              value={`${pct(partitioned)}% · ${partitioned}/${zones.length} zones`}
            />
            <StatLine label="reviewed" value={`${pct(reviewed)}% · no open calls`} />
            <StatLine label="synced" value={`${pct(synced)}% · every room in the .r10`} />
            <StatLine
              label="calls"
              value={calls === 0 ? "none open" : `${calls} rooms need a human`}
              tone={calls > 0 ? "alarm" : "done"}
            />
            <StatLine label="held" value={`${fmtNum(held, 0)} sf residue`} />
            <StatLine
              label="closure"
              value={
                Math.abs(residual) < 1
                  ? "closed — every declared foot accounted"
                  : `${fmtNum(residual, 0)} sf unaccounted`
              }
              tone={Math.abs(residual) < 1 ? "done" : "alarm"}
            />
          </div>
        </div>
      </ArtifactFrame>
    </div>
  );
}

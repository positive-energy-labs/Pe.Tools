import { StatLine } from "#/anatomy";
import { Press } from "#/components/lang/press";
import { fmtNum } from "#/components/master-table/model";
import { ROOM_STATES, STATE_META, stateInk, type RoomState } from "#/takeoff/room-state";
import type { WorldRoom, WorldZone } from "#/takeoff/world";

export function LevelStats({
  level,
  zones,
  stateOf,
  onClose,
}: {
  level: string;
  zones: WorldZone[];
  stateOf: (room: WorldRoom) => RoomState;
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
    residual +=
      run.declaredSqft - (run.roomSqft + run.claimedWallSqft + z.heldSqft + run.excludedSqft);
  }

  const pct = (n: number) => (zones.length === 0 ? 0 : Math.round((n / zones.length) * 100));

  return (
    <div className="absolute top-2 right-2 z-raised w-64 rounded-sm border border-line bg-page/95 px-2 py-1.5 shadow-sm backdrop-blur">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="t-label t-upper text-ink-2">{level} — level totals</span>
        <Press type="button" onClick={onClose} tone="quiet" size="mono-value">
          ×
        </Press>
      </div>

      <div className="flex h-2 w-full items-stretch gap-px overflow-hidden rounded-[1px]">
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
        {/* "Not partitioned" is a genuine empty, not a stand-in: firm hairline, never the
            reserved dash. */}
        {unpartitionedSqft > 0 && (
          <span
            title={`not partitioned — ${fmtNum(unpartitionedSqft, 0)} sf declared, no rooms yet`}
            className="border border-line-2"
            style={{ width: `${(unpartitionedSqft / Math.max(totalArea, 1)) * 100}%` }}
          />
        )}
      </div>
      <p className="face-mono t-value mt-0.5 text-ink-2">
        {fmtNum(totalArea, 0)} sf declared on this level, by room state
      </p>

      <div className="mt-1.5 space-y-px">
        <StatLine
          label="partitioned"
          value={`${pct(partitioned)}% · ${partitioned}/${zones.length} zones`}
        />
        <StatLine label="reviewed" value={`${pct(reviewed)}% · no open calls`} />
        <StatLine label="synced" value={`${pct(synced)}% · every room in the .r10`} />
        <StatLine
          label="calls"
          value={calls === 0 ? "none open" : `${calls} rooms need a human`}
          tone={calls > 0 ? "text-alarm" : "text-done"}
        />
        <StatLine label="held" value={`${fmtNum(held, 0)} sf residue`} />
        <StatLine
          label="closure"
          value={
            Math.abs(residual) < 1
              ? "closed — every declared foot accounted"
              : `${fmtNum(residual, 0)} sf unaccounted`
          }
          tone={Math.abs(residual) < 1 ? "text-done" : "text-alarm"}
        />
      </div>
    </div>
  );
}

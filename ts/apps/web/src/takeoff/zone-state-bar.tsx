import { cn } from "#/lib/utils";
import { FactChip } from "#/components/lang/chip";
import { StateDot } from "#/components/master-table/cells";
import type { ModelZone } from "#/takeoff/world";
import { ROOM_STATES, STATE_META, stateMeta, type RoomState } from "#/takeoff/room-state";

export function ZoneStateBar({
  zone,
  states,
  className,
}: {
  zone: ModelZone;
  states: RoomState[];
  className?: string;
}) {
  if (states.length === 0) {
    const held = zone.stage === "partitioned" && zone.residues.length > 0;
    return (
      <FactChip
        dashed
        title={
          held
            ? `${zone.zone.key} — partitioned: ${zone.residues.length} native shapes held for review`
            : `${zone.zone.key} — not partitioned: no rooms have been materialized yet`
        }
      >
        {held ? `${zone.residues.length} held` : "not partitioned"}
      </FactChip>
    );
  }
  const census = ROOM_STATES.map((s) => ({ s, n: states.filter((x) => x === s).length })).filter(
    (x) => x.n > 0,
  );
  // The bar is a FIXED width (the caller's), right-aligned by its flex parent: a zone with more
  // rooms shows more, thinner segments, never a wider bar (annotation verdict 2026-08-31).
  return (
    <span
      data-zone-bar=""
      className={cn("flex h-2.5 w-10 items-center gap-px", className)}
      title={`${zone.zone.key} — ${states.length} rooms · ${census
        .map((c) => `${c.n} ${STATE_META[c.s].label}`)
        .join(", ")}`}
    >
      {states.map((s, i) => (
        <StateDot key={i} bar {...stateMeta(s)} dim={s === "unreviewed"} />
      ))}
    </span>
  );
}

import { cn } from "#/lib/utils";
import type { WorldZone } from "#/takeoff/world";
import { ROOM_STATES, STATE_META, stateInk, type RoomState } from "#/takeoff/room-state";

export function ZoneStateBar({
  zone,
  states,
  className,
}: {
  zone: WorldZone;
  states: RoomState[];
  className?: string;
}) {
  if (states.length === 0)
    return (
      <span
        className={cn(
          "inline-block h-2.5 w-10 shrink-0 rounded-[1px] border border-line-2",
          className,
        )}
        title={`${zone.zone.key} — not partitioned: no rooms have been materialized yet`}
      />
    );
  const census = ROOM_STATES.map((s) => ({ s, n: states.filter((x) => x === s).length })).filter(
    (x) => x.n > 0,
  );
  return (
    <span
      className={cn("flex h-2.5 w-10 shrink-0 items-stretch gap-px", className)}
      title={`${zone.zone.key} — ${states.length} rooms · ${census
        .map((c) => `${c.n} ${STATE_META[c.s].label}`)
        .join(", ")}`}
    >
      {states.map((s, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-[1px]"
          style={{
            backgroundColor: stateInk(s),
            opacity: s === "unreviewed" ? 0.3 : 0.9,
          }}
        />
      ))}
    </span>
  );
}

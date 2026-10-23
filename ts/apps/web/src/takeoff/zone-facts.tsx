import { FactChip } from "@pe/kit/lang/chip";
import { fmtNum } from "@pe/kit/table/model";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { SENSIBLE_CAP_BTUH } from "#/takeoff/world";
import type { TakeoffsController } from "#/takeoff/controller";
import { ZoneStateBar } from "#/takeoff/zone-state-bar";
import type { ModelRoom, ModelSystem, ModelZone } from "#/takeoff/world";
import { STAGE_BLURB, type RoomState } from "#/takeoff/room-state";

/**
 * The selected zone in the plan's readout (the fixed top-left home, SURFACE-PHILOSOPHY I4): its
 * rooms, area and stage, its closure, its systems and its staged state. The zone's picture is the
 * plan itself (F frames it); partition is the Situation's verb, never a button here (P2).
 */
export function ZoneFacts({
  store,
  zone,
  stateOf,
  systems,
}: {
  store: TakeoffsController;
  zone: ModelZone;
  stateOf: (room: ModelRoom) => RoomState;
  systems: ModelSystem[];
}) {
  const entity = store.entity(zone.zone.guid);
  const states = zone.rooms.map(stateOf);
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const closure = run
    ? run.declaredSqft - (run.roomSqft + run.excludedSqft + zone.heldSqft + run.voidSqft)
    : null;
  const zoneSystems = systems.filter((s) => s.zoneKeys.includes(zone.zone.key));
  const calls = states.filter((s) => s === "call").length;

  return (
    <div
      className="flex flex-col gap-0.5"
      data-zone-facts={zone.zone.guid}
      data-dirty={entity.dirty || undefined}
      data-conflict={entity.conflict || undefined}
    >
      <div className="face-mono flex items-center gap-1.5 text-ink-2">
        <ZoneStateBar zone={zone} states={states} className="w-16" />
        <TooltipHint content={STAGE_BLURB[zone.stage]}>
          <span>
            {zone.rooms.length} rooms · {fmtNum(zone.zone.declaredSqft, 0)} sf · {zone.stage}
          </span>
        </TooltipHint>
      </div>
      <div className="flex flex-wrap gap-1">
        {calls > 0 && (
          <FactChip tone="alarm" title="Rooms here need a human call: an open flag or .r10 drift">
            {calls} call{calls === 1 ? "" : "s"}
          </FactChip>
        )}
        {run && (
          <FactChip
            tone={closure !== null && Math.abs(closure) < 1 ? "done" : "alarm"}
            title="Declared area minus rooms, claimed walls, held residue and exclusions"
          >
            {closure !== null && Math.abs(closure) < 1
              ? "closed"
              : `${fmtNum(closure ?? 0, 0)} sf unaccounted`}
          </FactChip>
        )}
        {entity.dirty && (
          <FactChip
            tone={entity.conflict ? "alarm" : undefined}
            title={
              entity.conflict
                ? "Authority changed since this edit was staged"
                : "This zone has staged edits"
            }
          >
            {entity.conflict ? "edit conflict" : "staged edit"}
          </FactChip>
        )}
      </div>
      {zoneSystems.map((s) => (
        <p key={s.tag} className="face-mono m-0 text-ink-2">
          {s.tag} · {fmtNum(s.sensibleBtuh, 0)} Btu/h
          {s.overCap ? (
            <span data-tone="alarm"> · over the {SENSIBLE_CAP_BTUH.toLocaleString()} cap</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

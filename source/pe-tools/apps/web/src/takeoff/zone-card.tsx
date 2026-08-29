import { useAtomValue } from "@effect/atom-react";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { fmtNum } from "#/components/master-table/model";
import { cn } from "#/lib/utils";
import { SENSIBLE_CAP_BTUH } from "#/takeoff/world";
import type { TakeoffStore } from "#/takeoff/store";
import { ZonePeek } from "#/takeoff/zone-peek";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { ZoneStateBar } from "#/takeoff/zone-state-bar";
import type { WorldRoom, WorldSystem, WorldZone } from "#/takeoff/world";
import type { AtlasActions } from "#/takeoff/atlas";
import { hostReason } from "#/takeoff/room-actions";
import { STAGE_BLURB, type RoomState } from "#/takeoff/room-state";

export function ZoneCard({
  store,
  zone,
  cursorRoom,
  geoReady,
  live,
  busy,
  actions,
  stateOf,
  systems,
  onClose,
}: {
  store: TakeoffStore;
  zone: WorldZone;
  cursorRoom: WorldRoom | null;
  geoReady: boolean;
  live: boolean;
  busy: string | null;
  actions: AtlasActions;
  stateOf: (room: WorldRoom) => RoomState;
  systems: WorldSystem[];
  onClose: () => void;
}) {
  const entity = useAtomValue(store.atoms.entity(zone.zone.guid));
  const states = zone.rooms.map(stateOf);
  const run = zone.runs[zone.runs.length - 1] ?? null;
  const closure = run
    ? run.declaredSqft - (run.roomSqft + run.claimedWallSqft + zone.heldSqft + run.excludedSqft)
    : null;
  const zoneSystems = systems.filter((s) => s.zoneKeys.includes(zone.zone.key));

  return (
    // Capped to the plan body and scrolling internally — at the default plan height the verbs
    // at the bottom must stay reachable without enlarging the plan first.
    <div
      data-hovered={entity.hovered || undefined}
      data-selected={entity.selected || undefined}
      data-dirty={entity.dirty || undefined}
      data-conflict={entity.conflict || undefined}
      className={cn(
        "absolute top-2 left-2 z-raised max-h-[calc(100%-1rem)] w-64 overflow-y-auto rounded-sm border border-line bg-page/95 shadow-sm backdrop-blur",
        entity.hovered && "ring-1 ring-line-2",
        entity.selected && "border-line-2",
        entity.conflict && "border-caution",
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <ZoneThumb zone={zone.zone} className="size-5" />
        <span className="face-mono t-value">{zone.zone.key}</span>
        <span className="face-mono t-value min-w-0 truncate text-ink-2">{zone.name}</span>
        <Press
          type="button"
          onClick={onClose}
          title="deselect this zone (Esc) — the table widens back to the whole house"
          className="face-mono t-value ml-auto text-ink-2 hover:text-ink"
        >
          ×
        </Press>
      </div>

      <ZonePeek zone={zone} cursorRoom={cursorRoom} geoReady={geoReady} stateOf={stateOf} />

      <div className="space-y-1 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {entity.bound && (
            <FactChip title="This zone is bound in the URL scope.">URL bound</FactChip>
          )}
          {entity.selected && <FactChip title="This zone has plan focus.">plan focus</FactChip>}
          {entity.dirty && (
            <FactChip
              tone={entity.conflict ? "alarm" : undefined}
              title={
                entity.conflict
                  ? "Authority changed since this edit was staged."
                  : "This entity has staged edits."
              }
            >
              {entity.conflict ? "edit conflict" : "staged edit"}
            </FactChip>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ZoneStateBar zone={zone} states={states} className="w-16" />
          <span className="face-mono t-value text-ink-2" title={STAGE_BLURB[zone.stage]}>
            {zone.rooms.length} rooms · {fmtNum(zone.zone.declaredSqft, 0)} sf · {zone.stage}
          </span>
        </div>
        {run && (
          // Accounting closure is a machine-measured FACT about the run, so it is a chip, not
          // prose: `done` when every declared foot is accounted for, `alarm` when it is not —
          // unaccounted area IS the model disagreeing with the designer's declared scope.
          <FactChip
            tone={closure !== null && Math.abs(closure) < 1 ? "done" : "alarm"}
            title="Declared area minus rooms, claimed walls, held residue and exclusions. Anything left over is area this run neither claimed nor abstained from."
          >
            {closure !== null && Math.abs(closure) < 1
              ? "closed — every declared foot accounted"
              : `${fmtNum(closure ?? 0, 0)} sf unaccounted`}
          </FactChip>
        )}
        {zoneSystems.map((s) => (
          <p key={s.tag} className="face-mono t-value text-ink-2">
            {s.tag} · {fmtNum(s.sensibleBtuh, 0)} Btu/h
            {s.overCap ? ` — over the ${SENSIBLE_CAP_BTUH.toLocaleString()} cap` : ""}
          </p>
        ))}
        {/* Both zone verbs run WriteTransaction scripts against the live document — capture
            stamps cropped seed views, partition materializes Room Region elements — so both wear
            `commit`, the language's one filled blue for writes that leave the page. Blast radius
            is not a tone; it groups the lane, which is what the group head below says. */}
        {live && (
          <VerbGroup className="pt-0.5" title="zone verbs" radius="document · model">
            <Verb
              tone="commit"
              label={zone.zone.lane.replayPath ? "re-capture level" : "capture level"}
              disabled={busy !== null}
              reason={hostReason(
                live,
                busy,
                `Prepares cropped seed views on ${zone.zone.lane.label}, exports ink, and detects rooms — writes replay_<level>.bin and touches the document`,
                "fixture · nothing to capture",
              )}
              onClick={() => actions.capture(zone.zone.lane)}
            />
            <Verb
              tone="commit"
              label="partition zone"
              disabled={busy !== null || !zone.zone.lane.replayPath}
              reason={
                zone.zone.lane.replayPath == null
                  ? "capture the level first — the partition replays that snapshot, it cannot invent one"
                  : hostReason(
                      live,
                      busy,
                      "Replays the capture masked to this zone and materializes Room Regions in the model (a rerun never overwrites)",
                      "fixture · nothing to partition",
                    )
              }
              onClick={() => actions.partition(zone)}
            />
          </VerbGroup>
        )}
      </div>
    </div>
  );
}

/** Per-room data, living beside the rooms it narrates. Exists exactly while a row is under the
 *  cursor. In "panel" fields mode the Manual J fields render here and leave the table narrow;
 *  in "columns" mode they stay inline and this panel carries calls + provenance only. */

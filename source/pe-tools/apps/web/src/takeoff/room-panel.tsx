import { Fragment } from "react";
import { useAtomValue } from "@effect/atom-react";
import { StatLine } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { NumberCell, StateDot } from "#/components/master-table/cells";
import { fmtNum } from "#/components/master-table/model";
import { Verb } from "#/components/lang/verb";
import { Pane } from "#/components/lang/pane";
import type { PaneShortcut } from "#/components/lang/pane";
import { ManualJField } from "#/takeoff/manual-j-field";
import type { Verdict } from "#/takeoff/atlas";
import { FLAG_MEANING } from "#/takeoff/model";
import { MANUAL_J, decideReason } from "#/takeoff/room-actions";
import { STATE_META, stateMeta } from "#/takeoff/room-state";
import type { AtlasRow as Row, TakeoffStore } from "#/takeoff/store";
import type { RoomEdit, WorldRoom } from "#/takeoff/world";

export function RoomPanelFromStore({
  store,
  row,
  ...props
}: Omit<Parameters<typeof RoomPanel>[0], "decided"> & {
  store: TakeoffStore;
}) {
  const entity = useAtomValue(store.atoms.entity(row.room.guid));
  return <RoomPanel {...props} row={row} decided={entity.decided} />;
}

function RoomPanel({
  row,
  decided,
  live,
  fieldsMode,
  shortcuts,
  onDecide,
  onPatch,
  url,
}: {
  row: Row;
  decided: Readonly<Record<string, Verdict>>;
  live: boolean;
  fieldsMode: "columns" | "panel";
  shortcuts: readonly PaneShortcut[];
  onDecide: (room: WorldRoom, flag: string, verb: Verdict) => void;
  onPatch: (patch: RoomEdit) => void;
  url: string;
}) {
  const { room, zone, state, open } = row;
  const localDecisions = room.flags
    .map((f) => ({ flag: f, verb: decided[f] }))
    .filter((x): x is { flag: string; verb: Verdict } => x.verb !== undefined);

  return (
    <Pane
      id="room"
      kind="inspector"
      title="room"
      meta={`${zone.zone.key} · ${zone.zone.lane.label}`}
      shortcuts={shortcuts}
    >
      <div className="hairline-rows -m-2">
        <div className="px-2.5 py-2">
          <h2 className="t-title text-ink">{room.name}</h2>
          <p className="face-mono mt-1 flex flex-wrap items-center gap-x-1.5 text-ink-2">
            <StateDot {...stateMeta(state)} />
            <FactChip tone={state === "call" ? "alarm" : undefined} title={STATE_META[state].note}>
              {STATE_META[state].label}
            </FactChip>
            <span>
              {room.sqft} sf · {fmtNum(room.ceilingFt, 1)} ft clg · {room.type}
            </span>
          </p>
        </div>

        {fieldsMode === "panel" && (
          <div className="px-2.5 py-2">
            <p className="t-small t-upper mb-1">manual j — this room</p>
            <div className="grid grid-cols-[4rem_1fr] items-center gap-y-1">
              <span className="face-mono pr-1.5 text-right text-ink-2">ceil ft</span>
              <span>
                <NumberCell
                  value={room.ceilingFt}
                  digits={1}
                  min={0}
                  onCommit={(v) => onPatch({ ceilingFt: v })}
                />
              </span>
              {MANUAL_J.map((mj) => (
                <Fragment key={mj.field}>
                  <span className="face-mono pr-1.5 text-right text-ink-2">{mj.label}</span>
                  <span>
                    <ManualJField room={room} field={mj.field} onPatch={onPatch} />
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {open.length > 0 && (
          <div className="px-2.5 py-2">
            <p className="t-small t-upper mb-1">open calls — {open.length}</p>
            <ul className="space-y-2">
              {open.map((flag) => (
                <li key={flag}>
                  <p className="face-mono" data-tone="alarm">
                    {flag}
                  </p>
                  <p className="face-mono text-ink-2">{FLAG_MEANING[flag] ?? "no blurb"}</p>

                  <span className="mt-0.5 flex gap-1">
                    <Verb
                      tone={live ? "commit" : "act"}
                      label="accept · a"
                      disabled={live && room.elementId === null}
                      reason={decideReason(live, room, "accept")}
                      onClick={() => onDecide(room, flag, "accept")}
                    />
                    <Verb
                      tone={live ? "commit" : "act"}
                      label="dismiss · d"
                      disabled={live && room.elementId === null}
                      reason={decideReason(live, room, "dismiss")}
                      onClick={() => onDecide(room, flag, "dismiss")}
                    />
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5">
              {!live ? (
                <FactChip
                  dashed
                  title="The fixture lane has no document. Verdicts mark this session only and are lost when the tab closes."
                >
                  fixture · verdicts stay local
                </FactChip>
              ) : room.elementId === null ? (
                <FactChip
                  dashed
                  title="This room was detected but never materialized, so there is no element to write a verdict onto. Partition the zone first."
                >
                  no Room Region home
                </FactChip>
              ) : (
                <FactChip
                  tone="done"
                  title="Verdicts are persisted onto this room's Room Region provenance blob before the UI shows them as decided."
                >
                  writes through to the blob
                </FactChip>
              )}
            </div>
          </div>
        )}

        <div className="px-2.5 py-2">
          <p className="t-small t-upper mb-1">provenance</p>
          <StatLine truncate={false} label="run" value={room.provenance.runId} />
          <StatLine
            truncate={false}
            label="source sf"
            value={
              room.sqft === room.provenance.sourceSqft
                ? `${fmtNum(room.provenance.sourceSqft, 0)} sf — unchanged since detection`
                : `${fmtNum(room.provenance.sourceSqft, 0)} sf detected, now ${room.sqft} sf`
            }
          />
          <StatLine
            truncate={false}
            label="boundary"
            value={room.outer ? `${room.outer.length} pts detected` : "no polygon — dot only"}
          />
          <StatLine truncate={false} label="guid" value={room.guid} />
          <StatLine
            truncate={false}
            label=".r10"
            value={
              room.r10
                ? `#${room.r10.identifier} · synced ${room.r10.syncedAt.slice(0, 10)} at ${fmtNum(room.r10.lastSyncedSqft, 0)} sf`
                : "never exported"
            }
          />
          {room.decisions.length === 0 && localDecisions.length === 0 ? (
            <StatLine truncate={false} label="decisions" value="none written on this room" muted />
          ) : (
            <>
              {room.decisions.map((d, i) => (
                <StatLine
                  truncate={false}
                  key={`w${i}`}
                  label={i === 0 ? "decisions" : ""}
                  value={`${d.verb} ${d.flag} · ${d.at.slice(0, 10)} · ${d.runId}`}
                />
              ))}
              {localDecisions.map((d) => (
                <StatLine
                  truncate={false}
                  key={`l${d.flag}`}
                  label=""
                  value={`${d.verb} ${d.flag} · this session`}
                />
              ))}
            </>
          )}
        </div>

        <div className="px-2.5 py-2">
          <p className="t-small t-upper mb-1">addressable</p>
          <p className="face-mono break-all px-1.5 py-1 text-ink-2" data-surface="recess">
            {url}
          </p>
        </div>
      </div>
    </Pane>
  );
}

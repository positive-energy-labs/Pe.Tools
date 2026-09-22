import {
  takeoffDecisionAddress,
  takeoffDecisionKey,
  takeoffEditAddress,
  takeoffEditKey,
} from "@pe/agent-contracts";
import { Fragment } from "react";
import { StatLine } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { StateDot } from "#/components/master-table/cells";
import { fmtNum } from "#/components/master-table/model";
import { ActionButton } from "#/components/lang/action-button";
import { Pane } from "#/components/lang/pane";
import type { PaneShortcut } from "#/components/lang/pane";
import { TakeoffEditCell, TakeoffProposalRows } from "#/takeoff/proposals";
import type { Verdict } from "#/takeoff/atlas";
import { FLAG_MEANING } from "#/takeoff/model";
import { MANUAL_J, decideReason, decisionRefusal } from "#/takeoff/room-actions";
import { STATE_META, stateMeta } from "#/takeoff/room-state";
import type { AtlasRow as Row, TakeoffsController } from "#/takeoff/controller";
import type { RoomEdit, ModelRoom } from "#/takeoff/world";

export function RoomPanelFromStore({
  store,
  row,
  ...props
}: Omit<Parameters<typeof RoomPanel>[0], "decided" | "cells" | "wires"> & {
  store: TakeoffsController;
}) {
  return (
    <RoomPanel
      {...props}
      row={row}
      decided={store.decisions}
      cells={store.cells}
      wires={store.wires}
    />
  );
}

function RoomPanel({
  row,
  decided,
  cells,
  wires,
  live,
  fieldsMode,
  shortcuts,
  onDecide,
  onPatch,
  url,
}: {
  row: Row;
  decided: Readonly<Record<string, Verdict>>;
  cells: TakeoffsController["cells"];
  wires: TakeoffsController["wires"];
  live: boolean;
  fieldsMode: "columns" | "panel";
  shortcuts: readonly PaneShortcut[];
  onDecide: (room: ModelRoom, flag: string, verb: Verdict) => void;
  onPatch: (patch: RoomEdit) => void;
  url: string;
}) {
  const { room, zone, state, open } = row;
  const localDecisions = room.flags
    .map((f) => ({ flag: f, verb: decided[takeoffDecisionKey(room.guid, f)] }))
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
                <TakeoffEditCell
                  roomId={room.guid}
                  field="ceilingFt"
                  value={room.ceilingFt}
                  digits={1}
                  cell={cells.edits[takeoffEditKey(room.guid, "ceilingFt")]}
                  wire={wires.edits}
                  onPatch={(v) => onPatch({ ceilingFt: v })}
                />
              </span>
              {MANUAL_J.map((mj) => (
                <Fragment key={mj.field}>
                  <span className="face-mono pr-1.5 text-right text-ink-2">{mj.label}</span>
                  <span>
                    <TakeoffEditCell
                      roomId={room.guid}
                      field={mj.field}
                      value={room.data?.[mj.field] ?? 0}
                      digits={0}
                      integer
                      cell={cells.edits[takeoffEditKey(room.guid, mj.field)]}
                      wire={wires.edits}
                      onPatch={(v) => onPatch({ [mj.field]: v })}
                    />
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Pea's proposals on this room, in the band grammar: its field edits and flag verdicts. */}
        <div className="px-2.5 empty:hidden">
          <TakeoffProposalRows
            cells={cells.edits}
            wire={wires.edits}
            keep={(key) => takeoffEditAddress(key).roomId === room.guid}
            label={(key) => takeoffEditAddress(key).field}
            show={(value) => String(value)}
          />
          <TakeoffProposalRows
            cells={cells.decisions}
            wire={wires.decisions}
            keep={(key) => takeoffDecisionAddress(key).roomGuid === room.guid}
            label={(key) => `flag ${takeoffDecisionAddress(key).flag}`}
            show={(value) => String(value)}
          />
        </div>

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
                    <ActionButton
                      tone={live ? "commit" : "act"}
                      label="accept · a"
                      disabled={live && decisionRefusal(room, flag) !== null}
                      reason={decideReason(live, room, "accept", flag)}
                      onClick={() => onDecide(room, flag, "accept")}
                    />
                    <ActionButton
                      tone={live ? "commit" : "act"}
                      label="dismiss · d"
                      disabled={live && decisionRefusal(room, flag) !== null}
                      reason={decideReason(live, room, "dismiss", flag)}
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
          {localDecisions.length === 0 ? (
            <StatLine truncate={false} label="decisions" value="none written on this room" muted />
          ) : (
            <>
              {localDecisions.map((d, i) => (
                <StatLine
                  truncate={false}
                  key={`l${d.flag}`}
                  label={i === 0 ? "decisions" : ""}
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

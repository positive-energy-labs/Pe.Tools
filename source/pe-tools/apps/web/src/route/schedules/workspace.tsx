import { useState } from "react";
import {
  scheduleCellKey,
  splitScheduleCellKey,
  transitionPatches,
  type RouteStatePatch,
  type ScheduleCatalog,
  type ScheduleGridDocument,
  type ScheduleGridSnapshot,
} from "@pe/agent-contracts";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { ActionButton } from "#/components/lang/action-button";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import { List } from "#/components/lang/list-popup";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { OutcomeStrip } from "#/components/lang/outcome-strip";
import { timeAgo } from "#/lib/utils";
import type { CellWire } from "#/components/lang/band";
import { PendingStrip } from "./pending-strip";
import { scheduleLock, useScheduleGridColumns } from "./columns";
import type { Refusal } from "#/route";

export interface ScheduleGridState {
  slice: ScheduleGridDocument | null;
  /** The Work revision the slice was read at; `null` before any Work exists. */
  revision: number | null;
  hydrated: boolean;
  refreshing: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<Refusal | null>;
  peaActive: boolean;
  connected: boolean | null;
  /** The running verb; capture and apply run from the Situation and lock the grid too. */
  busy: string | null;
  failure: Refusal | null;
  snapshot: ScheduleGridSnapshot | null;
  catalog: ScheduleCatalog | null;
  execute: (
    kind: "catalog" | "refresh" | "push",
    input?: Record<string, unknown>,
  ) => Promise<Refusal | null>;
  /** Why Push is disabled, in the operator's words. `null` means nothing blocks it. */
  blockedBecause?: string | null;
}

export function ScheduleGridWorkspace({
  state: {
    slice,
    revision,
    hydrated,
    refreshing,
    apply,
    execute,
    peaActive,
    connected,
    busy,
    failure,
    snapshot,
    catalog,
    blockedBecause,
  },
}: {
  state: ScheduleGridState;
}) {
  const [tableState, setTableState] = useTableState();
  const document = slice;
  const cells = document?.cells ?? {};
  const stale = document?.basis?.stale ?? [];

  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const staged = Object.entries(cells).filter(([, cell]) => cell.staged != null);
  const stagedCount = staged.length;
  const proposalCount = Object.values(cells).filter(
    (cell) => cell.proposal != null && cell.staged == null,
  ).length;
  const pending = Object.entries(cells).filter(
    ([, cell]) => cell.proposal != null || cell.staged != null,
  );
  // Staging IS the approval (ruled 2026-08-31): no review gate stands before push.
  const pushable = stagedCount > 0 && !blockedBecause;

  const runCommand = (kind: "catalog" | "refresh" | "push", input: Record<string, unknown> = {}) =>
    void execute(kind, input);

  const bindingAt = (key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    return snapshot?.rows
      .find((row) => row.rowNumber === rowNumber)
      ?.bindings.find((binding) => binding.columnNumber === columnNumber);
  };
  /** Every schedule cell's accept, deny and unstage write here, bound to the rendered revision. */
  const wire: CellWire = {
    segment: "cells",
    write: apply,
    revision,
    lockOf: (key) => scheduleLock(bindingAt(key)),
  };
  /** Typing stages; it also severs a standing proposal, so the typed value is not contested. */
  const stageEdit = (key: string, value: string): string | void => {
    const cell = cells[key] ?? {};
    void apply([
      ...transitionPatches(["cells"], key, cell, { kind: "stage", rung: { value } }),
      ...(cell.proposal != null ? transitionPatches(["cells"], key, cell, { kind: "deny" }) : []),
    ]);
  };

  const columnHeader = (columnNumber: number) =>
    snapshot?.columns.find((column) => column.columnNumber === columnNumber)?.headerText ??
    `col ${columnNumber}`;
  const currentText = (key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const row = snapshot?.rows.find((candidate) => candidate.rowNumber === rowNumber);
    const columnIndex =
      snapshot?.columns.findIndex((column) => column.columnNumber === columnNumber) ?? -1;
    return (
      bindingAt(key)?.displayValue ?? (columnIndex >= 0 ? (row?.values[columnIndex] ?? null) : null)
    );
  };

  const gridColumns = useScheduleGridColumns(snapshot, cells, wire, stageEdit, stale);

  const pushReason = blockedBecause
    ? blockedBecause
    : stagedCount === 0
      ? "Nothing is staged yet — accept a proposal or type into a cell first. Push writes staged values through the bridge into Revit."
      : `Write ${stagedCount} staged cell${stagedCount === 1 ? "" : "s"} through the bridge into Revit — the only verb here that leaves the page.`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AddressingBar
        name="schedules"
        sentence={
          snapshot ? (
            <span>{snapshot.scheduleName}</span>
          ) : (
            <Provenance>{hydrated ? "no schedule open" : "connecting"}</Provenance>
          )
        }
        facts={
          <>
            <FactChip
              tone={connected === true ? "meta" : "caution"}
              title={
                connected === true
                  ? "The route-state bridge is connected — pea's proposals arrive live over SSE."
                  : refreshing
                    ? "The route-state stream is re-establishing over the slice already held. Writes are refused until it settles — this is a reconnect, not a lost session."
                    : connected === null
                      ? "No Work slice has arrived yet. Read a schedule to open one."
                      : "The route-state bridge is not connected. Nothing arrives and nothing can be pushed; a busy bridge is not the model disagreeing."
              }
            >
              {/* A re-establishing stream is NOT a dead bridge, and must not be worded as one. */}
              bridge{" "}
              {connected === true
                ? "connected"
                : refreshing
                  ? "refreshing"
                  : connected === null
                    ? "connecting"
                    : "disconnected"}
            </FactChip>
            {snapshot ? (
              <>
                <FactChip title="Columns × rows in this snapshot, as read from Revit.">
                  {snapshot.columns.length}×{snapshot.rows.length}
                </FactChip>
                {snapshot.truncated ? (
                  <FactChip
                    tone="caution"
                    title="The read hit its row cap — rows beyond it are not shown and cannot be edited here. Narrow the schedule in Revit or push what is visible."
                  >
                    truncated
                  </FactChip>
                ) : null}
                {snapshot.takenAt ? (
                  <FactChip title="When this snapshot was read from Revit. The model may have moved since — re-read to check.">
                    read {timeAgo(snapshot.takenAt)}
                  </FactChip>
                ) : null}
              </>
            ) : null}
          </>
        }
        verb={
          <ActionButton
            tone="commit"
            label={`push ${stagedCount} to Revit`}
            busy={busy === "push"}
            disabled={!pushable || busy != null}
            reason={pushReason}
            onClick={() => runCommand("push")}
          />
        }
        advisory={peaActive ? <OutcomeLine kind="busy" label="pea is working" /> : undefined}
      />

      <PaneSplit
        axis="horizontal"
        grow
        resize={{
          target: "start",
          defaultSize: 264,
          minSize: 220,
          persist: "schedules:rail",
          collapse: {
            collapsed: railCollapsed,
            onCollapsedChange: setRailCollapsed,
            collapsedSize: 40,
            collapseBelow: 110,
          },
        }}
        start={
          <Pane
            kind="flank"
            flush
            title="schedules"
            meta={catalog ? String(catalog.schedules.length) : undefined}
            side="left"
            collapsed={railCollapsed}
            onCollapsedChange={setRailCollapsed}
            actions={
              <ActionButton
                label="re-list"
                busy={busy === "catalog"}
                disabled={busy != null}
                reason="Read the document's schedule list from Revit again. A read — nothing is written."
                onClick={() => runCommand("catalog")}
              />
            }
          >
            {catalog == null ? (
              <div className="space-y-2 px-3 py-3">
                <EmptyState
                  story="scope"
                  exit="list schedules to fill this rail — a read, nothing is changed"
                >
                  no schedule list yet
                </EmptyState>
                <ActionButton
                  label="list schedules"
                  busy={busy === "catalog"}
                  disabled={busy != null}
                  reason="Reads every schedule in the document so you (or pea) can open any of them. A read — nothing is written."
                  onClick={() => runCommand("catalog")}
                />
              </div>
            ) : (
              <List
                aria-label="schedules"
                region="schedules"
                items={catalog.schedules}
                keyOf={(entry) => String(entry.scheduleId)}
                labelOf={(entry) => entry.name}
                groupOf={(entry) => entry.categoryName ?? "Other"}
                filter="substring"
                searchPlaceholder="Filter schedules…"
                empty="No schedules in the document."
                onPick={(entry) => runCommand("refresh", { scheduleId: entry.scheduleId })}
                row={(entry) => ({
                  label: entry.name,
                  active: snapshot?.scheduleId === entry.scheduleId,
                  // ponytail: Summary projection reports 0 rows for every schedule — show counts only when computed
                  meta: entry.rowCount > 0 ? entry.rowCount : undefined,
                  title: `id ${entry.scheduleId}${entry.isPlacedOnSheet ? " · placed on sheet" : ""}`,
                  refusal: busy != null ? `${busy} is running` : null,
                })}
              />
            )}
          </Pane>
        }
        end={
          <Pane
            kind="content"
            flush
            title={snapshot?.scheduleName ?? "schedule"}
            headerless
            scroll="clip"
          >
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
                {snapshot ? (
                  <TableFrame
                    label="schedule rows"
                    rows={snapshot.rows}
                    columns={gridColumns}
                    rowKey={(row) => String(row.rowNumber)}
                    state={tableState}
                    onStateChange={setTableState}
                    searchPlaceholder="find in cells"
                    filters={<OutcomeStrip busy={busy} failure={failure} />}
                    actions={
                      <ActionButton
                        label="re-read"
                        busy={busy === "refresh"}
                        disabled={!snapshot || busy != null}
                        reason={`Read “${snapshot.scheduleName}” from Revit again — replaces this snapshot; proposals and staged cells stay.`}
                        onClick={() => runCommand("refresh", { scheduleId: snapshot.scheduleId })}
                      />
                    }
                  >
                    <Table
                      rows={snapshot.rows}
                      columns={gridColumns}
                      rowKey={(row) => String(row.rowNumber)}
                      label="schedule rows"
                      state={tableState}
                      onStateChange={setTableState}
                      activeKey={activeRow}
                      gutter={(row) => {
                        const owed = snapshot.columns.filter(
                          (column) =>
                            cells[scheduleCellKey(row.rowNumber, column.columnNumber)]?.proposal !=
                            null,
                        ).length;
                        return owed > 0
                          ? {
                              count: owed,
                              tone: "caution" as const,
                              title: `${owed} pea proposal${owed === 1 ? "" : "s"} on this row await${owed === 1 ? "s" : ""} a verdict — accept stages, deny clears`,
                            }
                          : null;
                      }}
                      empty={
                        <EmptyState
                          story="scope"
                          exit="re-read the schedule, or pick another from the rail"
                        >
                          this schedule has no rows
                        </EmptyState>
                      }
                    />
                  </TableFrame>
                ) : (
                  <div className="grid h-full place-items-center p-6">
                    {hydrated ? (
                      <EmptyState
                        story="scope"
                        exit="pick one from the rail (type to filter, ↑/↓ then Enter), or ask pea to open one"
                      >
                        no schedule open
                      </EmptyState>
                    ) : (
                      <OutcomeLine kind="busy" label="connecting to the workbench" />
                    )}
                  </div>
                )}
              </div>

              {pending.length > 0 && snapshot && (
                <PendingStrip
                  pending={pending}
                  stale={stale}
                  proposalCount={proposalCount}
                  stagedCount={stagedCount}
                  columnHeader={columnHeader}
                  wire={wire}
                  currentText={currentText}
                  locate={(key) => setActiveRow(String(splitScheduleCellKey(key).rowNumber))}
                />
              )}
            </section>
          </Pane>
        }
      />
    </div>
  );
}

import { useState } from "react";
import {
  scheduleCellKey,
  splitScheduleCellKey,
  transitionPatches,
  type RouteStatePatch,
  type ScheduleCatalog,
  type ScheduleGridDocument,
  type MeasuredValue,
  type ScheduleGridSnapshot,
} from "@pe/agent-contracts";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import { List } from "#/components/lang/list-popup";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { useMeasuredParse } from "#/host/measured-parse";
import type { HostCallOptions } from "#/host/client";
import type { CellWire } from "#/components/lang/band";
import { PendingStrip } from "./pending-strip";
import { cellText, scheduleLock, useScheduleGridColumns } from "./columns";
import type { Refusal } from "#/route";
import { ChangedInRevit } from "#/route/changed";

export interface ScheduleGridState {
  slice: ScheduleGridDocument | null;
  /** The Work revision the slice was read at; `null` before any Work exists. */
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<Refusal | null>;
  /** The running verb; capture and apply run from the Situation and lock the grid too. */
  busy: string | null;
  /** Why push is unavailable; retained for route seams that inspect readiness. */
  blockedBecause?: string | null;
  snapshot: ScheduleGridSnapshot | null;
  catalog: ScheduleCatalog | null;
  /** The verbs the panes reach the world through: the grid's read, and the stage's push. */
  execute: (kind: "refresh" | "push", input?: Record<string, unknown>) => Promise<Refusal | null>;
  /** The last push's refused cells, by key; each draws on its own cell. */
  refused: Readonly<Record<string, string>>;
  /** Each pane's focus edge, as the stage declares it (`stage.ts`). */
  onFocus: { rail: () => void; grid: () => void };
  /**
   * What is known about the drawn read: `changed` = Revit changed this document since it was
   * taken; `disconnected` = no bridge, so nothing is known. Never an age.
   */
  freshness: "current" | "changed" | "disconnected";
  /** The document the drawn read came from; a measured parse is asked of exactly it. */
  documentScope?: HostCallOptions;
}

export function ScheduleGridWorkspace({
  state: {
    slice,
    revision,
    hydrated,
    apply,
    execute,
    busy,
    snapshot,
    catalog,
    refused,
    onFocus,
    freshness,
    documentScope,
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
  const readAgain = () => {
    if (snapshot && busy == null) void execute("refresh", { scheduleId: snapshot.scheduleId });
  };

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
  /** The measured cell's one call, owned by this snapshot: a re-read aborts what is in flight. */
  const parse = useMeasuredParse(snapshot, documentScope);
  const parseMeasured = (key: string, text: string) => parse(bindingAt(key)?.displayUnit, text);

  /** Typing stages; it also severs a standing proposal, so the typed value is not contested. */
  const stageEdit = (key: string, value: string | MeasuredValue): string | void => {
    const cell = cells[key] ?? {};
    void apply([
      ...transitionPatches(["cells"], key, cell, { kind: "stage", rung: { value } }),
      ...(cell.proposal != null ? transitionPatches(["cells"], key, cell, { kind: "deny" }) : []),
    ]);
  };

  const columnHeader = (columnNumber: number) =>
    snapshot?.columns.find((column) => column.columnNumber === columnNumber)?.headerText ??
    `col ${columnNumber}`;
  const currentText = (key: string) => cellText(snapshot, key);

  const gridColumns = useScheduleGridColumns(
    snapshot,
    cells,
    wire,
    stageEdit,
    parseMeasured,
    stale,
    refused,
  );

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
          snapshot?.truncated || freshness !== "current" ? (
            <>
              {snapshot?.truncated ? (
                <FactChip
                  tone="caution"
                  title="The read hit its row cap — rows beyond it are not shown and cannot be edited here. Narrow the schedule in Revit or push what is visible."
                >
                  truncated
                </FactChip>
              ) : null}
              {freshness === "disconnected" ? (
                <FactChip
                  tone="caution"
                  title="No Revit bridge is attached, so nothing can be known about the model behind this read."
                >
                  disconnected
                </FactChip>
              ) : null}
              {freshness === "changed" ? (
                <ChangedInRevit
                  what={`“${snapshot!.scheduleName}”`}
                  busy={busy === "refresh"}
                  disabled={busy != null}
                  onReadAgain={readAgain}
                />
              ) : null}
            </>
          ) : undefined
        }
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
            onActivate={onFocus.rail}
          >
            {catalog == null ? (
              <div className="px-3 py-3">
                <EmptyState story="scope" exit="the list reads when the rail takes focus">
                  no schedule list yet
                </EmptyState>
              </div>
            ) : (
              <List
                aria-label="schedules"
                items={catalog.schedules}
                keyOf={(entry) => String(entry.scheduleId)}
                labelOf={(entry) => entry.name}
                groupOf={(entry) => entry.categoryName ?? "Other"}
                filter="substring"
                searchPlaceholder="Filter schedules…"
                empty="No schedules in the document."
                onPick={(entry) => void execute("refresh", { scheduleId: entry.scheduleId })}
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
            onActivate={onFocus.grid}
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
                          exit="press r to read it again, or pick another from the rail"
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

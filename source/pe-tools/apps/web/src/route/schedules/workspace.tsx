import { useEffect, useState } from "react";
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
import { timeAgo } from "#/lib/utils";
import type { CellWire } from "#/components/lang/band";
import { PendingStrip } from "./pending-strip";
import { cellText, scheduleLock, useScheduleGridColumns } from "./columns";
import type { Refusal } from "#/route";
import { STALE_S } from "./stage";

export interface ScheduleGridState {
  slice: ScheduleGridDocument | null;
  /** The Work revision the slice was read at; `null` before any Work exists. */
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<Refusal | null>;
  /** The running verb; capture and apply run from the Situation and lock the grid too. */
  busy: string | null;
  snapshot: ScheduleGridSnapshot | null;
  catalog: ScheduleCatalog | null;
  /** The verbs the panes reach the world through: the grid's read, and the stage's push. */
  execute: (kind: "refresh" | "push", input?: Record<string, unknown>) => Promise<Refusal | null>;
  /** The last push's refused cells, by key; each draws on its own cell. */
  refused: Readonly<Record<string, string>>;
  /** Each pane's focus edge, as the stage declares it (`stage.ts`). */
  onFocus: { rail: () => void; grid: () => void };
}

/** Now, every 15 s: an age that crosses the stale line shows without a re-render from elsewhere. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function ScheduleGridWorkspace({
  state: { slice, revision, hydrated, apply, execute, busy, snapshot, catalog, refused, onFocus },
}: {
  state: ScheduleGridState;
}) {
  const [tableState, setTableState] = useTableState();
  const document = slice;
  const cells = document?.cells ?? {};
  const stale = document?.basis?.stale ?? [];

  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const now = useNow();

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
  // ASSUME(kai): age only when stale | alt: never, focus revalidates
  const staleSince =
    snapshot?.takenAt != null && now - Date.parse(snapshot.takenAt) > STALE_S * 1000
      ? snapshot.takenAt
      : null;

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
  const currentText = (key: string) => cellText(snapshot, key);

  const gridColumns = useScheduleGridColumns(snapshot, cells, wire, stageEdit, stale, refused);

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
          snapshot?.truncated || staleSince ? (
            <>
              {snapshot?.truncated ? (
                <FactChip
                  tone="caution"
                  title="The read hit its row cap — rows beyond it are not shown and cannot be edited here. Narrow the schedule in Revit or push what is visible."
                >
                  truncated
                </FactChip>
              ) : null}
              {staleSince ? (
                <>
                  <FactChip
                    tone="caution"
                    title="The model may have moved since this read. Clicking into the grid reads it again."
                  >
                    read {timeAgo(staleSince)}
                  </FactChip>
                  <ActionButton
                    label="read again (r)"
                    busy={busy === "refresh"}
                    disabled={busy != null}
                    reason={`Read “${snapshot!.scheduleName}” from Revit again — proposals and staged cells stay.`}
                    onClick={readAgain}
                  />
                </>
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
                region="schedules"
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
            shortcuts={
              snapshot
                ? [
                    {
                      hotkey: "R",
                      label: "read again",
                      says: "Read this schedule from Revit again; proposals and staged cells stay.",
                      refusal: busy != null ? `${busy} is running` : null,
                      callback: readAgain,
                      options: { ignoreInputs: true },
                    },
                  ]
                : []
            }
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

import { useEffect, useRef } from "react";
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
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { readMeasuredText } from "#/components/lang/cell";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { emptyTableState, useTableState } from "#/components/master-table/view";
import { Pane } from "#/components/lang/pane";
import { useMeasuredParse } from "#/host/measured-parse";
import type { HostCallOptions } from "#/host/client";
import type { CellWire } from "#/components/lang/band";
import {
  scheduleLock,
  scheduleShownText,
  useScheduleGridColumns,
  type ScheduleCellWrites,
} from "./columns";
import type { Refusal } from "#/route";

export interface ScheduleGridState {
  slice: ScheduleGridDocument | null;
  /** The Work revision the slice was read at; `null` before any Work exists. */
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<Refusal | null>;
  /** The running verb; capture and apply run from the Situation and lock the grid too. */
  busy: string | null;
  /** Why apply is unavailable; retained for route seams that inspect readiness. */
  blockedBecause?: string | null;
  snapshot: ScheduleGridSnapshot | null;
  catalog: ScheduleCatalog | null;
  /** The verbs the panes reach the world through: the grid's hidden read, and apply. */
  execute: (kind: "read" | "apply", input?: Record<string, unknown>) => Promise<Refusal | null>;
  /** The last push's refused cells, by key; each draws on its own cell. */
  refused: Readonly<Record<string, string>>;
  /** Each pane's focus edge, as the stage declares it (`stage.ts`). */
  onFocus: { grid: () => void };
  /**
   * What is known about the drawn read: `changed` = Revit changed this document since it was
   * taken; `disconnected` = no bridge, so nothing is known. Never an age.
   */
  freshness: "current" | "changed" | "disconnected";
  /** The document the drawn read came from; a measured parse is asked of exactly it. */
  documentScope?: HostCallOptions;
  activeRow?: string | null;
  locateRow?: (row: string) => void;
}

/**
 * The schedule cell's write doors, shared by the grid and the review list: one wire bound to the
 * rendered revision, the stage that severs a standing proposal, and the measured parse.
 */
const bindingOf = (snapshot: ScheduleGridState["snapshot"], key: string) => {
  const { rowNumber, columnNumber } = splitScheduleCellKey(key);
  return snapshot?.rows
    .find((row) => row.rowNumber === rowNumber)
    ?.bindings.find((binding) => binding.columnNumber === columnNumber);
};

/** Every schedule cell's accept, deny and unstage write here, bound to the rendered revision. */
export const scheduleCellWire = ({
  apply,
  revision,
  snapshot,
}: Pick<ScheduleGridState, "apply" | "revision" | "snapshot">): CellWire => ({
  segment: "cells",
  write: apply,
  revision,
  lockOf: (key) => scheduleLock(bindingOf(snapshot, key)),
});

export function useScheduleCellWrites({
  slice,
  revision,
  apply,
  snapshot,
  refused,
  documentScope,
}: Pick<
  ScheduleGridState,
  "slice" | "revision" | "apply" | "snapshot" | "refused" | "documentScope"
>): ScheduleCellWrites {
  const cells = slice?.cells ?? {};
  const stale = slice?.basis?.stale ?? [];
  const bindingAt = (key: string) => bindingOf(snapshot, key);
  const wire = scheduleCellWire({ apply, revision, snapshot });
  /** The measured cell's one call, owned by this snapshot: a re-read aborts what is in flight. */
  const parse = useMeasuredParse(snapshot, documentScope);
  const parseMeasured = (key: string, text: string) => parse(bindingAt(key)?.displayUnit, text);

  /** Typing stages; it also severs a standing proposal, so the typed value is not contested. */
  const stageEdit = async (key: string, value: string | MeasuredValue): Promise<string | void> => {
    const cell = cells[key] ?? {};
    const refusal = await apply(
      [
        ...transitionPatches(["cells"], key, cell, { kind: "stage", rung: { value } }),
        ...(cell.proposal != null ? transitionPatches(["cells"], key, cell, { kind: "deny" }) : []),
      ],
      revision ?? undefined,
    );
    return refusal?.message;
  };

  return { cells, wire, stale, refused, stageEdit, parseMeasured };
}

export function ScheduleGridWorkspace({
  state: {
    slice,
    revision,
    hydrated,
    apply,
    snapshot,
    refused,
    onFocus,
    freshness,
    documentScope,
    activeRow: locatedRow,
  },
  onRefused,
}: {
  state: ScheduleGridState;
  /** A refused fill or paste, said once: the route logs it (ruling 9), the grid never draws it. */
  onRefused: (says: string) => void;
}) {
  const [tableState, setTableState] = useTableState();
  const priorSchedule = useRef(snapshot?.scheduleId);
  useEffect(() => {
    if (priorSchedule.current !== snapshot?.scheduleId) setTableState(emptyTableState());
    priorSchedule.current = snapshot?.scheduleId;
  }, [snapshot?.scheduleId, setTableState]);
  const document = slice;
  const cells = document?.cells ?? {};
  const stale = document?.basis?.stale ?? [];

  const writes = useScheduleCellWrites({
    slice,
    revision,
    apply,
    snapshot,
    refused,
    documentScope,
  });
  const { wire, stageEdit, parseMeasured } = writes;

  const gridColumns = useScheduleGridColumns(
    snapshot,
    cells,
    wire,
    stageEdit,
    parseMeasured,
    stale,
    refused,
  );

  const cellEdit = {
    read: (row: NonNullable<typeof snapshot>["rows"][number], column: string) => {
      if (column === "row") return String(row.rowNumber);
      const columnNumber = Number(column.slice(1));
      return scheduleShownText(
        row,
        columnNumber,
        snapshot?.columns.findIndex((item) => item.columnNumber === columnNumber) ?? -1,
        cells,
      );
    },
    fill: (
      targets: readonly { row: NonNullable<typeof snapshot>["rows"][number]; column: string }[],
      text: string,
    ) => {
      void (async () => {
        // One cell copied from a grid carries a trailing line break; only interior breaks refuse.
        text = text.replace(/\r?\n$/, "");
        if (/[\t\r\n]/.test(text))
          return onRefused("Paste one value at a time; table ranges are not supported.");
        const patches: RouteStatePatch[] = [];
        for (const { row, column } of targets) {
          const columnNumber = Number(column.slice(1));
          const key = scheduleCellKey(row.rowNumber, columnNumber);
          const binding = row.bindings.find((item) => item.columnNumber === columnNumber);
          const lock = column === "row" ? "row numbers cannot be edited" : scheduleLock(binding);
          if (lock) return onRefused(`row ${row.rowNumber}, ${column}: ${lock}`);
          if (text === "" && binding?.storageType !== "String")
            return onRefused(
              `row ${row.rowNumber}, ${column}: a ${binding?.storageType ?? "non-text"} parameter cannot be empty`,
            );
          let value: string | MeasuredValue = text;
          if (binding?.displayUnit) {
            const decided = readMeasuredText(text, binding.displayUnit);
            if (decided.kind === "refuse")
              return onRefused(`row ${row.rowNumber}, ${column}: ${decided.reason}`);
            if (decided.kind === "stage") value = decided.staged;
            else {
              const parsed = await parseMeasured(key, decided.text);
              if (parsed == null)
                return onRefused("The schedule changed while parsing; nothing was staged.");
              if ("refusal" in parsed)
                return onRefused(`row ${row.rowNumber}, ${column}: ${parsed.refusal}`);
              value = parsed;
            }
          }
          const cell = cells[key] ?? {};
          patches.push(
            ...transitionPatches(["cells"], key, cell, { kind: "stage", rung: { value } }),
            ...(cell.proposal != null
              ? transitionPatches(["cells"], key, cell, { kind: "deny" })
              : []),
          );
        }
        const refusal = await apply(patches, revision ?? undefined);
        if (refusal) onRefused(refusal.message);
      })().catch((cause: unknown) =>
        onRefused(cause instanceof Error ? cause.message : String(cause)),
      );
    },
  };

  // Facts about the drawn read ride the grid's own head; the Situation sentence names the schedule.
  const facts =
    snapshot?.truncated || freshness === "disconnected" ? (
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
      </>
    ) : undefined;

  return (
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
              // A schedule switch remounts the box: no draft or typed text outlives its schedule.
              key={snapshot.scheduleId}
              label="schedule rows"
              rows={snapshot.rows}
              columns={gridColumns}
              rowKey={(row) => String(row.rowNumber)}
              state={tableState}
              onStateChange={setTableState}
              searchPlaceholder="search any field, or type a column name"
              actions={facts}
            >
              <Table
                rows={snapshot.rows}
                columns={gridColumns}
                rowKey={(row) => String(row.rowNumber)}
                label="schedule rows"
                state={tableState}
                onStateChange={setTableState}
                activeKey={locatedRow}
                cellEdit={cellEdit}
                gutter={(row) => {
                  const owed = snapshot.columns.filter(
                    (column) =>
                      cells[scheduleCellKey(row.rowNumber, column.columnNumber)]?.proposal != null,
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
                  <EmptyState story="scope" exit="press r to read it again, or Ctrl K for another">
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
                  exit="press Ctrl K to choose one (type to filter, ↑/↓ then Enter), or ask pea to open one"
                >
                  no schedule open
                </EmptyState>
              ) : (
                <OutcomeLine kind="busy" label="connecting to the workbench" />
              )}
            </div>
          )}
        </div>
      </section>
    </Pane>
  );
}

import { useEffect, useRef } from "react";
import {
  scheduleCellKey,
  splitScheduleCellKey,
  cellPatches,
  type RouteStatePatch,
  type ScheduleGridDocument,
  type MeasuredValue,
  type ScheduleGridSnapshot,
} from "@pe/agent-contracts";
import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { readMeasuredText } from "@pe/kit/lang/cell";
import { Table } from "@pe/kit/table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { emptyTableState } from "@pe/kit/table/view";
import type { TableState } from "@pe/kit/table/model";
import { useMeasuredParse } from "#/host/measured-parse";
import type { CellHandle } from "@pe/kit/lang/cell";
import {
  scheduleLock,
  scheduleShownText,
  useScheduleGridColumns,
  type ScheduleCellWrites,
} from "./columns";
import type { Refusal } from "#/route/refusal";
import { type NativeObservation } from "#/revit/observation";

export interface ScheduleGridState {
  slice: ScheduleGridDocument | null;
  at: (key: string) => CellHandle;
  /** The Work revision the slice was read at; `null` before any Work exists. */
  revision: number | null;
  hydrated: boolean;
  apply: (patches: RouteStatePatch[], expectedRevision?: number) => Promise<Refusal | null>;
  snapshot: ScheduleGridSnapshot | null;
  /** The last push's refused cells, by key; each draws on its own cell. */
  refused: Readonly<Record<string, string>>;
  /**
   * What is known about the drawn read: `changed` = Revit changed this document since it was
   * taken; `disconnected` = no bridge, so nothing is known. Never an age.
   */
  freshness: "current" | "changed" | "disconnected";
  /** The document the drawn read came from; a measured parse is asked of exactly it. */
  documentScope?: { bridgeSessionId?: string; openDocumentId?: string };
  /** Native action provenance belongs to the displayed capture, independently of the selector. */
  nativeObservation?: NativeObservation;
  /** The grid's query, sorts and hidden columns: contract fields (`routeAddress("schedules")`). */
  table: TableState;
  setTable: (next: TableState) => void;
  /** The located cell (`row::column`); empty = none. */
  cell: string;
  locate: (cell: string) => void;
}

/**
 * The schedule cell's write doors, shared by the grid and the review list: owned handles bound to the
 * rendered revision, the stage that severs a standing suggestion, and the measured parse.
 */
const bindingOf = (snapshot: ScheduleGridState["snapshot"], key: string) => {
  const { rowNumber, columnNumber } = splitScheduleCellKey(key);
  return snapshot?.rows
    .find((row) => row.rowNumber === rowNumber)
    ?.bindings.find((binding) => binding.columnNumber === columnNumber);
};

export function useScheduleCellWrites({
  slice,
  at,
  snapshot,
  refused,
  documentScope,
}: Pick<
  ScheduleGridState,
  "slice" | "at" | "snapshot" | "refused" | "documentScope" | "nativeObservation"
>): ScheduleCellWrites {
  const cells = slice?.cells ?? {};
  const stale = slice?.basis?.stale ?? [];
  const bindingAt = (key: string) => bindingOf(snapshot, key);
  /** The measured cell's one call, owned by this snapshot: a re-read aborts what is in flight. */
  const parse = useMeasuredParse(snapshot, documentScope);
  const parseMeasured: ScheduleCellWrites["parseMeasured"] = (key, text) => {
    const scope = nativeObservation?.scope;
    if (
      scope?.source !== "native" ||
      !scope.document ||
      documentScope?.bridgeSessionId !== scope.document.session ||
      documentScope?.openDocumentId !== scope.document.openId
    )
      return Promise.resolve({
        refusal: "A native parse needs the displayed observation's exact document lifetime.",
      });
    return parse(bindingAt(key)?.displayUnit, text);
  };

  /** Typing stages; it also severs a standing suggestion, so the typed value is not contested. */
  const stageEdit = async (key: string, value: string | MeasuredValue): Promise<string | void> => {
    const refusal = await at(key).stage(value, { label: `Edit schedule cell ${key}` });
    return refusal?.message;
  };

  return { cells, at, stale, refused, stageEdit, parseMeasured };
}

export function ScheduleGridWorkspace({
  state: {
    slice,
    at,
    revision,
    hydrated,
    apply,
    snapshot,
    refused,
    freshness,
    documentScope,
    table: tableState,
    setTable: setTableState,
    cell: locatedCell,
    locate,
  },
  onRefused,
  onHidden,
}: {
  state: ScheduleGridState;
  /** A refused fill or paste, said once: the route logs it (ruling 9), the grid never draws it. */
  onRefused: (says: string) => void;
  /** A located cell the view hides (the query, a hidden column), said once per locate. */
  onHidden?: (says: string) => void;
}) {
  // Another schedule starts a bare view; a schedule arriving (a reload, a deep link) keeps the link's.
  const priorSchedule = useRef(snapshot?.scheduleId);
  useEffect(() => {
    if (
      priorSchedule.current !== undefined &&
      snapshot?.scheduleId !== undefined &&
      priorSchedule.current !== snapshot.scheduleId
    ) {
      setTableState(emptyTableState());
      locate("");
    }
    if (snapshot?.scheduleId !== undefined) priorSchedule.current = snapshot.scheduleId;
  }, [snapshot?.scheduleId]); // eslint-disable-line react-hooks/exhaustive-deps -- the schedule edge
  const located = locatedCell ? splitScheduleCellKey(locatedCell) : null;
  const locatedRow = located ? String(located.rowNumber) : null;
  const document = slice;
  const cells = document?.cells ?? {};
  const stale = document?.basis?.stale ?? [];

  const writes = useScheduleCellWrites({
    slice,
    at,
    snapshot,
    refused,
    documentScope,
  });
  const { stageEdit, parseMeasured } = writes;

  const gridColumns = useScheduleGridColumns(
    snapshot,
    cells,
    at,
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
            if (decided.kind === "set") value = decided.edit;
            else {
              const parsed = await parseMeasured(key, decided.text);
              if (parsed == null)
                return onRefused("The schedule changed while parsing; nothing was edit.");
              if ("refusal" in parsed)
                return onRefused(`row ${row.rowNumber}, ${column}: ${parsed.refusal}`);
              value = parsed;
            }
          }
          const cell = cells[key] ?? {};
          patches.push(...cellPatches(["cells"], key, cell, { kind: "set", rung: { value } }));
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
    // Focus arriving from outside the grid's pane is the edge a stage revalidates on.
    <>
      <div className="contents">
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
                search
                actions={facts}
              >
                <Table
                  // I2: a row Revit refused, or one moved under a edit value, blocks the push.
                  rows={snapshot.rows.map((row) => {
                    const keys = snapshot.columns.map((column) =>
                      scheduleCellKey(row.rowNumber, column.columnNumber),
                    );
                    return {
                      ...row,
                      damage: keys.some((key) => refused[key])
                        ? "refused"
                        : keys.some((key) => stale.some((cell) => cell.key === key))
                          ? "stale"
                          : null,
                    };
                  })}
                  columns={gridColumns}
                  rowKey={(row) => String(row.rowNumber)}
                  label="schedule rows"
                  state={tableState}
                  onStateChange={setTableState}
                  activeKey={locatedRow}
                  activeColumn={located ? `c${located.columnNumber}` : null}
                  onActiveHidden={(why) =>
                    onHidden?.(
                      `row ${located!.rowNumber}, column ${located!.columnNumber} not shown: ${why}`,
                    )
                  }
                  revit={(row) => row.subjectIds}
                  cellEdit={cellEdit}
                  gutter={(row) => {
                    const owed = snapshot.columns.filter(
                      (column) =>
                        cells[scheduleCellKey(row.rowNumber, column.columnNumber)]?.edit != null,
                    ).length;
                    return owed > 0
                      ? {
                          count: owed,
                          tone: "caution" as const,
                          title: `${owed} staged cell${owed === 1 ? "" : "s"} on this row`,
                        }
                      : null;
                  }}
                  empty={
                    <EmptyState
                      story="scope"
                      exit="press r to read it again, or Ctrl K for another"
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
      </div>
    </>
  );
}

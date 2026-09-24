import type { ReactNode } from "react";
import { showCellValue, splitScheduleCellKey } from "@pe/agent-contracts";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { Press } from "#/components/lang/press";
import { ValueDiff } from "#/components/lang/value-diff";
import type { ScheduleGridDocument } from "@pe/agent-contracts";
import { StateCell } from "#/components/lang/cell";
import {
  cellText,
  scheduleCellState,
  STALE_NOTE,
  scheduleTransitions,
  type StaleCell,
} from "./columns";
import { useScheduleCellWrites, type ScheduleGridState } from "./workspace";

export function ScheduleReview({
  state,
  staleBar,
}: {
  state: ScheduleGridState;
  /** The changed-in-Revit answers (`StaleResolve`), drawn above the list. */
  staleBar?: ReactNode;
}) {
  const writes = useScheduleCellWrites(state);
  const cells = writes.cells;
  const pending = Object.entries(cells).filter(
    ([, cell]) => cell.proposal != null || cell.staged != null,
  );
  const snapshot = state.snapshot;
  if (!snapshot || !pending.length) return staleBar ?? null;
  // The grid's own cell, editable, for each pending address.
  const editor = (key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const row = snapshot.rows.find((candidate) => candidate.rowNumber === rowNumber);
    const index = snapshot.columns.findIndex((column) => column.columnNumber === columnNumber);
    return row && index >= 0 ? (
      <StateCell {...scheduleCellState(writes, row, columnNumber, index)} />
    ) : undefined;
  };
  return (
    <ScheduleProposals
      pending={pending}
      stale={writes.stale}
      staleBar={staleBar}
      editor={editor}
      columnHeader={(number) =>
        snapshot.columns.find((column) => column.columnNumber === number)?.headerText ??
        `col ${number}`
      }
      currentText={(key) => cellText(snapshot, key)}
      locate={(key) => state.locateRow?.(String(splitScheduleCellKey(key).rowNumber))}
      wire={writes.wire}
    />
  );
}

type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

/**
 * Under the Work sentence, every open diff on the schedule, one `ReviewRow` each: the grid cell's
 * own verbs, findable. Its counts and aggregates are the Situation's Work sentence; a staged cell
 * Revit changed since carries its drift on its row, answered in aggregate by `staleBar`.
 */
export function ScheduleProposals({
  pending,
  stale,
  staleBar,
  editor,
  wire,
  columnHeader,
  currentText,
  locate,
}: {
  pending: [string, CellState][];
  /** Staged keys a re-read moved under (`basis.stale`): the person accepts or drops each. */
  stale: readonly StaleCell[];
  staleBar?: ReactNode;
  /** The table's own editable cell for a key; absent, the row draws its value read-only. */
  editor?: (key: string) => ReactNode;
  wire: CellWire;
  columnHeader: (columnNumber: number) => string;
  currentText: (key: string) => string | null;
  locate: (key: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {staleBar}
      <div aria-label="pending cells" role="list">
        {pending.map(([key, cell]) => {
          const { rowNumber, columnNumber } = splitScheduleCellKey(key);
          const next = showCellValue(
            cell.staged != null ? cell.staged.value : cell.proposal?.value,
          );
          const lock = wire.lockOf?.(key) ?? null;
          const staleAt = cell.staged != null ? stale.find((s) => s.key === key) : undefined;
          return (
            <div key={key} role="listitem">
              <ReviewRow
                wire={wire}
                address={key}
                cell={cell}
                label={
                  <Press
                    type="button"
                    tone="quiet"
                    size="caption"
                    title="Highlight this cell's row in the grid and scroll it into view."
                    onClick={() => locate(key)}
                  >
                    <span className="truncate">
                      {columnHeader(columnNumber)} · r{rowNumber}
                    </span>
                  </Press>
                }
                transitions={scheduleTransitions(wire, key, cell, stale)}
                editor={editor?.(key)}
                facts={{
                  // Stale: drift against what Revit holds now, answered by the cell's own verbs.
                  ...(staleAt
                    ? {
                        value: <ValueDiff from={currentText(key)} to={next} />,
                        agree: "drift" as const,
                        modelValue: currentText(key) ?? "",
                        reviewed: staleAt.was,
                        note: STALE_NOTE,
                      }
                    : { value: <ValueDiff from={currentText(key)} to={next} /> }),
                  cap: lock ? "locked" : "editable",
                  capReason: lock ?? undefined,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

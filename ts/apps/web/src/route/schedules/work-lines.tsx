import { showCellValue, splitScheduleCellKey } from "@pe/agent-contracts";
import { cellFromTrichotomy } from "@pe/kit/lang/cell";
import { WorkLines, type WorkCell, type WorkTab } from "#/components/work/lines";
import { STALE_NOTE } from "./columns";
import { useScheduleCellWrites, type ScheduleGridState } from "./workspace";

/**
 * The schedule's Work slot: every pending cell as `WorkLines`, one line per column. A row reads by
 * its key column's value (`IU-4`), the word the person sees in the grid, and a chip locates its
 * cell (the route's `cell` field, so the grid row it names is the one a link reopens).
 */
export function ScheduleWorkLines({
  state,
  tab,
  onTab,
}: {
  state: ScheduleGridState;
  tab: WorkTab | "all" | undefined;
  onTab: (tab: WorkTab | "all") => void;
}) {
  const { cells, wire, stale } = useScheduleCellWrites(state);
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const pending: WorkCell[] = Object.entries(cells).flatMap(([key, cell]) => {
    if (cell.proposal == null && cell.staged == null) return [];
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const value = showCellValue(cell.staged != null ? cell.staged.value : cell.proposal?.value);
    const row = snapshot.rows.find((candidate) => candidate.rowNumber === rowNumber);
    // Staged over a value a re-read moved: drift against what Revit holds now, as on its grid cell.
    const staleAt = cell.staged != null ? stale.find((s) => s.key === key) : undefined;
    return [
      {
        key,
        column:
          snapshot.columns.find((column) => column.columnNumber === columnNumber)?.headerText ??
          `col ${columnNumber}`,
        row: row?.values[0] || `r${rowNumber}`,
        value,
        look: cellFromTrichotomy(
          cell,
          staleAt
            ? {
                value,
                agree: "drift" as const,
                modelValue:
                  row?.bindings.find((b) => b.columnNumber === columnNumber)?.displayValue ?? "",
                reviewed: staleAt.was,
                note: STALE_NOTE,
              }
            : { value },
          showCellValue,
        ),
        locate: () => state.locate(key),
      },
    ];
  });
  // Grid order: by column, then row.
  pending.sort((a, b) => {
    const [x, y] = [splitScheduleCellKey(a.key), splitScheduleCellKey(b.key)];
    return x.columnNumber - y.columnNumber || x.rowNumber - y.rowNumber;
  });
  return <WorkLines cells={pending} store={cells} wire={wire} tab={tab} onTab={onTab} />;
}

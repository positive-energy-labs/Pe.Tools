import { useMemo } from "react";
import { scheduleCellKey, transitionPatches } from "@pe/agent-contracts";
import type { ScheduleGridDocument } from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/lang/band";
import type { CellTransition } from "#/components/lang/cell";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import type { Column } from "#/components/master-table/model";
import type { ScheduleGridSnapshot as Snapshot } from "@pe/agent-contracts";

type ScheduleRow = Snapshot["rows"][number];
type Binding = ScheduleRow["bindings"][number];

/** Why a schedule cell refuses writes, or null when its parameter binding takes them. */
export const scheduleLock = (binding: Binding | undefined): string | null =>
  binding == null
    ? "no parameter behind this cell — the row is unbound here"
    : binding.isEditable === true && binding.blocker === "None"
      ? null
      : binding.blocker !== "None"
        ? `blocked: ${binding.blocker}`
        : "read-only — this parameter cannot be written from a schedule";

/** A stale key's note (`basis.stale`), in the grid and the pending strip alike. */
export const STALE_NOTE = "stale: Revit changed under your staged value · accept to stage it again";

type GridCell = NonNullable<ScheduleGridDocument["cells"][string]>;

/**
 * A schedule cell's own verbs. A stale key is answered by accept (the contract's `stage`, again)
 * or deny (`unstage`); the wire's write drops the key from `basis.stale` in the same write.
 */
export function scheduleTransitions(
  wire: CellWire,
  key: string,
  cell: GridCell,
  stale: readonly string[],
): CellTransition[] {
  if (cell.staged == null || !stale.includes(key)) return reviewTransitions(wire, key, cell);
  const run = (patches: ReturnType<typeof transitionPatches>) => () =>
    wire.write(patches, wire.revision ?? undefined);
  return [
    {
      kind: "deny",
      reason: "Drop your stale value; the Revit value stands.",
      run: run(transitionPatches(["cells"], key, cell, { kind: "unstage" })),
    },
    {
      kind: "accept",
      reason: "Accept to stage it again over what Revit holds now.",
      run: run(transitionPatches(["cells"], key, cell, { kind: "stage", rung: cell.staged })),
    },
  ];
}

export function useScheduleGridColumns(
  snapshot: Snapshot | null,
  cells: ScheduleGridDocument["cells"],
  wire: CellWire,
  stageEdit: (key: string, value: string) => string | void,
  stale: readonly string[] = [],
) {
  return useMemo<Column<ScheduleRow>[]>(() => {
    if (!snapshot) return [];
    return [
      {
        key: "row",
        label: "#",
        title: "Schedule row number. ×N marks a grouped row standing for N elements.",
        right: true,
        width: "w-12",
        lock: true,
        sort: (row) => row.rowNumber,
        cell: (row) => (
          <span
            title={`row ${row.rowNumber} · ${row.kind}${row.subjectIds.length > 0 ? ` · elements [${row.subjectIds.join(",")}]` : ""}`}
          >
            <StateCell
              scale="row"
              value={`${row.rowNumber}${row.subjectIds.length > 1 ? ` ×${row.subjectIds.length}` : ""}`}
            />
          </span>
        ),
      },
      ...snapshot.columns.map((column): Column<ScheduleRow> => {
        const columnIndex = snapshot.columns.findIndex(
          (candidate) => candidate.columnNumber === column.columnNumber,
        );
        const kindNote = [
          column.isCalculated ? "ƒ calculated — Revit derives it; never writable" : null,
          column.isCombinedParameter
            ? "combined parameter — several parameters in one column"
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          key: `c${column.columnNumber}`,
          label: column.headerText || `col ${column.columnNumber}`,
          header:
            column.isCalculated || column.isCombinedParameter
              ? `${column.headerText} · ${column.isCalculated ? "ƒ" : "comb"}`
              : undefined,
          title: kindNote || "Schedule column — values write through the cell's parameter binding.",
          search: (row) => row.values[columnIndex] ?? "",
          state: (row) => {
            const key = scheduleCellKey(row.rowNumber, column.columnNumber);
            const binding = row.bindings.find(
              (candidate) => candidate.columnNumber === column.columnNumber,
            );
            const cell = cells[key] ?? {};
            const isStaged = cell.staged != null;
            const isProposal = !isStaged && cell.proposal != null;
            // Staged over a value a re-read moved (`basis.stale`): drift against what Revit holds now.
            const isStale = isStaged && stale.includes(key);
            const current = binding?.displayValue ?? row.values[columnIndex] ?? "";
            const shown = isStaged
              ? (cell.staged?.value ?? "")
              : isProposal
                ? String(cell.proposal?.value ?? "")
                : current;
            const lock = scheduleLock(binding);
            const note =
              [
                isStale ? STALE_NOTE : null,
                (isStaged || isProposal) && shown !== current ? `was ${current || "—"}` : null,
                isProposal
                  ? cell.proposal?.note
                    ? `pea: ${cell.proposal.note}`
                    : "pea proposed this"
                  : null,
                binding?.isTypeParameter
                  ? "type parameter — shared across every row of this type"
                  : null,
                binding?.hasMixedValues ? "mixed values across targets" : null,
                binding
                  ? `param ${binding.parameterName ?? "—"} · ${binding.storageType} · targets [${binding.targetElementIds.join(",")}]`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined;
            return {
              ...cellFromTrichotomy(cell, {
                value: shown,
                ...(isStale ? { agree: "drift" as const, modelValue: current } : {}),
                cap: binding == null ? "nohome" : lock ? "locked" : "editable",
                capReason: lock ?? undefined,
                note,
                // Clearing a value is allowed (ruling 1600-3), as far as Revit can hold it: a
                // text parameter can be empty, a number or an element id cannot.
                onCommit: lock
                  ? undefined
                  : (text) =>
                      text === "" && binding?.storageType !== "String"
                        ? `a ${binding?.storageType ?? "non-text"} parameter cannot be empty in Revit — type a value`
                        : stageEdit(key, text),
              }),
              transitions: scheduleTransitions(wire, key, cell, stale),
            };
          },
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stageEdit and wire close over `cells` and the revision, listed
  }, [snapshot, cells, wire.revision, stale.join("|")]);
}

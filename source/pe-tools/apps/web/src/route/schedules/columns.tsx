import { useMemo } from "react";
import { scheduleCellKey } from "@pe/agent-contracts";
import type { ScheduleGridDocument } from "@pe/agent-contracts";
import { StateCell, type StateCellProps } from "#/components/lang/cell";
import type { Column } from "#/components/master-table/model";
import type { ScheduleGridSnapshot as Snapshot } from "@pe/agent-contracts";

type ScheduleRow = Snapshot["rows"][number];

export function useScheduleGridColumns(
  snapshot: Snapshot | null,
  cells: ScheduleGridDocument["cells"],
  stageEdit: (key: string, value: string) => string | void,
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
          state: (row): StateCellProps => {
            const key = scheduleCellKey(row.rowNumber, column.columnNumber);
            const binding = row.bindings.find(
              (candidate) => candidate.columnNumber === column.columnNumber,
            );
            const cell = cells[key];
            const isStaged = cell?.staged != null;
            const isProposal = !isStaged && cell?.proposal != null;
            const current = binding?.displayValue ?? row.values[columnIndex] ?? "";
            const shown = isStaged
              ? (cell?.staged?.value ?? "")
              : isProposal
                ? String(cell?.proposal?.value ?? "")
                : current;
            const editable = binding?.isEditable === true && binding.blocker === "None";
            const capReason =
              binding == null
                ? "no parameter behind this cell — the row is unbound here"
                : editable
                  ? undefined
                  : binding.blocker !== "None"
                    ? `blocked: ${binding.blocker}`
                    : "read-only — this parameter cannot be written from a schedule";
            const note =
              [
                (isStaged || isProposal) && shown !== current ? `was ${current || "—"}` : null,
                isProposal
                  ? cell?.proposal?.note
                    ? cell.proposal.by === "human"
                      ? cell.proposal.note
                      : `pea: ${cell.proposal.note}`
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
              value: shown,
              stage: isStaged ? "staged" : isProposal ? "proposed" : "clean",
              stagedBy: "you",
              cap: binding == null ? "nohome" : editable ? "editable" : "locked",
              capReason,
              note,
              onCommit: editable ? (text) => stageEdit(key, text) : undefined,
            };
          },
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stageEdit closes over `cells`, listed
  }, [snapshot, cells]);
}

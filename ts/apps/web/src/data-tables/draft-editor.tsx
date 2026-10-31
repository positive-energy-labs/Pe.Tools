import { Plus, Trash2 } from "lucide-react";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { Tag } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { EmptyState } from "@pe/kit/lang/empty";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { TextCell } from "@pe/kit/table/cells";
import type { Column } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import type { ColumnKind, Draft } from "./graph";
import { rowKey } from "./graph";
import { TooltipHint } from "@pe/kit/lang/tooltip";

type Line = { row: Draft["rows"][number]; index: number };

const COLUMN_KINDS: { value: ColumnKind; label: string }[] = [
  { value: "Text", label: "txt" },
  { value: "Number", label: "num" },
];

export function DraftEditor({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
}) {
  const patch = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));

  const setCell = (rowIndex: number, columnIndex: number, value: string) =>
    patch((d) => {
      const rows = d.rows.map((row, i) => {
        if (i !== rowIndex) return row;
        const values = [...row.values];
        while (values.length <= columnIndex) values.push(null);
        values[columnIndex] = value.length > 0 ? value : null;
        return { ...row, values };
      });
      return { ...d, rows };
    });

  const addColumn = () =>
    patch((d) => ({
      ...d,
      columns: [...d.columns, { heading: `Column ${d.columns.length + 1}`, kind: "Text" }],
    }));

  const removeColumn = (columnIndex: number) =>
    patch((d) => ({
      ...d,
      columns: d.columns.filter((_, i) => i !== columnIndex),
      rows: d.rows.map((row) => ({
        ...row,
        values: row.values.filter((_, i) => i !== columnIndex),
      })),
    }));

  const addRow = () =>
    patch((d) => ({
      ...d,
      rows: [...d.rows, { key: rowKey(), values: d.columns.map(() => null) }],
    }));

  const removeRow = (rowIndex: number) =>
    patch((d) => ({ ...d, rows: d.rows.filter((_, i) => i !== rowIndex) }));

  return (
    <div className="space-y-3">
      <div className="max-w-72">
        <TooltipHint
          content={
            draft.isNew
              ? "The table's name — apply upserts by name"
              : "Renaming creates a NEW table on apply — upserts match by name"
          }
        >
          <Input
            value={draft.name}
            onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
            placeholder="Table name"
          />
        </TooltipHint>
      </div>

      <ArtifactFrame>
        <Table<Line>
          label={draft.name || "Draft table"}
          rows={draft.rows.map((row, index) => ({ row, index }))}
          rowKey={(line) => line.row.key}
          maxHeight="32rem"
          empty={
            <EmptyState story="scope" exit="add row below">
              no rows yet
            </EmptyState>
          }
          columns={[
            {
              key: "row",
              label: "row",
              header: <span />,
              right: true,
              width: "w-10",
              cell: ({ row, index }) => (
                <TooltipHint content={`row key: ${row.key} — the stable address apply upserts by`}>
                  <span>
                    <Tag>{index + 1}</Tag>
                  </span>
                </TooltipHint>
              ),
            },
            ...draft.columns.map(
              (column, columnIndex): Column<Line> => ({
                key: `column:${columnIndex}`,
                label: column.heading || `column ${columnIndex + 1}`,
                width: "min-w-36",
                header: (
                  <span className="flex items-center gap-1 normal-case">
                    <TooltipHint content="Column heading — written to the schedule on apply">
                      <Input
                        value={column.heading}
                        onChange={(e) =>
                          patch((d) => ({
                            ...d,
                            columns: d.columns.map((c, i) =>
                              i === columnIndex ? { ...c, heading: e.target.value } : c,
                            ),
                          }))
                        }
                      />
                    </TooltipHint>
                    <ListPopup<(typeof COLUMN_KINDS)[number]>
                      anchor="trigger"
                      title="Column type: txt = Text, num = Number"
                      triggerLabel={`${column.heading || "column"} type`}
                      trigger={
                        <span className="face-mono">{column.kind === "Text" ? "txt" : "num"}</span>
                      }
                      aria-label="column type"
                      items={COLUMN_KINDS}
                      keyOf={(kind) => kind.value}
                      labelOf={(kind) => kind.label}
                      select="single"
                      selected={[column.kind]}
                      empty="no column types"
                      onPick={(kind) =>
                        patch((d) => ({
                          ...d,
                          columns: d.columns.map((c, i) =>
                            i === columnIndex ? { ...c, kind: kind.value } : c,
                          ),
                        }))
                      }
                      row={(kind) => ({ label: <span className="face-mono">{kind.label}</span> })}
                    />
                    <Button
                      type="button"
                      icon={Trash2}
                      label="Remove column"
                      reason="Remove this column and its values from the draft"
                      refusal={
                        draft.columns.length === 1 ? "a table keeps at least one column" : null
                      }
                      onClick={() => removeColumn(columnIndex)}
                    />
                  </span>
                ),
                cell: ({ row, index }) => (
                  <TextCell
                    value={row.values[columnIndex] ?? ""}
                    placeholder={column.kind === "Number" ? "0" : undefined}
                    onCommit={(value) => setCell(index, columnIndex, value)}
                  />
                ),
              }),
            ),
            {
              key: "verbs",
              label: "verbs",
              header: (
                <Button
                  kind="framed"
                  label="col"
                  icon={Plus}
                  onClick={addColumn}
                  reason="Add a column to the draft"
                >
                  col
                </Button>
              ),
              width: "w-16",
              cell: ({ index }) => (
                <Button
                  type="button"
                  icon={Trash2}
                  label="Remove row"
                  reason="Remove this row — it is deleted in Revit on apply"
                  onClick={() => removeRow(index)}
                />
              ),
            },
          ]}
        />
        <div className="px-1 py-0.5">
          <Button
            kind="framed"
            label="add row"
            icon={Plus}
            onClick={addRow}
            reason="Add a row with a fresh stable key"
          >
            add row
          </Button>
        </div>
      </ArtifactFrame>
    </div>
  );
}

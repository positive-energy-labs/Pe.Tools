import { Plus, Trash2 } from "lucide-react";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Tag } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { ListPopup } from "#/components/lang/list-popup";
import { TextCell } from "#/components/master-table/cells";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import type { ColumnKind, Draft } from "#/routes/data-tables";
import { rowKey } from "#/routes/data-tables";

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
        <Input
          value={draft.name}
          onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
          placeholder="Table name"
          title={
            draft.isNew
              ? "The table's name — apply upserts by name"
              : "Renaming creates a NEW table on apply — upserts match by name"
          }
        />
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
                <span title={`row key: ${row.key} — the stable address apply upserts by`}>
                  <Tag>{index + 1}</Tag>
                </span>
              ),
            },
            ...draft.columns.map(
              (column, columnIndex): Column<Line> => ({
                key: `column:${columnIndex}`,
                label: column.heading || `column ${columnIndex + 1}`,
                width: "min-w-36",
                header: (
                  <span className="flex items-center gap-1 normal-case">
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
                      title="Column heading — written to the schedule on apply"
                    />
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
                    <Press
                      type="button"
                      title={
                        draft.columns.length === 1
                          ? "a table keeps at least one column"
                          : "Remove this column and its values from the draft"
                      }
                      tone="quiet"
                      state="disabled"
                      disabled={draft.columns.length === 1}
                      onClick={() => removeColumn(columnIndex)}
                    >
                      <Trash2 className="size-3" />
                    </Press>
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
                <ActionButton
                  label="col"
                  icon={Plus}
                  onClick={addColumn}
                  reason="Add a column to the draft"
                />
              ),
              width: "w-16",
              cell: ({ index }) => (
                <Press
                  type="button"
                  title="Remove this row — it is deleted in Revit on apply"
                  tone="quiet"
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="size-3" />
                </Press>
              ),
            },
          ]}
        />
        <div className="px-1 py-0.5">
          <ActionButton
            label="add row"
            icon={Plus}
            onClick={addRow}
            reason="Add a row with a fresh stable key"
          />
        </div>
      </ArtifactFrame>
    </div>
  );
}

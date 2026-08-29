import { Plus, Trash2 } from "lucide-react";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Verb } from "#/components/lang/verb";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";
import { Press } from "#/components/lang/press";
import type { ColumnKind, Draft } from "#/routes/data-tables";
import { rowKey } from "#/routes/data-tables";

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
      <Input
        value={draft.name}
        onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
        className="t-value h-8 max-w-72"
        placeholder="Table name"
        title={
          draft.isNew
            ? "The table's name — apply upserts by name"
            : "Renaming creates a NEW table on apply — upserts match by name"
        }
      />

      <ArtifactFrame>
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="border-b border-line bg-recess" />
              {draft.columns.map((column, columnIndex) => (
                <th
                  key={columnIndex}
                  className="min-w-36 border-b border-l border-line bg-recess px-1.5 py-1 text-left"
                >
                  <div className="flex items-center gap-1">
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
                      className="t-label h-6 rounded-none border-transparent bg-transparent px-1 font-normal hover:border-line"
                      title="Column heading — written to the schedule on apply"
                    />
                    <select
                      value={column.kind}
                      title="Column type: txt = Text, num = Number"
                      className="t-caption face-mono h-6 rounded-sm border border-transparent bg-transparent text-ink-2 hover:border-line"
                      onChange={(e) =>
                        patch((d) => ({
                          ...d,
                          columns: d.columns.map((c, i) =>
                            i === columnIndex ? { ...c, kind: e.target.value as ColumnKind } : c,
                          ),
                        }))
                      }
                    >
                      <option value="Text">txt</option>
                      <option value="Number">num</option>
                    </select>
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
                  </div>
                </th>
              ))}
              <th className="border-b border-l border-line bg-recess px-1">
                <Verb
                  label="col"
                  icon={Plus}
                  onClick={addColumn}
                  reason="Add a column to the draft"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => (
              <tr key={row.key}>
                <td
                  className="t-caption face-mono whitespace-nowrap border-b border-line px-2 py-1 text-right text-ink-2"
                  title={`row key: ${row.key} — the stable address apply upserts by`}
                >
                  {rowIndex + 1}
                </td>
                {draft.columns.map((column, columnIndex) => (
                  <td key={columnIndex} className="border-b border-l border-line p-0">
                    <input
                      value={row.values[columnIndex] ?? ""}
                      placeholder={column.kind === "Number" ? "0" : ""}
                      inputMode={column.kind === "Number" ? "decimal" : undefined}
                      onChange={(e) => setCell(rowIndex, columnIndex, e.target.value)}
                      className={cn(
                        "t-value face-mono h-7 w-full min-w-36 bg-transparent px-2 outline-none focus:bg-select",
                        column.kind === "Number" && "text-right",
                      )}
                    />
                  </td>
                ))}
                <td className="border-b border-l border-line px-1 text-center">
                  <Press
                    type="button"
                    title="Remove this row — it is deleted in Revit on apply"
                    tone="quiet"
                    onClick={() => removeRow(rowIndex)}
                  >
                    <Trash2 className="size-3" />
                  </Press>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={draft.columns.length + 2} className="px-1 py-0.5">
                <Verb
                  label="add row"
                  icon={Plus}
                  onClick={addRow}
                  reason="Add a row with a fresh stable key"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </ArtifactFrame>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, List, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { callHostDynamic } from "#/host/client";
import { useHostOpDynamic } from "#/host/queries";
import { cn } from "#/lib/utils";

/**
 * /data-tables — author synthetic data tables (revit.apply.schedule table lane).
 * Rail lists existing tables (revit.detail.data-tables); the editor drafts name,
 * columns (heading + Text/Number kind), and rows (stable key + cell values), then
 * upserts in one apply. Missing rows are pruned on apply, so deleting a row here
 * deletes it in Revit.
 */
export const Route = createFileRoute("/data-tables")({
  component: DataTablesRoute,
});

type ColumnKind = "Text" | "Number";

interface Draft {
  name: string;
  isNew: boolean;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
}

interface TableHandle {
  name: string;
  scheduleId: number;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
  placements: { sheetNumber: string }[];
}

interface DetailData {
  tables: TableHandle[];
}

const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;

function DataTablesRoute() {
  const detail = useHostOpDynamic("revit.detail.data-tables", {});
  const tables = (detail.data as DetailData | undefined)?.tables ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const openTable = (handle: TableHandle) => {
    setNote(null);
    setDraft({
      name: handle.name,
      isNew: false,
      columns: handle.columns.map((c) => ({ heading: c.heading, kind: c.kind })),
      rows: handle.rows.map((r) => ({ key: r.key, values: [...r.values] })),
    });
  };

  const newTable = () => {
    setNote(null);
    setDraft({
      name: "New Table",
      isNew: true,
      columns: [{ heading: "Column 1", kind: "Text" }],
      rows: [{ key: rowKey(), values: [null] }],
    });
  };

  const applyDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setNote(null);
    try {
      const result = (await callHostDynamic("revit.apply.schedule", {
        table: {
          name: draft.name,
          columns: draft.columns,
          rows: draft.rows,
          pruneMissingRows: true,
        },
      })) as { warnings?: string[] };
      setNote(result.warnings?.length ? result.warnings.join(" · ") : "Applied.");
      setDraft((d) => (d ? { ...d, isNew: false } : d));
      await detail.refetch();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "Apply failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 pb-2 pt-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="font-pe-display text-lg font-semibold tracking-tight">Data Tables</h1>
          <span className="tele text-muted-foreground">
            {draft ? `${draft.columns.length}×${draft.rows.length}` : "synthetic key schedules"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {draft && (
            <Button size="sm" disabled={busy || draft.name.trim().length === 0} onClick={() => void applyDraft()}>
              {busy ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              {busy ? "Applying…" : "Apply to Revit"}
            </Button>
          )}
        </div>
      </header>
      {note && <p className="shrink-0 border-b border-border px-4 py-1 text-xs text-muted-foreground">{note}</p>}

      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="data-tables:rail"
          minWidth={200}
          defaultWidth={248}
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="section-label">
                Tables
                <span className="tele ml-1.5 normal-case text-muted-foreground">{tables.length}</span>
              </span>
              <span className="flex items-center">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="Re-read data tables"
                  disabled={detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  {detail.isFetching ? <Loader2 className="animate-spin" /> : <List />}
                </Button>
                <Button size="icon-sm" variant="ghost" title="New table" onClick={newTable}>
                  <Plus />
                </Button>
              </span>
            </div>
          }
        >
          <PickList
            items={tables.map((t) => ({
              id: t.name,
              label: t.name,
              meta: `${t.columns.length}×${t.rows.length}`,
              hint: t.placements.length > 0 ? `on ${t.placements.map((p) => p.sheetNumber).join(", ")}` : undefined,
            }))}
            activeId={draft && !draft.isNew ? draft.name : null}
            onPick={(id) => {
              const handle = tables.find((t) => t.name === id);
              if (handle) openTable(handle);
            }}
            placeholder="Filter tables…"
            emptyNote={detail.isLoading ? "Reading…" : "No data tables yet — create one."}
            className="h-full"
          />
        </SidePane>

        <section className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
          {draft ? (
            <DraftEditor draft={draft} setDraft={setDraft} />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <p className="text-sm text-foreground">Pick a table from the rail, or create one</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Data tables are freely editable key schedules whose cells stay addressable by row
                  key. Apply upserts by name + row key.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ── the draft editor — one dense hairline grid, headers editable in place ──── */

function DraftEditor({
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
      <div className="flex items-center gap-2">
        <Input
          value={draft.name}
          onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))}
          className="h-8 max-w-72 font-medium"
          placeholder="Table name"
        />
        {!draft.isNew && (
          <span className="text-[11px] text-muted-foreground">
            renaming creates a new table — applies upsert by name
          </span>
        )}
      </div>

      <div className="inline-block max-w-full overflow-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-border bg-muted" />
              {draft.columns.map((column, columnIndex) => (
                <th key={columnIndex} className="min-w-36 border-b border-l border-border bg-muted px-1.5 py-1 text-left">
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
                      className="tele-label h-6 rounded-none border-transparent bg-transparent px-1 font-normal hover:border-border"
                    />
                    <select
                      value={column.kind}
                      title="Column type"
                      className="tele h-6 rounded-[var(--radius)] border border-transparent bg-transparent text-muted-foreground hover:border-border"
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
                    <button
                      type="button"
                      title="Remove column"
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                      disabled={draft.columns.length === 1}
                      onClick={() => removeColumn(columnIndex)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="border-b border-l border-border bg-muted px-1">
                <Button size="icon-sm" variant="ghost" title="Add column" onClick={addColumn}>
                  <Plus />
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => (
              <tr key={row.key}>
                <td
                  className="tele whitespace-nowrap border-b border-[var(--line-soft)] px-2 py-1 text-right text-muted-foreground"
                  title={`row key: ${row.key}`}
                >
                  {rowIndex + 1}
                </td>
                {draft.columns.map((column, columnIndex) => (
                  <td key={columnIndex} className="border-b border-l border-[var(--line-soft)] p-0">
                    <input
                      value={row.values[columnIndex] ?? ""}
                      placeholder={column.kind === "Number" ? "0" : ""}
                      inputMode={column.kind === "Number" ? "decimal" : undefined}
                      onChange={(e) => setCell(rowIndex, columnIndex, e.target.value)}
                      className={cn(
                        "tele h-7 w-full min-w-36 bg-transparent px-2 outline-none focus:bg-primary/5",
                        column.kind === "Number" && "text-right",
                      )}
                    />
                  </td>
                ))}
                <td className="border-b border-l border-[var(--line-soft)] px-1 text-center">
                  <button
                    type="button"
                    title="Remove row (deleted in Revit on apply)"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(rowIndex)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={draft.columns.length + 2} className="px-1 py-0.5">
                <Button size="sm" variant="ghost" onClick={addRow}>
                  <Plus /> Add row
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

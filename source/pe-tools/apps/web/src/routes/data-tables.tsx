import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, List, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Input } from "#/components/ui/input";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { callHostDynamic } from "#/host/client";
import { useHostOpDynamic } from "#/host/queries";
import { useVerb } from "#/lib/use-verb";
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
  const verb = useVerb();

  const openTable = (handle: TableHandle) => {
    verb.setError(null);
    setDraft({
      name: handle.name,
      isNew: false,
      columns: handle.columns.map((c) => ({ heading: c.heading, kind: c.kind })),
      rows: handle.rows.map((r) => ({ key: r.key, values: [...r.values] })),
    });
  };

  const newTable = () => {
    verb.setError(null);
    setDraft({
      name: "New Table",
      isNew: true,
      columns: [{ heading: "Column 1", kind: "Text" }],
      rows: [{ key: rowKey(), values: [null] }],
    });
  };

  const applyDraft = () =>
    verb.run("apply", async () => {
      if (!draft) return;
      const result = (await callHostDynamic("revit.apply.schedule", {
        table: {
          name: draft.name,
          columns: draft.columns,
          rows: draft.rows,
          pruneMissingRows: true,
        },
      })) as { warnings?: string[] };
      setDraft((d) => (d ? { ...d, isNew: false } : d));
      await detail.refetch();
      if (result.warnings?.length) {
        verb.fail("advisory", result.warnings.join(" · "));
        return;
      }
      return `applied — ${draft.name} upserted (${draft.columns.length}×${draft.rows.length})`;
    });

  const applyReason = !draft
    ? "open or create a table first"
    : draft.name.trim().length === 0
      ? "name the table first — apply upserts by name"
      : "Upsert this draft into Revit by name + row key; rows missing from the draft are pruned";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <AddressingBar
        name="DATA TABLES"
        sentence={
          <span className="flex items-center gap-2">
            <span className="t-value face-mono text-foreground">
              {draft ? draft.name : "no table open"}
            </span>
            <HelpTip>
              Data tables are freely editable key schedules whose cells stay addressable by a stable
              row key. Apply upserts by table name + row key, and prunes rows the draft no longer
              carries — deleting a row here deletes it in Revit.
            </HelpTip>
          </span>
        }
        facts={
          draft ? (
            <FactChip title="columns × rows in the open draft">
              {draft.columns.length}×{draft.rows.length}
            </FactChip>
          ) : undefined
        }
        verb={
          <Verb
            tone="commit"
            label="apply to revit"
            icon={CheckCheck}
            busy={verb.busy === "apply"}
            disabled={!draft || draft.name.trim().length === 0}
            onClick={() => void applyDraft()}
            reason={applyReason}
          />
        }
      />
      {(verb.busy || verb.outcome || verb.receipt) && (
        <div className="shrink-0 border-b border-border px-4 py-0.5">
          {verb.busy ? (
            <OutcomeLine kind="busy" label={`${verb.busy} · ${verb.seconds}s`} />
          ) : verb.outcome ? (
            <OutcomeLine kind={verb.outcome.kind} label={verb.outcome.text} />
          ) : verb.receipt ? (
            <OutcomeLine kind="receipt" label={verb.receipt.text} />
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="data-tables:rail"
          minWidth={200}
          defaultWidth={248}
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="t-label t-upper text-muted-foreground">
                Tables{" "}
                <span className="t-label face-mono normal-case font-normal">{tables.length}</span>
              </span>
              <span className="flex items-center gap-1">
                <Verb
                  label="re-read"
                  icon={List}
                  busy={detail.isFetching}
                  onClick={() => void detail.refetch()}
                  reason="Re-read every data table from the document"
                />
                <Verb
                  label="new"
                  icon={Plus}
                  onClick={newTable}
                  reason="Start a blank draft — nothing exists in Revit until apply"
                />
              </span>
            </div>
          }
        >
          <PickList
            items={tables.map((t) => ({
              id: t.name,
              label: t.name,
              meta: `${t.columns.length}×${t.rows.length}`,
              hint:
                t.placements.length > 0
                  ? `on ${t.placements.map((p) => p.sheetNumber).join(", ")}`
                  : undefined,
            }))}
            activeId={draft && !draft.isNew ? draft.name : null}
            onPick={(id) => {
              const handle = tables.find((t) => t.name === id);
              if (handle) openTable(handle);
            }}
            placeholder="Filter tables…"
            emptyNote={
              detail.isLoading ? (
                <OutcomeLine kind="busy" label="reading data tables" />
              ) : (
                <EmptyState story="scope" exit="create one with the new verb above">
                  no data tables in this document
                </EmptyState>
              )
            }
            className="h-full"
          />
        </SidePane>

        <section className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
          {draft ? (
            <DraftEditor draft={draft} setDraft={setDraft} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                story="scope"
                exit="pick a table from the rail, or start one with the new verb"
                className="text-center"
              >
                no table open
              </EmptyState>
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

      {/* The draft grid is the machine-operated object this route exists to edit —
          it carries the state apply will write, so it takes the one enclosure. */}
      <ArtifactFrame className="inline-block max-w-full overflow-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="border-b border-border bg-[var(--r-recess)]" />
              {draft.columns.map((column, columnIndex) => (
                <th
                  key={columnIndex}
                  className="min-w-36 border-b border-l border-border bg-[var(--r-recess)] px-1.5 py-1 text-left"
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
                      className="t-label h-6 rounded-none border-transparent bg-transparent px-1 font-normal hover:border-border"
                      title="Column heading — written to the schedule on apply"
                    />
                    <select
                      value={column.kind}
                      title="Column type: txt = Text, num = Number"
                      className="t-caption face-mono h-6 rounded-[var(--radius)] border border-transparent bg-transparent text-muted-foreground hover:border-border"
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
                      title={
                        draft.columns.length === 1
                          ? "a table keeps at least one column"
                          : "Remove this column and its values from the draft"
                      }
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={draft.columns.length === 1}
                      onClick={() => removeColumn(columnIndex)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="border-b border-l border-border bg-[var(--r-recess)] px-1">
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
                  className="t-caption face-mono whitespace-nowrap border-b border-border px-2 py-1 text-right text-muted-foreground"
                  title={`row key: ${row.key} — the stable address apply upserts by`}
                >
                  {rowIndex + 1}
                </td>
                {draft.columns.map((column, columnIndex) => (
                  <td key={columnIndex} className="border-b border-l border-border p-0">
                    <input
                      value={row.values[columnIndex] ?? ""}
                      placeholder={column.kind === "Number" ? "0" : ""}
                      inputMode={column.kind === "Number" ? "decimal" : undefined}
                      onChange={(e) => setCell(rowIndex, columnIndex, e.target.value)}
                      className={cn(
                        "t-value face-mono h-7 w-full min-w-36 bg-transparent px-2 outline-none focus:bg-[var(--r-select)]",
                        column.kind === "Number" && "text-right",
                      )}
                    />
                  </td>
                ))}
                <td className="border-b border-l border-border px-1 text-center">
                  <button
                    type="button"
                    title="Remove this row — it is deleted in Revit on apply"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeRow(rowIndex)}
                  >
                    <Trash2 className="size-3" />
                  </button>
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

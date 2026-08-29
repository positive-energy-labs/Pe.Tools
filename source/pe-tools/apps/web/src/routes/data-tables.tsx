import { useAtomValue } from "@effect/atom-react";
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
import { callHostRpc } from "#/host/client";
import { useHostOp } from "#/host/queries";
import { cn } from "#/lib/utils";
import { appAtomRegistry } from "#/state/registry";
import { createRouteStoreCore, fail } from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";
import { VerbLane } from "#/components/verb-lane";
import { Press } from "#/components/lang/press";

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

const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;

function DataTablesRoute() {
  const detail = useHostOp("revit.detail.data-tables", {});
  const tables = detail.data?.tables ?? [];

  const [draft, setDraft] = useState<Draft | null>(null);
  const store = useRouteStore(() => createRouteStoreCore("data-tables", appAtomRegistry));
  const busy = useAtomValue(store.busy)?.id ?? null;
  const clearFailure = () => store.registry.set(store.failure, null);

  const openTable = (handle: TableHandle) => {
    clearFailure();
    setDraft({
      name: handle.name,
      isNew: false,
      columns: handle.columns.map((c) => ({ heading: c.heading, kind: c.kind })),
      rows: handle.rows.map((r) => ({ key: r.key, values: [...r.values] })),
    });
  };

  const newTable = () => {
    clearFailure();
    setDraft({
      name: "New Table",
      isNew: true,
      columns: [{ heading: "Column 1", kind: "Text" }],
      rows: [{ key: rowKey(), values: [null] }],
    });
  };

  const applyDraft = () =>
    void store
      .runVerb("apply", async () => {
        if (!draft) return;
        const result = await callHostRpc("revit.apply.schedule", {
          table: {
            name: draft.name,
            columns: draft.columns,
            rows: draft.rows,
            pruneMissingRows: true,
          },
        });
        setDraft((d) => (d ? { ...d, isNew: false } : d));
        await detail.refetch();
        if (result.warnings?.length) return fail(result.warnings.join(" · "), "advisory");
        return `applied — ${draft.name} upserted (${draft.columns.length}×${draft.rows.length})`;
      })
      .catch(() => undefined);

  const applyReason = !draft
    ? "open or create a table first"
    : draft.name.trim().length === 0
      ? "name the table first — apply upserts by name"
      : "Upsert this draft into Revit by name + row key; rows missing from the draft are pruned";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-page">
      <AddressingBar
        name="data tables"
        sentence={
          <span>
            <span className="t-value face-mono text-ink">
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
            busy={busy === "apply"}
            disabled={!draft || draft.name.trim().length === 0}
            onClick={() => applyDraft()}
            reason={applyReason}
          />
        }
      />
      <div className="shrink-0 border-b border-line empty:border-0">
        <VerbLane atoms={store.verbAtoms} />
      </div>

      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="data-tables:rail"
          minWidth={200}
          defaultWidth={248}
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="t-label t-upper text-ink-2">
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
                      state="disabled-faint"
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

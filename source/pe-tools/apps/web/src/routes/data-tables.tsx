import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, List, Plus } from "lucide-react";
import { useState } from "react";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { callHostRpc } from "#/host/client";
import { useHostOp } from "#/host/queries";
import { appAtomRegistry } from "#/state/registry";
import { createRouteStoreCore, fail } from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";
import { VerbLane } from "#/components/verb-lane";
import { DraftEditor } from "#/data-tables/draft-editor";

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

export type ColumnKind = "Text" | "Number";

export interface Draft {
  name: string;
  isNew: boolean;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
}

export interface TableHandle {
  name: string;
  scheduleId: number;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
  placements: { sheetNumber: string }[];
}

export const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;

export function DataTablesRoute() {
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

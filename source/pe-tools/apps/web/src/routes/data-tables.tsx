import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, List, Plus } from "lucide-react";
import { useState } from "react";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { PickList } from "#/components/lang/pick-list";
import { SidePane } from "#/components/lang/side-pane";
import { callHostRpc } from "#/host/client";
import { useHostOp } from "#/readings";
import { RouteShell, appAtomRegistry, emptyManifest } from "#/route";
import { createRouteOwner, refuse } from "#/route";
import { useRouteOwner } from "#/route";
import { DraftEditor } from "#/data-tables/draft-editor";

/**
 * /data-tables — author synthetic data tables (revit.apply.schedule table lane).
 * Rail lists existing tables (revit.detail.data-tables); the editor drafts name,
 * columns (heading + Text/Number kind), and rows (stable key + cell values), then
 * upserts in one apply. Missing rows are pruned on apply, so deleting a row here
 * deletes it in Revit.
 */
export const dataTablesSearch = (_search: Record<string, unknown>) => ({});

/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
export const manifest = emptyManifest("data-tables", "Data Tables");

function RouteShelledDataTablesFileRoute() {
  return (
    <RouteShell manifest={manifest}>
      <DataTablesFileRoute />
    </RouteShell>
  );
}

export const Route = createFileRoute("/data-tables")({
  validateSearch: dataTablesSearch,
  component: RouteShelledDataTablesFileRoute,
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

const draftFrom = (table: TableHandle): Draft => ({
  name: table.name,
  isNew: false,
  columns: table.columns.map((column) => ({ ...column })),
  rows: table.rows.map((row) => ({ key: row.key, values: [...row.values] })),
});

function DataTablesFileRoute() {
  return <DataTablesRoute />;
}

export function DataTablesRoute() {
  return <LiveDataTablesRoute />;
}

function LiveDataTablesRoute() {
  const detail = useHostOp("revit.detail.data-tables", {});
  return (
    <DataTablesWorkspace
      tables={detail.data?.tables ?? []}
      isLoading={detail.isLoading}
      isFetching={detail.pending}
      onRefetch={async () => detail.refresh()}
      onApply={async (draft) => {
        const result = await callHostRpc("revit.apply.schedule", {
          table: {
            name: draft.name,
            columns: draft.columns,
            rows: draft.rows,
            pruneMissingRows: true,
          },
        });
        return result.warnings ?? [];
      }}
    />
  );
}

function DataTablesWorkspace({
  tables,
  initialDraft = null,
  isLoading = false,
  isFetching = false,
  onRefetch,
  onApply,
}: {
  tables: TableHandle[];
  initialDraft?: Draft | null;
  isLoading?: boolean;
  isFetching?: boolean;
  onRefetch?: () => Promise<void>;
  onApply?: (draft: Draft) => Promise<string[]>;
}) {
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const store = useRouteOwner(() => createRouteOwner("data-tables", appAtomRegistry));
  const busy = useAtomValue(store.busy)?.key ?? null;
  const clearFailure = () => store.registry.set(store.failure, null);

  const openTable = (handle: TableHandle) => {
    clearFailure();
    setDraft(draftFrom(handle));
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
      .runAction("apply", async () => {
        if (!draft || !onApply) return null;
        const warnings = await onApply(draft);
        setDraft((d) => (d ? { ...d, isNew: false } : d));
        await onRefetch?.();
        if (warnings.length) return refuse("partial", warnings.join(" · "));
        return null;
      })
      .catch(() => undefined);

  const applyReason = !onApply
    ? "fixture review — apply to Revit is unavailable"
    : !draft
      ? "open or create a table first"
      : draft.name.trim().length === 0
        ? "name the table first — apply upserts by name"
        : "Upsert this draft into Revit by name + row key; rows missing from the draft are pruned";

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <AddressingBar
        name="data tables"
        sentence={
          <span>
            <span>{draft ? draft.name : "no table open"}</span>
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
          <ActionButton
            tone="commit"
            label="apply to revit"
            icon={CheckCheck}
            busy={busy === "apply"}
            disabled={!onApply || !draft || draft.name.trim().length === 0}
            onClick={() => applyDraft()}
            reason={applyReason}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="data-tables:rail"
          minWidth={200}
          defaultWidth={248}
          header={
            <div className="flex items-center justify-between gap-2">
              <Tag>tables · {tables.length}</Tag>
              <span className="flex items-center gap-1">
                <ActionButton
                  label="re-read"
                  icon={List}
                  busy={isFetching}
                  disabled={!onRefetch}
                  onClick={() => void onRefetch?.()}
                  reason={
                    onRefetch
                      ? "Re-read every data table from the document"
                      : "fixture data is already loaded locally"
                  }
                />
                <ActionButton
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
              isLoading ? (
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

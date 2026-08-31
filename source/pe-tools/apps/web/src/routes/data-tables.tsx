import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, List, Plus } from "lucide-react";
import { useState } from "react";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip, Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { PickList } from "#/components/lang/pick-list";
import { SidePane } from "#/components/lang/side-pane";
import { callHostRpc } from "#/host/client";
import { useHostOp } from "#/host/queries";
import { appAtomRegistry } from "#/state/registry";
import { createRouteStoreCore, fail } from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";
import { VerbLane } from "#/components/lang/verb-lane";
import { DraftEditor } from "#/data-tables/draft-editor";

/**
 * /data-tables — author synthetic data tables (revit.apply.schedule table lane).
 * Rail lists existing tables (revit.detail.data-tables); the editor drafts name,
 * columns (heading + Text/Number kind), and rows (stable key + cell values), then
 * upserts in one apply. Missing rows are pruned on apply, so deleting a row here
 * deletes it in Revit.
 */
export const dataTablesSearch = (search: Record<string, unknown>) => ({
  source: search.source === "fixture" ? ("fixture" as const) : undefined,
});

export const Route = createFileRoute("/data-tables")({
  validateSearch: dataTablesSearch,
  component: DataTablesFileRoute,
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

const FIXTURE_TABLES: TableHandle[] = [
  {
    name: "Air Terminal Schedule",
    scheduleId: 41001,
    columns: [
      { heading: "Mark", kind: "Text" },
      { heading: "Type", kind: "Text" },
      { heading: "Level", kind: "Text" },
      { heading: "Airflow", kind: "Number" },
      { heading: "Neck Size", kind: "Text" },
      { heading: "System", kind: "Text" },
    ],
    rows: [
      { key: "at-101", values: ["SA-101", "4-way ceiling", "Level 1", "325", "10x10", "SA-1"] },
      { key: "at-102", values: ["SA-102", "Linear slot", "Level 1", "180", "8x8", "SA-1"] },
      { key: "at-103", values: ["RA-101", "Eggcrate return", "Level 1", "450", "14x14", "RA-1"] },
      { key: "at-201", values: ["SA-201", "4-way ceiling", "Level 2", "400", "12x12", "SA-2"] },
      { key: "at-202", values: ["SA-202", "Linear slot", "Level 2", "225", "8x10", "SA-2"] },
      { key: "at-203", values: ["EA-201", "Exhaust grille", "Level 2", "110", "8x8", "EA-2"] },
    ],
    placements: [{ sheetNumber: "M601" }],
  },
  {
    name: "Hydronic Design Points",
    scheduleId: 41002,
    columns: [
      { heading: "Loop", kind: "Text" },
      { heading: "Service", kind: "Text" },
      { heading: "Flow GPM", kind: "Number" },
      { heading: "Head ft", kind: "Number" },
    ],
    rows: [
      { key: "chw-primary", values: ["CHW-P", "Primary chilled water", "380", "54"] },
      { key: "chw-secondary", values: ["CHW-S", "Secondary chilled water", "425", "72"] },
      { key: "hhw-primary", values: ["HHW-P", "Heating hot water", "190", "48"] },
    ],
    placements: [{ sheetNumber: "M602" }],
  },
];

function DataTablesFileRoute() {
  const { source } = Route.useSearch();
  return <DataTablesRoute source={source} />;
}

export function DataTablesRoute({ source }: { source?: "fixture" }) {
  return source === "fixture" ? (
    <DataTablesWorkspace tables={FIXTURE_TABLES} initialDraft={draftFrom(FIXTURE_TABLES[0])} />
  ) : (
    <LiveDataTablesRoute />
  );
}

function LiveDataTablesRoute() {
  const detail = useHostOp("revit.detail.data-tables", {});
  return (
    <DataTablesWorkspace
      tables={detail.data?.tables ?? []}
      isLoading={detail.isLoading}
      isFetching={detail.isFetching}
      onRefetch={async () => void (await detail.refetch())}
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
  const store = useRouteStore(() => createRouteStoreCore("data-tables", appAtomRegistry));
  const busy = useAtomValue(store.busy)?.id ?? null;
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
      .runVerb("apply", async () => {
        if (!draft || !onApply) return;
        const warnings = await onApply(draft);
        setDraft((d) => (d ? { ...d, isNew: false } : d));
        await onRefetch?.();
        if (warnings.length) return fail(warnings.join(" · "), "advisory");
        return `applied — ${draft.name} upserted (${draft.columns.length}×${draft.rows.length})`;
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
          <Verb
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
      <div className="shrink-0">
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
              <Tag>tables · {tables.length}</Tag>
              <span className="flex items-center gap-1">
                <Verb
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

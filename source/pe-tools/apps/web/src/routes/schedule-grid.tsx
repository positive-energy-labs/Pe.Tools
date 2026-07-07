import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { HostConnectionPill, HostIssuePanel, toHostIssue } from "#/host/issues";
import { useHostOpDynamic, useHostStatusQuery } from "#/host/queries";
import { cn } from "#/lib/utils";

// THROWAWAY debug route for the schedule cell-binding surface (projection.includeBindings).
// Exists to find shape and bugs before the real schedule editor route; delete it after.
// Types are hand-authored loose mirrors of the v37 wire shape — the checked-in generated
// contracts lag until the live host runs v37 (see host-typegen).

type CatalogEntry = {
  scheduleId: number;
  name: string;
  categoryName?: string | null;
  visibleBodyRowCount: number;
};

type CellBinding = {
  columnNumber: number;
  targetElementIds: number[];
  parameterName?: string | null;
  parameterId?: number | null;
  storageType: string;
  rawValue?: string | null;
  displayValue?: string | null;
  isTypeParameter: boolean;
  isEditable: boolean;
  blocker: string;
  hasMixedValues: boolean;
};

type RenderedRow = {
  rowNumber: number;
  kind: string;
  values: string[];
  resolutionStatus: string;
  resolutionReason: string;
  subjectIds: number[];
  bindings?: CellBinding[] | null;
};

type RenderedColumn = {
  columnNumber: number;
  headerText: string;
  fieldName: string;
  isCalculated: boolean;
  isCombinedParameter: boolean;
};

type ScheduleEntry = {
  scheduleId: number;
  scheduleName: string;
  bindingStatus: string;
  boundRowCount: number;
  unboundRowCount: number;
  nonBindableRowCount: number;
  visibleBodyRowCount: number;
  columns: RenderedColumn[];
  rows: RenderedRow[];
};

export const Route = createFileRoute("/schedule-grid")({
  component: ScheduleGridRoute,
});

function ScheduleGridRoute() {
  const [selectedId, setSelectedId] = useState<number | undefined>();

  const statusQuery = useHostStatusQuery();
  const bridgeConnected =
    (statusQuery.data as { bridgeIsConnected?: boolean } | undefined)?.bridgeIsConnected ?? false;

  const catalogQuery = useHostOpDynamic(
    "revit.catalog.schedules",
    { budget: { maxEntries: 500 } },
    { enabled: bridgeConnected, staleTime: 60_000 },
  );
  const catalogEntries = (
    (catalogQuery.data as { entries?: CatalogEntry[] } | undefined)?.entries ?? []
  )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const detailQuery = useHostOpDynamic(
    "revit.detail.schedules",
    {
      query: {
        kind: "ScheduleReferences",
        scheduleIds: selectedId === undefined ? [] : [selectedId],
        projection: { view: "Full", includeBindings: true },
        budget: { maxEntries: 1, maxRowsPerEntry: 200 },
      },
    },
    { enabled: bridgeConnected && selectedId !== undefined, staleTime: 10_000 },
  );
  const entry = (detailQuery.data as { entries?: ScheduleEntry[] } | undefined)?.entries?.[0];
  const issue = detailQuery.isError
    ? toHostIssue(detailQuery.error, "Schedule detail failed")
    : catalogQuery.isError
      ? toHostIssue(catalogQuery.error, "Schedule catalog failed")
      : undefined;

  return (
    <main className="page-wrap grid min-h-screen grid-cols-[18rem_1fr] gap-4 px-4 py-6">
      <aside className="flex flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold">Schedule Grid (debug)</h1>
          <HostConnectionPill connected={bridgeConnected} />
        </div>
        <p className="text-xs text-muted-foreground">
          {catalogEntries.length} schedules · cell bindings probe
        </p>
        <ul className="flex flex-col gap-0.5 text-sm">
          {catalogEntries.map((item) => (
            <li key={item.scheduleId}>
              <button
                type="button"
                onClick={() => setSelectedId(item.scheduleId)}
                className={cn(
                  "w-full rounded-md px-2 py-1 text-left hover:bg-muted",
                  item.scheduleId === selectedId && "bg-muted font-medium",
                )}
              >
                {item.name}
                <span className="ml-1 text-xs text-muted-foreground">
                  {item.visibleBodyRowCount}r
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="text-sm">
            {entry ? (
              <>
                <span className="font-semibold">{entry.scheduleName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  binding {entry.bindingStatus} · {entry.boundRowCount} bound ·{" "}
                  {entry.unboundRowCount} unbound · {entry.nonBindableRowCount} non-bindable ·{" "}
                  {entry.visibleBodyRowCount} rows
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Select a schedule</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void detailQuery.refetch()}
            disabled={detailQuery.isFetching || selectedId === undefined}
          >
            <RefreshCw className={cn("size-3.5", detailQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {issue ? <HostIssuePanel issue={issue} /> : null}
        {detailQuery.isFetching ? (
          <p className="text-sm text-muted-foreground">Loading rows + bindings…</p>
        ) : null}

        {entry ? (
          <div className="overflow-auto rounded-xl border border-border bg-background">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="border-b border-border/60 px-2 py-1.5 font-semibold">Row</th>
                  {entry.columns.map((column) => (
                    <th
                      key={column.columnNumber}
                      className="border-b border-l border-border/40 px-2 py-1.5 font-semibold"
                    >
                      {column.headerText}
                      {column.isCalculated ? <ColumnBadge label="calc" /> : null}
                      {column.isCombinedParameter ? <ColumnBadge label="comb" /> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entry.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={cn(
                      "border-b border-border/30",
                      row.resolutionStatus !== "Bound" && "opacity-50",
                    )}
                  >
                    <td
                      className="whitespace-nowrap px-2 py-1 text-muted-foreground"
                      title={`${row.resolutionStatus} (${row.resolutionReason}) subjects=[${row.subjectIds.join(",")}]`}
                    >
                      {row.rowNumber} {row.kind === "GroupFooter" ? "ƒ" : ""}
                      {row.subjectIds.length > 1 ? ` ×${row.subjectIds.length}` : ""}
                    </td>
                    {entry.columns.map((column, columnIndex) => (
                      <BindingCell
                        key={column.columnNumber}
                        text={row.values[columnIndex] ?? ""}
                        binding={row.bindings?.find(
                          (item) => item.columnNumber === column.columnNumber,
                        )}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ColumnBadge({ label }: { label: string }) {
  return (
    <span className="ml-1 rounded border border-[var(--cat-clay)]/25 bg-[var(--cat-clay)]/12 px-1 text-[10px] text-[var(--cat-clay)]">
      {label}
    </span>
  );
}

function BindingCell({ text, binding }: { text: string; binding?: CellBinding }) {
  const tooltip = binding
    ? [
        `param: ${binding.parameterName ?? "—"} (${binding.parameterId ?? "—"})`,
        `storage: ${binding.storageType}`,
        `raw: ${binding.rawValue ?? "—"}`,
        `targets: [${binding.targetElementIds.join(",")}]`,
        `blocker: ${binding.blocker}`,
      ].join("\n")
    : "no binding (row unbound or bindings off)";
  return (
    <td className="border-l border-border/20 px-2 py-1 align-top" title={tooltip}>
      <span className="whitespace-pre-wrap">{text}</span>
      {binding ? (
        <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              binding.isEditable ? "bg-[var(--cat-green)]" : "bg-[var(--cat-slate)]/50",
            )}
          />
          {binding.isTypeParameter ? (
            <span className="text-[10px] font-semibold text-[var(--cat-blue)]">T</span>
          ) : null}
          {binding.hasMixedValues ? (
            <span className="text-[10px] font-semibold text-[var(--cat-kiln)]">M</span>
          ) : null}
        </span>
      ) : null}
    </td>
  );
}

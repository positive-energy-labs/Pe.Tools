import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Circle,
  Filter,
  LayoutGrid,
  List,
  RefreshCw,
  Table as TableIcon,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Tooltip, UiTooltipProvider } from "#/components/ui/tooltip";
import {
  type LoadedFamiliesRequest,
  type LoadedFamilyMatrixFamily,
  LoadedFamilyPlacementScope,
  type LoadedFamilyVisibleParameterEntry,
} from "#/host/loaded-families-view";
import {
  useBridgeSessionsListQuery,
  useBridgeSessionSummaryQuery,
  useHostStatusQuery,
  useLoadedFamiliesCatalogQuery,
  useLoadedFamiliesMatrixQuery,
} from "#/host/queries";
import { HostConnectionPill, HostIssuePanel, toHostIssue } from "#/host/issues";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/family-matrix")({
  component: FamilyMatrixRoute,
});

type ViewMode = "spreadsheet" | "grouped";
type GroupByMode = "none" | "group" | "kind" | "scope";
type SortDirection = "asc" | "desc";
type ColumnSortMode = "clustered" | "custom";
const DEFAULT_SESSION_VALUE = "__host_default__";

interface SortLayer {
  columnKey: string;
  direction: SortDirection;
}

interface MasterTableRow {
  familyName: string;
  familyUniqueId: string;
  categoryName: string;
  typeName: string;
  rowKey: string;
  scheduleNames: readonly string[];
  valuesByParam: Record<string, string>;
  scopeByParam: Record<string, LoadedFamilyVisibleParameterEntry["scope"]>;
  formulaStateByParam: Record<string, LoadedFamilyVisibleParameterEntry["formulaState"]>;
  isFirstInFamily: boolean;
  familyTypeCount: number;
}

interface ParameterColumnDef {
  key: string;
  name: string;
  kind: LoadedFamilyVisibleParameterEntry["kind"];
  isInstance: boolean;
  formulaState: LoadedFamilyVisibleParameterEntry["formulaState"];
  identityKind: LoadedFamilyVisibleParameterEntry["identity"]["kind"];
  familyCount: number;
  totalOccurrences: number;
}

type ParameterGroup = "builtin" | "common" | "uncommon";

function getParameterGroup(col: ParameterColumnDef, totalFamilies: number): ParameterGroup {
  if (col.identityKind === "BuiltInParameter") {
    return "builtin";
  }
  const commonThreshold = Math.max(2, totalFamilies * 0.3);
  if (col.familyCount >= commonThreshold) {
    return "common";
  }
  return "uncommon";
}

function getParameterGroupOrder(group: ParameterGroup): number {
  switch (group) {
    case "builtin":
      return 0;
    case "common":
      return 1;
    case "uncommon":
      return 2;
  }
}

function isProjectOnlyParameterColumn(col: ParameterColumnDef): boolean {
  return col.kind === "ProjectParameter";
}

function sortColumnsClusteredMode(
  columns: ParameterColumnDef[],
  totalFamilies: number,
): ParameterColumnDef[] {
  return [...columns].sort((a, b) => {
    const aProj = isProjectOnlyParameterColumn(a) ? 1 : 0;
    const bProj = isProjectOnlyParameterColumn(b) ? 1 : 0;
    if (aProj !== bProj) {
      return aProj - bProj;
    }

    const groupA = getParameterGroup(a, totalFamilies);
    const groupB = getParameterGroup(b, totalFamilies);
    const groupOrderDiff = getParameterGroupOrder(groupA) - getParameterGroupOrder(groupB);
    if (groupOrderDiff !== 0) return groupOrderDiff;

    if (groupA === "common" && groupB === "common") {
      const countDiff = b.familyCount - a.familyCount;
      if (countDiff !== 0) return countDiff;
    }

    return a.name.localeCompare(b.name);
  });
}

function getCellStatusClass(
  scope: LoadedFamilyVisibleParameterEntry["scope"] | undefined,
  formulaState: LoadedFamilyVisibleParameterEntry["formulaState"] | undefined,
  hasValue: boolean,
): string {
  if (!scope || scope === "Unresolved") {
    return "bg-[var(--cat-kiln)]/10";
  }

  if (scope === "ProjectBindingOnly") {
    return "bg-[var(--cat-clay)]/10";
  }

  if (formulaState === "Present") {
    return "bg-[var(--cat-lichen)]/12";
  }

  if (scope === "Family" || scope === "FamilyAndProjectBinding") {
    return hasValue ? "bg-[var(--cat-green)]/10" : "";
  }

  return "";
}

function getCellBorderClass(scope: LoadedFamilyVisibleParameterEntry["scope"] | undefined): string {
  if (!scope || scope === "Unresolved") {
    return "border-l-2 border-l-[var(--cat-kiln)]/40";
  }
  if (scope === "ProjectBindingOnly") {
    return "border-l-2 border-l-[var(--cat-clay)]/45";
  }
  return "";
}

function getParameterDisplayName(
  param: LoadedFamilyVisibleParameterEntry | { identity: { name: string } },
): string {
  return param.identity.name;
}

function getKindLabel(kind: LoadedFamilyVisibleParameterEntry["kind"]): string {
  switch (kind) {
    case "FamilyParameter":
      return "Family";
    case "SharedParameter":
      return "Shared";
    case "ProjectParameter":
      return "Project";
    case "ProjectSharedParameter":
      return "Proj+Shared";
    default:
      return kind;
  }
}

function getKindBadgeClass(kind: LoadedFamilyVisibleParameterEntry["kind"]): string {
  switch (kind) {
    case "FamilyParameter":
      return "bg-[var(--cat-blue)]/12 text-[var(--cat-blue)] border-[var(--cat-blue)]/25";
    case "SharedParameter":
      return "bg-[var(--cat-lichen)]/12 text-[var(--cat-lichen)] border-[var(--cat-lichen)]/25";
    case "ProjectParameter":
      return "bg-[var(--cat-clay)]/12 text-[var(--cat-clay)] border-[var(--cat-clay)]/25";
    case "ProjectSharedParameter":
      return "bg-[var(--cat-green)]/12 text-[var(--cat-green)] border-[var(--cat-green)]/25";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getScopeLabel(isInstance: boolean): string {
  return isInstance ? "inst" : "type";
}

function getScopeBadgeClass(isInstance: boolean): string {
  return isInstance
    ? "bg-[var(--cat-slate)]/12 text-[var(--cat-slate)] border-[var(--cat-slate)]/25"
    : "bg-[var(--cat-kiln)]/12 text-[var(--cat-kiln)] border-[var(--cat-kiln)]/25";
}

function getExcludedReasonLabel(
  reason: LoadedFamilyMatrixFamily["excludedParameters"][number]["excludedReason"],
): string {
  switch (reason) {
    case "ProjectObservedBuiltIn":
      return "Project-observed built-in";
    case "UnresolvedClassification":
      return "Unresolved";
    default:
      return reason;
  }
}

function FormulaIndicator({
  state,
  formula,
}: {
  state: LoadedFamilyVisibleParameterEntry["formulaState"];
  formula: string;
}) {
  if (state === "None" || state === "NotApplicable") {
    return null;
  }

  return (
    <span
      className="ml-0.5 inline-flex size-3 items-center justify-center rounded-sm bg-[var(--cat-lichen)]/15 text-[8px] font-bold text-[var(--cat-lichen)]"
      title={formula || "Has formula"}
    >
      fx
    </span>
  );
}

function MasterSpreadsheetTable({ families }: { families: LoadedFamilyMatrixFamily[] }) {
  const [columnSortMode, setColumnSortMode] = useState<ColumnSortMode>("clustered");
  const [sortLayers, setSortLayers] = useState<SortLayer[]>([]);
  const [showUncommon, setShowUncommon] = useState(false);

  const { rows, columns, totalFamilies } = useMemo(() => {
    const paramMap = new Map<string, ParameterColumnDef & { familiesWithParam: Set<string> }>();
    const tableRows: MasterTableRow[] = [];

    for (const family of families) {
      for (const param of family.visibleParameters) {
        const parameterKey = param.identity.key;
        if (!paramMap.has(parameterKey)) {
          paramMap.set(parameterKey, {
            key: parameterKey,
            name: getParameterDisplayName(param),
            kind: param.kind,
            isInstance: param.isInstance,
            formulaState: param.formulaState,
            identityKind: param.identity.kind,
            familyCount: 0,
            totalOccurrences: 0,
            familiesWithParam: new Set(),
          });
        }
        const entry = paramMap.get(parameterKey);
        if (entry && !entry.familiesWithParam.has(family.familyUniqueId)) {
          entry.familiesWithParam.add(family.familyUniqueId);
          entry.familyCount++;
        }
        if (entry) {
          entry.totalOccurrences++;
        }
      }

      for (let typeIndex = 0; typeIndex < family.types.length; typeIndex++) {
        const type = family.types[typeIndex];
        const valuesByParam: Record<string, string> = {};
        const scopeByParam: Record<string, LoadedFamilyVisibleParameterEntry["scope"]> = {};
        const formulaStateByParam: Record<
          string,
          LoadedFamilyVisibleParameterEntry["formulaState"]
        > = {};

        for (const param of family.visibleParameters) {
          valuesByParam[param.identity.key] = param.valuesByType[type.typeName] ?? "";
          scopeByParam[param.identity.key] = param.scope;
          formulaStateByParam[param.identity.key] = param.formulaState;
        }

        tableRows.push({
          familyName: family.familyName,
          familyUniqueId: family.familyUniqueId,
          categoryName: family.categoryName,
          typeName: type.typeName,
          rowKey: `${family.familyUniqueId}::${type.typeName}`,
          scheduleNames: family.scheduleNames,
          valuesByParam,
          scopeByParam,
          formulaStateByParam,
          isFirstInFamily: typeIndex === 0,
          familyTypeCount: family.types.length,
        });
      }
    }

    const allColumns: ParameterColumnDef[] = Array.from(paramMap.values()).map(
      ({ familiesWithParam: _, ...rest }) => rest,
    );

    return { rows: tableRows, columns: allColumns, totalFamilies: families.length };
  }, [families]);

  const sortedColumns = useMemo(() => {
    if (columnSortMode === "clustered") {
      return sortColumnsClusteredMode(columns, totalFamilies);
    }
    return [...columns].sort((a, b) => {
      const aProj = isProjectOnlyParameterColumn(a) ? 1 : 0;
      const bProj = isProjectOnlyParameterColumn(b) ? 1 : 0;
      if (aProj !== bProj) {
        return aProj - bProj;
      }
      return a.name.localeCompare(b.name);
    });
  }, [columns, columnSortMode, totalFamilies]);

  const filteredColumns = useMemo(() => {
    if (showUncommon) return sortedColumns;
    return sortedColumns.filter((col) => getParameterGroup(col, totalFamilies) !== "uncommon");
  }, [sortedColumns, showUncommon, totalFamilies]);

  const sortedRows = useMemo(() => {
    if (sortLayers.length === 0) {
      return [...rows].sort((a, b) => {
        const familyCmp = a.familyName.localeCompare(b.familyName);
        if (familyCmp !== 0) return familyCmp;
        return a.typeName.localeCompare(b.typeName);
      });
    }

    return [...rows].sort((a, b) => {
      for (const layer of sortLayers) {
        let valA: string;
        let valB: string;

        if (layer.columnKey === "__family") {
          valA = a.familyName;
          valB = b.familyName;
        } else if (layer.columnKey === "__type") {
          valA = a.typeName;
          valB = b.typeName;
        } else if (layer.columnKey === "__category") {
          valA = a.categoryName;
          valB = b.categoryName;
        } else {
          valA = a.valuesByParam[layer.columnKey] ?? "";
          valB = b.valuesByParam[layer.columnKey] ?? "";
        }

        const cmp = valA.localeCompare(valB);
        if (cmp !== 0) {
          return layer.direction === "asc" ? cmp : -cmp;
        }
      }
      return 0;
    });
  }, [rows, sortLayers]);

  const handleColumnSort = useCallback((columnKey: string, event: React.MouseEvent) => {
    const shiftHeld = event.shiftKey;

    setSortLayers((prev) => {
      const existingIndex = prev.findIndex((l) => l.columnKey === columnKey);

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        if (existing.direction === "asc") {
          const updated = [...prev];
          updated[existingIndex] = { ...existing, direction: "desc" };
          return updated;
        }
        return prev.filter((_, i) => i !== existingIndex);
      }

      const newLayer: SortLayer = { columnKey, direction: "asc" };
      if (shiftHeld) {
        return [...prev, newLayer];
      }
      return [newLayer];
    });
  }, []);

  const getSortIndicator = useCallback(
    (columnKey: string) => {
      const layerIndex = sortLayers.findIndex((l) => l.columnKey === columnKey);
      if (layerIndex < 0) return null;

      const layer = sortLayers[layerIndex];
      return (
        <span className="ml-0.5 inline-flex items-center gap-px text-primary">
          {layer.direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )}
          {sortLayers.length > 1 && <span className="text-[8px] font-bold">{layerIndex + 1}</span>}
        </span>
      );
    },
    [sortLayers],
  );

  const clearSortLayers = useCallback(() => {
    setSortLayers([]);
  }, []);

  const uncommonCount = useMemo(
    () => columns.filter((c) => getParameterGroup(c, totalFamilies) === "uncommon").length,
    [columns, totalFamilies],
  );

  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
        No family types to display
      </div>
    );
  }

  return (
    <UiTooltipProvider>
      <div className="flex flex-col">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border/60 bg-muted/30 p-0.5">
              <Button
                variant={columnSortMode === "clustered" ? "default" : "ghost"}
                size="xs"
                onClick={() => setColumnSortMode("clustered")}
                title="Group columns: Builtins → Common → Uncommon"
              >
                <List className="mr-1 size-3" />
                Clustered
              </Button>
              <Button
                variant={columnSortMode === "custom" ? "default" : "ghost"}
                size="xs"
                onClick={() => setColumnSortMode("custom")}
                title="Alphabetical column order"
              >
                <ArrowUp className="mr-1 size-3" />
                Alphabetical
              </Button>
            </div>
            {sortLayers.length > 0 && (
              <Button variant="ghost" size="xs" onClick={clearSortLayers}>
                Clear sort ({sortLayers.length} layer
                {sortLayers.length !== 1 ? "s" : ""})
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {filteredColumns.length} of {columns.length} params
            </span>
            {uncommonCount > 0 && (
              <Button variant="ghost" size="xs" onClick={() => setShowUncommon(!showUncommon)}>
                {showUncommon ? `Hide ${uncommonCount} uncommon` : `Show ${uncommonCount} uncommon`}
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border/60 bg-background">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/70">
                  <th
                    className="sticky left-0 z-30 min-w-[160px] cursor-pointer border-r border-b border-border/60 bg-muted/80 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                    onClick={(e) => handleColumnSort("__family", e)}
                    title="Click to sort, Shift+click to stack"
                  >
                    <div className="flex items-center">
                      Family
                      {getSortIndicator("__family")}
                    </div>
                  </th>
                  <th
                    className="sticky left-[160px] z-30 min-w-[100px] cursor-pointer border-r border-b border-border/60 bg-muted/80 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted"
                    onClick={(e) => handleColumnSort("__type", e)}
                    title="Click to sort, Shift+click to stack"
                  >
                    <div className="flex items-center">
                      Type
                      {getSortIndicator("__type")}
                    </div>
                  </th>
                  <th
                    className="min-w-[90px] cursor-pointer border-r border-b border-border/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/50"
                    onClick={(e) => handleColumnSort("__category", e)}
                    title="Click to sort, Shift+click to stack"
                  >
                    <div className="flex items-center">
                      Category
                      {getSortIndicator("__category")}
                    </div>
                  </th>
                  {filteredColumns.map((col) => {
                    const group = getParameterGroup(col, totalFamilies);
                    return (
                      <th
                        key={col.key}
                        className={cn(
                          "min-w-[80px] max-w-[140px] cursor-pointer border-r border-b border-border/60 px-1.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50",
                          group === "builtin" && "bg-[var(--cat-blue)]/8",
                          group === "common" && "bg-[var(--cat-green)]/8",
                          group === "uncommon" && "bg-[var(--cat-kiln)]/10",
                        )}
                        title={`${col.name} (${getKindLabel(col.kind)}, ${col.isInstance ? "Instance" : "Type"}) — in ${col.familyCount} families. Click to sort, Shift+click to stack.`}
                        onClick={(e) => handleColumnSort(col.key, e)}
                      >
                        <div className="flex items-center gap-0.5">
                          <span className="truncate">{col.name}</span>
                          {getSortIndicator(col.key)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1">
                          <span
                            className={cn(
                              "inline-block whitespace-nowrap rounded px-0.5 py-px text-[7px] font-bold uppercase border",
                              getKindBadgeClass(col.kind),
                            )}
                          >
                            {getKindLabel(col.kind).slice(0, 3)}
                          </span>
                          <span
                            className={cn(
                              "inline-block whitespace-nowrap rounded px-0.5 py-px text-[7px] font-bold uppercase border",
                              getScopeBadgeClass(col.isInstance),
                            )}
                          >
                            {getScopeLabel(col.isInstance)}
                          </span>
                          {group === "builtin" && (
                            <span className="inline-block whitespace-nowrap rounded bg-[var(--cat-blue)]/20 px-0.5 py-px text-[7px] font-bold uppercase text-[var(--cat-blue)]">
                              BLT
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr
                    key={row.rowKey}
                    className={cn(
                      "hover:bg-muted/15 transition-colors",
                      idx % 2 === 1 && "bg-muted/5",
                      row.isFirstInFamily && idx > 0 && "border-t-2 border-t-border/60",
                    )}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 border-r border-b border-border/40 bg-background px-2 py-0.5 text-[11px]",
                        row.isFirstInFamily ? "font-semibold" : "pl-4 text-muted-foreground",
                      )}
                    >
                      {row.isFirstInFamily ? (
                        <Tooltip.Root>
                          <Tooltip.Trigger className="block max-w-[150px] cursor-help truncate">
                            {row.familyName}
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Positioner side="right" sideOffset={8}>
                              <Tooltip.Popup className="max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
                                <div className="space-y-1">
                                  <p className="font-semibold">{row.familyName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {row.familyTypeCount} type
                                    {row.familyTypeCount !== 1 ? "s" : ""}
                                  </p>
                                  {row.scheduleNames.length > 0 && (
                                    <div className="mt-1 border-t border-border/50 pt-1">
                                      <p className="text-[10px] font-medium">Schedules:</p>
                                      <ul className="mt-0.5 space-y-0.5 text-[10px]">
                                        {row.scheduleNames.map((s) => (
                                          <li key={s}>{s}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </Tooltip.Popup>
                            </Tooltip.Positioner>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      ) : (
                        <span className="text-muted-foreground/50">└</span>
                      )}
                    </td>
                    <td className="sticky left-[160px] z-10 border-r border-b border-border/40 bg-background px-2 py-0.5 text-[11px]">
                      <Tooltip.Root>
                        <Tooltip.Trigger className="block max-w-[90px] cursor-help truncate">
                          {row.typeName}
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Positioner side="right" sideOffset={8}>
                            <Tooltip.Popup className="max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
                              <div className="space-y-1">
                                <p className="font-semibold">{row.typeName}</p>
                                <p className="text-xs text-muted-foreground">
                                  Family: {row.familyName}
                                </p>
                                {row.scheduleNames.length > 0 && (
                                  <div className="mt-1 border-t border-border/50 pt-1">
                                    <p className="text-[10px] font-medium">Schedules applied:</p>
                                    <ul className="mt-0.5 space-y-0.5 text-[10px]">
                                      {row.scheduleNames.map((s) => (
                                        <li key={s}>{s}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </Tooltip.Popup>
                          </Tooltip.Positioner>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    </td>
                    <td
                      className="border-r border-b border-border/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                      title={row.categoryName}
                    >
                      <span className="block max-w-[80px] truncate">{row.categoryName}</span>
                    </td>
                    {filteredColumns.map((col) => {
                      const value = row.valuesByParam[col.key] ?? "";
                      const scope = row.scopeByParam[col.key];
                      const formulaState = row.formulaStateByParam[col.key];
                      const isEmpty = !value.trim();
                      const isUnresolved = !scope || scope === "Unresolved";

                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "border-r border-b border-border/40 px-1.5 py-0.5 text-[11px] font-mono tracking-tight",
                            getCellStatusClass(scope, formulaState, !isEmpty),
                            getCellBorderClass(scope),
                            isEmpty && "text-muted-foreground/30",
                          )}
                          title={
                            isUnresolved
                              ? "Parameter not available on this family"
                              : scope === "ProjectBindingOnly"
                                ? `Project parameter only: ${value}`
                                : formulaState === "Present"
                                  ? `Formula-driven: ${value}`
                                  : value
                          }
                        >
                          <span className="block max-w-[130px] truncate">
                            {isUnresolved ? "" : isEmpty ? "—" : value}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-[var(--cat-blue)]/15 ring-1 ring-[var(--cat-blue)]/40" />
            <span>Built-in param</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-[var(--cat-green)]/15 ring-1 ring-[var(--cat-green)]/40" />
            <span>Family param</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-[var(--cat-clay)]/15 ring-1 ring-[var(--cat-clay)]/40" />
            <span>Project param only</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-[var(--cat-lichen)]/15 ring-1 ring-[var(--cat-lichen)]/40" />
            <span>Formula-driven</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block size-3 rounded bg-[var(--cat-kiln)]/15 ring-1 ring-[var(--cat-kiln)]/40" />
            <span>Not available</span>
          </div>
        </div>
      </div>
    </UiTooltipProvider>
  );
}

function FamilyParameterTable({
  family,
  groupBy,
}: {
  family: LoadedFamilyMatrixFamily;
  groupBy: GroupByMode;
}) {
  const { types, visibleParameters } = family;

  const groupedParams = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "", label: "", params: visibleParameters }];
    }

    const groups = new Map<string, LoadedFamilyVisibleParameterEntry[]>();

    for (const param of visibleParameters) {
      let key: string;
      switch (groupBy) {
        case "group":
          key = param.groupTypeLabel || "Ungrouped";
          break;
        case "kind":
          key = getKindLabel(param.kind);
          break;
        case "scope":
          key = param.isInstance ? "Instance" : "Type";
          break;
        default:
          key = "";
      }

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      const groupParams = groups.get(key);
      if (!groupParams) {
        continue;
      }

      groupParams.push(param);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, params]) => ({ key, label: key, params }));
  }, [visibleParameters, groupBy]);

  if (types.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
        No types loaded for this family
      </div>
    );
  }

  if (visibleParameters.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
        No visible parameters collected
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-border/60 bg-background">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 min-w-[160px] border-r border-b border-border/60 bg-muted/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Parameter
            </th>
            <th className="w-10 border-r border-b border-border/60 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span title="Parameter Kind">Knd</span>
            </th>
            <th className="w-[52px] border-r border-b border-border/60 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span title="Instance or Type">Scope</span>
            </th>
            {types.map((type) => (
              <th
                key={type.typeName}
                className="min-w-[90px] max-w-[140px] border-r border-b border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                title={type.typeName}
              >
                <span className="block truncate">{type.typeName}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupedParams.map((group) => (
            <Fragment key={group.key || "__ungrouped"}>
              {groupBy !== "none" && (
                <tr key={`group-${group.key}`} className="bg-muted/40">
                  <td
                    colSpan={3 + types.length}
                    className="border-b border-border/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    {group.label}
                    <span className="ml-1.5 font-normal">({group.params.length})</span>
                  </td>
                </tr>
              )}
              {group.params.map((param) => (
                <tr key={param.identity.key} className="hover:bg-muted/15 transition-colors">
                  <td className="sticky left-0 z-10 border-r border-b border-border/40 bg-background px-2 py-0.5 text-[11px] font-medium">
                    <div className="flex items-center gap-1">
                      <span
                        className="truncate max-w-[140px]"
                        title={getParameterDisplayName(param)}
                      >
                        {getParameterDisplayName(param)}
                      </span>
                      <FormulaIndicator state={param.formulaState} formula={param.formula} />
                    </div>
                  </td>
                  <td className="border-r border-b border-border/40 px-0.5 py-0.5 text-center">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded px-1 py-px text-[8px] font-bold uppercase border",
                        getKindBadgeClass(param.kind),
                      )}
                      title={getKindLabel(param.kind)}
                    >
                      {getKindLabel(param.kind).slice(0, 3)}
                    </span>
                  </td>
                  <td className="border-r border-b border-border/40 px-1 py-0.5 text-center text-[10px] font-medium text-muted-foreground">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded px-1 py-px text-[8px] font-bold uppercase border",
                        getScopeBadgeClass(param.isInstance),
                      )}
                      title={param.isInstance ? "Instance parameter" : "Type parameter"}
                    >
                      {getScopeLabel(param.isInstance)}
                    </span>
                  </td>
                  {types.map((type) => {
                    const value = param.valuesByType[type.typeName] ?? "";
                    const isEmpty = !value.trim();
                    return (
                      <td
                        key={type.typeName}
                        className={cn(
                          "border-r border-b border-border/40 px-1.5 py-0.5 text-[11px] font-mono tracking-tight",
                          isEmpty && "text-muted-foreground/30",
                        )}
                        title={value}
                      >
                        <span className="block max-w-[120px] truncate">
                          {isEmpty ? "—" : value}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FamilyCard({
  family,
  isExpanded,
  onToggle,
  groupBy,
}: {
  family: LoadedFamilyMatrixFamily;
  isExpanded: boolean;
  onToggle: () => void;
  groupBy: GroupByMode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/80 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
          "hover:bg-muted/30",
          isExpanded && "border-b border-border/50 bg-muted/20",
        )}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              isExpanded && "rotate-180",
            )}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{family.familyName}</p>
            <p className="text-[11px] text-muted-foreground">{family.categoryName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted/60 px-1.5 py-0.5">
            {family.types.length} type{family.types.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5">
            {family.scheduleNames.length} schedule
            {family.scheduleNames.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded bg-muted/60 px-1.5 py-0.5">
            {family.visibleParameters.length} param
            {family.visibleParameters.length !== 1 ? "s" : ""}
          </span>
          {family.placedInstanceCount > 0 && (
            <span className="rounded bg-[var(--cat-green)]/12 px-1.5 py-0.5 text-[var(--cat-green)]">
              {family.placedInstanceCount} placed
            </span>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="p-3">
          {family.scheduleNames.length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Shows in {family.scheduleNames.length} schedule
                {family.scheduleNames.length !== 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
                {family.scheduleNames.map((scheduleName) => (
                  <li key={scheduleName}>
                    <span className="font-medium">{scheduleName}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <FamilyParameterTable family={family} groupBy={groupBy} />
          {family.excludedParameters.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {family.excludedParameters.length} excluded parameter
                {family.excludedParameters.length !== 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
                {family.excludedParameters.map((param) => (
                  <li key={param.identity.key}>
                    <span className="font-medium">{param.identity.name}</span>
                    <span className="ml-2 text-[10px]">
                      ({getExcludedReasonLabel(param.excludedReason)})
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function FamilyMatrixRoute() {
  const [viewMode, setViewMode] = useState<ViewMode>("spreadsheet");
  const [bridgeSessionId, setBridgeSessionId] = useState<string | undefined>();
  const [placementScope, setPlacementScope] = useState<LoadedFamilyPlacementScope>(
    LoadedFamilyPlacementScope.AllLoaded,
  );
  const [groupBy, setGroupBy] = useState<GroupByMode>("none");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedFamilyNames, setSelectedFamilyNames] = useState<string[]>([]);
  const [appliedMatrixFilter, setAppliedMatrixFilter] = useState<{
    familyNames: string[];
    categoryNames: string[];
    placementScope: LoadedFamilyPlacementScope;
  } | null>(null);
  const [shouldAutoSelectFamilies, setShouldAutoSelectFamilies] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const hostQueryOptions = bridgeSessionId ? { bridgeSessionId } : undefined;

  const sessionsQuery = useBridgeSessionsListQuery();
  const hostStatusQuery = useHostStatusQuery(hostQueryOptions);
  const sessionQuery = useBridgeSessionSummaryQuery(hostQueryOptions);
  const bridgeConnected = hostStatusQuery.data?.bridgeIsConnected ?? false;
  const activeDocumentTitle = sessionQuery.data?.activeDocument?.title;
  const revitVersion = sessionQuery.data?.revitVersion;

  // The catalog is cheap (names only, no parameters); a generous budget keeps the
  // category + family pickers from truncating at the host default (50).
  // ponytail: 5000-family ceiling; raise if a model exceeds it.
  const categoryCatalogQuery = useLoadedFamiliesCatalogQuery(
    {
      filter: { placementScope: LoadedFamilyPlacementScope.AllLoaded },
      budget: { maxEntries: 5000 },
    },
    { ...hostQueryOptions, enabled: bridgeConnected },
  );
  const availableCategories = useMemo(() => {
    const families = categoryCatalogQuery.data?.families ?? [];
    return Array.from(
      new Set(
        families
          .map((family) => family.categoryName)
          .filter((categoryName): categoryName is string => Boolean(categoryName?.trim())),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [categoryCatalogQuery.data?.families]);

  const selectedFamilyCatalogRequest = useMemo<LoadedFamiliesRequest>(
    () => ({
      filter: { categoryNames: selectedCategories, placementScope },
      budget: { maxEntries: 5000 },
    }),
    [selectedCategories, placementScope],
  );
  const selectedFamilyCatalogQuery = useLoadedFamiliesCatalogQuery(selectedFamilyCatalogRequest, {
    ...hostQueryOptions,
    enabled: bridgeConnected && selectedCategories.length > 0,
  });
  const availableFamilyNames = useMemo(() => {
    const families = selectedFamilyCatalogQuery.data?.families ?? [];
    return families
      .map((family) => family.familyName)
      .filter((familyName) => familyName.trim().length > 0)
      .sort((a, b) => a.localeCompare(b));
  }, [selectedFamilyCatalogQuery.data?.families]);

  const draftMatrixFilter = useMemo(
    () => ({ familyNames: selectedFamilyNames, categoryNames: selectedCategories, placementScope }),
    [selectedCategories, selectedFamilyNames, placementScope],
  );
  // The matrix is the expensive call (parameters per type). Size the budget to
  // the explicit family selection so all chosen families load without truncation,
  // and lift the per-entry sample cap so cells/types aren't dropped.
  const matrixRequest = useMemo<LoadedFamiliesRequest | undefined>(
    () =>
      appliedMatrixFilter
        ? {
            filter: appliedMatrixFilter,
            budget: {
              maxEntries: Math.max(appliedMatrixFilter.familyNames.length, 10),
              maxSamplesPerEntry: 1000,
            },
          }
        : undefined,
    [appliedMatrixFilter],
  );
  const matrixQuery = useLoadedFamiliesMatrixQuery(matrixRequest, {
    ...hostQueryOptions,
    enabled: bridgeConnected && matrixRequest !== undefined,
  });
  const categoryCatalogIssue = categoryCatalogQuery.isError
    ? toHostIssue(categoryCatalogQuery.error, "Couldn't load categories")
    : undefined;
  const selectedFamilyCatalogIssue = selectedFamilyCatalogQuery.isError
    ? toHostIssue(selectedFamilyCatalogQuery.error, "Couldn't load families")
    : undefined;
  const matrixIssue = matrixQuery.isError
    ? toHostIssue(matrixQuery.error, "Failed to load families")
    : undefined;

  const families = matrixQuery.data?.families ?? [];
  const issues = matrixQuery.data?.issues ?? [];
  const catalogIssues = [
    ...(categoryCatalogQuery.data?.issues ?? []),
    ...(selectedFamilyCatalogQuery.data?.issues ?? []),
  ];
  const hasSelectedCategories = selectedCategories.length > 0;
  const hasSelectedFamilies = selectedFamilyNames.length > 0;
  const hasAppliedMatrixFilter = appliedMatrixFilter !== null;
  const hasPendingSelectionChanges =
    JSON.stringify(appliedMatrixFilter) !== JSON.stringify(draftMatrixFilter);
  const canRefreshMatrix = hasAppliedMatrixFilter && !matrixQuery.isFetching;

  useEffect(() => {
    if (selectedCategories.length === 0) {
      setSelectedFamilyNames([]);
      setShouldAutoSelectFamilies(false);
      setAppliedMatrixFilter(null);
    }
  }, [selectedCategories]);

  useEffect(() => {
    if (!shouldAutoSelectFamilies || selectedFamilyCatalogQuery.isPending) {
      return;
    }

    setSelectedFamilyNames(availableFamilyNames);
    setShouldAutoSelectFamilies(false);
  }, [availableFamilyNames, selectedFamilyCatalogQuery.isPending, shouldAutoSelectFamilies]);

  useEffect(() => {
    if (shouldAutoSelectFamilies) {
      return;
    }

    setSelectedFamilyNames((prev) =>
      prev.filter((familyName) => availableFamilyNames.includes(familyName)),
    );
  }, [availableFamilyNames, shouldAutoSelectFamilies]);

  const toggleFamily = (familyId: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedFamilies(new Set(families.map((f) => f.familyUniqueId)));
  };

  const collapseAll = () => {
    setExpandedFamilies(new Set());
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedFamilies(new Set());
    setSelectedFamilyNames([]);
    setShouldAutoSelectFamilies(true);
    setAppliedMatrixFilter(null);
    setSelectedCategories((prev) =>
      prev.includes(categoryName)
        ? prev.filter((value) => value !== categoryName)
        : [...prev, categoryName].sort((a, b) => a.localeCompare(b)),
    );
  };

  const selectAllCategories = () => {
    setExpandedFamilies(new Set());
    setSelectedFamilyNames([]);
    setShouldAutoSelectFamilies(true);
    setAppliedMatrixFilter(null);
    setSelectedCategories(availableCategories);
  };

  const clearCategories = () => {
    setExpandedFamilies(new Set());
    setSelectedFamilyNames([]);
    setShouldAutoSelectFamilies(false);
    setAppliedMatrixFilter(null);
    setSelectedCategories([]);
  };

  const toggleSelectedFamily = (familyName: string) => {
    setExpandedFamilies(new Set());
    setAppliedMatrixFilter(null);
    setSelectedFamilyNames((prev) =>
      prev.includes(familyName)
        ? prev.filter((value) => value !== familyName)
        : [...prev, familyName].sort((a, b) => a.localeCompare(b)),
    );
  };

  const selectAllFamilies = () => {
    setExpandedFamilies(new Set());
    setAppliedMatrixFilter(null);
    setSelectedFamilyNames(availableFamilyNames);
  };

  const clearFamilies = () => {
    setExpandedFamilies(new Set());
    setAppliedMatrixFilter(null);
    setSelectedFamilyNames([]);
  };

  const handlePlacementScopeChange = (value: LoadedFamilyPlacementScope) => {
    setExpandedFamilies(new Set());
    setPlacementScope(value);
    setAppliedMatrixFilter(null);
    if (selectedCategories.length > 0) {
      setSelectedFamilyNames([]);
      setShouldAutoSelectFamilies(true);
    }
  };

  const handleBridgeSessionChange = (value: string | undefined) => {
    setBridgeSessionId(value);
    setExpandedFamilies(new Set());
    setSelectedCategories([]);
    setSelectedFamilyNames([]);
    setShouldAutoSelectFamilies(false);
    setAppliedMatrixFilter(null);
  };

  const handleApplyMatrixSelection = () => {
    if (!hasSelectedCategories || !hasSelectedFamilies) {
      return;
    }

    setExpandedFamilies(new Set());
    setAppliedMatrixFilter({
      familyNames: [...selectedFamilyNames],
      categoryNames: [...selectedCategories],
      placementScope,
    });
  };

  const handleRefreshMatrix = () => {
    if (!appliedMatrixFilter) {
      return;
    }

    void matrixQuery.refetch();
  };

  const totalTypes = families.reduce((sum, f) => sum + f.types.length, 0);
  const uniqueParams = useMemo(() => {
    const paramNames = new Set<string>();
    for (const family of families) {
      for (const param of family.visibleParameters) {
        paramNames.add(param.identity.key);
      }
    }
    return paramNames.size;
  }, [families]);

  return (
    <main className="page-wrap flex min-h-screen flex-col gap-4 px-4 py-6">
      <section className="shrink-0 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Revit Data
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Loaded Families Matrix
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              View parameter values across loaded family types
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {bridgeConnected
                ? `Bridge connected${revitVersion ? ` · Revit ${revitVersion}` : ""}${
                    activeDocumentTitle ? ` · ${activeDocumentTitle}` : " · no active document"
                  }`
                : "Bridge disconnected - open Revit and connect the TS host to load matrices."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HostConnectionPill connected={bridgeConnected} />

            <Select
              value={bridgeSessionId ?? DEFAULT_SESSION_VALUE}
              onValueChange={(value: string | null) =>
                handleBridgeSessionChange(
                  !value || value === DEFAULT_SESSION_VALUE ? undefined : value,
                )
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Host default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_SESSION_VALUE}>Host default</SelectItem>
                {(sessionsQuery.data?.sessions ?? []).map((session) => (
                  <SelectItem key={session.sessionId} value={session.sessionId}>
                    {session.activeDocumentTitle || `Revit ${session.processId ?? ""}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex rounded-md border border-border/60 bg-muted/30 p-0.5">
              <Button
                variant={viewMode === "spreadsheet" ? "default" : "ghost"}
                size="xs"
                onClick={() => setViewMode("spreadsheet")}
                className="gap-1"
              >
                <TableIcon className="size-3" />
                Spreadsheet
              </Button>
              <Button
                variant={viewMode === "grouped" ? "default" : "ghost"}
                size="xs"
                onClick={() => setViewMode("grouped")}
                className="gap-1"
              >
                <LayoutGrid className="size-3" />
                Grouped
              </Button>
            </div>

            <Select
              value={placementScope}
              onValueChange={(v: string | null) =>
                v && handlePlacementScopeChange(v as LoadedFamilyPlacementScope)
              }
            >
              <SelectTrigger className="w-[130px]">
                <Filter className="mr-1 size-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LoadedFamilyPlacementScope.AllLoaded}>All Loaded</SelectItem>
                <SelectItem value={LoadedFamilyPlacementScope.PlacedOnly}>Placed Only</SelectItem>
                <SelectItem value={LoadedFamilyPlacementScope.UnplacedOnly}>
                  Unplaced Only
                </SelectItem>
              </SelectContent>
            </Select>

            {viewMode === "grouped" && (
              <Select
                value={groupBy}
                onValueChange={(v: string | null) => v && setGroupBy(v as GroupByMode)}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Group by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No grouping</SelectItem>
                  <SelectItem value="group">By Group</SelectItem>
                  <SelectItem value="kind">By Kind</SelectItem>
                  <SelectItem value="scope">By Scope</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Button
              size="sm"
              onClick={handleApplyMatrixSelection}
              disabled={
                !hasSelectedCategories ||
                !hasSelectedFamilies ||
                !hasPendingSelectionChanges ||
                matrixQuery.isFetching ||
                selectedFamilyCatalogQuery.isPending
              }
            >
              Load Matrix
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshMatrix}
              disabled={!canRefreshMatrix}
            >
              <RefreshCw className={cn("size-3", matrixQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-foreground">Categories</p>
              <p className="text-[11px] text-muted-foreground">
                Select categories to load their families into the matrix
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={selectAllCategories}
                disabled={availableCategories.length === 0}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={clearCategories}
                disabled={selectedCategories.length === 0}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryCatalogIssue ? (
              <HostIssuePanel issue={categoryCatalogIssue} compact />
            ) : categoryCatalogQuery.isPending && bridgeConnected ? (
              <span className="text-xs text-muted-foreground">Loading categories...</span>
            ) : !bridgeConnected || availableCategories.length === 0 ? (
              <span className="text-xs text-muted-foreground">No categories available</span>
            ) : null}
            {availableCategories.map((categoryName) => {
              const isSelected = selectedCategories.includes(categoryName);
              return (
                <Button
                  key={categoryName}
                  variant={isSelected ? "default" : "outline"}
                  size="xs"
                  onClick={() => toggleCategory(categoryName)}
                >
                  {categoryName}
                </Button>
              );
            })}
          </div>
        </div>
      </section>

      {hasSelectedCategories && (
        <section className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-foreground">Families</p>
                <p className="text-[11px] text-muted-foreground">
                  Choose which families in the selected categories to collect
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={selectAllFamilies}
                  disabled={availableFamilyNames.length === 0}
                >
                  Check all
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={clearFamilies}
                  disabled={selectedFamilyNames.length === 0}
                >
                  Check none
                </Button>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {selectedFamilyCatalogQuery.isPending
                ? "Loading families for selected categories..."
                : `${selectedFamilyNames.length} of ${availableFamilyNames.length} selected`}
            </div>
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded border border-border/40 bg-background/70 p-2">
              {selectedFamilyCatalogIssue ? (
                <HostIssuePanel issue={selectedFamilyCatalogIssue} compact />
              ) : selectedFamilyCatalogQuery.isPending ? (
                <span className="text-xs text-muted-foreground">Loading family names...</span>
              ) : availableFamilyNames.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No families found for the selected categories
                </span>
              ) : null}
              {availableFamilyNames.map((familyName) => {
                const isSelected = selectedFamilyNames.includes(familyName);
                return (
                  <Button
                    key={familyName}
                    variant={isSelected ? "default" : "outline"}
                    size="xs"
                    onClick={() => toggleSelectedFamily(familyName)}
                    className="gap-1"
                  >
                    {isSelected ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <Circle className="size-3" />
                    )}
                    <span className="max-w-[220px] truncate">{familyName}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{families.length}</span> families
          </span>
          <span>
            <span className="font-medium text-foreground">{totalTypes}</span> types
          </span>
          <span>
            <span className="font-medium text-foreground">{uniqueParams}</span> parameters
          </span>
          <span>
            <span className="font-medium text-foreground">{selectedFamilyNames.length}</span>{" "}
            selected families
          </span>
          {hasAppliedMatrixFilter && (
            <span className="text-[var(--cat-green)]">Matrix loaded for applied selection</span>
          )}
          {!bridgeConnected && <span className="text-[var(--cat-clay)]">Bridge disconnected</span>}
          {bridgeConnected && !hasSelectedCategories && (
            <span className="text-[var(--cat-clay)]">Select at least one category</span>
          )}
          {bridgeConnected && hasSelectedCategories && !hasSelectedFamilies && (
            <span className="text-[var(--cat-clay)]">Select at least one family</span>
          )}
          {bridgeConnected &&
            hasSelectedCategories &&
            hasSelectedFamilies &&
            hasPendingSelectionChanges && (
              <span className="text-[var(--cat-clay)]">Apply selection to load matrix</span>
            )}
        </div>
        {viewMode === "grouped" && (
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" onClick={expandAll} disabled={families.length === 0}>
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={collapseAll}
              disabled={families.length === 0}
            >
              Collapse all
            </Button>
          </div>
        )}
      </section>

      {(issues.length > 0 || catalogIssues.length > 0) && (
        <section className="rounded-lg border border-[var(--cat-clay)]/30 bg-[var(--cat-clay)]/10 p-3">
          <p className="text-xs font-medium text-[var(--cat-clay)]">
            {issues.length + catalogIssues.length} issue
            {issues.length + catalogIssues.length !== 1 ? "s" : ""} reported
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--cat-clay)]">
            {catalogIssues.map((issue, idx) => (
              <li key={`catalog-${idx}-${issue.code}`}>{issue.message}</li>
            ))}
            {issues.map((issue, idx) => (
              <li key={`data-${idx}-${issue.code}`}>
                {issue.familyName && <span className="font-medium">{issue.familyName}: </span>}
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasAppliedMatrixFilter && matrixQuery.isPending && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Loading families...
          </div>
        </div>
      )}

      {hasAppliedMatrixFilter && matrixQuery.isError && (
        <HostIssuePanel
          issue={matrixIssue}
          action={
            <Button variant="outline" size="sm" onClick={() => matrixQuery.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {!hasSelectedCategories && (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Choose one or more categories to load the matrix
          </p>
        </div>
      )}

      {hasSelectedCategories && !hasSelectedFamilies && !selectedFamilyCatalogQuery.isPending && (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Choose one or more families to load the matrix
          </p>
        </div>
      )}

      {hasSelectedCategories &&
        hasSelectedFamilies &&
        !hasAppliedMatrixFilter &&
        !selectedFamilyCatalogQuery.isPending && (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Review your family selection, then click Load Matrix
            </p>
          </div>
        )}

      {hasAppliedMatrixFilter && matrixQuery.isSuccess && families.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No loaded families found with the current filter
          </p>
        </div>
      )}

      {hasAppliedMatrixFilter && matrixQuery.isSuccess && families.length > 0 && (
        <>
          {viewMode === "spreadsheet" && (
            <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/50 p-3">
              <MasterSpreadsheetTable families={families} />
            </section>
          )}

          {viewMode === "grouped" && (
            <section className="space-y-2">
              {families.map((family) => (
                <FamilyCard
                  key={family.familyUniqueId}
                  family={family}
                  isExpanded={expandedFamilies.has(family.familyUniqueId)}
                  onToggle={() => toggleFamily(family.familyUniqueId)}
                  groupBy={groupBy}
                />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

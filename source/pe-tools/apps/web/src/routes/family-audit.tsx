import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { HostConnectionPill, toHostIssue } from "#/host/issues";
import {
  LoadedFamilyPlacementScope,
  cellText,
  visibleParameters,
} from "#/host/loaded-families-view";
import {
  useHostStatusQuery,
  useLoadedFamiliesCatalogQuery,
  useLoadedFamiliesMatrixQuery,
} from "#/host/queries";
import { type AuditRow, AuditTable } from "#/pdf-audit/AuditTable";
import { AuditShell } from "#/pdf-audit/AuditShell";
import { PdfAuditProvider, usePdfAudit } from "#/pdf-audit/store";
import { cn } from "#/lib/utils";

/**
 * Experimental: audit ONE loaded family against a PDF (schedule/datasheet).
 * Family types are columns, parameters are rows; hovering a mapped cell
 * grounds it in the source document. Edits stage locally — writing values back
 * into a loaded family isn't wired yet (needs the scripting write lane that
 * /family-doc uses, pointed at the project document).
 */
export const Route = createFileRoute("/family-audit")({
  component: () => (
    <PdfAuditProvider>
      <FamilyAuditRoute />
    </PdfAuditProvider>
  ),
});

interface FamilyPick {
  familyName: string;
  categoryName: string;
}

function FamilyAuditRoute() {
  const [picked, setPicked] = useState<FamilyPick | null>(null);
  const { runMapping } = usePdfAudit();

  const hostStatusQuery = useHostStatusQuery();
  const bridgeConnected = hostStatusQuery.data?.bridgeIsConnected ?? false;

  const catalogQuery = useLoadedFamiliesCatalogQuery(
    {
      filter: { placementScope: LoadedFamilyPlacementScope.AllLoaded },
      budget: { maxEntries: 5000 },
    },
    { enabled: bridgeConnected },
  );

  const matrixQuery = useLoadedFamiliesMatrixQuery(
    picked
      ? {
          filter: {
            familyNames: [picked.familyName],
            ...(picked.categoryName ? { categoryNames: [picked.categoryName] } : {}),
            placementScope: LoadedFamilyPlacementScope.AllLoaded,
          },
          budget: { maxEntries: 1, maxSamplesPerEntry: 1000 },
          includeTempPlacement: true,
        }
      : undefined,
    { enabled: bridgeConnected && picked !== null },
  );

  const family = matrixQuery.data?.families[0];

  const { rows, columns, current } = useMemo(() => {
    if (!family) {
      return { rows: [] as AuditRow[], columns: [] as string[], current: {} };
    }
    const columnNames = [...family.typeNames];
    const auditRows: AuditRow[] = [];
    const values: Record<string, Record<string, string>> = {};
    const seen = new Set<string>();
    for (const param of visibleParameters(family)) {
      const name = param.definition.identity.name;
      if (seen.has(name)) continue;
      seen.add(name);
      auditRows.push({
        name,
        caption: `${param.kind.replace("Parameter", "")} · ${
          param.definition.isInstance ? "inst" : "type"
        }`,
        formula: param.formulaState === "Present" ? param.formula || "formula" : undefined,
      });
      values[name] = Object.fromEntries(
        Object.entries(param.valuesPerType).map(([typeName, value]) => [typeName, cellText(value)]),
      );
    }
    return { rows: auditRows, columns: columnNames, current: values };
  }, [family]);

  const matrixIssue = matrixQuery.isError
    ? toHostIssue(matrixQuery.error, "Failed to load family")
    : undefined;

  return (
    <AuditShell
      title="Family Audit"
      subtitle="Audit one loaded family's parameter values against a PDF"
      canRunMapping={rows.length > 0 && columns.length > 0}
      onRunMapping={() => void runMapping({ rows, columns, current })}
      headerControls={
        <>
          <HostConnectionPill connected={bridgeConnected} />
          <FamilyPicker
            families={catalogQuery.data?.families ?? []}
            loading={catalogQuery.isPending && bridgeConnected}
            picked={picked}
            onPick={setPicked}
          />
        </>
      }
      ribbonExtra={
        <span className="text-muted-foreground/70">
          Edits stage locally — write-back for loaded families isn't wired yet
        </span>
      }
    >
      {!bridgeConnected && (
        <EmptyState text="Bridge disconnected — open Revit and connect the TS host." />
      )}
      {bridgeConnected && !picked && <EmptyState text="Pick a loaded family to audit." />}
      {picked && matrixQuery.isPending && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading {picked.familyName}…
        </div>
      )}
      {matrixIssue && <EmptyState text={matrixIssue.message} />}
      {family && <AuditTable rows={rows} columns={columns} current={current} />}
    </AuditShell>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function FamilyPicker({
  families,
  loading,
  picked,
  onPick,
}: {
  families: ReadonlyArray<{ familyName: string; categoryName?: string | null }>;
  loading: boolean;
  picked: FamilyPick | null;
  onPick: (pick: FamilyPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const unique = new Map<string, FamilyPick>();
    for (const family of families) {
      if (!family.familyName.trim()) continue;
      unique.set(family.familyName, {
        familyName: family.familyName,
        categoryName: family.categoryName ?? "",
      });
    }
    const all = Array.from(unique.values()).sort((a, b) =>
      a.familyName.localeCompare(b.familyName),
    );
    if (!needle) return all.slice(0, 60);
    return all
      .filter(
        (family) =>
          family.familyName.toLowerCase().includes(needle) ||
          family.categoryName.toLowerCase().includes(needle),
      )
      .slice(0, 60);
  }, [families, query]);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        className="max-w-[280px]"
      >
        <span className="truncate">
          {picked ? picked.familyName : loading ? "Loading families…" : "Pick family"}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[320px] rounded-md border border-border bg-popover shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search families…"
              className="h-6 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {loading ? "Loading…" : "No matching families"}
              </p>
            )}
            {filtered.map((family) => (
              <button
                key={family.familyName}
                type="button"
                onClick={() => {
                  onPick(family);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full flex-col rounded px-2 py-1 text-left hover:bg-muted",
                  picked?.familyName === family.familyName && "bg-muted/70",
                )}
              >
                <span className="truncate text-xs font-medium text-foreground">
                  {family.familyName}
                </span>
                <span className="text-[10px] text-muted-foreground">{family.categoryName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { HostConnectionPill, toHostIssue } from "#/host/issues";
import {
  type FamilyDocApplyResult,
  type FamilyDocEdit,
  useFamilyDocApplyMutation,
  useFamilyDocSnapshotQuery,
} from "#/host/family-doc";
import { useBridgeSessionSummaryQuery, useHostStatusQuery } from "#/host/queries";
import { type AuditRow, AuditTable } from "#/pdf-audit/AuditTable";
import { AuditShell } from "#/pdf-audit/AuditShell";
import { PdfAuditProvider, usePdfAudit } from "#/pdf-audit/store";
import { splitCellKey } from "#/pdf-audit/types";
import { cn } from "#/lib/utils";

/**
 * Experimental: audit and edit the parameter values of the family document
 * open in the Revit family editor. Reads FamilyManager via a ReadOnly inline
 * script; Apply runs a WriteTransaction script (host-owned transaction).
 */
export const Route = createFileRoute("/family-doc")({
  component: () => (
    <PdfAuditProvider>
      <FamilyDocRoute />
    </PdfAuditProvider>
  ),
});

function FamilyDocRoute() {
  const { runMapping, edits, clearAllEdits } = usePdfAudit();
  const [applyResult, setApplyResult] = useState<FamilyDocApplyResult | null>(null);

  const hostStatusQuery = useHostStatusQuery();
  const bridgeConnected = hostStatusQuery.data?.bridgeIsConnected ?? false;
  const sessionQuery = useBridgeSessionSummaryQuery();
  const activeDocumentTitle = sessionQuery.data?.activeDocument?.title;

  const snapshotQuery = useFamilyDocSnapshotQuery();
  const applyMutation = useFamilyDocApplyMutation();
  const snapshot = snapshotQuery.data;

  const { rows, columns, current } = useMemo(() => {
    if (!snapshot) {
      return { rows: [] as AuditRow[], columns: [] as string[], current: {} };
    }
    const auditRows: AuditRow[] = snapshot.parameters.map((param) => ({
      name: param.name,
      caption: `${param.isInstance ? "inst" : "type"} · ${param.storageType}`,
      formula: param.formula || undefined,
      readOnly: param.isReadOnly,
    }));
    const values: Record<string, Record<string, string>> = {};
    for (const param of snapshot.parameters) {
      values[param.name] = param.values;
    }
    return { rows: auditRows, columns: [...snapshot.types], current: values };
  }, [snapshot]);

  const handleApply = () => {
    const pending: FamilyDocEdit[] = Array.from(edits.entries()).map(([key, value]) => {
      const [paramName, typeName] = splitCellKey(key);
      return { paramName, typeName, value };
    });
    if (pending.length === 0) return;
    setApplyResult(null);
    applyMutation.mutate(pending, {
      onSuccess: (result) => {
        setApplyResult(result);
        clearAllEdits();
        void snapshotQuery.refetch();
      },
    });
  };

  const snapshotIssue = snapshotQuery.isError
    ? toHostIssue(snapshotQuery.error, "Couldn't read the family document")
    : undefined;

  return (
    <AuditShell
      title="Family Document Audit"
      subtitle={
        activeDocumentTitle
          ? `Active document: ${activeDocumentTitle}`
          : "Open a family in the Revit family editor"
      }
      canRunMapping={rows.length > 0 && columns.length > 0}
      onRunMapping={() => void runMapping({ rows, columns, current })}
      headerControls={
        <>
          <HostConnectionPill connected={bridgeConnected} />
          <Button
            variant="outline"
            size="sm"
            disabled={!bridgeConnected || snapshotQuery.isFetching}
            onClick={() => void snapshotQuery.refetch()}
          >
            <RefreshCw className={cn("size-3", snapshotQuery.isFetching && "animate-spin")} />
            {snapshot ? "Re-read family" : "Read family"}
          </Button>
          <Button
            size="sm"
            disabled={edits.size === 0 || applyMutation.isPending || !bridgeConnected}
            onClick={handleApply}
            className="bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85"
          >
            {applyMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CheckCheck className="size-3" />
            )}
            Apply {edits.size > 0 ? `${edits.size} edit${edits.size !== 1 ? "s" : ""}` : ""} to
            Revit
          </Button>
        </>
      }
      ribbonExtra={
        <>
          {applyMutation.isError && (
            <span className="text-[var(--cat-clay)]">
              Apply failed: {applyMutation.error.message}
            </span>
          )}
          {applyResult && (
            <span
              className={cn(
                applyResult.failures.length > 0
                  ? "text-[var(--cat-clay)]"
                  : "text-[var(--cat-green)]",
              )}
              title={applyResult.failures.join("\n")}
            >
              Applied {applyResult.applied}
              {applyResult.failures.length > 0 && `, ${applyResult.failures.length} failed`}
            </span>
          )}
        </>
      }
    >
      {!bridgeConnected && (
        <EmptyState text="Bridge disconnected — open Revit and connect the TS host." />
      )}
      {bridgeConnected && !snapshot && !snapshotQuery.isFetching && !snapshotIssue && (
        <EmptyState text="Open a family document in Revit, then click Read family." />
      )}
      {snapshotQuery.isFetching && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Running read script in Revit…
        </div>
      )}
      {snapshotIssue && !snapshotQuery.isFetching && <EmptyState text={snapshotIssue.message} />}
      {snapshot && !snapshotQuery.isFetching && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{snapshot.familyName}</span> ·{" "}
            {snapshot.types.length} type{snapshot.types.length !== 1 ? "s" : ""} ·{" "}
            {snapshot.parameters.length} parameters
          </p>
          <AuditTable rows={rows} columns={columns} current={current} />
        </>
      )}
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

import { useContext, useState, type ReactNode } from "react";
import {
  scheduleGridRouteState,
  scheduleReadingSchema,
  scheduleCatalogSchema,
  type WorkKey,
  type ScheduleReading,
  type ScheduleCatalog,
  type DocumentRef,
  type RouteStatePatch,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { useRouteState } from "#/workbench/route-state";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { useAction, useHostCall } from "#/readings";
import { useRoute } from "#/route";
import { scheduleGridManifest } from "./manifest";
import { readScheduleCapture } from "../../../../packages/mcps/src/shared/schedule-client";
import {
  runSemanticAction,
  readScopedActionStatuses,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { ActionReceipts } from "#/actions/receipt";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

export function LiveScheduleGridWorkspace({
  workspaceId,
  render,
}: {
  workspaceId?: string;
  render?: (state: ScheduleGridState) => ReactNode;
}) {
  // The route's own resolution IS the binding: one resolved document Target, or none.
  const { resolution } = useRoute(scheduleGridManifest());
  const target =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const [reading, setReading] = useState<ScheduleReading>();
  const [error, setError] = useState<string>();
  const catalog = useHostCall(async () =>
      scheduleCatalogSchema.parse(await readScheduleCapture("schedule-grid.catalog", {}, target)), ["schedule-grid", "catalog", target], !!target);
  const readMutation = useAction(async (input: Record<string, unknown>) => {
      if (!target) throw Error("Select an exact available document lifetime");
      setError(undefined);
      try {
        setReading(
          scheduleReadingSchema.parse(
            await readScheduleCapture("schedule-grid.snapshot", input, target),
          ),
        );
      } catch (error) {
        setError(String(error));
        throw error;
      }
    });
  const retained = useHostCall(async () =>
      scheduleReadingSchema.parse(
        await readScheduleCapture("schedule-grid.work", { workspaceId: workspaceId! }),
      ), ["schedule-grid", "work", workspaceId], !!workspaceId);
  const address = reading?.workspaceId ?? workspaceId;
  // One receipt id per Work address. Switching schedules MUST build a fresh store (`key=`), because
  // useRouteStore caches the first scope it saw — but the receipt the previous address left
  // unresolved is still the operator's to recover, so it lives here, not in the remounted child.
  const [lastIds, setLastIds] = useState<Record<string, string>>({});
  const reads = {
    catalog: catalog.data,
    target,
    busy: readMutation.isPending ? ("refresh" as const) : null,
    read: readMutation.mutateAsync,
    list: async () => {
      catalog.refresh();
    },
    render,
  };
  return (
    <>
      {(error || catalog.error || !target) && (
        <div role="status">
          {error ??
            (catalog.error
              ? String(catalog.error)
              : "Select an available document and session to read schedules")}
        </div>
      )}
      {address ? (
        <ScheduleWork
          key={address}
          workspaceId={address}
          reading={reading ?? retained.data}
          setReading={setReading}
          lastId={lastIds[address]}
          setLastId={(id) => setLastIds((prior) => ({ ...prior, [address]: id }))}
          {...reads}
        />
      ) : (
        <ScheduleRead {...reads} />
      )}
    </>
  );
}

interface ScheduleReads {
  catalog?: ScheduleCatalog;
  target?: DocumentRef;
  busy: "refresh" | null;
  read: (input: Record<string, unknown>) => Promise<void>;
  list: () => Promise<void>;
  render?: (state: ScheduleGridState) => ReactNode;
}

/**
 * No reading yet means no Work ADDRESS yet: `schedule:sha256(document, scheduleUniqueId)` only
 * exists once a schedule has been read. Subscribing document-scoped Work here opened a stream that
 * reported "bridge connected" and held cells `schedule-grid.apply` would always refuse, so the
 * catalog and refresh controls stand on their own until the address exists.
 */
function ScheduleRead({ catalog, target, busy, read, list, render }: ScheduleReads) {
  const workbench = useContext(WorkbenchContext);
  const [error, setError] = useState<string>();
  const command = useAction(async ({
      kind,
      input,
    }: {
      kind: "catalog" | "refresh" | "push";
      input: Record<string, unknown>;
    }) => {
      setError(undefined);
      try {
        if (kind === "catalog") await list();
        else if (kind === "refresh") await read(input);
        else throw Error("Read a schedule before pushing");
        return { ok: true, revision: 0 } as const;
      } catch (cause) {
        setError(String(cause));
        return {
          ok: false,
          kind: "error",
          error: String(cause),
          hint: "Read a schedule first",
        } as const;
      }
    });
  const state: ScheduleGridState = {
    slice: null,
    hydrated: false,
    refreshing: false,
    peaActive: workbench?.isRunning ?? false,
    connected: null,
    failure: null,
    apply: async () => ({
      ok: false,
      kind: "refused",
      error: "Read the schedule before editing",
      hint: "Select a schedule",
    }),
    execute: (kind, input = {}) => command.mutateAsync({ kind, input }),
    snapshot: null,
    catalog: catalog ?? null,
    busy: command.isPending ? null : busy,
    blockedBecause: target
      ? "Read a schedule before staging or pushing"
      : "Select an available document and session",
  };
  return (
    <>
      {error && <div role="alert">{error}</div>}
      {render ? render(state) : <ScheduleGridWorkspace state={state} />}
    </>
  );
}
function ScheduleWork({
  workspaceId,
  reading,
  catalog,
  target,
  setReading,
  read,
  list,
  lastId,
  setLastId,
  busy: readingBusy,
  render,
}: ScheduleReads & {
  workspaceId: string;
  reading?: ScheduleReading;
  setReading: (reading: ScheduleReading) => void;
  lastId?: string;
  setLastId: (id: string) => void;
}) {
  const scope: WorkKey = { route: "schedule-grid", target: null, work: workspaceId };
  const work = useRouteState(scheduleGridRouteState, scope);
  const [error, setError] = useState<string>();
  const basisId = work.slice?.basis?.captureId;
  const basis = useHostCall(async () =>
      scheduleReadingSchema.parse(
        await readScheduleCapture("schedule-grid.saved", { id: basisId! }),
      ), ["schedule-grid", "saved", basisId], !!basisId);
  const hasWork = Object.values(work.slice?.cells ?? {}).some(
    (cell) => cell.staged || cell.proposal,
  );
  const shown = hasWork && basisId ? basis.data : (reading ?? basis.data);
  const receiptScope = { kind: "schedule-grid" as const, workspaceId };
  const receipts = useHostCall(() => readScopedActionStatuses(receiptScope, "", undefined, lastId), ["actions", "subject", receiptScope, lastId]);
  const relevant: { state: string; startedAt: string }[] = receipts.data ?? [];
  const unresolved = relevant.some((row) =>
    ["running", "unknown", "incomplete"].includes(row.state),
  );
  const apply = async (patches: RouteStatePatch[]): Promise<RouteStateWriteResult> => {
    if (!shown)
      return {
        ok: false,
        kind: "refused",
        error: "Read the schedule before editing",
        hint: "Select a schedule",
      };
    const writing = patches.some((p) => p.value !== undefined);
    return work.apply(
      writing && (!hasWork || !work.slice?.basis)
        ? [{ path: ["basis"], value: { captureId: shown.id } }, ...patches]
        : patches,
    );
  };
  const command = useAction(async ({
      kind,
      input,
    }: {
      kind: "catalog" | "refresh" | "push";
      input: Record<string, unknown>;
    }) => {
      setError(undefined);
      try {
        if (kind === "catalog") await list();
        else if (kind === "refresh") await read(input);
        else {
          if (!target || !shown || !work.slice?.basis || work.revision == null)
            throw Error("Review the exact schedule binding first");
          if (unresolved) throw Error("Recover or resume the original receipt before a new apply");
          const row = await runSemanticAction("schedule-grid.apply", {}, target, {
            work: { key: scope, revision: work.revision },
          });
          setLastId(row.id);
          if ("result" in row && row.result && typeof row.result === "object") {
            const result = row.result as {
              readback?: unknown;
              failures?: { key: string; error: string }[];
              readbackError?: string;
            };
            if (result.readback) setReading(scheduleReadingSchema.parse(result.readback));
            if (result.failures?.length || result.readbackError)
              throw Error(
                [
                  ...(result.failures ?? []).map((f) => `${f.key}: ${f.error}`),
                  result.readbackError,
                ]
                  .filter(Boolean)
                  .join("; "),
              );
          }
          if (row.state !== "succeeded")
            throw Error("error" in row ? row.error : `Action ${row.state}; read original receipt`);
          receipts.refresh();
        }
        return { ok: true, revision: work.revision ?? 0 } as const;
      } catch (error) {
        setError(String(error));
        return {
          ok: false,
          kind: "error",
          error: String(error),
          hint: "Read the original action receipt",
        } as const;
      }
    });
  const state: ScheduleGridState = {
    ...work,
    apply,
    execute: (kind, input = {}) => command.mutateAsync({ kind, input }),
    snapshot: shown?.snapshot ?? null,
    catalog: catalog ?? null,
    busy: command.isPending ? null : readingBusy,
    // A disabled Push has to say WHICH condition disabled it; `blocked: boolean` folded six of them.
    blockedBecause: unresolved
      ? "Recover or resume the original receipt before a new apply"
      : !target
        ? "Select an available document and session"
        : work.refreshing
          ? "The route-state stream is re-establishing — writes are refused until it settles"
          : work.connected !== true
            ? "The route-state bridge is not connected"
            : work.outcomeUnknown
              ? "A previous push outcome is unknown — read the original receipt"
              : basis.error
                ? `The basis reading could not be read: ${String(basis.error)}`
                : receipts.error
                  ? `Receipts could not be polled: ${String(receipts.error)}`
                  : null,
  };
  return (
    <>
      {(error || basis.error || receipts.error) && (
        <div role="alert">{error ?? String(basis.error ?? receipts.error)}</div>
      )}
      {hasWork && reading && basisId !== reading.id && (
        <div role="status">
          Staged cells retain their original binding reading. Apply checks current bindings before
          writing.
        </div>
      )}
      {relevant.some((r) => Date.parse(r.startedAt) >= Date.parse(shown?.capturedAt ?? "")) && (
        <div role="status">
          An apply occurred after this reading; re-read to observe current values.
        </div>
      )}
      <ActionReceipts scope={receiptScope} lastId={lastId} />
      {render ? render(state) : <ScheduleGridWorkspace state={state} />}
    </>
  );
}

import { useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  scheduleCatalogSchema,
  scheduleReadingSchema,
  type ActionStatus,
  type Reading,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { previousOf } from "#/readings";
import { refuse, useRoute } from "#/route";
import { ActionReceiptView } from "#/actions/receipt";
import { scheduleGridManifest, type ScheduleGridPage } from "./manifest";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

const valueOf = <T,>(reading: Reading<unknown>, schema: { parse(value: unknown): T }) => {
  const value = previousOf(reading);
  return value === undefined ? undefined : schema.parse(value);
};

const readingError = (reading: Reading<unknown>) =>
  reading.state === "failed" ? reading.message : undefined;

export function LiveScheduleGridWorkspace({
  workspaceId,
  render,
}: {
  workspaceId?: string;
  render?: (state: ScheduleGridState) => ReactNode;
}) {
  const workbench = useContext(WorkbenchContext);
  const manifest = useMemo(() => scheduleGridManifest(), []);
  const handle = useRoute(manifest, {
    page: { workspaceId: workspaceId ?? "" },
    target: (page) => (page.target ? JSON.stringify({ kind: "open", ref: page.target }) : null),
    work: (page, target) => (target ? page.workspaceId || undefined : undefined),
  });
  const [page, setPage] = handle.page;
  const target =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : undefined;
  const targetKey = target ? `${target.session}:${target.openId}` : null;
  const previousTarget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!targetKey) {
      if (previousTarget.current) setPage({ workspaceId: "", captureId: "" });
      return;
    }
    if (previousTarget.current && previousTarget.current !== targetKey)
      setPage({ workspaceId: "", captureId: "" });
    previousTarget.current = targetKey;
  }, [setPage, targetKey]);

  useEffect(() => {
    if (workspaceId !== undefined) setPage({ workspaceId });
  }, [setPage, workspaceId]);

  const work = handle.work;
  const catalog = valueOf(handle.readings.catalog, scheduleCatalogSchema);
  const retained = valueOf(handle.readings.work, scheduleReadingSchema);
  const saved = valueOf(handle.readings.saved, scheduleReadingSchema);
  const receipts = (previousOf(handle.readings.receipts) as ActionStatus[] | undefined) ?? [];
  const hasWork = Object.values(work.doc?.cells ?? {}).some((cell) => cell.staged || cell.proposal);
  const basisId = work.doc?.basis?.captureId;

  useEffect(() => {
    if (
      retained &&
      (page.target?.session !== retained.target.session ||
        page.target.openId !== retained.target.openId)
    )
      setPage({ target: retained.target });
  }, [page.target, retained, setPage]);

  useEffect(() => {
    if (hasWork && basisId && page.captureId !== basisId) setPage({ captureId: basisId });
  }, [basisId, hasWork, page.captureId, setPage]);

  const shown = hasWork && basisId ? saved : (retained ?? saved);
  const unresolved = receipts.some((row) =>
    ["running", "unknown", "incomplete"].includes(row.state),
  );
  const apply = async (patches: RouteStatePatch[], expectedRevision?: number) => {
    if (!shown) return refuse("not-ready", "Read the schedule before editing: Select a schedule");
    const writing = patches.some((patch) => patch.value !== undefined);
    return work.write(
      writing && (!hasWork || !work.doc?.basis)
        ? [{ path: ["basis"], value: { captureId: shown.id } }, ...patches]
        : patches,
      expectedRevision,
    );
  };
  const execute: ScheduleGridState["execute"] = (kind, input = {}) =>
    handle.actions[kind].run(input);
  const readingFailure =
    readingError(handle.readings.catalog) ??
    readingError(handle.readings.work) ??
    readingError(handle.readings.saved) ??
    readingError(handle.readings.receipts);
  const blockedBecause = unresolved
    ? "Recover or resume the original receipt before a new apply"
    : !target
      ? "Select an available document and session"
      : !page.workspaceId
        ? "Read a schedule before staging or pushing"
        : work.revision !== null && !work.current
          ? "The route-state stream is re-establishing — writes are refused until it settles"
          : !work.current
            ? "The route-state bridge is not connected"
            : readingError(handle.readings.saved)
              ? `The basis reading could not be read: ${readingError(handle.readings.saved)}`
              : readingError(handle.readings.receipts)
                ? `Receipts could not be polled: ${readingError(handle.readings.receipts)}`
                : handle.actions.push.refusal;
  const state: ScheduleGridState = {
    slice: work.doc,
    hydrated: work.current || work.revision !== null,
    refreshing: work.revision !== null && !work.current,
    apply,
    peaActive: workbench?.isRunning ?? false,
    connected: work.current ? true : work.revision === null ? null : false,
    failure: handle.failure,
    execute,
    snapshot: shown?.snapshot ?? null,
    catalog: catalog ?? null,
    busy: handle.busy?.key ?? null,
    blockedBecause,
  };

  return (
    <>
      {(readingFailure || !target) && (
        <div role="status">
          {readingFailure ?? "Select an available document and session to read schedules"}
        </div>
      )}
      {hasWork && retained && basisId !== retained.id && (
        <div role="status">
          Staged cells retain their original binding reading. Apply checks current bindings before
          writing.
        </div>
      )}
      {receipts.some(
        (receipt) => Date.parse(receipt.startedAt) >= Date.parse(shown?.capturedAt ?? ""),
      ) && (
        <div role="status">
          An apply occurred after this reading; re-read to observe current values.
        </div>
      )}
      <ScheduleReceipts workspaceId={page.workspaceId} receipts={receipts} />
      {render ? render(state) : <ScheduleGridWorkspace state={state} />}
    </>
  );
}

function ScheduleReceipts({
  workspaceId,
  receipts,
}: {
  workspaceId: ScheduleGridPage["workspaceId"];
  receipts: ActionStatus[];
}) {
  if (!workspaceId) return null;
  return (
    <section aria-label="Actions for this selection">
      {receipts.length === 0 && <div>No unresolved actions for this selection</div>}
      {receipts.map((receipt) => (
        <ActionReceiptView key={receipt.id} id={receipt.id} />
      ))}
    </section>
  );
}

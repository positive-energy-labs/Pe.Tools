import { useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { frozenDemo } from "#/host/demo-client";
import {
  unstale,
  scheduleCatalogSchema,
  scheduleReadingSchema,
  type ScheduleReading,
  type ActionStatus,
  type Reading,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { previousOf } from "#/readings";
import { refuse, useRoute, type EntitySearch } from "#/route";
import { ActionReceiptView } from "#/actions/receipt";
import { EntityRouteView } from "#/route/entity";
import { ActionFlag } from "#/route/situation";
import { usePodList } from "#/route/pods";
import { DEMO_SPEC } from "#/route/seeds";
import { scheduleSpec, schedulesManifest, type ScheduleGridPage } from "./manifest";
import { cellText } from "./columns";
import { StaleResolve } from "./stale-resolve";
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
  framed,
  target: chosen = null,
  thread,
  entry,
  url = true,
}: {
  workspaceId?: string;
  render?: (state: ScheduleGridState) => ReactNode;
  /** `/schedules` draws the entity route around the grid; a chat pane draws the grid alone. */
  framed?: boolean;
  /** The route's `?target` pin; absent, the thread head names the document. */
  target?: string | null;
  /** The thread whose head is the target store. */
  thread?: string;
  /** The route's URL page state (stage, pod, path), read once at mount. */
  entry?: EntitySearch;
  /** False in a chat pane, which does not own the URL. */
  url?: boolean;
}) {
  const workbench = useContext(WorkbenchContext);
  const manifest = useMemo(() => schedulesManifest(), []);
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(manifest, {
    provided: { pods },
    page: {
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...Object.fromEntries(Object.entries(entry ?? {}).filter(([, value]) => value)),
    },
    target: chosen,
    thread,
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

  // `/schedules` owns its URL: the open schedule rides it, so a reload reopens it.
  const navigate = useNavigate();
  useEffect(() => {
    if (!framed || !url) return;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        schedule: page.workspaceId || undefined,
      }),
      replace: true,
    } as never);
  }, [framed, url, navigate, page.workspaceId]);

  const work = handle.work;
  const catalog = valueOf(handle.readings.catalog, scheduleCatalogSchema);
  const retained = valueOf(handle.readings.work, scheduleReadingSchema);
  const saved = valueOf(handle.readings.saved, scheduleReadingSchema);
  const receipts = (previousOf(handle.readings.receipts) as ActionStatus[] | undefined) ?? [];
  const hasWork = Object.values(work.doc?.cells ?? {}).some((cell) => cell.staged || cell.proposal);
  const basisId = work.doc?.basis?.captureId;

  // Held while an action runs: a push's readback rebinds the basis mid-action, and a page move here
  // would void that action's own page writes (its run line); it lands on the same capture anyway.
  const acting = handle.busy !== null;
  useEffect(() => {
    if (!acting && hasWork && basisId && page.captureId !== basisId)
      setPage({ captureId: basisId });
  }, [acting, basisId, hasWork, page.captureId, setPage]);

  // Staged cells are keyed by the basis reading's rows. A later reading (a push's readback) is
  // drawn only while its rows are the same elements in the same positions: written cells then show
  // what Revit now holds, and a still-staged cell overlays the row it was staged on (F-S-1).
  const shown =
    hasWork && basisId
      ? retained && saved && retained.id !== basisId && sameRows(saved, retained)
        ? retained
        : saved
      : (retained ?? saved);
  const unresolved = receipts.some((row) =>
    ["running", "unknown", "incomplete"].includes(row.state),
  );
  const apply = async (patches: RouteStatePatch[], expectedRevision?: number) => {
    if (!shown) return refuse("not-ready", "Read the schedule before editing: Select a schedule");
    const writing = patches.some((patch) => patch.value !== undefined);
    // Staging or unstaging a stale key is the person's answer to it: the key leaves `basis.stale`.
    const restaged = patches.flatMap(({ path: [cells, key, rung] }) =>
      cells === "cells" && rung === "staged" ? [String(key)] : [],
    );
    return work.write(
      writing && (!hasWork || !work.doc?.basis)
        ? // not a cell: basis
          [{ path: ["basis"], value: { captureId: shown.id } }, ...patches]
        : [...patches, ...unstale(work.doc, restaged)],
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
    revision: work.revision,
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

  const resolve = (
    <StaleResolve
      doc={work.doc}
      current={(key) => cellText(shown?.snapshot, key)}
      write={apply}
      revision={work.revision}
      push={() => execute("push")}
      unread={page.unread}
      readAgain={() => execute("refresh")}
    />
  );
  const audit = (
    <div className="flex size-full min-h-0 min-w-0 flex-col">
      {(readingFailure || !target) && (
        <div role="status">
          {readingFailure ??
            handle.bindingLost?.sentence ??
            "Select an available document and session to read schedules"}
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
      {page.pushRun && <div role="status">push run · {page.pushRun}</div>}
      <ScheduleReceipts workspaceId={page.workspaceId} receipts={receipts} />
      {/* Unframed there is no head: the stale cells and their aggregate stand in the audit. */}
      {framed ? null : resolve}
      {render ? render(state) : <ScheduleGridWorkspace state={state} />}
    </div>
  );
  if (!framed) return audit;
  return (
    <ActionFlag.Provider value={{ push: resolve }}>
      <EntityRouteView
        def={scheduleSpec}
        handle={handle as never}
        refreshPods={refreshPods}
        fixture={demo ? DEMO_SPEC : undefined}
        url={url}
        band={resolve}
      >
        {audit}
      </EntityRouteView>
    </ActionFlag.Provider>
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

/** The same schedule rows: each row number stands for the same elements in both readings. */
const sameRows = (a: ScheduleReading, b: ScheduleReading) =>
  a.snapshot.scheduleUniqueId === b.snapshot.scheduleUniqueId &&
  a.snapshot.rows.length === b.snapshot.rows.length &&
  a.snapshot.rows.every(
    (row, index) =>
      row.rowNumber === b.snapshot.rows[index]!.rowNumber &&
      JSON.stringify(row.subjectIds) === JSON.stringify(b.snapshot.rows[index]!.subjectIds),
  );

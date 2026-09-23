import { useEffect, useMemo, useRef, type ReactNode } from "react";
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
import { changedInRevit, previousOf, useHostStatus } from "#/readings";
import { refuse, useRoute, type EntitySearch } from "#/route";
import { KeysNode, manifestChords } from "#/route/keys";
import { ActionReceiptView } from "#/actions/receipt";
import { EntityRouteView } from "#/route/entity";
import { ActionFlag } from "#/route/situation-verbs";
import { usePodList } from "#/route/pods";
import { DEMO_SPEC } from "#/route/seeds";
import { scheduleSpec, schedulesManifest } from "./manifest";
import { cellText } from "./columns";
import { StaleResolve } from "./stale-resolve";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";
import { SCHEDULE_STAGES } from "./stage";

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
  useEffect(() => {
    if (!page.workspaceId && retained?.workspaceId) setPage({ workspaceId: retained.workspaceId });
  }, [page.workspaceId, retained?.workspaceId, setPage]);
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
  const unresolved = receipts.filter((row) =>
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
        ? // not a cell: basis, and when that read was taken
          [
            { path: ["basis"], value: { captureId: shown.id } },
            { path: ["takenAt"], value: shown.capturedAt },
            ...patches,
          ]
        : [...patches, ...unstale(work.doc, restaged)],
      expectedRevision,
    );
  };
  const execute: ScheduleGridState["execute"] = (kind, input = {}) =>
    handle.actions[kind].run(input);
  // Freshness is what the envelope says: the host marks a document's Readings changed and this
  // draws the mark. A bridge that is gone says so instead: nothing can be known about a model we
  // are not attached to, and every Reading taken before the detach comes back marked.
  const gridChanged = changedInRevit(handle.readings.work) || changedInRevit(handle.readings.saved);
  const railChanged = changedInRevit(handle.readings.catalog);
  const connected = previousOf(useHostStatus())?.bridgeIsConnected !== false;
  const freshness: ScheduleGridState["freshness"] = !connected
    ? "disconnected"
    : gridChanged
      ? "changed"
      : "current";
  const readingFailure =
    readingError(handle.readings.catalog) ??
    readingError(handle.readings.work) ??
    readingError(handle.readings.saved) ??
    readingError(handle.readings.receipts);
  /**
   * A pane's focus edge: re-read only when Revit says this document changed since the read was
   * taken. An unmarked pane is left alone, and a pane already focused is never re-read under the
   * hands — this runs on the focus edge only.
   */
  const focusOf = (pane: "rail" | "grid") => () => {
    const declared = SCHEDULE_STAGES[page.stage === "archived" ? "audit" : page.stage].panes[pane];
    if (!declared || handle.busy) return;
    if (!(pane === "grid" ? gridChanged : railChanged)) return;
    if (!declared.reads) return handle.revalidate(declared.draws);
    if (shown) void handle.actions[declared.reads].run({ scheduleId: shown.snapshot.scheduleId });
  };
  const state: ScheduleGridState = {
    slice: work.doc,
    revision: work.revision,
    hydrated: work.current || work.revision !== null,
    apply,
    execute,
    snapshot: shown?.snapshot ?? null,
    catalog: catalog ?? null,
    busy: handle.busy?.key ?? null,
    blockedBecause: handle.actions.push.refusal,
    refused: page.refused,
    onFocus: { rail: focusOf("rail"), grid: focusOf("grid") },
    freshness,
    documentScope: target
      ? { bridgeSessionId: target.session, openDocumentId: target.openId }
      : undefined,
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
      {readingFailure ? <div role="status">{readingFailure}</div> : null}
      {/* The one non-empty case: a receipt that needs recovery before a new push. */}
      {unresolved.map((receipt) => (
        <ActionReceiptView key={receipt.id} id={receipt.id} />
      ))}
      {framed ? null : resolve}
      {render ? render(state) : <ScheduleGridWorkspace state={state} />}
    </div>
  );
  const framedView = (
    <ActionFlag.Provider value={{ push: resolve }}>
      <EntityRouteView
        def={scheduleSpec}
        handle={handle as never}
        refreshPods={refreshPods}
        fixture={demo ? DEMO_SPEC : undefined}
        url={url}
        band={resolve}
        stages={SCHEDULE_STAGES}
      >
        {audit}
      </EntityRouteView>
    </ActionFlag.Provider>
  );
  return (
    <KeysNode id={handle.manifest.name} keys={framed && url ? manifestChords(handle) : []}>
      {framed ? framedView : audit}
    </KeysNode>
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

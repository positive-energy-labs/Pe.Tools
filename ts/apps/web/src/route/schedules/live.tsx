import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { frozenDemo } from "#/host/demo-client";
import {
  unstale,
  scheduleCatalogSchema,
  scheduleReadingSchema,
  scheduleGridDocumentSchema,
  type ScheduleReading,
  type ActionStatus,
  type Reading,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { changedInRevit, previousOf, useHostStatus } from "#/readings";
import { refuse, useRoute } from "#/route";
import { KeysNode, manifestChords, useScopeKeys } from "#/route/keys";
import { EntityRouteView } from "#/route/entity";
import { ActionFlag } from "#/route/situation-verbs";
import { usePodList } from "#/route/pods";
import { DEMO_SPEC } from "#/route/seeds";
import { scheduleSpec, schedulesManifest } from "./manifest";
import { StaleResolve } from "./stale-resolve";
import { ScheduleGridWorkspace, scheduleCellWire, type ScheduleGridState } from "./workspace";
import { SCHEDULE_STAGES, scheduleRung } from "./stage";
import { ScheduleReview } from "./review";
import {
  advanceScheduleHistory,
  sameScheduleDoc,
  scheduleHistoryStep,
  type ScheduleHistory,
} from "./history";

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
  /** False in a chat pane, which does not own the URL. */
  url?: boolean;
}) {
  const manifest = useMemo(() => schedulesManifest(), []);
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const handle = useRoute(manifest, {
    provided: { pods },
    page: workspaceId === undefined ? {} : { workspaceId },
    url,
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
        : (saved ?? (retained?.id === basisId ? retained : undefined))
      : (retained ?? saved);
  const unresolved = receipts.filter((row) =>
    ["running", "unknown", "incomplete"].includes(row.state),
  );
  const scope = JSON.stringify([targetKey, page.workspaceId]);
  const historyRef = useRef<ScheduleHistory | null>(null);
  if (historyRef.current?.scope !== scope)
    historyRef.current = {
      scope,
      revision: work.revision,
      undo: [],
      redo: [],
      pending: [],
      replay: null,
    };
  const clearHistory = () => {
    historyRef.current = {
      scope,
      revision: work.revision,
      undo: [],
      redo: [],
      pending: [],
      replay: null,
    };
  };
  useEffect(() => {
    const history = historyRef.current;
    if (history?.scope === scope && !advanceScheduleHistory(history, work.doc, work.revision))
      clearHistory();
  }, [scope, work.doc, work.revision]);
  const apply = async (patches: RouteStatePatch[], expectedRevision?: number) => {
    if (!shown) return refuse("not-ready", "Read the schedule before editing: Select a schedule");
    const history = historyRef.current!;
    const before =
      history.pending.at(-1)?.after ?? work.doc ?? scheduleGridDocumentSchema.parse({});
    const hasPendingWork = Object.values(before.cells).some((cell) => cell.staged || cell.proposal);
    const writing = patches.some((patch) => patch.value !== undefined);
    // Staging or unstaging a stale key is the person's answer to it: the key leaves `basis.stale`.
    const restaged = patches.flatMap(({ path: [cells, key, rung] }) =>
      cells === "cells" && rung === "staged" ? [String(key)] : [],
    );
    const next: RouteStatePatch[] =
      writing && (!hasPendingWork || !before.basis)
        ? // not a cell: basis, and when that read was taken
          [
            { path: ["basis"], value: { captureId: shown.id } },
            { path: ["takenAt"], value: shown.capturedAt },
            ...patches,
          ]
        : [...patches, ...unstale(before, restaged)];
    const step = scheduleHistoryStep(before, next);
    if (step && sameScheduleDoc(before, step.after)) return null;
    if (!step || history.replay) {
      clearHistory();
      return work.write(next, expectedRevision ?? work.revision ?? undefined);
    }
    history.pending.push(step);
    const refusal = await work.write(next, expectedRevision ?? work.revision ?? undefined);
    if (refusal) clearHistory();
    return refusal;
  };
  const replayHistory = async (direction: "undo" | "redo") => {
    const history = historyRef.current!;
    const step = (direction === "undo" ? history.undo : history.redo).at(-1);
    if (!step || history.pending.length || history.replay) return;
    if (
      history.revision !== work.revision ||
      !sameScheduleDoc(work.doc, direction === "undo" ? step.after : step.before)
    ) {
      clearHistory();
      handle.note("undo", "Schedule Work changed; the local undo history was cleared.", true);
      return;
    }
    history.replay = { step, direction };
    const refusal = await work.write(
      direction === "undo" ? step.inverse : step.forward,
      work.revision ?? undefined,
    );
    if (refusal) {
      clearHistory();
      handle.note("undo", refusal.message, true);
    }
  };
  const execute: ScheduleGridState["execute"] = (kind, input = {}) => {
    clearHistory();
    return handle.actions[kind].run(input);
  };
  useEffect(() => {
    if (handle.busy?.key === "apply" || handle.busy?.key === "read") clearHistory();
  }, [handle.busy?.key]);
  // Freshness is what the envelope says: the host marks a document's Readings changed and this
  // draws the mark. A bridge that is gone says so instead: nothing can be known about a model we
  // are not attached to, and every Reading taken before the detach comes back marked.
  const gridChanged = changedInRevit(handle.readings.work) || changedInRevit(handle.readings.saved);
  const listChanged = changedInRevit(handle.readings.catalog);
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
  // Ruling 9: a failed read and a receipt awaiting recovery are log rows, never page data. Each
  // notes once per new fact; `handle.note` is a fresh closure every render, so it is not a dep.
  useEffect(() => {
    if (readingFailure) handle.note("read", readingFailure, true);
  }, [readingFailure]); // eslint-disable-line react-hooks/exhaustive-deps
  const unresolvedKey = unresolved.map((row) => `${row.id}:${row.state}`).join(",");
  useEffect(() => {
    for (const row of unresolved)
      handle.note(`push ${row.state}`, "Recover or resume this receipt before a new push", true, {
        kind: "receipt",
        id: row.id,
      });
  }, [unresolvedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * A pane's focus edge: re-read only when Revit says this document changed since the read was
   * taken. An unmarked pane is left alone, and a pane already focused is never re-read under the
   * hands — this runs on the focus edge only.
   */
  const focusOf = (pane: "list" | "grid") => () => {
    const declared = SCHEDULE_STAGES[page.stage].panes[pane];
    if (!declared || handle.busy) return;
    if (!(pane === "grid" ? gridChanged : listChanged)) return;
    if (!declared.reads) return handle.revalidate(declared.draws);
    if (shown) {
      clearHistory();
      void handle.actions[declared.reads].run({ scheduleId: shown.snapshot.scheduleId });
    }
  };
  const [activeRow, locateRow] = useState<string | null>(null);
  const state: ScheduleGridState = {
    activeRow,
    locateRow,
    slice: work.doc,
    revision: work.revision,
    hydrated: work.current || work.revision !== null,
    apply,
    execute,
    snapshot: shown?.snapshot ?? null,
    catalog: catalog ?? null,
    busy: handle.busy?.key ?? null,
    blockedBecause: handle.actions.apply.refusal,
    refused: page.refused,
    onFocus: { grid: focusOf("grid") },
    freshness,
    documentScope: target
      ? { bridgeSessionId: target.session, openDocumentId: target.openId }
      : undefined,
  };

  const resolve = (
    <StaleResolve
      doc={work.doc}
      write={apply}
      revision={work.revision}
      push={() => execute("apply")}
      unread={page.unread}
      readAgain={() => execute("read")}
    />
  );
  // Stale resolve is apply's question (ruling 39): it stands on apply's flag while it has one.
  const staleStaged = (work.doc?.basis?.stale ?? []).some((s) => work.doc?.cells[s.key]?.staged);
  const auditRef = useRef<HTMLDivElement | null>(null);
  const audit = (
    <div ref={auditRef} className="flex size-full min-h-0 min-w-0 flex-col">
      {framed ? null : <ScheduleReview state={state} staleBar={resolve} />}
      {render ? (
        render(state)
      ) : (
        <ScheduleGridWorkspace
          state={state}
          onRefused={(says) => handle.note("fill", says, true)}
        />
      )}
    </div>
  );
  const framedView = (
    <ActionFlag.Provider value={staleStaged || page.unread ? { apply: resolve } : {}}>
      <EntityRouteView
        def={scheduleSpec}
        handle={handle as never}
        refreshPods={refreshPods}
        fixture={demo ? DEMO_SPEC : undefined}
        url={url}
        wire={scheduleCellWire(state)}
        work={(_, sentence) => (
          <>
            {sentence}
            <ScheduleReview state={state} />
          </>
        )}
        stages={SCHEDULE_STAGES}
        onPalette={focusOf("list")}
        targetRungs={() => [
          scheduleRung(
            catalog ?? null,
            shown?.snapshot ?? null,
            readingError(handle.readings.catalog),
            execute,
          ),
        ]}
      >
        {audit}
      </EntityRouteView>
    </ActionFlag.Provider>
  );
  return (
    // A chat pane does not own the URL, so its undo keys never bind on /chat's document.
    <KeysNode
      id={handle.manifest.name}
      keys={framed && url ? manifestChords(handle) : []}
      hidden={!url}
    >
      <ScheduleHistoryKeys
        region={framed ? null : auditRef}
        undo={() => void replayHistory("undo")}
        redo={() => void replayHistory("redo")}
      />
      {framed ? framedView : audit}
    </KeysNode>
  );
}

function ScheduleHistoryKeys({
  region,
  undo,
  redo,
}: {
  region: React.RefObject<HTMLDivElement | null> | null;
  undo: () => void;
  redo: () => void;
}) {
  useScopeKeys(
    [
      { hotkey: "Mod+Z", callback: undo, label: "undo staged schedule edit" },
      { hotkey: "Mod+Shift+Z", callback: redo, label: "redo staged schedule edit" },
      { hotkey: "Mod+Y", callback: redo, label: "redo staged schedule edit" },
    ],
    region,
  );
  return null;
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

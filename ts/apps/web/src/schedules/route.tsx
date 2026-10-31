import { createContext, useContext, useState, type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import {
  canonicalRouteInput,
  routeAddress,
  showCellValue,
  splitScheduleCellKey,
  type ActionReceipt,
  type HistoryRow,
  type ScheduleCatalog,
  type ScheduleCatalogEntry,
  type ScheduleGridDocument,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { ScheduleGridWorkspace, type ScheduleGridState } from "#/route/schedules/workspace";
import { ScheduleWorkLines } from "#/route/schedules/work-lines";
import { StaleResolve } from "#/route/schedules/stale-resolve";
import { isSpecOf } from "#/route/workflow";
import { SchedulesOwner, type SchedulesMount } from "./context";
import { schedulesGraph, SCHEDULE_SPEC_SCHEMA, type SchedulesPage } from "./graph";
import {
  readingValue,
  scheduleEditRefusal,
  schedulesBinding,
  shownSchedule,
  type SchedulesScope,
} from "./actions";
import { schedulesSources, type ScheduleOutcome } from "./sources";

interface ScheduleView {
  state: ScheduleGridState;
  scope: SchedulesScope;
  outcome: ScheduleOutcome;
}
const ScheduleView = createContext<ScheduleView | null>(null);
const useScheduleView = () => useContext(ScheduleView)!;

/** Projection only: the kernel owns acquisition, Target/Work, Page, writes, review and history. */
function SchedulesProvider({ owner, children }: { owner: SchedulesMount; children: ReactNode }) {
  const scope: SchedulesScope = {
    ...owner.snapshot(),
    page: owner.view.read().page,
    readings: Object.fromEntries(
      Object.keys(schedulesGraph.readings).map((id) => [id, owner.readings.get(id)]),
    ),
  };
  const { work, page, target } = scope;
  const shown = shownSchedule(scope);
  const outcome = readingValue<ScheduleOutcome>(scope, "outcome") ?? {
    unread: 0,
    refused: {},
    readbackError: null,
    receiptId: null,
  };
  const freshness =
    scope.readings.retained?.current && scope.readings.saved?.current ? "current" : "changed";
  const native =
    !!shown &&
    target.kind === "document" &&
    canonicalRouteInput(shown.target) === canonicalRouteInput(target.ref) &&
    freshness === "current";
  const state: ScheduleGridState = {
    slice: page.stage === "history" ? null : (work?.doc ?? null),
    revision: work?.handle.revision ?? null,
    hydrated: work !== null,
    apply: async (patches, expectedRevision = work?.handle.revision ?? -1) => {
      const result = await owner.control("edit", { patches, expectedRevision }).run();
      return "refusal" in result ? result.refusal : null;
    },
    execute: async (id, input) => {
      const result = await owner.control(id === "apply" ? "push" : id, input).run();
      return "refusal" in result ? result.refusal : null;
    },
    snapshot: shown?.snapshot ?? null,
    catalog: readingValue<ScheduleCatalog>(scope, "catalog"),
    busy: owner.busy()?.key ?? null,
    blockedBecause: owner.control("push").refusal,
    refused: outcome.refused,
    // Revalidation is kernel-owned; an unchanged focus never starts another native read.
    onFocus: { grid: () => {} },
    freshness,
    nativeObservation: {
      scope: shown
        ? { document: native ? shown.target : null, source: native ? "native" : "saved" }
        : null,
    },
    documentScope: shown
      ? { bridgeSessionId: shown.target.session, openDocumentId: shown.target.openId }
      : undefined,
    table: { query: page.query, sorts: page.sort, hiddenColumns: page.hidden },
    setTable: (next) =>
      owner.view.setPage(
        { query: next.query, sort: next.sorts, hidden: next.hiddenColumns ?? [] },
        { history: "replace" },
      ),
    cell: page.cell,
    locate: (cell) => owner.view.setPage({ cell }),
  };
  return (
    <RegistryContext value={owner.registry}>
      <SchedulesOwner value={owner}>
        <ScheduleView value={{ scope, state, outcome }}>{children}</ScheduleView>
      </SchedulesOwner>
    </RegistryContext>
  );
}

function ScheduleList({ owner, page, verbs }: MountBody<SchedulesPage, ScheduleGridDocument>) {
  const { scope } = useScheduleView();
  const catalog = readingValue<ScheduleCatalog>(scope, "catalog");
  const history = readingValue<HistoryRow[]>(scope, "history");
  const rows = page.stage === "history" ? (history ?? []) : (catalog?.schedules ?? []);
  const list = useList<ScheduleCatalogEntry | HistoryRow>({
    items: rows,
    keyOf: (row) => ("scheduleId" in row ? String(row.scheduleId) : row.id),
    search: (row) => ({
      text: "name" in row ? [row.name, row.categoryName ?? ""] : [row.label, row.at],
    }),
    select: "single",
    onPick: (row) =>
      "scheduleId" in row
        ? owner.view.setPage({ workspaceId: row.workspaceId ?? "", captureId: "" })
        : owner.view.setPage({ captureId: row.id }),
  });
  return (
    <ListView
      list={list}
      aria-label={page.stage === "history" ? "Schedule reads" : "Schedules"}
      empty={{
        message: page.stage === "history" ? "No retained reads" : "No schedules in this document",
        exit: "Choose an open project document",
      }}
      row={(row) =>
        "scheduleId" in row
          ? {
              label: row.name,
              sub: row.categoryName ?? undefined,
              active: row.workspaceId === page.workspaceId,
              actions: verbs({ scheduleId: row.scheduleId }),
            }
          : {
              label: row.label,
              sub: new Date(row.at).toLocaleString(),
              active: row.id === page.captureId,
            }
      }
    />
  );
}

function GridBody() {
  const { scope, state } = useScheduleView();
  const [failure, setFailure] = useState<string | null>(null);
  const error = ["catalog", "retained", "saved", "receipts"]
    .map((id) => scope.readings[id]?.error)
    .find(Boolean);
  return (
    <>
      {(error || failure) && (
        <OutcomeLine kind="error" label="Schedule grid" says={error ?? failure!} />
      )}
      <ScheduleGridWorkspace state={state} onRefused={setFailure} onHidden={setFailure} />
    </>
  );
}

function WorkBody({ owner, page, verbs }: MountBody<SchedulesPage, ScheduleGridDocument>) {
  const { scope, state, outcome } = useScheduleView();
  const cells = state.slice?.cells ?? {};
  const first = Object.keys(cells).find((key) => cells[key]?.suggestion || cells[key]?.edit);
  const key = cells[page.cell] ? page.cell : first;
  const row = key ? splitScheduleCellKey(key) : null;
  const refusal = scheduleEditRefusal(scope);
  return (
    <>
      {refusal && <OutcomeLine kind="error" label="Schedule Work" says={refusal} />}
      {outcome.receiptId && (
        <a href={routeAddress("ops").link({ actionId: outcome.receiptId })}>Open push receipt</a>
      )}
      {!scope.work?.doc.basis && verbs(undefined)}
      <StaleResolve
        doc={state.slice}
        write={state.apply}
        revision={state.revision}
        push={() => state.execute("apply")}
        unread={outcome.unread}
        readAgain={() => state.execute("read")}
      />
      {outcome.readbackError && (
        <OutcomeLine kind="error" label="Readback" says={outcome.readbackError} />
      )}
      {key && row && (
        <div data-key={`cells:${key}`} role="group" aria-label={`Cell ${key}`}>
          <span>
            {state.snapshot?.columns.find((column) => column.columnNumber === row.columnNumber)
              ?.headerText ?? `Column ${row.columnNumber}`}{" "}
            · row {row.rowNumber} ·{" "}
            {showCellValue(cells[key]?.edit?.value ?? cells[key]?.suggestion?.value)}
          </span>
          {verbs({ segment: "cells", key })}
        </div>
      )}
      <ScheduleWorkLines
        state={state}
        tab={page.lines}
        onTab={(lines) => owner.view.setPage({ lines })}
      />
    </>
  );
}

function SpecBody({ owner, page }: MountBody<SchedulesPage, ScheduleGridDocument>) {
  const { scope } = useScheduleView();
  const pods = readingValue<PodList["pods"]>(scope, "pods") ?? [];
  const rows = pods.flatMap((pod) =>
    pod.members
      .filter((member) => isSpecOf(member.schema, SCHEDULE_SPEC_SCHEMA))
      .map((member) => ({ ...member, pod: pod.id })),
  );
  const list = useList({
    items: rows,
    keyOf: (row) => `${row.pod}/${row.path}`,
    search: (row) => ({ text: [row.pod, row.path] }),
    select: "single",
    onPick: (row) => owner.view.setPage({ pod: row.pod, path: row.path }),
  });
  if (!rows.length)
    return (
      <EmptyState story="scope" exit="Capture a schedule into a pod">
        No saved schedule specs
      </EmptyState>
    );
  return (
    <ListView
      list={list}
      aria-label="Schedule specs"
      row={(row) => ({
        label: row.path,
        sub: row.pod,
        active: page.pod === row.pod && page.path === row.path,
        actions: (
          <a href={routeAddress("pods").link({ pod: row.pod, path: row.path })}>Open in Pods</a>
        ),
      })}
      empty={{ message: "No saved schedule specs", exit: "Capture a schedule into a pod" }}
    />
  );
}

export const schedulesAdapters: RouteAdapters<SchedulesPage, ScheduleGridDocument> = {
  sources: schedulesSources(),
  binding: schedulesBinding,
  cell: (row, scope) => {
    const value = row as { segment?: string; key?: string } | undefined;
    if (value?.segment !== "cells" || !value.key || !scope.work || scheduleEditRefusal(scope))
      return null;
    return {
      type: "cell:cells",
      id: value.key,
      work: scope.work.handle.key,
      path: ["cells", value.key],
    };
  },
  subjects: {},
  verbReadings: {},
  receiptPaths: (receipt: ActionReceipt) => (receipt.key === "schedule.grid.push" ? [[]] : []),
  wrap: (owner, children) => <SchedulesProvider owner={owner}>{children}</SchedulesProvider>,
  bodies: {
    list: (body) => <ScheduleList {...body} />,
    grid: () => <GridBody />,
    work: (body) => <WorkBody {...body} />,
    spec: (body) => <SpecBody {...body} />,
  },
};
export const schedulesRoute = routeFromGraph(schedulesGraph, schedulesAdapters, "/schedules");

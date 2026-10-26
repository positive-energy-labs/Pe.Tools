import type { ScheduleGridDocument, ScheduleReading } from "@pe/agent-contracts";
import type { EntityPage, RouteHandle } from "#/route";
import { useRouteLease } from "#/route/view-bridge";
import type { ScheduleGridPage } from "./manifest";
import type { ScheduleGridState } from "./workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route's own Reading and action keys
type Handle = RouteHandle<ScheduleGridDocument, any, ScheduleGridPage & EntityPage, any>;

/**
 * The grid's view and its located cell, as contract fields (`routeAddress("schedules")`): a link
 * reopens them and Pea sets them. Typing, a header sort and a column toggle are gestures: each
 * rewrites this history entry.
 */
export function scheduleView([page, setPage]: Handle["page"]): Pick<
  ScheduleGridState,
  "table" | "setTable" | "cell" | "locate"
> {
  return {
    table: { sorts: page.sort, query: page.query, hiddenColumns: page.hidden },
    setTable: (next) =>
      setPage(
        { query: next.query, sort: next.sorts, hidden: next.hiddenColumns ?? [] },
        { history: "replace" },
      ),
    cell: page.cell,
    locate: (cell) => setPage({ cell }),
  };
}

/** What the Schedules page tells Pea it shows: the open schedule, its columns and its counts. */
export function useScheduleLease(
  handle: Handle,
  {
    url,
    visible,
    shown,
    freshness,
  }: {
    url: boolean;
    visible: boolean;
    shown: ScheduleReading | undefined;
    freshness: ScheduleGridState["freshness"];
  },
) {
  const page = handle.page[0];
  const cells = Object.values(handle.work.doc?.cells ?? {});
  useRouteLease("schedules", handle.page, {
    thread: handle.thread ?? undefined,
    url,
    visible,
    context: {
      stage: page.stage,
      workspaceId: page.workspaceId,
      captureId: shown?.id ?? null,
      document: shown?.target ?? null,
    },
    facts: {
      schedule: shown?.snapshot.scheduleName ?? null,
      columns:
        shown?.snapshot.columns.map((column) => ({
          key: `c${column.columnNumber}`,
          header: column.headerText,
        })) ?? [],
      rows: shown?.snapshot.rows.length ?? 0,
      staged: cells.filter((cell) => cell.staged).length,
      proposals: cells.filter((cell) => cell.proposal != null).length,
      freshness,
    },
  });
}

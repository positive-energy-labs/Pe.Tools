import { createFileRoute } from "@tanstack/react-router";

import { entitySearch, useRouteThread, type EntitySearch } from "#/route";
import { routeSearch } from "#/route/route-owner";
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";

export const schedulesSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & EntitySearch & { schedule?: string } => ({
  ...routeSearch(search),
  ...entitySearch(search),
  /** The open schedule's reading (`workspaceId`), so a reload reopens it. */
  schedule:
    typeof search.schedule === "string" && search.schedule.trim()
      ? search.schedule.trim()
      : undefined,
});

export const Route = createFileRoute("/schedules")({
  validateSearch: schedulesSearch,
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const { target, schedule, stage, pod, path } = Route.useSearch();
  const thread = useRouteThread();
  return (
    <LiveScheduleGridWorkspace
      framed
      target={target ?? null}
      thread={thread}
      workspaceId={schedule}
      entry={{ stage, pod, path }}
    />
  );
}

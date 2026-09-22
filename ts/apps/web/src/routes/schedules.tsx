import { createFileRoute } from "@tanstack/react-router";

import { entitySearch, routeSearch, useRouteThread, type EntitySearch } from "#/route";
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import { schedulesManifest } from "#/route/schedules/manifest";

/** The route, declared once. `route/schedules/live.tsx` binds it to the grid and the pods. */
export const manifest = schedulesManifest();

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

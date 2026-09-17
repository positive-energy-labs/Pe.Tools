import { createFileRoute } from "@tanstack/react-router";

import { routeSearch } from "#/route";
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import { schedulesManifest } from "#/route/schedules/manifest";

/** The route, declared once. `route/schedules/live.tsx` binds it to the grid and the pods. */
export const manifest = schedulesManifest();

export const schedulesSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & { thread?: string } => ({
  ...routeSearch(search),
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
});

export const Route = createFileRoute("/schedules")({
  validateSearch: schedulesSearch,
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const { target } = Route.useSearch();
  return <LiveScheduleGridWorkspace framed target={target ?? null} />;
}

import { createFileRoute } from "@tanstack/react-router";

import { routeSearch } from "#/route";
import { scheduleGridManifest } from "#/schedule-grid/manifest";
import { ScheduleGridRoute } from "#/schedule-grid/route";

/** The route, declared once. `schedule-grid/live.tsx` re-derives it with the workspace bound. */
export const manifest = scheduleGridManifest();

export const scheduleGridSearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & { thread?: string } => ({
  ...routeSearch(search),
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
});

export const Route = createFileRoute("/schedule-grid")({
  validateSearch: scheduleGridSearch,
  component: ScheduleGridFileRoute,
});

function ScheduleGridFileRoute() {
  return <ScheduleGridRouteContent />;
}

export function ScheduleGridRouteContent() {
  return <ScheduleGridRoute />;
}

import { createFileRoute } from "@tanstack/react-router";
import { FixtureScheduleGrid } from "#/schedule-grid/fixture";
import { ScheduleGridRoute } from "#/schedule-grid/route";

export const scheduleGridSearch = (
  search: Record<string, unknown>,
): { thread?: string; source?: "fixture" } => ({
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? "fixture" : undefined,
});

export const Route = createFileRoute("/schedule-grid")({
  validateSearch: scheduleGridSearch,
  component: ScheduleGridFileRoute,
});

function ScheduleGridFileRoute() {
  return <ScheduleGridRouteContent source={Route.useSearch().source} />;
}

export function ScheduleGridRouteContent({ source }: { source?: "fixture" }) {
  return source === "fixture" ? <FixtureScheduleGrid /> : <ScheduleGridRoute />;
}

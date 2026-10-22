import { useRouteSearch } from "#/route/activity";
import { createFileRoute } from "@tanstack/react-router";

import { urlPage, useRouteThread } from "#/route";
import { routeSearch } from "#/route/route-owner";
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import { schedulesManifest } from "#/route/schedules/manifest";

const url = urlPage(schedulesManifest())!;

export const schedulesSearch = (search: Record<string, unknown>) => ({
  ...routeSearch(search),
  ...url.read(search),
});

export const Route = createFileRoute("/schedules")({
  validateSearch: schedulesSearch,
  search: { middlewares: [...url.middlewares] },
  component: SchedulesRoute,
});

function SchedulesRoute() {
  const { target } = useRouteSearch("schedules");
  const thread = useRouteThread();
  return <LiveScheduleGridWorkspace framed target={target ?? null} thread={thread} />;
}

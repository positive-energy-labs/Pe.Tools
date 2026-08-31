import { createFileRoute } from "@tanstack/react-router";
import { FixtureInstancesPage } from "#/instances/fixture";
import { InstancesPage } from "#/instances/route";

export { InstancesPage } from "#/instances/route";

export const instancesSearch = (search: Record<string, unknown>) => ({
  thread: typeof search.thread === "string" ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? ("fixture" as const) : undefined,
});

export const Route = createFileRoute("/instances")({
  validateSearch: instancesSearch,
  component: InstancesFileRoute,
});

function InstancesFileRoute() {
  return <InstancesRouteContent source={Route.useSearch().source} />;
}

export function InstancesRouteContent({ source }: { source?: "fixture" }) {
  return source === "fixture" ? <FixtureInstancesPage /> : <InstancesPage />;
}

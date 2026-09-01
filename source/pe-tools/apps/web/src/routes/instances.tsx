import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FixtureInstancesPage } from "#/instances/fixture";
import { InstancesPage } from "#/instances/route";

export { InstancesPage } from "#/instances/route";

export const instancesSearch = (search: Record<string, unknown>) => ({
  thread: typeof search.thread === "string" ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? ("fixture" as const) : undefined,
  target: typeof search.target === "string" ? search.target.trim() : undefined,
});

export const Route = createFileRoute("/instances")({
  validateSearch: instancesSearch,
  component: InstancesFileRoute,
});

function InstancesFileRoute() {
  const navigate = useNavigate({ from: "/instances" });
  const search = Route.useSearch();
  return (
    <InstancesRouteContent
      source={search.source}
      target={search.target ?? ""}
      setTarget={(target) =>
        void navigate({
          search: (previous) => ({ ...previous, target: target || undefined }),
          replace: true,
        })
      }
    />
  );
}

export function InstancesRouteContent({
  source,
  target,
  setTarget,
}: {
  source?: "fixture";
  target: string;
  setTarget: (target: string) => void;
}) {
  return source === "fixture" ? (
    <FixtureInstancesPage target={target} setTarget={setTarget} />
  ) : (
    <InstancesPage target={target} setTarget={setTarget} />
  );
}

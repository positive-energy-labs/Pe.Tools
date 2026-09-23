import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InstancesPage } from "#/instances/route";

export { InstancesPage } from "#/instances/route";

export const instancesSearch = (search: Record<string, unknown>) => ({
  thread: typeof search.thread === "string" ? search.thread.trim() : undefined,
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
  target,
  setTarget,
}: {
  target: string;
  setTarget: (target: string) => void;
}) {
  return <InstancesPage target={target} setTarget={setTarget} />;
}

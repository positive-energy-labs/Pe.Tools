import { createFileRoute } from "@tanstack/react-router";
import { InstancesPage } from "#/instances/route";

export { InstancesPage } from "#/instances/route";

export const Route = createFileRoute("/instances")({
  validateSearch: (search: Record<string, unknown>) => ({
    thread: typeof search.thread === "string" ? search.thread.trim() : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  component: InstancesPage,
});

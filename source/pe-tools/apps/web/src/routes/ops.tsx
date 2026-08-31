import { createFileRoute } from "@tanstack/react-router";
import { OpsRoute } from "#/ops/route-workspace";

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const opsSearch = (search: Record<string, unknown>) => ({
  thread: str(search.thread) || undefined,
  source: search.source === "fixture" ? ("fixture" as const) : undefined,
});

export const Route = createFileRoute("/ops")({
  validateSearch: opsSearch,
  component: OpsFileRoute,
});

function OpsFileRoute() {
  const { source } = Route.useSearch();
  return <OpsRoute source={source} />;
}

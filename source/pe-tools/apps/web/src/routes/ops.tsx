import { createFileRoute } from "@tanstack/react-router";
import { OpsRoute } from "#/ops/route-workspace";

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/ops")({
  validateSearch: (search: Record<string, unknown>) => ({
    thread: str(search.thread) || undefined,
    source: str(search.source) || undefined,
  }),
  component: OpsRoute,
});

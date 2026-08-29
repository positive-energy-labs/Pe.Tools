import { createFileRoute } from "@tanstack/react-router";
import { TakeoffsRoute } from "#/takeoff/route";

export { resolvedWorldBinding, TakeoffsRoute, LiveTakeoffsRoute } from "#/takeoff/route";

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/takeoffs")({
  validateSearch: (search: Record<string, unknown>) => ({
    source: search.source === "fixture" ? ("fixture" as const) : ("live" as const),
    thread: str(search.thread) || undefined,
    targeting: search.targeting === "flow" ? ("flow" as const) : undefined,
  }),
  component: TakeoffsFileRoute,
});

function TakeoffsFileRoute() {
  const { source } = Route.useSearch();
  return <TakeoffsRoute source={source} />;
}

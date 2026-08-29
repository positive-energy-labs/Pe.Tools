import { createFileRoute } from "@tanstack/react-router";
import { type ScheduleGridDocument } from "@pe/agent-contracts";
import { RouteDocument } from "#/workbench/route-document";
import { ScheduleGridWorkspace } from "#/schedule-grid/workspace";

export const Route = createFileRoute("/schedule-grid")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: ScheduleGridRoute,
});

export type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

export type Snapshot = NonNullable<ScheduleGridDocument["snapshot"]>;

export type ScheduleRow = Snapshot["rows"][number];

export function ScheduleGridRoute() {
  return <RouteDocument>{(at) => <ScheduleGridWorkspace documentAddress={at} />}</RouteDocument>;
}

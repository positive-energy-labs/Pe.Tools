import { type ScheduleGridDocument } from "@pe/agent-contracts";
import { RouteScope } from "#/workbench/route-scope";
import { LiveScheduleGridWorkspace } from "#/schedule-grid/workspace";

export type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

export type Snapshot = NonNullable<ScheduleGridDocument["snapshot"]>;

export type ScheduleRow = Snapshot["rows"][number];

export function ScheduleGridRoute() {
  return <RouteScope>{(scope) => <LiveScheduleGridWorkspace scope={scope} />}</RouteScope>;
}

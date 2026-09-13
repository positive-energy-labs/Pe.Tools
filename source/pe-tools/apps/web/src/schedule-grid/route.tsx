import { type ScheduleGridDocument, type ScheduleGridSnapshot } from "@pe/agent-contracts";
import { LiveScheduleGridWorkspace } from "#/schedule-grid/live";

export type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

export type Snapshot = ScheduleGridSnapshot;

export type ScheduleRow = Snapshot["rows"][number];

export function ScheduleGridRoute() {
  return <LiveScheduleGridWorkspace />;
}

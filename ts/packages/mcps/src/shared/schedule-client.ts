import { contextFetch as fetch } from "@pe/runtime/context";
import {
  scheduleReadingSchema,
  scheduleCatalogSchema,
  type ScheduleCatalog,
  type ScheduleReading,
  type ScheduleGridDocument,
  type RouteEnvelope,
  type ScheduleReadKey,
  type DocumentRef,
} from "@pe/agent-contracts";
type ScheduleResult<K extends ScheduleReadKey> = K extends "schedule.grid.catalog"
  ? ScheduleCatalog
  : K extends "schedule.grid.bind"
    ? { envelope: RouteEnvelope<ScheduleGridDocument> }
    : ScheduleReading;

export async function readScheduleCapture<K extends ScheduleReadKey>(
  key: K,
  input: Record<string, unknown>,
  target?: DocumentRef,
  base = "",
): Promise<ScheduleResult<K>> {
  const response = await fetch(`${base}/schedules/readings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, input, target }),
  });
  const value = await response.json();
  // The status rides on the error: a 4xx is the host refusing the read (its `error` is the reason), anything else failed.
  if (!response.ok)
    throw Object.assign(
      Error((value as { error?: string }).error ?? `Schedule read failed (${response.status})`),
      { status: response.status },
    );
  const parsed = key === "schedule.grid.catalog" ? scheduleCatalogSchema.parse(value) : scheduleReadingSchema.parse(value);
  return parsed as ScheduleResult<K>;
}

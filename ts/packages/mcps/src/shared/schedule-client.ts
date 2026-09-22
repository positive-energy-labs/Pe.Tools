import {
  scheduleReadingSchema,
  scheduleCatalogSchema,
  type ScheduleReadKey,
  type DocumentRef,
} from "@pe/agent-contracts";
export async function readScheduleCapture(
  key: ScheduleReadKey,
  input: Record<string, unknown>,
  target?: DocumentRef,
  base = "",
) {
  const response = await fetch(`${base}/schedules/readings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, input, target }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error((value as { error?: string }).error ?? `Schedule read failed (${response.status})`);
  return key === "schedule.grid.catalog"
    ? scheduleCatalogSchema.parse(value)
    : scheduleReadingSchema.parse(value);
}

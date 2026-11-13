import { expect, test } from "vite-plus/test";
import { bindWork, type TimelineRow } from "@pe/agent-contracts";
import { activityTime, timelineRowKey } from "./timeline";

test("equal revisions on different Works have distinct row identities", () => {
  const row: TimelineRow = { kind: "edit", work: bindWork("fans", null, "a"), revision: 1, by: "human", label: "Edit", state: "applied", at: 1 };
  expect(timelineRowKey(row)).not.toBe(timelineRowKey({ ...row, work: bindWork("ducts", null, "a") }));
});

test("activity time treats ISO and epoch stamps alike and labels invalid stamps", () => {
  const iso = "2026-11-12T15:00:00Z";
  expect(activityTime(iso)).toBe(activityTime(Date.parse(iso)));
  expect(activityTime("not a time")).toBe("Time unavailable");
  expect(activityTime(NaN)).toBe("Time unavailable");
});

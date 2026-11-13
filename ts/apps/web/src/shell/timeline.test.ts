import { expect, test } from "vite-plus/test";
import { bindWork, type TimelineRow } from "@pe/agent-contracts";
import { timelineRowKey } from "./timeline";

test("equal revisions on different Works have distinct row identities", () => {
  const row: TimelineRow = { kind: "edit", work: bindWork("fans", null, "a"), revision: 1, by: "human", label: "Edit", state: "applied", at: 1 };
  expect(timelineRowKey(row)).not.toBe(timelineRowKey({ ...row, work: bindWork("ducts", null, "a") }));
});

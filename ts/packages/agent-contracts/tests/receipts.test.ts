import { expect, test } from "vite-plus/test";
import { receiptGoldenEnvelope, receiptMatches, receiptSchema } from "../src/receipts.ts";

test("golden envelope survives JSON without losing wire identity", () => {
  expect(receiptSchema.parse(JSON.parse(JSON.stringify(receiptGoldenEnvelope)))).toEqual(
    receiptGoldenEnvelope,
  );
  expect(
    receiptMatches(receiptGoldenEnvelope, { requestId: receiptGoldenEnvelope.join.requestId }),
  ).toBe(true);
  expect(receiptMatches(receiptGoldenEnvelope, { kinds: ["action"] })).toBe(false);
});
test("untrusted envelope fields, free faults, caller ids and MCP content fail closed", () => {
  const r = receiptGoldenEnvelope;
  for (const bad of [
    { ...r, schema: 2 },
    { ...r, revision: 0 },
    { ...r, component: "host" },
    { ...r, stamp: { ...r.stamp, commit: "unknown" } },
    { ...r, join: { requestId: "C:/private.rvt" } },
    { ...r, body: { kind: "diagnostic", code: "exception private text" } },
    { ...r, body: { kind: "feedback", explicitHumanSubmit: false, localRef: { path: "local" } } },
    { ...r, body: { kind: "usage", event: "app_boot", counters: { input: "secret" } } },
    {
      ...r,
      body: {
        kind: "mcp",
        event: "$mcp_tool_call",
        metadata: {
          source: "server",
          serverName: "pea",
          serverVersion: "1.0.0",
          serverBuild: "build",
          parameters: { secret: true },
        },
      },
    },
  ])
    expect(receiptSchema.safeParse(bad).success).toBe(false);
});
test("missing identity remains explicit local evidence", () => {
  expect(receiptSchema.parse({ ...receiptGoldenEnvelope, stamp: null }).stamp).toBeNull();
});

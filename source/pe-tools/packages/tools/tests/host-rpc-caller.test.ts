import { expect, test } from "vite-plus/test";
import { HostRpcCaller } from "../src/shared/host-rpc-caller.ts";

test("derives capability map from host operation metadata", () => {
  const result = new HostRpcCaller().searchOperations({ projection: "capability-map" });

  expect(Array.isArray(result)).toBe(false);
  if (Array.isArray(result)) throw new Error("expected capability-map projection");
  expect(result.generatedFrom).toBe("hostOperations");
  expect(result.rowCount).toBeGreaterThan(0);
  expect(result.matchedOperationKeys).toContain("revit.context.summary");
  expect(result.matchedOperationKeys).not.toContain("host.status");
  expect(result.matchedOperationKeys).not.toContain("bridge.sessions.summary");
  expect(result.matchedOperationKeys).not.toContain("logs.tail");
  expect(result.rendered).toContain("## Context");
});

test("keeps direct admin calls out of agent operation search", () => {
  const results = new HostRpcCaller().searchOperations({
    query: "status logs session",
    limit: 50,
  });

  expect(Array.isArray(results)).toBe(true);
  if (!Array.isArray(results)) throw new Error("expected matches projection");
  expect(results.map((result) => result.key)).not.toContain("host.status");
  expect(results.map((result) => result.key)).not.toContain("bridge.sessions.summary");
  expect(results.map((result) => result.key)).not.toContain("logs.tail");
});

test("rejects unknown dynamic operation keys before transport", async () => {
  const result = await new HostRpcCaller({
    hostBaseUrl: "http://127.0.0.1:1",
  }).callOperation("missing.operation");

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejected operation");
  expect(result.status).toBe(404);
});

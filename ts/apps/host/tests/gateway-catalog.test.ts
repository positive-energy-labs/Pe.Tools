import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { fixtureNative } from "./fixture-native.ts";

test("real native action admission retains one recorded availability catalog and refuses an unknown operation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-gateway-recorded-"));
  const native = await fixtureNative(dir, "retained-host-ops-catalog", "retained-script-Succeeded"); const socket = await native.connect();
  const post = native.actions();
  try {
    for (const id of ["first", "second"]) {
      const response = await post({ id, key: "scripting.execute", target: { kind: "document", ref: socket.target }, input: { scriptContent: "WriteLine(1);" } });
      expect(response.status, await response.clone().text()).toBeLessThan(400);
      expect(await native.journal.wait(id)).toMatchObject({ state: "succeeded" });
    }
    expect(native.calls.filter(call => call.key === "host.ops.catalog")).toHaveLength(1);
    expect(native.calls.filter(call => call.key === "scripting.execute")).toHaveLength(2);
    expect(native.calls.every(call => call.action === "scripting.execute")).toBe(true);
    const response = await post({ id: "unknown", key: "fixture.unknown", target: { kind: "document", ref: socket.target }, input: {} });
    expect(response.status).toBeLessThan(400);
    expect(await native.journal.wait("unknown")).toMatchObject({ state: "failed", notDispatched: true });
    expect(native.calls.some(call => call.key === "fixture.unknown")).toBe(false);
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});
// UNPROVEN[no recording]: malformed catalog rows and a late catalog from a replaced socket.

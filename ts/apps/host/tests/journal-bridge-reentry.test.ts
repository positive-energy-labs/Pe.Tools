import { journalAt } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordingRequest, nativeRecordings } from "./native-recordings.ts";

test("cold native command admission and its recorded outcome cross the real bridge and survive journal reconstruction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-journal-bridge-recorded-"));
  const native = await fixtureNative(dir, "retained-host-ops-catalog", "fresh-revit.context.lens"); const socket = await native.connect();
  const post = native.actions();
  const input = nativeRecordingRequest("fresh-revit.context.lens");
  const answer = nativeRecordings("fresh-revit.context.lens").responses["revit.context.lens"];
  try {
    const response = await post({ id: "lens", key: "revit.context.lens", target: { kind: "document", ref: socket.target }, input });
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    const result = await native.journal.wait("lens");
    expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded", steps: [{ key: "revit.context.lens", state: "succeeded", result: answer }] });
    expect(native.calls.map(call => call.key)).toEqual(["host.ops.catalog", "revit.context.lens"]);
    expect(native.calls.every(call => call.action === "revit.context.lens")).toBe(true);
    await native.journal.close();
    const restored = journalAt(join(dir, "partition-operations.json"), Date.now);
    try { expect(await restored.wait("lens")).toEqual(result); }
    finally { await restored.close(); }
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});
// Lost/late native replies and fabricated validation failures are no longer emulated here.
// Root Stop/consent has the real-admission Fans and harness surface homes listed in the sweep report.

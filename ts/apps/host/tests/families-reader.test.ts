import { expect, test, vi } from "vite-plus/test";
import { familiesRecorded } from "./families-recorded.fixture.ts";

test("recorded Families read traverses the real action declaration, enriches the actual cached records and publishes Work", async () => {
  const f = await familiesRecorded(); const id = crypto.randomUUID();
  try {
    const response = await f.read(id);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    const result = await f.native.journal.wait(id);
    expect(result, JSON.stringify(result)).toMatchObject({ state: "succeeded" });
    if (result.state !== "succeeded") throw Error(JSON.stringify(result));
    expect(f.native.calls.map(call => call.key)).toEqual(["revit.matrix.loaded-families", "revit.matrix.loaded-families"]);
    expect(f.native.calls[0]).toMatchObject({ action: "families.read", input: { phase: "Prepare" } });
    expect((await f.workspace.read(f.key, "families"))!.revision).toBe(2);
    expect(await f.captures.latestFamilies(f.key)).toMatchObject({ id: (result.result as any).id });
  } finally { await f.close(); }
});

test("real Families cancellation owns the exact read and late recorded success cannot publish it", async () => {
  const f = await familiesRecorded(); const id = crypto.randomUUID();
  f.hold();
  try {
    expect((await f.read(id)).status).toBeLessThan(400);
    await vi.waitFor(() => expect(f.native.calls.map(call => call.key)).toEqual(["revit.matrix.loaded-families"]));
    const response = await f.post({ id: "cancel", key: "families.cancel-read", target: { kind: "document", ref: f.socket.target }, input: { readId: id } });
    expect(response.status).toBeLessThan(400);
    f.release();
    expect(await f.native.journal.wait("cancel")).toMatchObject({ state: "succeeded", result: { cancelled: true } });
    expect((await f.native.journal.wait(id)).state).toBe("failed");
    expect(await f.captures.latestFamilies(f.key)).toBeNull();
    expect((await f.workspace.read(f.key, "families"))!.revision).toBe(1);
  } finally { await f.close(); }
});

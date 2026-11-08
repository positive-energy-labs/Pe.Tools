import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { setup } from "./schedule-test-fixture.ts";
import { fixtureNative } from "./fixture-native.ts";

test("E8 cold HTTP reentry converts a real running native write to unknown without redispatch", async () => {
  const f = await setup();
  const admission = await f.admission();
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  f.native.onRequest(async key => { if (key === "schedule.cells.apply") await hold; });
  const pending = f.submit(admission);
  const dir = await mkdtemp(join(tmpdir(), "pe-cold-write-"));
  let cold: Awaited<ReturnType<typeof fixtureNative>> | undefined;
  try {
    await vi.waitFor(async () => expect((await f.native.journal.list(undefined, admission.id))[0]).toMatchObject({ state: "running", steps: expect.arrayContaining([expect.objectContaining({ key: "schedule.cells.apply", state: "running", dispatchedAt: expect.any(String) })]) }));
    await copyFile(join(f.dir, "native", "partition-operations.json"), join(dir, "partition-operations.json"));
    const durable = (await readFile(join(dir, "partition-operations.json"), "utf8")).trim().split("\n")
      .map(line => JSON.parse(line)).flatMap(line => line.receipt?.body?.kind === "action" && line.receipt.body.value.id === admission.id ? [line.receipt.body.value] : []).at(-1);
    expect(durable).toMatchObject({ state: "running", steps: expect.arrayContaining([expect.objectContaining({ key: "schedule.cells.apply", state: "running", dispatchedAt: expect.any(String) })]) });
    cold = await fixtureNative(dir);
    const response = await cold.actions()(admission);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(await cold.journal.wait(admission.id)).toMatchObject({ state: "unknown", steps: expect.arrayContaining([expect.objectContaining({ key: "schedule.cells.apply", state: "unknown", dispatchedAt: expect.any(String) })]) });
    expect(cold.calls).toEqual([]);
  } finally { release(); await pending; await cold?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("E8 corrupt journal refuses a real action and preserves the exact malformed bytes", async () => {
  const f = await setup();
  const admission = await f.admission();
  const dir = await mkdtemp(join(tmpdir(), "pe-corrupt-journal-"));
  const path = join(dir, "partition-operations.json");
  const corrupt = Buffer.from("corrupt journal header\n", "utf8");
  await writeFile(path, corrupt);
  const cold = await fixtureNative(dir);
  try {
    let refused = false;
    try { refused = (await cold.actions()(admission)).status >= 400; }
    catch { refused = true; } // Startup itself can refuse corrupt durable storage.
    expect(refused).toBe(true);
    expect(await readFile(path)).toEqual(corrupt);
    expect(cold.calls).toEqual([]);
  } finally {
    // The rejected storage load is also reported by its owning finalizer.
    await cold.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

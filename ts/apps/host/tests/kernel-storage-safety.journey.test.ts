import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { readStoredNotices } from "@pe/host-contracts/store";
import { storedNoticesPath } from "../src/notice-feed.ts";
import { setup } from "./schedule-recorded-fixture.ts";
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

// Fail closed (MAP ruling 59d4f336, departing from ADR 0039 rule 1 for the journal): a journal
// that does not decode may hide a write whose outcome is unknown, so it is kept. The host starts,
// the action is refused with the file's path and reason, nothing is dispatched, the bytes do not
// change, and removing the file is the recovery.
test("E8 corrupt journal refuses a real action with its path and reason, keeps the exact bytes, and acts again once removed", async () => {
  const f = await setup();
  const admission = await f.admission();
  const dir = await mkdtemp(join(tmpdir(), "pe-corrupt-journal-"));
  const path = join(dir, "partition-operations.json");
  const corrupt = Buffer.from("corrupt journal header\n", "utf8");
  await writeFile(path, corrupt);
  const cold = await fixtureNative(dir);
  try {
    // One handler for both calls: the route binds the journal's command environment once.
    const act = cold.actions();
    const response = await act(admission);
    const said = await response.text();
    expect(response.status, said).toBeGreaterThanOrEqual(400);
    expect(said).toContain(JSON.stringify(path).slice(1, -1));
    expect(said).toContain("so the file is kept and no action runs until it is removed");
    expect(said).toContain("Journal header is not JSON");
    expect(cold.calls).toEqual([]);
    expect(await readFile(path)).toEqual(corrupt);
    expect(
      readStoredNotices(storedNoticesPath()).filter((notice) => notice.path === path),
    ).toMatchObject([{ class: "keep", place: "Action journal" }]);
    await rm(path);
    const recovered = await act(admission);
    expect(recovered.status, await recovered.clone().text()).toBeLessThan(400);
    expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":8}');
  } finally {
    await cold.close();
    await rm(dir, { recursive: true, force: true });
  }
});

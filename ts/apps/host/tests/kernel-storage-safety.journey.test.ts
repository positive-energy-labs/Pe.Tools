import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { ADMISSION_RESEND_HEADER } from "@pe/agent-contracts";
import { readStoredNotices, sha256Hex } from "@pe/host-contracts/store";
import { storedBlobsPath, storedNoticesPath } from "../src/notice-feed.ts";
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

// ADR 0039 rule 1 reverses this journey. It used to assert that a corrupt journal refuses every
// action and keeps its malformed bytes, which left the host unable to act until a person deleted
// the file. The journal is `discard`: it is deleted with one notice and the host acts on an empty
// journal. The boundary that still holds is the test above: a journal that decodes never
// redispatches a write it knows was running. A journal that does not decode knows nothing.
test("E8 corrupt journal is discarded with one notice, and a real action then runs", async () => {
  const f = await setup();
  const admission = await f.admission();
  const dir = await mkdtemp(join(tmpdir(), "pe-corrupt-journal-"));
  const path = join(dir, "partition-operations.json");
  const corrupt = Buffer.from("corrupt journal header\n", "utf8");
  await writeFile(path, corrupt);
  const cold = await fixtureNative(dir);
  try {
    const response = await cold.actions()(admission);
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(JSON.parse((await readFile(path, "utf8")).split("\n")[0]!)).toEqual({
      version: 8,
      discarded: expect.any(String),
    });
    expect(
      readStoredNotices(storedNoticesPath()).filter((notice) => notice.path === path),
    ).toMatchObject([{ class: "discard", place: "Action journal", sha256: sha256Hex(corrupt) }]);
    // Nothing is lost: the discarded bytes rest in the blob store under the hash the notice names.
    expect(await readFile(join(storedBlobsPath(), "sha256", sha256Hex(corrupt)))).toEqual(corrupt);
  } finally {
    await cold.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// The replay guard (MAP decision log 2026-11-12). A discarded journal knows nothing, so an
// admission that is re-sent to it (`ADMISSION_RESEND_HEADER`: an earlier send may have arrived)
// may already have run. It is refused with the reason and never dispatched as a new action. The
// refusal holds across a restart with the notice file gone, because the discard rides the
// journal's own header.
test("E8 a re-sent admission that a discarded journal does not know is refused, and nothing dispatches", async () => {
  const f = await setup();
  const admission = await f.admission();
  const resend = () =>
    new Request("http://host/actions", {
      method: "POST",
      headers: { "content-type": "application/json", [ADMISSION_RESEND_HEADER]: "2000-01-01T00:00:00.000Z" },
      body: JSON.stringify(admission),
    });
  const dir = await mkdtemp(join(tmpdir(), "pe-replay-journal-"));
  const intact = await mkdtemp(join(tmpdir(), "pe-replay-intact-"));
  const path = join(dir, "partition-operations.json");
  await writeFile(path, Buffer.from("corrupt journal header\n", "utf8"));
  let cold: Awaited<ReturnType<typeof fixtureNative>> | undefined;
  try {
    for (const start of ["the start that discards", "the next start"]) {
      cold = await fixtureNative(dir);
      const post = cold.actions();
      const refused = await post.request(resend());
      const said = await refused.text();
      expect(refused.status, `${start}: ${said}`).toBe(409);
      expect(JSON.parse(said), start).toMatchObject({
        error: {
          code: "journal.discarded",
          message: expect.stringMatching(/^Action .*was discarded\. It is not run again\./),
          details: { notDispatched: true, error: expect.stringMatching(/^Action /) },
        },
      });
      expect(said, start).toContain(admission.id);
      expect(cold.calls, start).toEqual([]);
      expect(await cold.journal.list(undefined, admission.id), start).toEqual([]);
      const header = JSON.parse((await readFile(path, "utf8")).split("\n")[0]!);
      for (const sentAt of [header.discarded, "", "1", "not-a-time"]) {
        const request = resend();
        request.headers.set(ADMISSION_RESEND_HEADER, sentAt);
        const invalid = await post.request(request);
        expect(invalid.status, sentAt).toBe(409);
        expect(await invalid.json()).toMatchObject({ error: { code: "journal.discarded", details: { notDispatched: true } } });
      }
      expect(cold.calls, start).toEqual([]);
      await cold.close();
      cold = undefined;
      // The notice is only the feed's row: losing the whole file changes nothing for the guard.
      await rm(storedNoticesPath(), { force: true });
    }
    // The guard reads the discard, not the re-send: a journal that kept its history (here, one
    // that never existed) admits the same re-sent bytes, because it knows it never ran them.
    cold = await fixtureNative(intact);
    const admitted = await cold.actions().request(resend());
    expect(admitted.status, await admitted.clone().text()).toBeLessThan(400);
  } finally {
    await cold?.close();
    await rm(dir, { recursive: true, force: true });
    await rm(intact, { recursive: true, force: true });
  }
});

test("E8 a new admission first sent after discard survives a lost first POST", async () => {
  const f = await setup();
  const admission = await f.admission();
  const dir = await mkdtemp(join(tmpdir(), "pe-new-after-discard-"));
  await writeFile(join(dir, "partition-operations.json"), "corrupt journal header\n");
  const cold = await fixtureNative(dir);
  try {
    await cold.journal.list();
    const header = JSON.parse((await readFile(join(dir, "partition-operations.json"), "utf8")).split("\n")[0]!);
    const sentAt = new Date(Date.parse(header.discarded) + 1).toISOString();
    const response = await cold.actions().request(new Request("http://host/actions", {
      method: "POST",
      headers: { "content-type": "application/json", [ADMISSION_RESEND_HEADER]: sentAt },
      body: JSON.stringify(admission),
    }));
    expect(response.status, await response.clone().text()).toBeLessThan(400);
    expect(await cold.journal.list(undefined, admission.id)).toHaveLength(1);
  } finally {
    await cold.close();
    await rm(dir, { recursive: true, force: true });
  }
});

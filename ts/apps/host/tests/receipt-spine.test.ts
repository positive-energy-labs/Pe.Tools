import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { readJournal } from "./journal-fixture.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { type Receipt, type ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { crossingOf } from "./callers.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const stamp = { ...receiptGoldenEnvelope.stamp!, component: "host" } as ReceiptStamp;
const admission = (id = "private caller id") => ({
  id,
  kind: "operation" as const,
  key: "test.receipt",
  ...crossingOf("human"),
  destination: { kind: "host" as const },
  input: { frozen: "exact" },
  bases: {},
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-spine-"));
  dirs.push(dir);
  const path = join(dir, "actions.json");
  return { path, owner: new ActionJournal(path, () => stamp) };
}

test("constructing and reading an empty journal leaves no files or floating writes", async () => {
  const { path, owner } = await fixture();
  expect(await owner.read({})).toEqual([]);
  expect(await owner.list()).toEqual([]);
  expect(await readdir(join(path, ".."))).toEqual([]);
  // An unused constructor must not start an asynchronous load or recreate a retired directory.
  new ActionJournal(join(path, "unused", "actions.json"));
  await rm(join(path, ".."), { recursive: true });
});

test("subscribers read one durable action authority, retain opaque ids across restart and cannot settle via facts", async () => {
  const { path, owner } = await fixture();
  const received: Receipt[] = [];
  const stop = owner.subscribe({ kinds: ["action"] }, (r) => {
    received.push(r);
  });
  let dispatches = 0;
  await owner.admit(
    admission(),
    async () => ({ original: true }),
    async (ex) =>
      ex.step("native", "test.native", {}, async () => {
        dispatches++;
        return 1;
      }),
  );
  const settled = await owner.wait(admission().id);
  await owner.admit(
    admission(),
    async () => {
      throw Error("duplicate prepare");
    },
    async () => {
      throw Error("duplicate dispatch");
    },
  );
  const [receipt] = await owner.read({ kinds: ["action"] });
  expect(dispatches).toBe(1);
  expect(receipt!.body).toEqual({ kind: "action", value: settled });
  expect(receipt!.join.actionId).not.toBe(admission().id);
  expect(received.at(-1)).toEqual(receipt);
  expect(new Set(received.map((r) => `${r.id}/${r.revision}`)).size).toBe(received.length);
  const disk = await readJournal(path);
  expect(disk.receipts.filter((r: Receipt) => r.body.kind === "action")).toEqual([receipt]);
  const restarted = new ActionJournal(path, () => ({ ...stamp, build: "successor" }));
  expect(await restarted.read({})).toEqual(await owner.read({}));
  const leaf = await restarted.requestJoin(settled.steps[0]!.id);
  expect(leaf).toEqual({
    actionId: receipt!.join.actionId,
    requestId: settled.steps[0]!.id,
    parentRequestId: receipt!.join.requestId,
  });
  await expect(owner.recordFact({ kind: "action", value: settled } as never)).rejects.toThrow();
  stop();
});

test("facts publish after commit, isolate listeners, and detach caller data", async () => {
  const { path, owner } = await fixture();
  const seen: Receipt[] = [];
  owner.subscribe({}, () => {
    throw Error("broken subscriber");
  });
  owner.subscribe({}, (r) => {
    seen.push(r);
  });
  const body = { kind: "usage" as const, event: "app_boot" as const, counters: {} };
  const r = await owner.recordFact(body);
  expect((await readJournal(path)).receipts).toContainEqual(r);
  expect(seen).toEqual([r]);
  expect(r.stamp).toEqual(stamp);
  // A journal the host cannot append to: the commit fails and publishes nothing.
  await chmod(path, 0o444);
  await expect(owner.recordFact(body)).rejects.toThrow();
  expect(seen).toEqual([r]);
  expect((await owner.read({}))[0]).toEqual(r);
  await chmod(path, 0o644);
  await owner.recordFact(body);
  expect(seen).toHaveLength(2);
});

test("producer replay retains its id and timestamp and cannot overwrite a committed fact", async () => {
  const { owner } = await fixture();
  const r = receiptGoldenEnvelope;
  const seen: Receipt[] = [];
  owner.subscribe({}, (receipt) => {
    seen.push(receipt);
  });
  const fact = { kind: "usage" as const, event: "app_boot" as const, counters: {} };
  const first = await owner.recordFact(fact, r.join, r.stamp, r);
  expect(await owner.recordFact(fact, r.join, r.stamp, r)).toEqual(first);
  expect(first.id).toBe(r.id);
  expect(first.at).toBe(r.at);
  expect(seen).toHaveLength(1);
  await expect(
    owner.recordFact({ ...fact, counters: { count: 1 } }, r.join, r.stamp, r),
  ).rejects.toThrow(/conflicts/);
  expect(await owner.read({})).toEqual([first]);
});

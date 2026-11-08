import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { type Receipt, type ReceiptStamp } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const stamp = { ...receiptGoldenEnvelope.stamp!, component: "host" } as ReceiptStamp;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-spine-"));
  dirs.push(dir);
  const path = join(dir, "actions.json");
  return { path, owner: new ActionJournal(path, Date.now, () => stamp) };
}

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
  expect(await new ActionJournal(path, Date.now).read({})).toContainEqual(r);
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

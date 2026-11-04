import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { chmod, mkdtemp, rm } from "node:fs/promises";
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

  key: "test.receipt",
  ...crossingOf("human"),
  effects: [{ kind: "session" as const, session: "receipt-spine-session" }],
  target: { kind: "host" as const },
  input: { frozen: "exact" },
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-spine-"));
  dirs.push(dir);
  const path = join(dir, "actions.json");
  return { path, owner: new ActionJournal(path, () => stamp) };
}

test("subscribers read one durable action authority, retain opaque ids across restart and cannot settle via facts", async () => {
  const { path, owner } = await fixture();
  const received: Receipt[] = [];
  const stop = owner.subscribe({ kinds: ["action"] }, (r) => {
    received.push(r);
  });
  let dispatches = 0,
    preparations = 0;
  const output = join(path, "..", "result.txt");
  owner.bindCommands({
    probe: async () => {
      throw Error("No dependency probe expected");
    },
    resolve: () => ({
      definition: {
        says: "Write file",
        needs: "nothing",
        effect: "command",
        dirties: [],
        input: z.object({ frozen: z.literal("exact") }),
      },
      bind: async () => ({
        effects: [{ kind: "file", path: output }],
        prepare: async () => {
          preparations++;
          return { bytes: "original bytes" };
        },
      }),
      prepared: z.object({ bytes: z.string() }),
      run: async (_context, ex) =>
        ex.step("file", "write", {}, async () => {
          dispatches++;
          await writeFile(output, (ex.prepared as { bytes: string }).bytes);
          return { path: output };
        }),
    }),
  });
  const { caller, basis, effects: _effects, ...request } = admission();
  await owner.invoke(request, { caller, basis });
  const settled = await owner.wait(request.id);
  await owner.invoke(request, { caller, basis });
  expect(await readFile(output, "utf8")).toBe("original bytes");
  const [receipt] = await owner.read({ kinds: ["action"] });
  expect(dispatches).toBe(1);
  expect(preparations).toBe(1);
  expect(receipt!.body).toEqual({ kind: "action", value: settled });
  expect(receipt!.join.actionId).not.toBe(admission().id);
  expect(received.at(-1)).toEqual(receipt);
  expect(new Set(received.map((r) => `${r.id}/${r.revision}`)).size).toBe(received.length);
  const disk = await new ActionJournal(path).read({});
  expect(disk.filter((r: Receipt) => r.body.kind === "action")).toEqual([receipt]);
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
  expect(await new ActionJournal(path).read({})).toContainEqual(r);
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

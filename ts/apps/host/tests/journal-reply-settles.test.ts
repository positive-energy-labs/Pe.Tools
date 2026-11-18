import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { actionStepSchema, persistedActionReceiptSchema, persistedReceiptSchema, type ActionStep } from "@pe/agent-contracts";
import { command } from "../src/command-executor.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";
import { fixtureNative } from "./fixture-native.ts";

// K1b: a reply settles a step forever. Rows are synthetic, shaped like field record 0cde3cc0.
const human = { kind: "human" as const, via: "cli" as const };
const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wrote = { kind: "wrote", transactions: [], added: 0, modified: 1, deleted: 0 };
const step = (over: Record<string, unknown>) => ({
  id: "s1", key: "test.write", kind: "native", input: {}, transport: "bridge",
  dispatchedAt: "2026-11-17T22:57:00Z", ...over,
});
const row = (state: Record<string, unknown>, steps: object[]) => ({
  id: "a1", key: "test.write", target: { kind: "host" }, input: {}, caller: human, basis: null,
  prepared: { state: "ready", value: {} }, recovery: [], startedAt: "2026-11-17T22:56:00Z",
  effects: [], claims: [], ...state, steps,
});
const fieldIncomplete = row(
  { state: "incomplete", error: "RuntimeFailed", status: 500, result: null },
  [step({ state: "failed", error: "RuntimeFailed", status: 500, bridgeReply: "touched", touched: wrote })],
);
const lost = (over: Record<string, unknown> = {}) =>
  row({ state: "unknown", error: "lost", status: 503 }, [step({ state: "unknown", error: "lost", status: 503, ...over })]);

async function journalWith(value: object, answer: (step: ActionStep) => object) {
  const dir = await mkdtemp(join(tmpdir(), "pe-reply-settles-"));
  const path = join(dir, "partition-operations.json");
  const parsed = persistedActionReceiptSchema.parse(value);
  await writeFile(path, [
    JSON.stringify({ version: 8 }),
    JSON.stringify({ mapping: [JSON.stringify(["action", parsed.id]), uuid(1)] }),
    JSON.stringify({ mapping: [JSON.stringify(["action-request", parsed.id]), uuid(2)] }),
    JSON.stringify({ receipt: persistedReceiptSchema.parse({ schema: 1, id: uuid(3), revision: 1, at: parsed.startedAt, stamp: null,
      join: { actionId: uuid(1), requestId: uuid(2) }, body: { kind: "action", value: parsed } }) }),
  ].join("\n") + "\n");
  const host = Scope.makeUnsafe();
  const journal = Context.get(await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)), ActionJournalService);
  const recover = vi.fn(async (asked: ActionStep) => ({ step: actionStepSchema.parse(answer(asked)), evidence: { sdk: "op result" } }));
  const target = vi.fn(async () => {});
  const ran: string[] = [];
  let definitions = 0;
  const definition = { says: "Write", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) } as const;
  journal.bindCommands({
    probe: async () => null,
    target,
    resolve: () => ({
      ...command(definition, z.unknown(), {
        bind: async () => ({ effects: [] }),
        recover,
        run: (_ctx, execution) => execution.step("native", "test.write", {}, () => Effect.die("never redispatched")).pipe(
          Effect.andThen(execution.step("publication", "work.retire", {}, () => Effect.sync(() => (ran.push("work.retire"), { retired: [] })))),
          Effect.as(null),
        ),
      }),
      // The first re-entry's definition read commits the row, so admission takes its retry path.
      definition: async () => {
        if (definitions++ === 0) await journal.markDispatched("s1", "bridge");
        return definition;
      },
    }),
  });
  return {
    journal, recover, target, ran,
    bytes: async () => { await journal.read({}); return readFile(path, "utf8"); },
    dispose: async () => { await settle(Scope.close(host, Exit.void)); await rm(dir, { recursive: true, force: true }); },
  };
}
const succeeded = (asked: ActionStep) => {
  const intent: Record<string, unknown> = { ...asked };
  delete intent.error;
  delete intent.status;
  return { ...intent, state: "succeeded", result: { ok: true }, bridgeReply: "touched", touched: wrote };
};

test("A: a failed step with a touched reply is never re-asked, by a resend or by recover", async () => {
  const f = await journalWith(fieldIncomplete, succeeded);
  try {
    const before = await f.bytes();
    const resent = await f.journal.invoke({ id: "a1", key: "test.write", target: { kind: "host" }, input: {} }, { caller: human, basis: null, resent: true });
    expect(resent).toMatchObject({ state: "incomplete", steps: [{ state: "failed", bridgeReply: "touched" }] });
    const recovered = await f.journal.recover("a1");
    expect(recovered).toMatchObject({ state: "incomplete", steps: [{ state: "failed", bridgeReply: "touched" }] });
    expect(f.recover).not.toHaveBeenCalled();
    expect(await f.bytes()).toBe(before);
  } finally { await f.dispose(); }
});

test.each([
  ["no reply", {}],
  ["a missing-touched reply", { bridgeReply: "missing-touched" }],
])("B: a dispatched step with %s is asked exactly once and settles from the answer", async (_name, reply) => {
  const f = await journalWith(lost(reply), (asked) => ({ ...asked, state: "failed", error: "RuntimeFailed", status: 500, bridgeReply: "touched", touched: wrote }));
  try {
    const recovered = await f.journal.recover("a1");
    expect(f.recover).toHaveBeenCalledTimes(1);
    expect(recovered).toMatchObject({ state: "incomplete", steps: [{ state: "failed", bridgeReply: "touched" }] });
    const settledBytes = await f.bytes();
    await f.journal.recover("a1");
    expect(f.recover).toHaveBeenCalledTimes(1);
    expect(await f.bytes()).toBe(settledBytes);
  } finally { await f.dispose(); }
});

test("C: a lost reply observed as succeeded retires its Work in retirement-only mode, retry included", async () => {
  const f = await journalWith(lost(), succeeded);
  try {
    await f.journal.recover("a1");
    const settled = await f.journal.wait("a1");
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "succeeded" });
    expect(settled.steps.map((each) => `${each.key}:${each.state}`)).toEqual(["test.write:succeeded", "work.retire:succeeded"]);
    expect(f.ran).toEqual(["work.retire"]);
    expect(f.recover).toHaveBeenCalledTimes(1);
    // The retry re-admission stays retirement-only: it never re-checks the live target.
    expect(f.target).not.toHaveBeenCalled();
  } finally { await f.dispose(); }
});

test("E: boot and a connect leave the field row untouched: no SDK read, no revision", async () => {
  const f = await journalWith({ ...fieldIncomplete, target: { kind: "session", session: "S" } }, succeeded);
  try {
    const before = await f.bytes();
    await f.journal.reconcile();
    await f.journal.reconcile("S");
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.ran).toEqual([]);
    expect(await f.bytes()).toBe(before);
  } finally { await f.dispose(); }
});

test("F: at boot an interrupted row whose steps all succeeded retires its Work without an SDK read", async () => {
  const answered = row({ state: "incomplete", error: "Host restarted", status: 503, result: null },
    [step({ state: "succeeded", result: { ok: true }, bridgeReply: "touched", touched: wrote })]);
  const f = await journalWith(answered, succeeded);
  try {
    await f.journal.reconcile();
    const settled = await f.journal.wait("a1");
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "succeeded" });
    expect(f.ran).toEqual(["work.retire"]);
    expect(f.recover).not.toHaveBeenCalled();
  } finally { await f.dispose(); }
});

test("D: the person- and agent-facing Recover and Resume doors are not routed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-reply-doors-"));
  const native = await fixtureNative(join(dir, "native"));
  try {
    const post = native.actions();
    for (const door of ["/actions/recover", "/actions/resume"]) {
      const response = await post.request(new Request(`http://host${door}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "any" }),
      }));
      expect(response.status, `${door}: ${await response.clone().text()}`).toBe(404);
    }
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});

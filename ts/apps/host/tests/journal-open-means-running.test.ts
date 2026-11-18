import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { persistedActionReceiptSchema, persistedReceiptSchema, type Claim } from "@pe/agent-contracts";
import { command } from "../src/command-executor.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";

// K1a: only a running action blocks an overlapping write or holds a claim. Rows are synthetic,
// shaped like the field records 0cde3cc0 (incomplete write script) and c86a4225 (unknown open).
const document = { kind: "document" as const, ref: { session: "S", openId: "D" } };
const slot: Claim = { kind: "session-slot", selector: { year: "2025" } };
const human = { kind: "human" as const, via: "cli" as const };
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const terminal = {
  incomplete: {
    id: "field-incomplete", key: "scripting.execute", state: "incomplete", error: "NullReferenceException", status: 500, result: null,
    effects: [document], claims: [],
    steps: [{ id: "s1", key: "scripting.execute", kind: "native", input: {}, transport: "bridge", state: "failed", error: "RuntimeFailed", status: 500,
      dispatchedAt: "2026-11-17T22:57:00Z", bridgeReply: "touched", touched: { kind: "wrote", transactions: [], added: 0, modified: 1, deleted: 0 } }],
  },
  unknown: {
    id: "field-unknown", key: "instances.open", state: "unknown", error: "session.boot-blocked", status: 500,
    effects: [], claims: [slot],
    steps: [{ id: "s1", key: "instances.open", kind: "native", input: {}, state: "unknown", error: "session.boot-blocked", status: 500,
      dispatchedAt: "2026-11-17T14:17:00Z" }],
  },
};

async function journalWith(rows: object[]) {
  const dir = await mkdtemp(join(tmpdir(), "pe-open-running-"));
  const lines = [JSON.stringify({ version: 8 })];
  rows.forEach((row, index) => {
    const value = persistedActionReceiptSchema.parse({ target: { kind: "host" }, input: {}, caller: human, basis: null,
      prepared: { state: "unprepared" }, recovery: [], startedAt: "2026-11-17T14:00:00Z", ...row });
    lines.push(JSON.stringify({ mapping: [JSON.stringify(["action", value.id]), uuid(index * 3 + 1)] }),
      JSON.stringify({ mapping: [JSON.stringify(["action-request", value.id]), uuid(index * 3 + 2)] }),
      JSON.stringify({ receipt: persistedReceiptSchema.parse({ schema: 1, id: uuid(index * 3 + 3), revision: 1, at: value.startedAt, stamp: null,
        join: { actionId: uuid(index * 3 + 1), requestId: uuid(index * 3 + 2) }, body: { kind: "action", value } }) }));
  });
  await writeFile(join(dir, "partition-operations.json"), lines.join("\n") + "\n");
  const host = Scope.makeUnsafe();
  const journal = Context.get(await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)), ActionJournalService);
  const hold = Deferred.makeUnsafe<void>();
  const entered: string[] = [];
  journal.bindCommands({
    probe: async () => null,
    resolve: () => command(
      { says: "Write or claim as the input says", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
      z.null(),
      {
        bind: async (ctx) => ({
          effects: ctx.admission.input.write ? [document] : [],
          claims: ctx.admission.input.claim ? [slot] : [],
        }),
        run: (ctx) => Effect.sync(() => entered.push(ctx.admission.id)).pipe(
          Effect.andThen(ctx.admission.input.hold ? Deferred.await(hold) : Effect.void),
          Effect.as(null),
        ),
      },
    ),
  });
  const invoke = (id: string, input: Record<string, unknown>) =>
    journal.invoke({ id, key: "scripting.execute", target: { kind: "host" }, input }, { caller: human, basis: null });
  return {
    journal, entered, invoke,
    release: () => Deferred.doneUnsafe(hold, Effect.void),
    dispose: async () => { Deferred.doneUnsafe(hold, Effect.void); await settle(Scope.close(host, Exit.void)); },
  };
}

test("A: an incomplete write script no longer blocks a later write on the same document", async () => {
  const f = await journalWith([terminal.incomplete]);
  try {
    await f.invoke("later-write", { write: true });
    const row = await f.journal.wait("later-write");
    expect(row, JSON.stringify(row)).toMatchObject({ state: "succeeded" });
    expect(f.entered).toEqual(["later-write"]);
  } finally { await f.dispose(); }
});

test("B: an unknown open no longer holds its session-slot claim", async () => {
  const f = await journalWith([terminal.unknown]);
  try {
    await f.invoke("later-open", { claim: true });
    const row = await f.journal.wait("later-open");
    expect(row, JSON.stringify(row)).toMatchObject({ state: "succeeded" });
    expect(row).not.toHaveProperty("refusal");
  } finally { await f.dispose(); }
});

test("a running action still blocks an overlapping write and still holds its claim", async () => {
  const f = await journalWith([]);
  try {
    await f.invoke("running", { write: true, claim: true, hold: true });
    await vi.waitFor(() => expect(f.entered).toEqual(["running"]));
    expect(await f.invoke("rival-claim", { claim: true }).catch((error) => error))
      .toMatchObject({ refusal: { kind: "claimed", claim: slot, by: "running" } });
    await f.invoke("queued-write", { write: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(f.entered).toEqual(["running"]);
    f.release();
    expect(await f.journal.wait("queued-write")).toMatchObject({ state: "succeeded" });
    expect(f.entered).toEqual(["running", "queued-write"]);
  } finally { await f.dispose(); }
});

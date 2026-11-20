import { mkdtemp, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { persistedActionReceiptSchema, persistedReceiptSchema, type Claim } from "@pe/agent-contracts";
import { command } from "@pe/host-internal/command-executor";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";

// A plan is single-use: an apply that may have dispatched keeps its `receipt` claim whatever it
// ended as, so a NEW action id applying the same preview is refused even when the document mark did
// not move. The K1a field shapes (a write after an incomplete script, a start after an unknown
// launch) stay admitted: journal-open-means-running.test.ts A and B.
const document = { kind: "document" as const, ref: { session: "S", openId: "D" } };
const human = { kind: "human" as const, via: "cli" as const };
const plan = (id: string): Claim => ({ kind: "receipt", id });
// The mark the preview sealed; the probe answers `true`, so it has not moved since.
const unmovedMark = { kind: "document-mark", probe: { ref: document.ref, sealed: { observedSince: 1, changedAt: null } }, expected: true };
const dispatched = { id: "s1", key: "rooms.write", kind: "native", input: {}, transport: "bridge", dispatchedAt: "2026-11-18T08:01:00Z" };
const applies = {
  // Option B ends every other claim at succeeded; the plan's receipt stays spent.
  succeeded: { state: "succeeded", result: null, steps: [{ ...dispatched, state: "succeeded", result: {} }] },
  unknown: { state: "unknown", error: "Host restarted before the executor recorded an outcome", status: 500,
    steps: [{ ...dispatched, state: "unknown", error: "lost", status: 500 }] },
  incomplete: { state: "incomplete", error: "RuntimeFailed", status: 500, result: null,
    steps: [{ ...dispatched, state: "failed", error: "RuntimeFailed", status: 500, bridgeReply: "touched",
      touched: { kind: "wrote", transactions: [], added: 0, modified: 1, deleted: 0 } }] },
};

async function journalAfter(first: object) {
  const dir = await mkdtemp(join(tmpdir(), "pe-receipt-single-use-"));
  const value = persistedActionReceiptSchema.parse({ id: "first-apply", key: "rooms.write", target: { kind: "host" }, input: {},
    caller: human, basis: null, prepared: { state: "unprepared" }, recovery: [], startedAt: "2026-11-18T08:00:30Z",
    effects: [document], consumes: [unmovedMark], claims: [plan("preview-1")], ...first });
  const ids = [1, 2, 3].map((n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  await writeFile(join(dir, "partition-operations.json"), [
    { version: 8 },
    { mapping: [JSON.stringify(["action", value.id]), ids[0]] },
    { mapping: [JSON.stringify(["action-request", value.id]), ids[1]] },
    { receipt: persistedReceiptSchema.parse({ schema: 1, id: ids[2], revision: 1, at: value.startedAt, stamp: null,
      join: { actionId: ids[0], requestId: ids[1] }, body: { kind: "action", value } }) },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  const host = Scope.makeUnsafe();
  const journal = Context.get(await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)), ActionJournalService);
  journal.bindCommands({
    probe: async (dependency) => (dependency.kind === "document-mark" ? true : null),
    resolve: () => command(
      { says: "Apply one preview", needs: "nothing", effect: "command", dirties: [], input: z.object({ preview: z.string() }) },
      z.null(),
      {
        bind: async (ctx) => ({ effects: [document], consumes: [unmovedMark as never], claims: [plan(ctx.admission.input.preview)] }),
        run: () => Effect.succeed(null),
      },
    ),
  });
  const apply = (id: string, preview: string) =>
    journal.invoke({ id, key: "scripting.execute", target: { kind: "host" }, input: { preview } }, { caller: human, basis: null })
      .then((admitted) => journal.wait(admitted.id), (error: unknown) => error);
  return { apply, close: () => settle(Scope.close(host, Exit.void)) };
}

test.each(["succeeded", "unknown", "incomplete"] as const)(
  "after an apply that ended %s, a new action id applying the same preview with an unmoved mark is refused claimed",
  async (ended) => {
    const f = await journalAfter(applies[ended]);
    try {
      expect(await f.apply("second-apply", "preview-1"))
        .toMatchObject({
          status: 409,
          notDispatched: true,
          error: "An earlier apply already used this plan. Generate a fresh plan before trying again.",
          refusal: { kind: "claimed", claim: plan("preview-1"), by: "first-apply" },
        });
    } finally { await f.close(); }
  },
);

test.each(["succeeded", "unknown", "incomplete"] as const)("after an apply that ended %s, a new preview on the same document is admitted", async (ended) => {
  const f = await journalAfter(applies[ended]);
  try {
    expect(await f.apply("new-preview", "preview-2")).toMatchObject({ state: "succeeded" });
  } finally { await f.close(); }
});

test("an apply refused before it dispatched spends nothing: the same preview applies again", async () => {
  const f = await journalAfter({ state: "failed", error: "refused", status: 409, notDispatched: true,
    steps: [{ id: "s1", key: "rooms.write", kind: "native", input: {}, state: "failed", error: "refused", status: 409, notDispatched: true }] });
  try {
    expect(await f.apply("retry", "preview-1")).toMatchObject({ state: "succeeded" });
  } finally { await f.close(); }
});

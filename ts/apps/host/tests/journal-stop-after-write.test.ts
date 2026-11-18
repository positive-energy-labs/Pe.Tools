import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { command, StepFailure } from "../src/command-executor.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";
import { markDispatched, recordNativeTerminal } from "../src/action-dispatch.ts";

// K3: a Stop that lands after Revit has replied `wrote`, before the attempt settles its row.
// Only the bridge is mocked: it answers op.cancel as Revit does for a request no longer in flight
// (BridgeRequestPump.cs CancelAsync). The registry's own default `cancel` maps that answer.
const human = { kind: "human", via: "local" } as const;
const wrote = { kind: "wrote", transactions: ["k3 701"], added: 0, modified: 1, deleted: 0 };
const notInFlight = (id: string) => `Request '${id}' is not in flight; nothing to cancel.`;
const bridge = {
  invoke: (_key: string, payload: { requestId: string }) =>
    Effect.succeed({ value: { cancelled: false, requestId: payload.requestId, message: notInFlight(payload.requestId) }, target: { session: "S", document: null } }),
};
const registryCancel = commandRegistry(bridge as never, {} as never, {} as never, () => Effect.fail(Error("unused")))("work.start").cancel!;

type Shape = { retire?: "ok" | "throws"; native?: "ok" | "cancelled"; holdFirst?: boolean };
async function fixture(shape: Shape) {
  const dir = await mkdtemp(join(tmpdir(), "pe-stop-after-write-"));
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  // Released by the test: Revit has replied, the attempt has not yet returned from the step.
  const release = Deferred.makeUnsafe<void>();
  const before = Deferred.makeUnsafe<void>();
  const waiting: string[] = [];
  const replied: string[] = [];
  const ran: string[] = [];
  journal.bindCommands({
    probe: async () => null,
    resolve: () => command(
      { says: "Write, then retire Work", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
      z.null(),
      {
        bind: async () => ({ effects: [] }),
        run: (_ctx, execution) => Effect.gen(function* () {
          // holdFirst: the Stop lands before any step exists, so nothing reached Revit.
          if (shape.holdFirst) { waiting.push("before"); yield* Deferred.await(before); }
          yield* execution.step("native", "test.write", {}, (id) => Effect.gen(function* () {
            yield* Effect.promise(() => markDispatched(id, "bridge"));
            yield* Effect.promise(() => recordNativeTerminal(id, wrote));
            replied.push(id);
            yield* Deferred.await(release);
            // Revit's own cancel after the script committed: 499 with `touched: wrote` already recorded.
            if (shape.native === "cancelled") return yield* Effect.fail(new StepFailure("Revit cancelled the request", 499, "cancelled"));
            return { ok: true };
          }));
          // The shape of workWriteBoundary's retirement after a families.apply write.
          if (shape.retire) yield* execution.step("publication", "work.retire", {}, () => shape.retire === "throws"
            // retireWork's own typed refusal (action-journal.ts); an untyped Error settles `unknown` instead.
            ? Effect.fail(new StepFailure("Retirement requires a proven external outcome", 409, "refused"))
            : Effect.sync(() => (ran.push("work.retire"), { retired: [] })));
          return null;
        }),
        cancel: registryCancel,
      },
    ),
  });
  return {
    journal, replied, ran, waiting,
    release: () => Deferred.doneUnsafe(release, Effect.void),
    start: () => Deferred.doneUnsafe(before, Effect.void),
    dispose: async () => {
      Deferred.doneUnsafe(release, Effect.void);
      Deferred.doneUnsafe(before, Effect.void);
      await settle(Scope.close(host, Exit.void));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("a Stop saved after Revit replied answers with the row, not 'nothing to cancel'", async () => {
  const f = await fixture({});
  try {
    await f.journal.invoke({ id: "stop-after-reply", key: "w", target: { kind: "host" }, input: {} }, { caller: human, basis: null });
    await vi.waitFor(() => expect(f.replied).toHaveLength(1));
    const stop = await f.journal.cancel("stop-after-reply").then((row) => ({ row }), (error: unknown) => ({ error: String(error) }));
    // The Stop is durable either way; the defect is that its caller is told it did nothing.
    expect((await f.journal.list(undefined, "stop-after-reply"))[0]).toMatchObject({ cancellationRequested: true });
    expect(stop).toMatchObject({ row: { id: "stop-after-reply", cancellationRequested: true } });
  } finally { await f.dispose(); }
});

test("a Stop after the write never settles the action as 'cancelled before dispatch'", async () => {
  const f = await fixture({ retire: "ok" });
  try {
    await f.journal.invoke({ id: "stop-after-write", key: "w", target: { kind: "host" }, input: {} }, { caller: human, basis: null });
    await vi.waitFor(() => expect(f.replied).toHaveLength(1));
    await f.journal.cancel("stop-after-write").catch(() => {});
    f.release();
    const settled = await f.journal.wait("stop-after-write");
    expect(settled.steps[0]).toMatchObject({ key: "test.write", bridgeReply: "touched", touched: { kind: "wrote" } });
    // The model holds the write: the receipt must not say the action was cancelled before dispatch.
    expect(settled.state, JSON.stringify(settled)).not.toBe("cancelled");
    expect("error" in settled ? settled.error : "").not.toMatch(/before dispatch/);
  } finally { await f.dispose(); }
});

test("Revit's own cancel after a committed write settles incomplete, never cancelled", async () => {
  const f = await fixture({ native: "cancelled" });
  try {
    await f.journal.invoke({ id: "cancel-after-commit", key: "w", target: { kind: "host" }, input: {} }, { caller: human, basis: null });
    await vi.waitFor(() => expect(f.replied).toHaveLength(1));
    f.release();
    const settled = await f.journal.wait("cancel-after-commit");
    expect(settled.steps[0]).toMatchObject({ state: "cancelled", touched: { kind: "wrote" } });
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "incomplete" });
  } finally { await f.dispose(); }
});

test("guard: a Stop before any dispatch still settles cancelled with notDispatched", async () => {
  const f = await fixture({ holdFirst: true });
  try {
    await f.journal.invoke({ id: "stop-before", key: "w", target: { kind: "host" }, input: {} }, { caller: human, basis: null });
    await vi.waitFor(() => expect(f.waiting).toHaveLength(1));
    await f.journal.cancel("stop-before");
    f.start();
    const settled = await f.journal.wait("stop-before");
    expect(f.replied).toHaveLength(0);
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "cancelled", notDispatched: true });
  } finally { await f.dispose(); }
});

test("a Stop after the write, then a retirement that fails on its own, settles incomplete", async () => {
  const f = await fixture({ retire: "throws" });
  try {
    await f.journal.invoke({ id: "stop-retire-fails", key: "w", target: { kind: "host" }, input: {} }, { caller: human, basis: null });
    await vi.waitFor(() => expect(f.replied).toHaveLength(1));
    await f.journal.cancel("stop-retire-fails");
    f.release();
    const settled = await f.journal.wait("stop-retire-fails");
    expect(settled, JSON.stringify(settled)).toMatchObject({ state: "incomplete", cancellationRequested: true, error: "Retirement requires a proven external outcome" });
    expect(settled.steps.map((each) => `${each.key}:${each.state}`)).toEqual(["test.write:succeeded", "work.retire:failed"]);
  } finally { await f.dispose(); }
});

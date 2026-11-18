import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { command } from "../src/command-executor.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { settle } from "./effect-test.ts";
import { markDispatched, recordNativeTerminal } from "../src/action-dispatch.ts";

// K3: a Stop that lands after Revit has replied `wrote`, before the attempt settles its row.
// Only the native side is mocked. The mock op.cancel answers as Revit does for a request that is
// no longer in flight (BridgeRequestPump.cs CancelAsync), mapped the way the registry's default
// cancel maps it (command-registry.ts: `cancelled === false` fails with the message).
const human = { kind: "human", via: "local" } as const;
const wrote = { kind: "wrote", transactions: ["k3 701"], added: 0, modified: 1, deleted: 0 };
const notInFlight = (id: string) => `Request '${id}' is not in flight; nothing to cancel.`;

async function fixture(retire: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "pe-stop-after-write-"));
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  // Released by the test: Revit has replied, the attempt has not yet returned from the step.
  const release = Deferred.makeUnsafe<void>();
  const replied: string[] = [];
  const ran: string[] = [];
  journal.bindCommands({
    probe: async () => null,
    resolve: () => command(
      { says: "Write, then retire Work", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
      z.null(),
      {
        bind: async () => ({ effects: [] }),
        run: (_ctx, execution) => execution.step("native", "test.write", {}, (id) => Effect.gen(function* () {
          yield* Effect.promise(() => markDispatched(id, "bridge"));
          yield* Effect.promise(() => recordNativeTerminal(id, wrote));
          replied.push(id);
          yield* Deferred.await(release);
          return { ok: true };
        })).pipe(Effect.andThen(() => retire
          // The shape of workWriteBoundary's retirement after a families.apply write.
          ? execution.step("publication", "work.retire", {}, () => Effect.sync(() => (ran.push("work.retire"), { retired: [] })))
          : Effect.succeed(null))),
        cancel: (requestId) => Effect.fail(Error(notInFlight(requestId))),
      },
    ),
  });
  return {
    journal, replied, ran,
    release: () => Deferred.doneUnsafe(release, Effect.void),
    dispose: async () => {
      Deferred.doneUnsafe(release, Effect.void);
      await settle(Scope.close(host, Exit.void));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("a Stop saved after Revit replied answers with the row, not 'nothing to cancel'", async () => {
  const f = await fixture(false);
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
  const f = await fixture(true);
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

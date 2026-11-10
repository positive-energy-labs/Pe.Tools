import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import type { RequestIdentityData } from "@pe/host-internal/request-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { command, StepFailure } from "../src/command-executor.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { settle } from "./effect-test.ts";

const human = { kind: "human", via: "local" } as const;

// ADR 0029 rule 10, durable command: only the native side is mocked; the journal is its live Layer.
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-attempt-"));
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, dir), host)),
    ActionJournalService,
  );
  const entered = Deferred.makeUnsafe<string>();
  const native = Deferred.makeUnsafe<unknown, StepFailure>();
  const calls: { key: string; requestId: string }[] = [];
  const seen: { identity?: RequestIdentityData; interrupted: boolean } = { interrupted: false };
  journal.bindCommands({
    probe: async () => null,
    resolve: () =>
      command(
        { says: "Hold one native write", needs: "nothing", effect: "command", dirties: [], input: z.record(z.string(), z.unknown()) },
        z.null(),
        {
          bind: async () => ({ effects: [] }),
          run: (_ctx, execution) =>
            execution.step("native", "test.hold", {}, (requestId) =>
              Effect.gen(function* () {
                seen.identity = yield* RequestIdentity;
                calls.push({ key: "test.hold", requestId });
                Deferred.doneUnsafe(entered, Effect.succeed(requestId));
                return yield* Deferred.await(native);
              }).pipe(Effect.onInterrupt(() => Effect.sync(() => void (seen.interrupted = true)))),
            ),
          // The mock native door: what the registry's `op.cancel` sends to Revit.
          cancel: async (requestId) => {
            calls.push({ key: CANCEL_OPERATION_KEY, requestId });
            return { cancelled: true };
          },
        },
      ),
  });
  const submitter = admittedRequestIdentity(human, {});
  // The /actions admission fiber: it journals the row, then is aborted with its request.
  const submit = (id: string) =>
    settle(
      Effect.gen(function* () {
        const admission = yield* Effect.forkChild(
          Effect.tryPromise(() =>
            journal.invoke(
              { id, key: "test.hold", target: { kind: "host" }, input: {} },
              { caller: human, basis: null, parent: submitter.requestId },
            ),
          ).pipe(Effect.andThen(Effect.never), Effect.provideService(RequestIdentity, submitter)),
        );
        const stepId = yield* Deferred.await(entered);
        yield* Fiber.interrupt(admission);
        return stepId;
      }),
    );
  return {
    journal,
    calls,
    seen,
    submitter,
    submit,
    answer: (value: Effect.Effect<unknown, StepFailure>) => Deferred.doneUnsafe(native, value),
    closeHost: () => settle(Scope.close(host, Exit.void)),
    reopen: () => new ActionJournal(join(dir, "partition-operations.json"), Date.now),
    async dispose() {
      await settle(Scope.close(host, Exit.void));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("aborting the admission after the row is journaled changes nothing; the attempt settles from native evidence", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("held");
    f.answer(Effect.succeed({ ok: true }));
    expect(await f.journal.wait("held")).toMatchObject({ state: "succeeded", steps: [{ id: stepId, state: "succeeded" }] });
    expect(f.seen.interrupted).toBe(false);
    expect(f.calls).toEqual([{ key: "test.hold", requestId: stepId }]);
  } finally {
    await f.dispose();
  }
});

test("the attempt runs under the journal's identity with the submitter as causal parent", async () => {
  const f = await fixture();
  try {
    await f.submit("owned");
    f.answer(Effect.succeed(null));
    await f.journal.wait("owned");
    expect(f.seen.identity?.requestId).not.toBe(f.submitter.requestId);
    expect(f.seen.identity?.caller).toEqual(human);
    expect(f.seen.identity?.ownership).toMatchObject({ owner: "owned", causalParent: f.submitter.requestId });
  } finally {
    await f.dispose();
  }
});

test("cancel sends op.cancel with the step id and never interrupts the dispatched step", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("cancelled");
    expect(await f.journal.cancel("cancelled")).toMatchObject({ state: "running", cancellationRequested: true });
    expect(f.calls).toEqual([
      { key: "test.hold", requestId: stepId },
      { key: CANCEL_OPERATION_KEY, requestId: stepId },
    ]);
    expect(f.seen.interrupted).toBe(false);
    f.answer(Effect.fail(new StepFailure("Revit cancelled the request", 499, "cancelled")));
    expect(await f.journal.wait("cancelled")).toMatchObject({ state: "cancelled" });
    expect(f.seen.interrupted).toBe(false);
  } finally {
    await f.dispose();
  }
});

test("closing the host scope joins the attempt; it never interrupts it", async () => {
  const f = await fixture();
  try {
    await f.submit("joined");
    let closed = false;
    const closing = f.closeHost().then(() => void (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    f.answer(Effect.succeed({ ok: true }));
    await closing;
    expect(f.seen.interrupted).toBe(false);
    expect((await f.reopen().list())[0]).toMatchObject({ id: "joined", state: "succeeded" });
  } finally {
    await f.dispose();
  }
});

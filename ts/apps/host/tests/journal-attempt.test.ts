import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { RequestIdentityData } from "@pe/host-internal/request-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { command, StepFailure } from "../src/command-executor.ts";
import { ActionJournalService } from "../src/receipt-services.ts";
import { HostLog } from "../src/host-log.ts";
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
  const native = Deferred.makeUnsafe<unknown, StepFailure>();
  const calls: { key: string; requestId: string }[] = [];
  const seen: { identity?: RequestIdentityData; interrupted: boolean; cancelsSettled: number } = { interrupted: false, cancelsSettled: 0 };
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
                return yield* Deferred.await(native);
              }).pipe(Effect.onInterrupt(() => Effect.sync(() => void (seen.interrupted = true)))),
            ),
          // The mock native door: what the registry's `op.cancel` sends to Revit, answered late.
          cancel: (requestId) =>
            Effect.sync(() => calls.push({ key: CANCEL_OPERATION_KEY, requestId })).pipe(
              Effect.andThen(Effect.sleep("300 millis")),
              Effect.andThen(Effect.sync(() => void seen.cancelsSettled++)),
              Effect.as({ cancelled: true }),
            ),
        },
      ),
  });
  const submitter = admittedRequestIdentity(human, {});
  const holds = () => calls.filter((call) => call.key === "test.hold");
  // The /actions admission fiber: it journals the row, then is aborted with its request once the
  // attempt's native step has entered. Returns that step's id.
  const submit = async (id: string) => {
    const before = holds().length;
    const admission = Effect.runFork(
      Effect.tryPromise(() =>
        journal.invoke(
          { id, key: "test.hold", target: { kind: "host" }, input: {} },
          { caller: human, basis: null, parent: submitter.requestId },
        ),
      ).pipe(Effect.andThen(Effect.never), Effect.provideService(RequestIdentity, submitter)),
    );
    await vi.waitFor(() => expect(holds()).toHaveLength(before + 1));
    await settle(Fiber.interrupt(admission));
    return holds()[before]!.requestId;
  };
  return {
    journal,
    calls,
    seen,
    submitter,
    submit,
    answer: (value: Effect.Effect<unknown, StepFailure>) => Deferred.doneUnsafe(native, value),
    closeHost: () => settle(Scope.close(host, Exit.void)),
    reopen: () => new ActionJournal(join(dir, "partition-operations.json"), Date.now),
    /** Receipt revisions the host log holds, as JSON text. */
    logged: () => new HostLog(join(dir, "log"), Date.now).read(0, (entry) => entry.event.kind === "receipt").entries.map((entry) => JSON.stringify(entry.event)),
    async dispose() {
      // A failed assertion leaves the step held; release it so the scope's join can finish.
      Deferred.doneUnsafe(native, Effect.succeed(null));
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

test("two concurrent Stops on one running step both settle; one op.cancel is sent", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("stopped-twice");
    const stops = await Promise.allSettled([f.journal.cancel("stopped-twice"), f.journal.cancel("stopped-twice")]);
    expect(stops.map((stop) => stop.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(f.calls.filter((call) => call.key === CANCEL_OPERATION_KEY)).toEqual([{ key: CANCEL_OPERATION_KEY, requestId: stepId }]);
    expect(f.seen.interrupted).toBe(false);
    f.answer(Effect.fail(new StepFailure("Revit cancelled the request", 499, "cancelled")));
    expect(await f.journal.wait("stopped-twice")).toMatchObject({ state: "cancelled" });
  } finally {
    await f.dispose();
  }
});

test("a fork under a running attempt's key never interrupts it, even a cancel under a caller-chosen id", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("cancelled-other");
    // Action ids are the caller's: this one spells the cancel key of the other action's step.
    await f.submit(`cancel:${stepId}`);
    await f.journal.cancel("cancelled-other");
    f.answer(Effect.succeed({ ok: true }));
    expect(await f.journal.wait(`cancel:${stepId}`)).toMatchObject({ state: "succeeded" });
    expect(f.seen.interrupted).toBe(false);
    expect(f.calls.filter((call) => call.key === "test.hold")).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

test("an action id that equals a running step's id runs its own step; ids are two namespaces", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("named-other");
    // A caller may choose any id, including the uuid of another action's running step.
    const own = await f.submit(stepId);
    expect(own).not.toBe(stepId);
    // The other action's Stop reaches its own step, and nothing of the bare-id action.
    const stopping = f.journal.cancel("named-other");
    await vi.waitFor(() => expect(f.calls.filter((call) => call.key === CANCEL_OPERATION_KEY)).toEqual([{ key: CANCEL_OPERATION_KEY, requestId: stepId }]));
    await stopping;
    f.answer(Effect.succeed({ ok: true }));
    expect(await f.journal.wait(stepId)).toMatchObject({ state: "succeeded", steps: [{ id: own, state: "succeeded" }] });
    expect(f.seen.interrupted).toBe(false);
  } finally {
    await f.dispose();
  }
});

test("closing joins a Stop still sending: the cancel settles before the journal closes", async () => {
  const f = await fixture();
  try {
    await f.submit("stopped-at-close");
    const stopping = f.journal.cancel("stopped-at-close");
    await vi.waitFor(() => expect(f.calls.some((call) => call.key === CANCEL_OPERATION_KEY)).toBe(true));
    // The attempt settles at once; only the 300 ms op.cancel send is still open at close.
    f.answer(Effect.fail(new StepFailure("Revit cancelled the request", 499, "cancelled")));
    await f.journal.wait("stopped-at-close");
    await f.closeHost();
    expect(f.seen.cancelsSettled).toBe(1);
    await expect(stopping).resolves.toMatchObject({ id: "stopped-at-close" });
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
    // The revision the final join committed reached the log: its subscription outlives the close.
    expect(f.logged().some((event) => event.includes('"joined"') && event.includes('"succeeded"'))).toBe(true);
  } finally {
    await f.dispose();
  }
});

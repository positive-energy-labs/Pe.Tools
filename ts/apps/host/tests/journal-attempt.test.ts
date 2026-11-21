import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { journalFixture } from "./storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { address } from "@pe/agent-contracts";
import type { RequestIdentityData } from "@pe/host-internal/request-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { command, StepFailure, refused } from "@pe/host-internal/command-executor";
import { ActionJournalService } from "../src/receipt-services.ts";
import { HostLog } from "../src/host-log.ts";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import { settle } from "./effect-test.ts";
import type { ReadOwnership } from "../src/reads/read-ownership.ts";
import {
  markDispatched,
  recordNativeProgress,
  recordNativeTerminal,
} from "../src/action-dispatch.ts";
import { bindControl, callerOf, mintPageDoor } from "../src/control.ts";

test("unpinning mid-action refuses the next journal step", async () => {
  const lifetime = { session: "S", openId: "D" };
  let pin: typeof lifetime | null = lifetime;
  bindControl({ pagePin: async () => pin });
  const minted = mintPageDoor(
    "page:@pages/pin",
    { kind: "pinned", ref: lifetime },
    "/pages/pin/act",
    true,
    lifetime,
  );
  const first = Deferred.makeUnsafe<void>();
  const entered: string[] = [];
  const f = await fixture(undefined, false, {
    probe: async () => null,
    resolve: () =>
      command(
        {
          says: "Two steps",
          needs: "document",
          effect: "command",
          dirties: [],
          input: z.record(z.string(), z.unknown()),
        },
        z.null(),
        {
          bind: async () => ({ effects: [] }),
          run: (_ctx, execution) =>
            execution
              .step("publication", "first", {}, () => {
                entered.push("first");
                return Deferred.await(first);
              })
              .pipe(
                Effect.andThen(() =>
                  execution.step("publication", "second", {}, () => {
                    entered.push("second");
                    return Effect.succeed(null);
                  }),
                ),
              ),
        },
      ),
  });
  try {
    const identity = callerOf({ kind: "local" }, { "x-pe-context": minted.token });
    if (!("caller" in identity)) throw Error("Page context not minted");
    const admitted = await f.journal.invoke(
      { id: "pin-steps", key: "two", target: { kind: "document", ref: lifetime }, input: {} },
      {
        caller: identity.caller,
        basis: { kind: "person-pin", page: "page:@pages/pin", boundBy: "human", lifetime },
      },
    );
    expect(admitted, JSON.stringify(admitted)).toMatchObject({ state: "running" });
    await vi.waitFor(() => expect(entered).toEqual(["first"]));
    minted.retire(); // The journal retained its own caller, as a held action does.
    pin = null;
    Deferred.doneUnsafe(first, Effect.void);
    expect(await f.journal.wait("pin-steps")).toMatchObject({
      state: "failed",
      refusal: { code: "grant.revoked" },
    });
    expect(entered).toEqual(["first"]);
  } finally {
    Deferred.doneUnsafe(first, Effect.void);
    minted.retire();
    bindControl({ pagePin: undefined });
    await f.dispose();
  }
});

const human = { kind: "human", via: "local" } as const;

test.each([false, true])("domain refusal after step entry, dispatched=%s", async (dispatched) => {
  const f = await fixture(undefined, false, {
    probe: async () => null,
    resolve: () =>
      command(
        {
          says: "Refuse",
          needs: "nothing",
          effect: "command",
          dirties: [],
          input: z.record(z.string(), z.unknown()),
        },
        z.null(),
        {
          bind: async () => ({ effects: [] }),
          run: (_ctx, execution) =>
            execution.step("native", "test.refuse", {}, (id) =>
              Effect.gen(function* () {
                if (dispatched) yield* Effect.promise(() => markDispatched(id, "bridge"));
                return yield* Effect.fail(refused("Exact refusal words", "test.refused"));
              }),
            ),
        },
      ),
  });
  try {
    await f.journal.invoke(
      { id: "refuse", key: "refuse", target: { kind: "host" }, input: {} },
      { caller: human, basis: null },
    );
    const receipt = await f.journal.wait("refuse");
    expect(receipt).toMatchObject({
      state: dispatched ? "unknown" : "failed",
      refusal: { code: "test.refused", message: "Exact refusal words" },
    });
    expect(receipt.steps[0]).toMatchObject({
      state: dispatched ? "unknown" : "failed",
      error: "Exact refusal words",
    });
    if (dispatched) expect(receipt.steps[0]).not.toHaveProperty("notDispatched");
    else expect(receipt.steps[0]).toHaveProperty("notDispatched", true);
  } finally {
    await f.dispose();
  }
});

// ADR 0029 rule 10, durable command: only the native side is mocked; the journal is its live Layer.
async function fixture(
  readOwnership?: ReadOwnership,
  failAfter = false,
  environment?: Parameters<ActionJournal["bindCommands"]>[0],
  stepRequest: { key: string; input: Record<string, unknown> } = { key: "test.hold", input: {} },
) {
  const dir = await mkdtemp(join(tmpdir(), "pe-attempt-"));
  const host = Scope.makeUnsafe();
  const journal = Context.get(
    await settle(Layer.buildWithScope(ActionJournalService.live(null, stateFixture(dir)), host)),
    ActionJournalService,
  );
  const native = Deferred.makeUnsafe<unknown, StepFailure>();
  const calls: { key: string; requestId: string }[] = [];
  const seen: { identity?: RequestIdentityData; interrupted: boolean; cancelsSettled: number } = {
    interrupted: false,
    cancelsSettled: 0,
  };
  journal.bindCommands(
    environment ?? {
      readOwnership,
      probe: async () => null,
      resolve: () =>
        command(
          {
            says: "Hold one native write",
            needs: "nothing",
            effect: "command",
            dirties: [],
            input: z.record(z.string(), z.unknown()),
          },
          z.null(),
          {
            bind: async () => ({ effects: [] }),
            run: (_ctx, execution) =>
              execution
                .step("native", stepRequest.key, stepRequest.input, (requestId) =>
                  Effect.gen(function* () {
                    seen.identity = yield* RequestIdentity;
                    yield* Effect.promise(() => markDispatched(requestId, "bridge"));
                    calls.push({ key: stepRequest.key, requestId });
                    return yield* Deferred.await(native);
                  }).pipe(
                    Effect.onInterrupt(() => Effect.sync(() => void (seen.interrupted = true))),
                  ),
                )
                .pipe(
                  Effect.andThen((result) =>
                    failAfter
                      ? Effect.fail(new StepFailure("later step refused", 409, "refused"))
                      : Effect.succeed(result),
                  ),
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
    },
  );
  const submitter = admittedRequestIdentity(human, {});
  const holds = () => calls.filter((call) => call.key === stepRequest.key);
  // The /actions admission fiber: it journals the row, then is aborted with its request once the
  // attempt's native step has entered. Returns that step's id.
  const submit = async (id: string) => {
    const before = holds().length;
    await settle(
      Effect.gen(function* () {
        const admission = yield* Effect.forkChild(
          Effect.tryPromise(() =>
            journal.invoke(
              { id, key: "test.hold", target: { kind: "host" }, input: {} },
              { caller: human, basis: null, parent: submitter.requestId },
            ),
          ).pipe(Effect.andThen(Effect.never), Effect.provideService(RequestIdentity, submitter)),
        );
        yield* Effect.promise(() => vi.waitFor(() => expect(holds()).toHaveLength(before + 1)));
        yield* Fiber.interrupt(admission);
      }),
    );
    return holds()[before]!.requestId;
  };
  return {
    dir,
    journal,
    calls,
    seen,
    submitter,
    submit,
    answer: (value: Effect.Effect<unknown, StepFailure>) => Deferred.doneUnsafe(native, value),
    closeHost: () => settle(Scope.close(host, Exit.void)),
    reopen: () =>
      new ActionJournal(journalFixture(join(dir, "partition-operations.json")), Date.now),
    /** Receipt revisions the host log holds, as JSON text. */
    logged: () =>
      new HostLog(stateFixture(join(dir, "log")), Date.now)
        .read(0, (entry) => entry.event.kind === "receipt")
        .entries.map((entry) => JSON.stringify(entry.event)),
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
    expect(await f.journal.wait("held")).toMatchObject({
      state: "succeeded",
      steps: [{ id: stepId, state: "succeeded" }],
    });
    expect(f.seen.interrupted).toBe(false);
    expect(f.calls).toEqual([{ key: "test.hold", requestId: stepId }]);
  } finally {
    await f.dispose();
  }
});

test("owned reads open at admission, Stop signals them, and cleanup precedes parent settlement", async () => {
  const events: string[] = [];
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({
    open: (identity) => {
      events.push(`open:${identity.ownership.owner}`);
      return {
        ownership: identity.ownership,
        native: async () => {
          throw Error("unused");
        },
        requestStop: async () => {
          events.push("stop");
        },
        state: () => ({ kind: "unsettled", requiredDescendants: [], evidence: [] }),
        settle: async () => {
          events.push("settle");
          await cleanup;
          return { kind: "settled", requiredDescendants: [], evidence: [] };
        },
      };
    },
    flight: () => {
      throw Error("unused");
    },
  });
  try {
    await f.submit("read-owner");
    await f.journal.cancel("read-owner");
    f.answer(Effect.succeed({ ok: true }));
    await vi.waitFor(() => expect(events).toContain("settle"));
    expect((await f.journal.list(undefined, "read-owner"))[0]?.state).toBe("running");
    expect(events).toEqual(["open:read-owner", "stop", "settle"]);
    release();
    expect((await f.journal.wait("read-owner")).state).toBe("succeeded");
  } finally {
    release();
    await f.dispose();
  }
});

test("live native terminal facts survive the step write and journal reopen", async () => {
  const f = await fixture();
  try {
    const id = await f.submit("facts");
    await recordNativeTerminal(
      id,
      { kind: "restored", views: [] },
      JSON.stringify({ documentKey: "model", revision: 5, extra: "preserved" }),
    );
    f.answer(Effect.succeed({ ok: true }));
    const row = await f.journal.wait("facts");
    expect(row.steps[0]).toMatchObject({
      touched: { kind: "restored", views: [] },
      nativeEvidence: { documentKey: "model", revision: 5, extra: "preserved" },
    });
    expect(row.steps[0]).not.toHaveProperty("effect");
    expect((await f.reopen().list(undefined, "facts"))[0]?.steps).toEqual(row.steps);
  } finally {
    await f.dispose();
  }
});

test("only the dispatched rooms request updates its journal receipt with native progress", async () => {
  const f = await fixture(undefined, false, undefined, {
    key: "rooms.partition",
    input: { view: "04a06654-51ab-45b8-8154-c4e534d88aec-0012d9ca" },
  });
  try {
    const id = await f.submit("rooms-progress");
    const progress = { phase: "Solve", zonesDone: 1, zonesTotal: 2 };
    const report = (operationKey: string, phase: string, zonesDone = 1) =>
      recordNativeProgress(
        "rooms.partition.progress",
        JSON.stringify({ requestId: id, progress: { ...progress, zonesDone } }),
        (requestId) => (requestId === id ? { operationKey, phase } : undefined),
      );
    await report("rooms.partition", "queued");
    await report("other.operation", "dispatched");
    expect((await f.journal.list(undefined, "rooms-progress"))[0]?.progress).toBeUndefined();

    await report("rooms.partition", "dispatched");
    expect((await f.journal.list(undefined, "rooms-progress"))[0]?.progress).toEqual(progress);
    f.answer(Effect.succeed({ ok: true }));
    expect((await f.journal.wait("rooms-progress")).state).toBe("succeeded");
    await report("rooms.partition", "dispatched", 2);
    expect((await f.reopen().list(undefined, "rooms-progress"))[0]?.progress).toEqual(progress);
  } finally {
    await f.dispose();
  }
});

test.each([
  { touched: { kind: "none" }, state: "failed" },
  { touched: { kind: "rolledBack" }, state: "failed" },
  { touched: { kind: "restored", views: [] }, state: "failed" },
  {
    touched: { kind: "wrote", transactions: [], added: 0, modified: 1, deleted: 0 },
    state: "incomplete",
  },
  {
    touched: {
      kind: "restoreFailed",
      views: [{ view: { documentKey: "doc", uniqueId: "view", id: 1 }, left: ["crop"] }],
    },
    state: "incomplete",
  },
  { touched: { kind: "unknown", reason: "lost-response" }, state: "incomplete" },
])("a later refusal uses native $touched.kind testimony: $state", async ({ touched, state }) => {
  const f = await fixture(undefined, true);
  try {
    const id = await f.submit("native-facts");
    await recordNativeTerminal(id, touched);
    f.answer(Effect.succeed({ ok: true }));
    expect((await f.journal.wait("native-facts")).state).toBe(state);
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
    expect(f.seen.identity?.ownership).toMatchObject({
      owner: "owned",
      causalParent: f.submitter.requestId,
    });
  } finally {
    await f.dispose();
  }
});

test("cancel sends op.cancel with the step id and never interrupts the dispatched step", async () => {
  const f = await fixture();
  try {
    const stepId = await f.submit("cancelled");
    expect(await f.journal.cancel("cancelled")).toMatchObject({
      receipt: { state: "running", cancellationRequested: true },
      signalled: true,
    });
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
    const stops = await Promise.allSettled([
      f.journal.cancel("stopped-twice"),
      f.journal.cancel("stopped-twice"),
    ]);
    expect(stops.map((stop) => stop.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(f.calls.filter((call) => call.key === CANCEL_OPERATION_KEY)).toEqual([
      { key: CANCEL_OPERATION_KEY, requestId: stepId },
    ]);
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
    await vi.waitFor(() =>
      expect(f.calls.filter((call) => call.key === CANCEL_OPERATION_KEY)).toEqual([
        { key: CANCEL_OPERATION_KEY, requestId: stepId },
      ]),
    );
    await stopping;
    f.answer(Effect.succeed({ ok: true }));
    expect(await f.journal.wait(stepId)).toMatchObject({
      state: "succeeded",
      steps: [{ id: own, state: "succeeded" }],
    });
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
    await vi.waitFor(() =>
      expect(f.calls.some((call) => call.key === CANCEL_OPERATION_KEY)).toBe(true),
    );
    // The attempt settles at once; only the 300 ms op.cancel send is still open at close.
    f.answer(Effect.fail(new StepFailure("Revit cancelled the request", 499, "cancelled")));
    await f.journal.wait("stopped-at-close");
    await f.closeHost();
    expect(f.seen.cancelsSettled).toBe(1);
    await expect(stopping).resolves.toMatchObject({ receipt: { id: "stopped-at-close" } });
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
    expect(
      f.logged().some((event) => event.includes('"joined"') && event.includes('"succeeded"')),
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

// The kernel's one Work fence (`admitWorkTarget`): no Work command and no write boundary is involved
// here, so only admission can refuse. `address` is what the composition's document resolver answers:
// a string, null for an unsaved document, and nothing at all where no resolver is composed.
const here = { session: "s", openId: "here" };
const savedWork = { binding: "address" as const, route: "fence", target: address("C:/model.rvt") };
test.each([
  [
    "an open lifetime's Work on another lifetime",
    { binding: "open" as const, route: "fence", target: null, open: { ...here, openId: "gone" } },
    "C:/model.rvt",
    "Work belongs to another document",
  ],
  ["saved Work on another file", savedWork, "C:/other.rvt", "Work belongs to another document"],
  [
    "saved Work on an unsaved target",
    savedWork,
    null,
    "Work belongs to a saved document, and the target document is unsaved",
  ],
  [
    "saved Work where no resolver reads the target's Address",
    savedWork,
    undefined,
    "Work belongs to a saved document, and this host cannot read the target's Address",
  ],
  ["saved Work on its own file", savedWork, "C:/model.rvt", null],
] as const)("the Work fence at admission: %s", async (_name, key, resolved, refusal) => {
  let bound = 0;
  const f = await fixture(undefined, false, {
    probe: async () => null,
    ...(resolved === undefined ? {} : { target: async () => resolved }),
    resolve: () =>
      command(
        {
          says: "Spend Work",
          needs: "project-document",
          effect: "command",
          dirties: [],
          input: z.record(z.string(), z.unknown()),
        },
        z.null(),
        {
          bind: async () => (bound++, { effects: [] }),
          run: () => Effect.fail(new StepFailure("ran", 409, "refused")),
        },
      ),
  });
  try {
    await settle(
      Effect.tryPromise(() =>
        f.journal.invoke(
          {
            id: "fence",
            key: "test.fence",
            target: { kind: "document", ref: here },
            input: { work: { key, revision: 0 } },
          },
          { caller: human, basis: null, parent: f.submitter.requestId },
        ),
      ).pipe(Effect.ignore, Effect.provideService(RequestIdentity, f.submitter)),
    );
    const receipt = await f.journal.wait("fence");
    if (refusal === null) {
      expect(bound).toBe(1);
      expect(receipt).not.toMatchObject({ refusal: { code: "work.target" } });
    } else {
      expect(receipt).toMatchObject({
        state: "failed",
        notDispatched: true,
        refusal: { kind: "domain", code: "work.target", message: refusal },
      });
      expect(bound).toBe(0);
    }
  } finally {
    await f.dispose();
  }
});

test("a succeeded action links the picture its result names; a line without the link still loads", async () => {
  const f = await fixture();
  try {
    await f.submit("pictured");
    const sha256 = "a".repeat(64);
    f.answer(Effect.succeed({ capture: { sha256 } }));
    const row = await f.journal.wait("pictured");
    expect(row.emitted).toEqual([{ store: "picture", sha: sha256 }]);
    // The reopened journal decodes the linked line and, written before the field, a bare one.
    const path = join(f.dir, "partition-operations.json");
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    const bare = lines.map((line) => line.replace(/,?"emitted":\[[^\]]*\]/, ""));
    expect(bare.join("\n")).not.toContain("emitted");
    expect((await f.reopen().list(undefined, "pictured"))[0]?.emitted).toEqual(row.emitted);
    await writeFile(path, bare.join("\n") + "\n");
    const old = (await f.reopen().list(undefined, "pictured"))[0];
    expect(old).toMatchObject({ id: "pictured", state: "succeeded" });
    expect(old).not.toHaveProperty("emitted");
  } finally {
    await f.dispose();
  }
});

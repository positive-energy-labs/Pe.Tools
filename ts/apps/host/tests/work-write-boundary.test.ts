import { NodeCrypto } from "@effect/platform-node";
import { commands, tools, writePreviewSchema, type Command, type ActionReceipt } from "@pe/agent-contracts";
import { Context, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { ActionExecution } from "../src/action-journal.ts";
import type { CommandContext } from "../src/command-executor.ts";
import { assertSealed } from "../src/document-marks.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { RunConsents } from "../src/run-consent.ts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import { settle, testDocumentMarks } from "./effect-test.ts";
// These fakes read no attempt service; the journal provides them in production.
const runOwned = (run: Effect.Effect<unknown, unknown, unknown>) => settle(run as Effect.Effect<unknown, unknown>);
import { detachedBridge, sessionView, effectTest } from "./effect-test.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

const writes = Object.entries(commands).filter(([, definition]) => "writeBoundary" in definition);
test.each(writes)("%s accepts only revisioned Work, never a preview flag", (_key, definition) => {
  const work = {
    key: {
      binding: "open",
      route: (definition as Command).work!.route,
      target: null,
      open: { session: "A", openId: "open-A" },
    },
    revision: 1,
  };
  expect(definition.input.safeParse({ work }).success).toBe(true);
  for (const input of [
    {},
    { work, previewOnly: true },
    { work, nativePreview: true },
    { source: {} },
    { work, regions: [] },
    { work, table: {} },
    { work, profile: {} },
  ])
    expect(definition.input.safeParse(input).success).toBe(false);
});

async function fixture() {
  const ref = { session: "A", openId: "open-A" };
  const listeners: ((event: never) => void)[] = [];
  const work = {
    key: { binding: "open" as const, route: "schedules", target: null, open: { ...ref } },
    revision: 1,
  };
  const makeBridge = () => detachedBridge({
    subscribe: (listener: (event: never) => void) => {
      listeners.push(listener);
      return () => {};
    },
    list: Effect.succeed([
      sessionView({
        sessionId: "A",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: { openDocuments: [{ ...ref, isFamilyDocument: false }] },
      }),
    ]),
  } as never);
  let bridge = makeBridge();
  let marks = testDocumentMarks(bridge);
  const receipts: ActionReceipt[] = [];
  let request = "one";
  let evidence: unknown = { model: 1 };
  const run = vi.fn(() => Effect.succeed({ applied: true }));
  const make = (definition: Command) => () => workWriteBoundary(
    {
      definition,
      prepared: z.object({ request: z.string(), dependencies: z.unknown() }),
      bind: async (ctx) => {
        expect(ctx.admission.input.source).toEqual({
          pod: "p",
          path: "s.json",
          sha256: "a".repeat(64),
        });
        return {
          effects: [{ kind: "document", ref }],
          prepare: async () => ({ request, dependencies: evidence }),
        };
      },
      seal: (raw) => {
        const p = z.object({ request: z.string(), dependencies: z.unknown() }).parse(raw);
        return { request: { request: p.request }, evidence: p.dependencies };
      },
      run,
    },
    bridge,
    { sdk: sdkSessions, marks },
  );
  const executors = { preview: make(commands["schedule.apply.preview"]), apply: make(commands["schedule.apply"]) };
  let current = executors.preview;
  let executor = current();
  const doc = tools.schedules.work.schema.parse({
    writeIntent: {
      "schedule.apply": {
        edit: { value: { source: { pod: "p", path: "s.json", sha256: "a".repeat(64) } } },
      },
    },
  });
  const ctx: CommandContext = {
    admission: {
      id: "preview",
      key: "schedule.apply",
      target: { kind: "document", ref },
      input: { work },
    },
    caller: { kind: "human", via: "local" },
    basis: null,
    consumed: [],
    work: {} as CommandContext["work"],
    selectWork: vi.fn(async () => doc) as CommandContext["selectWork"],
    read: { receipts: () => receipts },
  };
  return {
    ctx,
    get executor() {
      return executor;
    },
    /** Recheck at apply: the write entry, not a flag on the preview. */
    apply: () => {
      current = executors.apply;
      executor = current();
    },
    /** Revit reports this document changed; the host's mark moves. */
    documentChanged: async () => {
      const before = marks.changedAt(ref);
      for (const listener of listeners)
        listener({ kind: "event", sessionId: "A", eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: ["open-A"] }) } as never);
      await vi.waitFor(() => expect(marks.changedAt(ref)).not.toBe(before));
    },
    /** A new host process: a fresh bridge and mark holder, so observedSince moves. */
    restart: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      bridge = makeBridge();
      marks = testDocumentMarks(bridge);
      executor = current();
    },
    run,
    receipts,
    recordPreview: (id: string, result: unknown, key = "schedule.apply.preview") => receipts.push({
      id,
      key,
      caller: ctx.caller,
      target: ctx.admission.target,
      input: ctx.admission.input,
      basis: ctx.basis,
      effects: [],
      consumes: [],
      claims: [],
      consent: null,
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: new Date().toISOString(),
      state: "succeeded",
      result: writePreviewSchema.parse(result),
    }),
    evidence: (value: unknown) => {
      evidence = value;
    },
    change: () => {
      request = "changed";
    },
  };
}

test("preview exposes a derived request without running the write; changed derivation refuses apply", async () => {
  const f = await fixture();
  const binding = await f.executor.bind(f.ctx);
  expect(binding.effects).toEqual([]);
  const prepared = await binding.prepare!();
  const preview = await runOwned(f.executor.run(f.ctx, { prepared } as ActionExecution));
  expect(preview).toMatchObject({ previewOnly: true, derivedRequest: { request: "one" } });
  expect(f.run).not.toHaveBeenCalled();
  f.recordPreview("preview", preview);
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).resolves.toMatchObject({
    seal: (preview as { seal: unknown }).seal,
  });
  f.change();
  await expect(apply.preflight!()).rejects.toMatchObject({ refusal: { code: "preview.stale" } });
  await expect(apply.prepare!()).rejects.toThrow("Plan changed");
  expect(f.run).not.toHaveBeenCalled();
});

test("re-derived identical inputs apply; a changed dependency refuses before execution", async () => {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const preview = await runOwned(f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution));
  f.recordPreview("preview", preview);
  f.apply();
  f.evidence({ model: 1 });
  const apply = await f.executor.bind(f.ctx);
  await runOwned(f.executor.run(f.ctx, { prepared: await apply.prepare!() } as ActionExecution));
  expect(f.run).toHaveBeenCalledTimes(1);
  f.evidence({ model: 2 });
  await expect(apply.prepare!()).rejects.toThrow("Plan changed");
  expect(f.run).toHaveBeenCalledTimes(1);
});

test("missing preview and foreign Work refuse before native execution", async () => {
  const f = await fixture();
  f.apply();
  const binding = await f.executor.bind(f.ctx);
  await expect(binding.preflight!()).rejects.toMatchObject({ refusal: { code: "preview.stale" } });
  await expect(binding.prepare!()).rejects.toThrow("Plan the current Work first");
  (f.ctx.admission.input.work as { key: { open: { openId: string } } }).key.open.openId = "foreign";
  await expect(f.executor.bind(f.ctx)).rejects.toThrow("another document");
  expect(f.run).not.toHaveBeenCalled();
});

test("a new Work revision invalidates the seal even when the request is identical", async () => {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const preview = await runOwned(f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution));
  f.recordPreview("preview", preview);
  f.apply();
  (f.ctx.admission.input.work as { revision: number }).revision++;
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).rejects.toThrow("Plan changed");
  expect(f.run).not.toHaveBeenCalled();
});

test("refetching the same dependency set in a different order preserves the preview", async () => {
  const f = await fixture();
  const a = { kind: "file" as const, probe: { path: "a" }, expected: "a1" };
  const b = { kind: "file" as const, probe: { path: "b" }, expected: "b1" };
  f.ctx.consumed = [a, b];
  const bound = await f.executor.bind(f.ctx);
  const preview = await runOwned(f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution));
  f.recordPreview("preview", preview);
  f.apply();
  f.ctx.consumed = [b, a, b];
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).resolves.toMatchObject({
    seal: (preview as { seal: unknown }).seal,
  });
});

test("write admission refuses a producer without a semantic projection", () => {
  expect(() => workWriteBoundary({
    definition: commands["schedule.apply"], prepared: z.unknown(),
    bind: async () => ({ effects: [] }), run: () => Effect.succeed(null),
  }, detachedBridge())).toThrow("producer-owned seal projection");
});

test("re-pricing a changed preview remains a successful read and never runs a write", async () => {
  const f = await fixture();
  for (const id of ["preview-one", "preview-two"]) {
    f.ctx.admission.id = id;
    const bound = await f.executor.bind(f.ctx);
    const preview = await runOwned(f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution));
    expect(preview).toMatchObject({ previewOnly: true });
    f.recordPreview(id, preview);
    f.change();
  }
  expect(f.run).not.toHaveBeenCalled();
});

test("an older preview refuses changed request and Work; a fresh preview keeps its seal across 60 seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const f = await fixture();
    const capture = async () => {
      const bound = await f.executor.bind(f.ctx);
      const result = await runOwned(f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution));
      f.recordPreview(f.ctx.admission.id, result);
      return result as { seal: unknown };
    };
    await capture();
    f.change();
    (f.ctx.admission.input.work as { revision: number }).revision++;
    f.ctx.consumed = [{ kind: "file", probe: { path: "new" }, expected: "new" }];
    f.apply();
    const stale = await f.executor.bind(f.ctx);
    await expect(stale.prepare!()).rejects.toMatchObject({ refusal: { code: "preview.stale" },
      message: expect.stringContaining("requestHash, work, dependencies") });
    // Capture again through the preview executor, then apply the exact same derived input.
    const fresh = await fixture();
    const bound = await fresh.executor.bind(fresh.ctx);
    const preview = writePreviewSchema.parse(await runOwned(fresh.executor.run(fresh.ctx, { prepared: await bound.prepare!() } as ActionExecution)));
    fresh.recordPreview("fresh", preview);
    vi.setSystemTime(Date.now() + 60_000);
    fresh.apply();
    const apply = await fresh.executor.bind(fresh.ctx);
    const prepared = await apply.prepare!();
    expect(prepared).toMatchObject({ seal: preview.seal });
    await runOwned(fresh.executor.run(fresh.ctx, { prepared } as ActionExecution));
    expect(fresh.run).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

effectTest("preview seal survives the real 60-second run-consent auto-approval", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(fixture);
    const bound = yield* Effect.promise(() => f.executor.bind(f.ctx));
    const prepared = yield* Effect.promise(() => bound.prepare!());
    const preview = writePreviewSchema.parse(yield* Effect.promise(() => runOwned(f.executor.run(f.ctx, { prepared } as ActionExecution))));
    f.recordPreview("preview", preview);
    const runs = Context.get(yield* Layer.build(RunConsents.layer.pipe(Layer.provide(NodeCrypto.layer))), RunConsents);
    runs.attach({ emit: () => {}, persist: () => {}, autoApprove: () => true });
    const run = { thread: "sealed-write", turn: "one" };
    yield* runs.open(run);
    const pending = yield* Effect.forkScoped(runs.authorize({ caller: { kind: "pea", context: "minted",
      thread: run.thread, run, root: run }, run, root: run }, "apply", [{ kind: "document", ref: { session: "A", openId: "open-A" } }]));
    yield* TestClock.adjust("59 seconds");
    expect(pending.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(pending)).toMatchObject({ decision: { by: "deadline" } });
    f.apply();
    const apply = yield* Effect.promise(() => f.executor.bind(f.ctx));
    yield* Effect.promise(() => apply.preflight!());
    const ready = yield* Effect.promise(() => apply.prepare!());
    expect(ready).toMatchObject({ seal: preview.seal });
    yield* Effect.promise(() => runOwned(f.executor.run(f.ctx, { prepared: ready } as ActionExecution)));
    expect(f.run).toHaveBeenCalledOnce();
  }),
);

/** Plan, then a change at each seal key; apply must say "Plan changed (key)" and never run the write. */
async function plannedThenApply() {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const plan = await runOwned(f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution));
  f.recordPreview("plan", plan);
  return { f, plan: plan as { seal: { documentMark: unknown } } };
}

test("a Revit change to the planned document changes the seal; apply refuses plan changed", async () => {
  const { f } = await plannedThenApply();
  await f.documentChanged();
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).rejects.toThrow("Plan changed; plan the current Work again (documentMark)");
  expect(f.run).not.toHaveBeenCalled();
});

test("a host restart between plan and apply changes the sealed mark; apply refuses", async () => {
  const { f, plan } = await plannedThenApply();
  await f.restart();
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  const refusal = apply.prepare!();
  await expect(refusal).rejects.toThrow("(documentMark)");
  expect(plan.seal.documentMark).toMatchObject({ session: "A", openId: "open-A", changedAt: null });
  expect(f.run).not.toHaveBeenCalled();
});

test("a plan that goes stale after consent is refused at the post-consent prepare, before the write", async () => {
  const { f } = await plannedThenApply();
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  await apply.preflight!(); // before consent: still the planned Work
  await f.documentChanged(); // the person or Revit moves on while the Reject? window is open
  await expect(apply.prepare!()).rejects.toMatchObject({ refusal: { code: "preview.stale" } });
  expect(f.run).not.toHaveBeenCalled();
});

test("a rehearsal receipt cannot arm apply: only the declared plan key seals", async () => {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const plan = await runOwned(f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution));
  f.recordPreview("rehearsal", plan, "schedule.rehearse");
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.preflight!()).rejects.toMatchObject({ refusal: { code: "preview.stale" } });
  await expect(apply.prepare!()).rejects.toThrow("Plan the current Work first");
  expect(f.run).not.toHaveBeenCalled();
});

test("a change the host received but has not applied yet still refuses the sealed mark", async () => {
  let listener!: (event: never) => void;
  const bridge = detachedBridge({
    subscribe: (next: (event: never) => void) => ((listener = next), () => {}),
    list: Effect.promise(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20)); // the tail awaits bridge.list
      return [sessionView({ sessionId: "A", connected: true, lane: hostOwnership.lane, sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName, processId: 42, processStartUtcUnixMs: 1000, state: { openDocuments: [{ openId: "open-A" }] } })];
    }),
  } as never);
  const marks = testDocumentMarks(bridge);
  const ref = { session: "A", openId: "open-A" };
  const sealed = { observedSince: marks.observedSince ?? null, changedAt: marks.changedAt(ref) };
  listener({ kind: "event", sessionId: "A", eventName: "document-changed", payloadJson: JSON.stringify({ changedOpenIds: ["open-A"] }) } as never);
  expect(marks.changedAt(ref), "the cache has not caught up").toBeNull();
  await expect(assertSealed(marks, ref, sealed)).rejects.toThrow("Plan changed (documentMark)");
});

test.each(["caller", "requestHash", "work", "documentMark", "incarnation", "dependencies"] as const)(
  "prepare independently rechecks sealed %s after bind", async key => {
    const f = await fixture();
    const previewBinding = await f.executor.bind(f.ctx);
    const preview = await runOwned(f.executor.run(f.ctx, { prepared: await previewBinding.prepare!() } as ActionExecution));
    f.recordPreview("preview", preview);
    f.apply();
    const apply = await f.executor.bind(f.ctx);
    const result = f.receipts[0].state === "succeeded" ? f.receipts[0].result : null;
    const seal = (result as { seal: Record<string, unknown> }).seal;
    seal[key] = key === "caller" ? { kind: "human", via: "cli" } : { tampered: true };
    await expect(apply.prepare!()).rejects.toMatchObject({ refusal: { code: "preview.stale" } });
    expect(f.run).not.toHaveBeenCalled();
  },
);

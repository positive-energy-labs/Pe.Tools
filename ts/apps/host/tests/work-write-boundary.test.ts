import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { z } from "zod";
import { commands, tools, type Command, type ActionReceipt } from "@pe/agent-contracts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { hostOwnership } from "../src/host-ownership.ts";
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
  const work = {
    key: { binding: "open" as const, route: "schedules", target: null, open: { ...ref } },
    revision: 1,
  };
  const bridge = {
    subscribe: () => () => {},
    list: Effect.succeed([
      {
        sessionId: "A",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: { openDocuments: [{ ...ref, isFamilyDocument: false }] },
      },
    ]),
  } as unknown as RevitBridge["Service"];
  const receipts: ActionReceipt[] = [];
  let request = "one";
  let evidence: unknown = { model: 1 };
  const run = vi.fn(async () => ({ applied: true }));
  const make = (definition: Command) => workWriteBoundary(
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
    { sdk: sdkSessions },
  );
  const executors = { preview: make(commands["schedule.apply.preview"]), apply: make(commands["schedule.apply"]) };
  let executor = executors.preview;
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
      executor = executors.apply;
    },
    run,
    receipts,
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
  const preview = await f.executor.run(f.ctx, { prepared } as ActionExecution);
  expect(preview).toMatchObject({ previewOnly: true, derivedRequest: { request: "one" } });
  expect(f.run).not.toHaveBeenCalled();
  f.receipts.push({
    id: "preview",
    key: "schedule.apply.preview",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
    startedAt: new Date().toISOString(),
  } as ActionReceipt);
  f.apply();
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).resolves.toMatchObject({
    seal: (preview as { seal: unknown }).seal,
  });
  f.change();
  await expect(apply.prepare!()).rejects.toThrow("Preview changed");
  expect(f.run).not.toHaveBeenCalled();
});

test("re-derived identical inputs apply; a changed dependency refuses before execution", async () => {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const preview = await f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution);
  f.receipts.push({
    id: "preview",
    key: "schedule.apply.preview",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
  } as ActionReceipt);
  f.apply();
  f.evidence({ model: 1 });
  const apply = await f.executor.bind(f.ctx);
  await f.executor.run(f.ctx, { prepared: await apply.prepare!() } as ActionExecution);
  expect(f.run).toHaveBeenCalledTimes(1);
  f.evidence({ model: 2 });
  await expect(apply.prepare!()).rejects.toThrow("Preview changed");
  expect(f.run).toHaveBeenCalledTimes(1);
});

test("missing preview and foreign Work refuse before native execution", async () => {
  const f = await fixture();
  f.apply();
  const binding = await f.executor.bind(f.ctx);
  await expect(binding.prepare!()).rejects.toThrow("Preview the current Work");
  (f.ctx.admission.input.work as { key: { open: { openId: string } } }).key.open.openId = "foreign";
  await expect(f.executor.bind(f.ctx)).rejects.toThrow("another document");
  expect(f.run).not.toHaveBeenCalled();
});

test("a new Work revision invalidates the seal even when the request is identical", async () => {
  const f = await fixture();
  const bound = await f.executor.bind(f.ctx);
  const preview = await f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution);
  f.receipts.push({
    id: "preview",
    key: "schedule.apply.preview",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
    startedAt: new Date().toISOString(),
  } as ActionReceipt);
  f.apply();
  (f.ctx.admission.input.work as { revision: number }).revision++;
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).rejects.toThrow("Preview changed");
  expect(f.run).not.toHaveBeenCalled();
});

test("refetching the same dependency set in a different order preserves the preview", async () => {
  const f = await fixture();
  const a = { kind: "file" as const, probe: { path: "a" }, expected: "a1" };
  const b = { kind: "file" as const, probe: { path: "b" }, expected: "b1" };
  f.ctx.consumed = [a, b];
  const bound = await f.executor.bind(f.ctx);
  const preview = await f.executor.run(f.ctx, {
    prepared: await bound.prepare!(),
  } as ActionExecution);
  f.receipts.push({
    id: "preview",
    key: "schedule.apply.preview",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
  } as ActionReceipt);
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
    bind: async () => ({ effects: [] }), run: async () => null,
  }, {} as RevitBridge["Service"])).toThrow("producer-owned seal projection");
});


test("re-pricing a changed preview remains a successful read and never runs a write", async () => {
  const f = await fixture();
  for (const id of ["preview-one", "preview-two"]) {
    f.ctx.admission.id = id;
    const bound = await f.executor.bind(f.ctx);
    const preview = await f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution);
    expect(preview).toMatchObject({ previewOnly: true });
    f.receipts.push({ id, key: "schedule.apply.preview", target: f.ctx.admission.target,
      state: "succeeded", result: preview, startedAt: new Date().toISOString() } as ActionReceipt);
    f.change();
  }
  expect(f.run).not.toHaveBeenCalled();
});

test("empty salvage crosses the HTTP response contract as 200 null", async () => {
  const { servePeRoute } = await import("@pe/agent-contracts/pe-api");
  const response = await servePeRoute(
    new Request("http://local/pe/route-state/families/salvage"),
    async () => Response.json(null),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});


test("an older preview refuses changed request and Work; a fresh preview keeps its seal across 60 seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const f = await fixture();
    const capture = async () => {
      const bound = await f.executor.bind(f.ctx);
      const result = await f.executor.run(f.ctx, { prepared: await bound.prepare!() } as ActionExecution);
      f.receipts.push({ id: f.ctx.admission.id, key: "schedule.apply.preview",
        target: f.ctx.admission.target, state: "succeeded", result } as ActionReceipt);
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
    const preview = await fresh.executor.run(fresh.ctx, { prepared: await bound.prepare!() } as ActionExecution) as { seal: unknown };
    fresh.receipts.push({ id: "fresh", key: "schedule.apply.preview", target: fresh.ctx.admission.target,
      state: "succeeded", result: preview } as ActionReceipt);
    vi.setSystemTime(Date.now() + 60_000);
    fresh.apply();
    const apply = await fresh.executor.bind(fresh.ctx);
    const prepared = await apply.prepare!();
    expect(prepared).toMatchObject({ seal: preview.seal });
    await fresh.executor.run(fresh.ctx, { prepared } as ActionExecution);
    expect(fresh.run).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

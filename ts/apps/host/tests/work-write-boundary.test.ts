import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { z } from "zod";
import { commands, tools, type Command, type ActionReceipt } from "@pe/agent-contracts";
import { workWriteBoundary, writeSeal } from "../src/work-write-boundary.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

const writes = Object.entries(commands).filter(([, definition]) => "writeBoundary" in definition);
test.each(writes)("%s accepts only revisioned Work and preview choice", (_key, definition) => {
  const work = {
    key: {
      binding: "open",
      route: (definition as Command).work!.route,
      target: null,
      open: { session: "A", openId: "open-A" },
    },
    revision: 1,
  };
  expect(definition.input.safeParse({ work, previewOnly: true }).success).toBe(true);
  for (const input of [
    {},
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
  const executor = workWriteBoundary(
    {
      definition: commands["schedule.apply"],
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
      run,
    },
    bridge,
    { sdk: sdkSessions },
  );
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
      input: { work, previewOnly: true },
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
    executor,
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
    key: "schedule.apply",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
    startedAt: new Date().toISOString(),
  } as ActionReceipt);
  f.ctx.admission.input.previewOnly = false;
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
    key: "schedule.apply",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
  } as ActionReceipt);
  f.ctx.admission.input.previewOnly = false;
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
  f.ctx.admission.input.previewOnly = false;
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
    key: "schedule.apply",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
    startedAt: new Date().toISOString(),
  } as ActionReceipt);
  f.ctx.admission.input.previewOnly = false;
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
    key: "schedule.apply",
    target: f.ctx.admission.target,
    state: "succeeded",
    result: preview,
  } as ActionReceipt);
  f.ctx.admission.input.previewOnly = false;
  f.ctx.consumed = [b, a, b];
  const apply = await f.executor.bind(f.ctx);
  await expect(apply.prepare!()).resolves.toMatchObject({
    seal: (preview as { seal: unknown }).seal,
  });
});

test("seal properties: canonical keys, dependency sets and Work paths; every real input remains binding", () => {
  const work = {
    key: {
      binding: "open" as const,
      route: "schedules",
      target: null,
      open: { session: "A", openId: "doc" },
    },
    revision: 1,
  };
  const consumed = [
    {
      kind: "work" as const,
      probe: { handle: work, paths: [["a"], ["b"]], edits: [["a"], ["b"]] },
      expected: { a: 1, b: 2 },
    },
  ];
  const seal = (
    request = { a: 1, b: 2 },
    handle = work,
    incarnation = { openId: "doc" },
    deps = consumed,
    evidence = { version: 1 },
  ) => writeSeal(request, { a: 1 }, handle, incarnation, deps, evidence);
  const baseline = seal();
  for (let i = 0; i < 64; i++) {
    const refetch = structuredClone(consumed);
    if (i % 2) refetch[0]!.probe.paths.reverse();
    if (i % 3) refetch[0]!.probe.edits.reverse();
    if (i % 5) refetch.push(structuredClone(refetch[0]!));
    expect(seal({ b: 2, a: 1 }, structuredClone(work), { openId: "doc" }, refetch)).toEqual(
      baseline,
    );
  }
  expect(seal({ a: 2, b: 2 })).not.toEqual(baseline);
  expect(seal(undefined, { ...work, revision: 2 })).not.toEqual(baseline);
  expect(seal(undefined, undefined, { openId: "reopened" })).not.toEqual(baseline);
  expect(seal(undefined, undefined, undefined, undefined, { version: 2 })).not.toEqual(baseline);
  const changed = structuredClone(consumed);
  changed[0]!.expected.a = 3;
  expect(seal(undefined, undefined, undefined, changed)).not.toEqual(baseline);
});

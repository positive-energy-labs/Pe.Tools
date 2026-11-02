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
  const run = vi.fn(async () => ({ applied: true }));
  const executor = workWriteBoundary(
    {
      definition: commands["schedule.apply"],
      prepared: z.object({ request: z.string() }),
      bind: async (ctx) => {
        expect(ctx.admission.input.source).toEqual({
          pod: "p",
          path: "s.json",
          sha256: "a".repeat(64),
        });
        return { effects: [{ kind: "document", ref }], prepare: async () => ({ request }) };
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
    seal: (preview as { seal: string }).seal,
  });
  f.change();
  await expect(apply.prepare!()).rejects.toThrow("Preview changed");
  expect(f.run).not.toHaveBeenCalled();
});

test("missing preview and foreign Work refuse before native execution", async () => {
  const f = await fixture();
  f.ctx.admission.input.previewOnly = false;
  await expect(f.executor.bind(f.ctx)).rejects.toThrow("Preview the current Work");
  (f.ctx.admission.input.work as { key: { open: { openId: string } } }).key.open.openId = "foreign";
  await expect(f.executor.bind(f.ctx)).rejects.toThrow("another document");
  expect(f.run).not.toHaveBeenCalled();
});

import { expect, test, vi } from "vite-plus/test";
import { Effect } from "effect";
import { z } from "zod";
import { commands, tools, type Command } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { workIntentBoundary } from "../src/work-write-boundary.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { detachedBridge, sessionView, captureStore } from "./effect-test.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";

// ADR 0028: a SessionWrite capture writes nothing to the model, so it has no preview and no seal.
const captures = [
  "family.capture",
  "families.capture",
  "schedule.capture",
  "takeoffs.initialize",
  "takeoffs.sync",
] as const;

test.each(captures)("%s derives from Work and carries neither a preview entry nor a seal", (key) => {
  const entry = commands[key] as Command & Record<string, unknown>;
  expect(commandCatalogAxes[key].effect).toBe("SessionWrite");
  expect(entry).toHaveProperty("authoredInput");
  expect(entry).toHaveProperty("workIntent");
  expect(typeof entry.derivation?.derive).toBe("function");
  expect(entry.derivation).not.toHaveProperty("preview");
  expect(entry).not.toHaveProperty("writeBoundary");
  expect(commands).not.toHaveProperty(`${key}.preview`);
  expect(commandCatalogAxes).not.toHaveProperty(`${key}.preview`);
});

test("the seal follows the axis: a ModelWrite is sealed and nothing else carries a boundary", () => {
  for (const [key, axes] of Object.entries(commandCatalogAxes)) {
    const phase = (commands as Record<string, { writeBoundary?: { phase: string } }>)[key]
      ?.writeBoundary?.phase;
    expect(phase === "apply", key).toBe(axes.effect === "ModelWrite");
    if (phase === "preview") expect(axes.effect, key).toBe("TransactRead");
  }
});

test("the registry derives a capture's input from Work and never seals it", () => {
  const resolve = commandRegistry(
    detachedBridge(),
    captureStore("unused-intent-test"),
    {},
    async () => {
      throw Error("No I/O in a structure test");
    },
  );
  for (const key of captures) {
    const executor = resolve(key);
    expect(executor.boundary, key).toBe("work");
    expect(executor.seal, key).toBeUndefined();
  }
});

async function fixture() {
  const ref = { session: "A", openId: "open-A" };
  const work = {
    key: { binding: "open" as const, route: "schedules", target: null, open: { ...ref } },
    revision: 1,
  };
  const bridge = detachedBridge({
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
  });
  const authored = { pod: "p", scheduleId: 7 };
  const doc = tools.schedules.work.schema.parse({
    writeIntent: { "schedule.capture": { edit: { value: authored } } },
  });
  const seen: unknown[] = [];
  const run = vi.fn(async (ctx: CommandContext) => {
    seen.push(ctx.admission.input);
    return { member: "m" };
  });
  const executor = workIntentBoundary(
    {
      definition: commands["schedule.capture"],
      prepared: z.object({ pod: z.string() }),
      bind: async (ctx) => {
        seen.push(ctx.admission.input);
        return { effects: [], prepare: async () => ({ pod: "p" }) };
      },
      run,
    },
    bridge,
    { sdk: sdkSessions },
  );
  const ctx: CommandContext = {
    admission: {
      id: "capture",
      key: "schedule.capture",
      target: { kind: "document", ref },
      input: { work },
    },
    caller: { kind: "human", via: "local" },
    basis: null,
    consumed: [],
    work: {} as CommandContext["work"],
    selectWork: vi.fn(async () => doc) as CommandContext["selectWork"],
    read: { receipts: () => [] },
  };
  return { executor, ctx, work, authored, seen };
}

test("a capture binds and runs on the input derived from Work, and answers with its own result", async () => {
  const f = await fixture();
  const binding = await f.executor.bind(f.ctx);
  const prepared = await binding.prepare!();
  const result = await f.executor.run(f.ctx, { prepared } as ActionExecution);
  expect(f.seen).toEqual([
    { ...f.authored, work: f.work },
    { ...f.authored, work: f.work },
  ]);
  expect(result).toEqual({ member: "m" });
});

test("a capture refuses Work that belongs to another document before it runs", async () => {
  const f = await fixture();
  const foreign = {
    ...f.work,
    key: { ...f.work.key, open: { session: "A", openId: "open-B" } },
  };
  const ctx = { ...f.ctx, admission: { ...f.ctx.admission, input: { work: foreign } } };
  await expect(f.executor.bind(ctx)).rejects.toThrow("Work belongs to another document");
});

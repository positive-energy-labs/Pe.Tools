import { detachedBridge, captureStore, settle } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import { CANCEL_OPERATION_KEY } from "../src/bridge.ts";
import { familiesReader } from "./effect-test.ts";
import { commandRegistry } from "../src/command-registry.ts";
import type { CommandContext } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";
import { commands } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";

type Matrix = RevitMatrixLoadedFamilies.Res.Response;
type Input = RevitMatrixLoadedFamilies.Req.Request;

async function fixture(blockSecond: boolean, scope?: Scope.Closeable) {
  const dir = await mkdtemp(join(tmpdir(), "families-reader-"));
  const captures = captureStore(dir);
  const document = { session: randomUUID(), openId: randomUUID() };
  const work = bindWork("families", address(join(dir, "source.rvt")), undefined, document);
  const filter = {
    categoryNames: ["Air Terminals"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const readId = randomUUID();
  const calls: { key: string; input: Input; requestId?: string }[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const families = [1, 2].map((id) => ({
    familyId: id,
    familyUniqueId: `u${id}`,
    familyName: `Air ${id}`,
    typeNames: ["One"],
    parameters: [],
    issues: [],
    isPartial: false,
    placedInstanceCount: 0,
  }));
  const reader = await familiesReader(scope);
  const bridge = detachedBridge({
    invoke: (key: string, input: any, _session?: string, _openId?: string | null, requestId?: string) =>
      Effect.promise(async () => {
        calls.push({ key, input, requestId });
        if (key === CANCEL_OPERATION_KEY) return { target: { session: "bridge-a", document: null }, value: {} };
        let value: Matrix;
        if (input.phase === "Prepare")
          value = {
            families: [],
            issues: [],
            source: {
              families: families.map((f) => ({ ...f, typeCount: 1, types: [{ typeName: "One" }] })),
              revitVersion: "2025",
              version: "v1",
              copyRefusal: "Reading unsaved changes in this instance.",
            },
          };
        else if (input.phase === "Extract") {
          if (input.familyId === 2 && blockSecond) await blocked;
          value = { families: [families[input.familyId! - 1]!], issues: [], elapsedMs: 1000 };
        } else value = { families, issues: [] };
        return { target: { session: "bridge-a", document: null }, value };
      }),
  });
  return {
    captures,
    calls,
    document,
    work,
    readId,
    release,
    dir,
    bridge,
    filter,
    reader,
    start: () => reader.read({ bridge, captures, document, work, readId, filter }),
  };
}

test("a row is available before the next family finishes; exact cancellation retains it without completing the baseline", async () => {
  const f = await fixture(true);
  const running = f.start();
  try {
    await vi.waitFor(async () =>
      expect((await f.captures.displayedFamilies(f.work))?.result.families).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(f.calls.filter((c) => c.input.phase === "Extract")).toHaveLength(2),
    );
    expect(await f.captures.latestFamilies(f.work)).toBeNull();
    await expect(f.reader.cancel(f.readId, { ...f.document, openId: "foreign" })).rejects.toThrow(
      "no running",
    );
    const stop = commandRegistry(f.bridge, f.captures, { families: f.reader }, async () => {
      throw Error("Stop must not use the local gateway");
    })("families.cancel-read");
    expect(stop.definition).toBe(commands["families.cancel-read"]);
    expect(commandCatalogAxes["families.cancel-read"].effect).toBe("SessionWrite");
    const context = {
      admission: { input: { readId: f.readId }, target: { kind: "document", ref: f.document } },
    } as unknown as CommandContext;
    const bound = await stop.bind(context);
    const prepared = stop.prepared.parse(await bound.prepare!());
    expect(await stop.run(context, { prepared } as ActionExecution)).toEqual({ cancelled: true });
    const cancel = f.calls.find((c) => c.key === CANCEL_OPERATION_KEY);
    expect(cancel?.input).toEqual({
      requestId: f.calls.find((c) => c.input.familyId === 2)?.requestId,
    });
    f.release();
    const result = await running;
    expect(result.progress).toMatchObject({ state: "cancelled", completed: 1, total: 2 });
    expect(result.result.families.map((family) => family.familyId)).toEqual([1]);
    expect(await f.captures.latestFamilies(f.work)).toBeNull();
    expect(f.calls.filter((c) => c.key !== CANCEL_OPERATION_KEY && !c.input.phase)).toHaveLength(0);
  } finally {
    f.release();
    await running;
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("one persistent Work cannot run competing reads through different document bindings", async () => {
  const f = await fixture(true);
  const running = f.start();
  try {
    await vi.waitFor(() =>
      expect(f.calls.filter((c) => c.input.phase === "Extract")).toHaveLength(2),
    );
    const document = { session: randomUUID(), openId: randomUUID() };
    await expect(
      f.reader.read({
        bridge: f.bridge,
        captures: f.captures,
        document,
        filter: f.filter,
        readId: randomUUID(),
        work: bindWork("families", address(join(f.dir, "source.rvt")), undefined, document),
      }),
    ).rejects.toThrow("already running");
  } finally {
    f.release();
    await running;
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("short reads finish serially and enrich all supplied families once before publishing a completed baseline", async () => {
  const f = await fixture(false);
  try {
    const result = await f.start();
    expect(result.progress).toMatchObject({ state: "complete", completed: 2, workers: 1 });
    expect((await f.captures.latestFamilies(f.work))?.id).toBe(result.id);
    const final = f.calls.filter((c) => !c.input.phase);
    expect(final).toHaveLength(1);
    expect(final[0]?.input.snapshots?.map((family) => family.familyId)).toEqual([1, 2]);
    expect(f.calls).toHaveLength(4);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("overlapping lifecycle operations run one at a time, in order, and a failure frees the next", async () => {
  const reader = await familiesReader();
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const first = reader.lifecycle(async () => {
    order.push("first:start");
    await held;
    order.push("first:end");
    throw Error("first failed");
  });
  const second = reader.lifecycle(async () => {
    order.push("second:start");
    return "second";
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(order).toEqual(["first:start"]);
  release();
  await expect(first).rejects.toThrow("first failed");
  await expect(second).resolves.toBe("second");
  expect(order).toEqual(["first:start", "first:end", "second:start"]);
});

test("closing the reader joins an in-flight read: it settles cancelled before the finalizer returns", async () => {
  const scope = Scope.makeUnsafe();
  const f = await fixture(true, scope);
  let settledRead = false;
  const running = f.start().then((result) => ((settledRead = true), result));
  try {
    await vi.waitFor(() =>
      expect(f.calls.filter((c) => c.input.phase === "Extract")).toHaveLength(2),
    );
    let closed = false;
    const closing = settle(Scope.close(scope, Exit.void)).then(() => (closed = true));
    await vi.waitFor(() => expect(f.calls.some((c) => c.key === CANCEL_OPERATION_KEY)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false); // the native extract still runs: the finalizer waits for it
    f.release();
    await closing;
    expect(settledRead).toBe(true); // joined, not abandoned
    expect((await running).progress).toMatchObject({ state: "cancelled" });
  } finally {
    f.release();
    await running;
    await rm(f.dir, { recursive: true, force: true });
  }
});

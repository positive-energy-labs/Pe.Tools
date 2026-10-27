import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import type { RevitMatrixLoadedFamilies } from "@pe/host-contracts/generated";
import { CANCEL_OPERATION_KEY, type RevitBridge } from "../src/bridge.ts";
import { cancelFamiliesRead, readFamiliesProgressively } from "../src/families-reader.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";

type Matrix = RevitMatrixLoadedFamilies.Res.Response;
type Input = RevitMatrixLoadedFamilies.Req.Request;

async function fixture(blockSecond: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "families-reader-"));
  const captures = new TakeoffCaptures(dir);
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
  const bridge = {
    list: Effect.succeed([]),
    subscribe: () => () => {},
    invoke: (key: string, input: Input, _session: string, _openId?: string, requestId?: string) =>
      Effect.promise(async () => {
        calls.push({ key, input, requestId });
        if (key === CANCEL_OPERATION_KEY) return { value: {} };
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
        return { value };
      }),
  } as unknown as RevitBridge["Service"];
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
    start: () => readFamiliesProgressively({ bridge, captures, document, work, readId, filter }),
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
    await expect(
      cancelFamiliesRead(f.readId, { ...f.document, openId: "foreign" }),
    ).rejects.toThrow("no running");
    await cancelFamiliesRead(f.readId, f.document);
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
      readFamiliesProgressively({
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

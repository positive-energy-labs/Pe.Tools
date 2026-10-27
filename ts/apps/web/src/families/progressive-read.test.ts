import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import { familiesSpec, manifest } from "./manifest";
import type { FamiliesObservation } from "./host";

const calls = vi.hoisted(() => ({ read: vi.fn(), cancel: vi.fn() }));
vi.mock("./host", async (original) => ({
  ...(await original<typeof import("./host")>()),
  readFamiliesObservation: calls.read,
  cancelFamiliesObservation: calls.cancel,
}));

afterEach(() => vi.clearAllMocks());

const target = { session: "families-session", openId: "project-open" };
const work = bindWork("families", address("C:/Models/Air.rvt"), undefined, target);
const family = {
  familyId: 1,
  familyUniqueId: "family-1",
  familyName: "Diffuser",
  typeNames: ["24x24"],
  parameters: [],
  issues: [],
  isPartial: false,
  placedInstanceCount: 1,
};

function invocation() {
  let page = manifest.page!.parse({
    stage: "audit",
    draft: { categories: ["Air Terminals"], families: null, placement: "PlacedOnly" },
  });
  let current = true;
  let cancel: (() => Promise<void>) | undefined;
  const ctx = {
    target: { kind: "document", ref: target },
    page,
    work: { key: work, doc: null, revision: 0, refusal: null },
    readings: {},
    currentPage: () => (current ? page : null),
    cancelWith: (callback: () => Promise<void>) => {
      cancel = callback;
    },
    setPage: vi.fn((patch: object, _guard?: readonly string[]) => {
      page = { ...page, ...patch };
    }),
    write: vi.fn(async (_patches: unknown[], _expectedRevision?: number) => null),
    note: vi.fn(),
  };
  let complete!: (value: FamiliesObservation) => void;
  let fail!: (cause: Error) => void;
  calls.read.mockImplementation(
    () =>
      new Promise<FamiliesObservation>((resolve, reject) => {
        complete = resolve;
        fail = reject;
      }),
  );
  const pending = manifest.actions!.read.run(ctx as never, undefined as never);
  const reading = () => page.reading as FamiliesObservation;
  const finish = (state: "complete" | "cancelled" | "failed") =>
    complete({
      ...reading(),
      id: "persisted-result",
      ...(state === "complete" ? { envelope: { revision: 1 } } : {}),
      progress: { ...reading().progress!, state, completed: 1, total: 2 },
      result: {
        families: [family],
        issues: [],
        page: { totalCount: 2, returnedCount: 1, isTruncated: false },
      },
    });
  return {
    ctx,
    pending,
    reading,
    page: () => page,
    finish,
    fail,
    cancel: () => cancel!(),
    moveTarget: () => {
      current = false;
    },
    receive: (value: FamiliesObservation) => {
      page = { ...page, reading: value };
    },
  };
}

test("the first read subscribes its fixed scope immediately and registers its exact cancellation", async () => {
  const run = invocation();
  expect(run.reading()).toMatchObject({
    document: target,
    work,
    filter: { categoryNames: ["Air Terminals"], familyNames: [], placementScope: "PlacedOnly" },
    result: { families: [] },
    progress: { state: "reading", completed: 0, workers: 1 },
  });
  const subject = manifest.readings!.matrix;
  expect(typeof subject === "function" && subject(run.page() as never, work)).toMatchObject({
    kind: "families-matrix",
    filter: run.reading().filter,
  });
  const readId = run.reading().progress!.runId;
  expect(calls.read).toHaveBeenCalledWith(work, target, run.reading().filter, readId, 0);
  await run.cancel();
  expect(calls.cancel).toHaveBeenCalledWith(target, readId);
  run.finish("cancelled");
  expect(await run.pending).toMatchObject({ code: "partial" });
  expect(run.ctx.write).not.toHaveBeenCalled();
  expect(familiesSpec.targetReady!({ ...run.ctx, page: run.page() } as never)).toBe(
    "Complete this Families read before planning edits",
  );
});

test("progress revisions may replace Page.reading without dropping the final completed baseline", async () => {
  const run = invocation();
  const partial: FamiliesObservation = {
    ...run.reading(),
    id: "partial-one",
    progress: { ...run.reading().progress!, completed: 1, total: 2 },
    result: { families: [family], issues: [], page: null },
  };
  run.receive(partial);
  expect(run.page().reading?.result.families).toEqual([family]);
  run.finish("complete");
  await run.pending;
  expect(run.reading().progress?.state).toBe("complete");
  expect(run.ctx.write).toHaveBeenCalledTimes(1);
  expect(run.ctx.write.mock.calls[0]?.[0]).toEqual([
    { path: ["scope", "edit"], value: { value: partial.filter } },
  ]);
  expect(run.ctx.write.mock.calls[0]?.[1]).toBe(1);
  expect(run.ctx.setPage.mock.calls.some((call) => call[1]?.includes("reading"))).toBe(false);
});

test("a failed read keeps completed families and never arms Work with a partial baseline", async () => {
  const run = invocation();
  run.receive({
    ...run.reading(),
    id: "partial-one",
    result: { families: [family], issues: [], page: null },
  });
  const failed = expect(run.pending).rejects.toThrow("connection lost");
  run.fail(Error("connection lost"));
  await failed;
  expect(run.reading()).toMatchObject({
    progress: { state: "failed", message: "connection lost" },
    result: { families: [family] },
  });
  expect(run.ctx.write).not.toHaveBeenCalled();
});

test("a late read from a previous Target cannot replace the current page or Work", async () => {
  const run = invocation();
  const pageMoves = run.ctx.setPage.mock.calls.length;
  run.moveTarget();
  run.finish("complete");
  await run.pending;
  expect(run.ctx.setPage).toHaveBeenCalledTimes(pageMoves);
  expect(run.ctx.write).not.toHaveBeenCalled();
});

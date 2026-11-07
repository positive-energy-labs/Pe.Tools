import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import {
  scheduleQueries,
} from "../../../../packages/mcps/src/shared/query-client";
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  actionReceiptSchema,
  applyPatches,
  draftCellSchema,
  routeDocDelta,
  type RouteStatePatch,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { bind, commandVerb, invoke, queryVerb, pageVerb, workVerb, type Caller, type VerbDelivery, type VerbContext, type VerbSubject } from "./verbs";


const transport = vi.hoisted(() => ({
  run: vi.fn(),
  preview: vi.fn(),
  families: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: (
    ...args: Parameters<
      typeof import("../../../../packages/mcps/src/shared/takeoff-action-client").runSemanticAction
    >
  ) =>
    /\.preview$|^ducts\.preview-/.test(String(args[0]))
      ? transport.preview(...args)
      : transport.run(...args),
  actionResult: (receipt: { result?: unknown }) => receipt.result,
  cancelRunningAdmissions: vi.fn(async () => []),
}));

vi.mock("../../../../packages/mcps/src/shared/schedule-client", () => ({
  readScheduleCapture: transport.schedule,
}));

const key: WorkKey = { binding: "workspace", route: "verb-proof", target: null, work: "one" };
const schema = z.object({
  writeIntent: z.record(z.string(), z.unknown()).default({}),
  rows: z.record(z.string(), z.object({ id: z.string(), value: z.number(), note: z.string() })),
  cells: z.record(z.string(), draftCellSchema(z.string())),
});
const spec: RouteStateSpec<typeof schema> = {
  route: key.route,
  title: "Proof",
  description: "Verbs",
  schema,
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const succeededReceipt = () =>
  actionReceiptSchema.parse({
    id: "host-receipt",
    key: "takeoffs.initialize",
    caller: { kind: "human", via: "local" },
    target: { kind: "host" },
    basis: null,
    input: { stage: "sheet" },
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: "2026-10-29T12:00:00.000Z",
    state: "succeeded",
    result: { wrote: true },
  });
beforeEach(() => {
  transport.preview.mockReset();
  transport.preview.mockResolvedValue(succeededReceipt());
  transport.run.mockReset();
  transport.families.mockReset();
  transport.schedule.mockReset();
  transport.run.mockResolvedValue(succeededReceipt());
});

function environment<C extends Caller>(caller: C, identity: WorkKey = key) {
  const key = identity;
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("verb-proof", registry);
  cleanups.push(() => {
    owner.dispose();
    registry.dispose();
  });
  let envelope = {
    version: 1 as const,
    revision: 4,
    doc: schema.parse({
      rows: { slot: { id: "a", value: 1, note: "before" } },
      cells: { first: { edit: { value: "proposed" } } },
    }),
  };
  let readingVersion = 1;
  const target = { kind: "document" as const, ref: { session: "session-a", openId: "open-a" } };
  const states: string[] = [];
  const writes: Array<{ patches: RouteStatePatch[]; expectedRevision: number; press: string }> = [];
  const ctx: VerbContext<C> = {
    caller,
    owner,
    snapshot: () => ({
      target,
      work: { handle: { key, revision: envelope.revision }, doc: envelope.doc },
      basis: { readingVersion },
    }),
    subjects: { row: (value) => (value as { id: string }).id },
    changed: (state) => {
      states.push(state);
    },
    write: async (_key, request) => {
      writes.push(request);
      const before = envelope;
      const landed = applyPatches(
        spec,
        envelope,
        caller === "agent" ? "pea" : "human",
        request.patches,
        request.expectedRevision,
      );
      if (!landed.ok) return landed;
      envelope = landed.envelope;
      return {
        ok: true,
        revision: envelope.revision,
        handle: { key, revision: envelope.revision },
        write: {
          key,
          kind: "apply",
          by: caller === "agent" ? "pea" : "human",
          press: request.press,
          base: before.revision,
          revision: envelope.revision,
          patches: routeDocDelta(before.doc, envelope.doc),
          inverse: routeDocDelta(envelope.doc, before.doc),
          undoable: caller === "human",
        },
      };
    },
  };
  const subject: VerbSubject = { type: "row", id: "a", work: key, path: ["rows", "slot"] };
  return {
    ctx,
    owner,
    subject,
    states,
    writes,
    target,
    doc: () => envelope.doc,
    replaceRow: () => {
      envelope.doc.rows.slot = { id: "replacement", value: 9, note: "new" };
    },
    drift: () => {
      readingVersion++;
    },
    moveRevision: () => {
      envelope.revision++;
    },
  };
}

const edit = () =>
  workVerb(
    { label: "edit", subject: "row", input: z.object({ value: z.number() }), chord: "Mod+Enter" },
    {
      patches: (scope, input) => [
        { path: [...scope.subject!.path, "value"], value: input.value },
        { path: [...scope.subject!.path, "note"], value: "after" },
      ],
    },
  );
function command(review: "none" | "shown") {
  const declaration = { label: "initialize", input: z.object({ stage: z.string() }) };
  const implementation = {
    prepare: () => ({ lines: ["Writes shared parameters"] }),
    stage: (_scope: unknown, input: { stage: string }) => input,
    intent: () => ({}),
  };
  return commandVerb("takeoffs.initialize", { ...declaration, review }, implementation);
}
const reviewed = (result: VerbDelivery) => {
  expect(result.state).toBe("review");
  if (result.state !== "review") throw new Error("Expected review");
  return result;
};

















test("validation, readiness and busy admission prevent writes", async () => {
  const env = environment("human");
  const verb = edit();
  expect((await invoke(env.ctx, verb, env.subject, { value: "bad" })).state).toBe("refused");
  const blocked = workVerb(
    { label: "blocked", input: z.undefined() },
    { ready: () => "Read the sheet first", patches: () => [] },
  );
  expect(bind(blocked, { ctx: env.ctx, subject: null, args: undefined }).refusal).toBe(
    "Read the sheet first",
  );
  expect((await invoke(env.ctx, blocked, null, undefined)).state).toBe("refused");
  const reviewVerb = command("shown");
  const review = reviewed(await invoke(env.ctx, reviewVerb, null, { stage: "sheet" }));
  expect(await invoke(env.ctx, verb, env.subject, { value: 2 })).toMatchObject({
    state: "refused",
    press: null,
    refusal: { code: "busy" },
  });
  expect(env.writes).toHaveLength(1); // The review staged intent; busy admission added no write.
  await invoke(env.ctx, reviewVerb, null, undefined, { kind: "cancel", ticket: review.ticket });
});












test("a query's final result is admitted only into the scope generation it started in", async () => {
  const env = environment("human");
  let generation = 1;
  const moving: VerbContext<"human"> = {
    ...env.ctx,
    snapshot: () => ({ ...env.ctx.snapshot(), generation }),
  };
  const verb = queryVerb(scheduleQueries["schedule.grid.catalog"], {
    label: "Catalog",
    input: z.strictObject({}).default({}),
    review: "none",
  });
  let finish!: (value: unknown) => void;
  transport.schedule.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const pressed = invoke(moving, verb, null, {});
  await vi.waitFor(() => expect(transport.schedule).toHaveBeenCalled());
  // A -> B -> A: the same Target and Work key come back, but as the third generation.
  generation = 3;
  finish({ schedules: [] });
  expect(await pressed).toMatchObject({ state: "stale" });
});









test("K1.5: command lands its result and fences late Page changes after A-B-A", async () => {
  const env = environment("human");
  let generation = 1;
  const ctx = { ...env.ctx, snapshot: () => ({ ...env.ctx.snapshot(), generation }) };
  const verb = commandVerb(
    "takeoffs.initialize",
    { label: "Initialize", input: z.object({}), review: "none" },
    {
      stage: () => ({ stage: "sheet" }),
      intent: () => ({}),
      lands: (result) => ({ selected: (result as { wrote: boolean }).wrote }),
    },
  );
  expect(await invoke(ctx, verb, null, {})).toMatchObject({
    state: "done",
    page: { selected: true },
  });
  let finish!: (receipt: ReturnType<typeof succeededReceipt>) => void;
  transport.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = invoke(ctx, verb, null, {});
  await vi.waitFor(() => expect(finish).toBeDefined());
  generation = 3;
  finish(succeededReceipt());
  expect(await pending).not.toHaveProperty("page");
});



test("Page verbs run without Work, host transport, or undo writes", async () => {
  const env = environment("human");
  const verb = pageVerb(
    { label: "Close inspector", input: z.object({}), chord: "Escape" },
    { page: () => ({ inspector: "" }) },
  );
  const ctx = {
    ...env.ctx,
    snapshot: () => ({ target: { kind: "host" as const }, work: null, basis: null, closed: true }),
  };
  expect(await invoke(ctx, verb, null, {})).toMatchObject({
    state: "done",
    kind: "page",
    page: { inspector: "" },
  });
  expect(transport.run).not.toHaveBeenCalled();
  expect(env.writes).toEqual([]);
});

test("K1.2: page.bind resolves its HTTP contract at invocation and validates before dispatch", async () => {
  const fetch = vi.fn(async () => Response.json({ bound: true }));
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(pageBindRpc.run({ slug: "test", binding: { kind: "none" } })).resolves.toEqual({
      bound: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(pageBindRpc.run({ slug: "test", binding: { kind: "wrong" } })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

import { pageBindRpc } from "../../../../packages/mcps/src/shared/rpc-client";
import {
  scheduleQueries,
  familiesQueries,
} from "../../../../packages/mcps/src/shared/query-client";
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  actionReceiptSchema,
  applyPatches,
  draftCellSchema,
  routeDocDelta,
  type PaneDecl,
  type RouteStatePatch,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import {
  bind,
  commandVerb,
  commit,
  invoke,
  placements,
  queryVerb,
  rpcVerb,
  pageVerb,
  sequenceVerb,
  workVerb,
  type Caller,
  type InvocationPhase,
  type InvocationResult,
  type VerbContext,
  type VerbSubject,
} from "./verbs";
import { kernelCellVerbs } from "./verbs-cells";

const transport = vi.hoisted(() => ({ run: vi.fn(), families: vi.fn(), schedule: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: transport.run,
  cancelRunningAdmissions: vi.fn(async () => []),
}));

vi.mock("../../../../packages/mcps/src/shared/families-client", async (original) => ({
  ...(await original<typeof import("../../../../packages/mcps/src/shared/families-client")>()),
  readFamiliesCapture: transport.families,
}));
vi.mock("../../../../packages/mcps/src/shared/schedule-client", () => ({
  readScheduleCapture: transport.schedule,
}));

const key: WorkKey = { binding: "workspace", route: "verb-proof", target: null, work: "one" };
const schema = z.object({
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
  transport.run.mockReset();
  transport.families.mockReset();
  transport.schedule.mockReset();
  transport.run.mockResolvedValue(succeededReceipt());
});

function environment<C extends Caller>(caller: C) {
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
      cells: { first: { suggestion: { value: "proposed" } } },
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
function command(review: "none" | "shown" | "required") {
  const declaration = { label: "initialize", input: z.object({ stage: z.string() }) };
  const implementation = {
    prepare: () => ({ lines: ["Writes shared parameters"] }),
    intent: (_scope: unknown, input: { stage: string }) => input,
  };
  return review === "required"
    ? commandVerb(
        "takeoffs.initialize",
        { ...declaration, review, answers: z.object({ reason: z.string().min(1) }) },
        implementation,
      )
    : commandVerb("takeoffs.initialize", { ...declaration, review }, implementation);
}
const reviewed = (result: InvocationResult) => {
  expect(result.state).toBe("review");
  if (result.state !== "review") throw new Error("Expected review");
  return result;
};

test("Work acknowledges forward and inverse paths, and two patches share the owner's one press", async () => {
  const env = environment("human");
  const run = vi.spyOn(env.owner, "runAction");
  const bound = bind(edit(), { ctx: env.ctx, subject: env.subject, args: { value: 12 } });
  expect(bound.label).toBe("edit");
  expect(bound.chord).toBe("Mod+Enter");
  expect(bound.refusal).toBeNull();
  const result = await bound.run();
  expect(result.state).toBe("done");
  if (result.state !== "done" || result.kind !== "work")
    throw new Error("Expected acknowledgement");
  expect(run).toHaveBeenCalledTimes(1);
  expect(result.press).toMatch(/^[0-9a-f-]{36}$/);
  expect(env.writes).toEqual([
    {
      patches: [
        { path: ["rows", "slot", "value"], value: 12 },
        { path: ["rows", "slot", "note"], value: "after" },
      ],
      expectedRevision: 4,
      press: result.press,
    },
  ]);
  expect(result.acknowledgement).toMatchObject({
    press: result.press,
    base: 4,
    revision: 5,
    patches: env.writes[0]!.patches,
    inverse: [
      { path: ["rows", "slot", "value"], value: 1 },
      { path: ["rows", "slot", "note"], value: "before" },
    ],
  });
  const restored = applyPatches(
    spec,
    { version: 1, revision: 5, doc: env.doc() },
    "human",
    result.acknowledgement.inverse,
    5,
    true,
    true,
  );
  expect(restored.ok && restored.envelope.doc.rows.slot).toEqual({
    id: "a",
    value: 1,
    note: "before",
  });
  expect(env.states).toEqual(["idle", "preparing", "applying", "done"]);
  // A returned terminal result has released the owner's admission.
  expect(
    (await bind(edit(), { ctx: env.ctx, subject: env.subject, args: { value: 13 } }).run()).state,
  ).toBe("done");
});

test.each(["human", "agent"] as const)(
  "required review refuses missing or invalid answers for %s",
  async (caller) => {
    const env = environment(caller);
    const verb = command("required");
    const started = reviewed(await invoke(env.ctx, verb, null, { stage: "sheet" }));
    expect(started.ticket).toEqual({
      press: started.press,
      subject: null,
      input: { stage: "sheet" },
      target: env.target,
      basis: { work: { key, revision: 4 }, value: { readingVersion: 1 } },
      evidence: { lines: ["Writes shared parameters"] },
      presentation: { sentence: "initialize: review the proposed changes.", rows: [] },
    });
    expect((await commit(env.ctx, verb, started.ticket)).state).toBe("refused");
    expect((await commit(env.ctx, verb, started.ticket, {})).state).toBe("refused");
    expect(transport.run).not.toHaveBeenCalled();
    const run = vi.spyOn(env.owner, "runAction");
    const result = await commit(env.ctx, verb, started.ticket, { reason: "Needed for takeoff" });
    expect(result).toMatchObject({ state: "done", kind: "command", press: started.press });
    expect(run).not.toHaveBeenCalled();
    expect(transport.run).toHaveBeenCalledExactlyOnceWith(
      "takeoffs.initialize",
      { stage: "sheet" },
      env.target,
      { key, revision: 4 },
      "",
      started.press,
      120_000,
    );
    if (result.state !== "done" || result.kind !== "command")
      throw new Error("Expected host receipt");
    expect(result.receipt).toBe(await transport.run.mock.results[0]!.value);
    expect((await commit(env.ctx, verb, started.ticket, { reason: "again" })).state).toBe(
      "refused",
    );
    expect(env.states).toEqual(["idle", "preparing", "review", "applying", "done"]);
  },
);

test("shown review can be skipped by agent, and cannot be skipped by human at type or runtime boundary", async () => {
  const human = environment("human");
  const agent = environment("agent");
  const verb = command("shown");
  // @ts-expect-error A human phase has no skip alternative.
  const illegal: InvocationPhase<"human"> = { kind: "skip" };
  expect((await invoke(human.ctx, verb, null, { stage: "sheet" }, illegal)).state).toBe("refused");
  expect(transport.run).not.toHaveBeenCalled();
  const review = reviewed(await invoke(human.ctx, verb, null, { stage: "sheet" }));
  expect(transport.run).not.toHaveBeenCalled();
  expect((await commit(human.ctx, verb, review.ticket)).state).toBe("done");
  expect((await invoke(agent.ctx, verb, null, { stage: "sheet" }, { kind: "skip" })).state).toBe(
    "done",
  );
  expect(transport.run).toHaveBeenCalledTimes(2);
  expect(
    (await invoke(agent.ctx, command("required"), null, { stage: "sheet" }, { kind: "skip" }))
      .state,
  ).toBe("refused");
});

test("placements evaluate a bounded row function and preserve distinct verb schemas", async () => {
  const env = environment("human");
  const first = edit();
  const second = workVerb(
    { label: "clear", subject: "row", input: z.undefined() },
    { patches: () => [] },
  );
  const rowVerbs = Object.assign(
    (row: { editable: boolean }) => (row.editable ? ["edit"] : ["clear"]),
    { ids: ["edit", "clear"] },
  );
  const declarations: Record<string, PaneDecl<{ editable: boolean }>> = {
    table: { label: "Rows", purpose: "Edit", draws: [], verbs: rowVerbs },
  };
  const stage = { word: "Work", panes: ["table"], verbs: [] };
  const panes = {
    ctx: env.ctx,
    declarations,
    verbs: { edit: first, clear: second },
    binding: (id: string) => ({
      subject: env.subject,
      args: id === "edit" ? { value: 7 } : undefined,
    }),
  };
  expect(placements(stage, panes, { editable: true }).map((verb) => verb.label)).toEqual(["edit"]);
  expect(placements(stage, panes, { editable: false }).map((verb) => verb.label)).toEqual([
    "clear",
  ]);
  expect(placements(stage, panes)).toEqual([]);
  expect((await placements(stage, panes, { editable: true })[0]!.run()).state).toBe("done");
  rowVerbs.ids = ["clear"];
  expect(() => placements(stage, panes, { editable: true })).toThrow("Undeclared row verb");
});

test("a bound row cannot mutate a replacement with a different identity or an indexed path", async () => {
  const env = environment("human");
  const verb = edit();
  const bound = bind(verb, { ctx: env.ctx, subject: env.subject, args: { value: 12 } });
  env.replaceRow();
  expect(bound.refusal).toContain("identity changed");
  expect((await bound.run()).state).toBe("stale");
  expect(env.writes).toEqual([]);
  expect(
    (
      await invoke(
        env.ctx,
        verb,
        { ...env.subject, path: ["rows", 0] as unknown as string[] },
        { value: 2 },
      )
    ).state,
  ).toBe("stale");
});

test.each(["reading", "revision", "target"] as const)(
  "ticket %s drift invalidates without dispatch, and releases admission",
  async (kind) => {
    const env = environment("human");
    const verb = command("shown");
    const review = reviewed(await invoke(env.ctx, verb, null, { stage: "sheet" }));
    if (kind === "reading") env.drift();
    if (kind === "revision") env.moveRevision();
    if (kind === "target") env.target.ref.openId = "new-incarnation";
    expect((await commit(env.ctx, verb, review.ticket)).state).toBe("stale");
    expect(transport.run).not.toHaveBeenCalled();
    expect((await commit(env.ctx, verb, review.ticket)).state).toBe("refused");
    expect((await invoke(env.ctx, command("none"), null, { stage: "sheet" })).state).toBe("done");
  },
);

test("tickets cannot be forged or moved between callers, and explicit cancellation releases the owner", async () => {
  const human = environment("human");
  const agent = environment("agent");
  const verb = command("shown");
  const review = reviewed(await invoke(human.ctx, verb, null, { stage: "sheet" }));
  expect((await commit(agent.ctx, verb, review.ticket)).state).toBe("refused");
  expect(
    (await commit(human.ctx, verb, { ...review.ticket, input: { stage: "forged" } })).state,
  ).toBe("refused");
  expect(Object.isFrozen(review.ticket.input)).toBe(true);
  expect(
    (await invoke(human.ctx, verb, null, undefined, { kind: "cancel", ticket: review.ticket }))
      .state,
  ).toBe("refused");
  expect((await invoke(human.ctx, command("none"), null, { stage: "sheet" })).state).toBe("done");
});

test("Pea can commit an authentic ticket after JSON transport with the same invocation press", async () => {
  const env = environment("agent");
  const verb = command("required");
  const review = reviewed(await invoke(env.ctx, verb, null, { stage: "sheet" }));
  const ticket = JSON.parse(JSON.stringify(review.ticket));
  const result = await commit(env.ctx, verb, ticket, { reason: "Approved" });
  expect(result).toMatchObject({ state: "done", kind: "command", press: review.press });
  expect(transport.run).toHaveBeenCalledTimes(1);
});

test("kernel cell verbs use the shared transitions and host acknowledgement", async () => {
  const env = environment("human");
  const { verbs, subjects } = kernelCellVerbs({ cells: [{ segment: "cells", groupOf: () => [] }] });
  const ctx = { ...env.ctx, subjects: { ...env.ctx.subjects, ...subjects } };
  const subject = { type: "cell:cells", id: "first", work: key, path: ["cells", "first"] };
  expect(Object.keys(verbs)).toEqual([
    "cell:cells.take",
    "cell:cells.reject",
    "cell:cells.reopen",
    "cell:cells.delete",
  ]);
  expect(z.toJSONSchema(verbs["cell:cells.take"]!.input, { io: "input" })).toMatchObject({
    type: "object",
  });
  const taken = await invoke(ctx, verbs["cell:cells.take"]!, subject, undefined);
  expect(taken).toMatchObject({ state: "done", kind: "work" });
  expect(env.doc().cells.first).toMatchObject({
    edit: { value: "proposed", by: "human", base: 4 },
    suggestion: null,
  });
  expect(env.writes[0]!.patches).toEqual([
    { path: ["cells", "first", "edit"], value: { value: "proposed" } },
    { path: ["cells", "first", "suggestion"], value: null },
  ]);
  expect((await invoke(ctx, verbs["cell:cells.reopen"]!, subject, undefined)).state).toBe("done");
  expect(env.doc().cells.first?.edit).toBeNull();
  expect((await invoke(ctx, verbs["cell:cells.delete"]!, subject, undefined)).state).toBe("done");
  expect(env.doc().cells.first).toBeUndefined();
});

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
  expect(env.writes).toEqual([]);
  await invoke(env.ctx, reviewVerb, null, undefined, { kind: "cancel", ticket: review.ticket });
});

test("a bound control retains its document incarnation and Work revision", async () => {
  const env = environment("human");
  const bound = bind(edit(), { ctx: env.ctx, subject: env.subject, args: { value: 12 } });
  env.target.ref.openId = "reopened-document";
  expect(bound.refusal).toContain("basis changed");
  expect((await bound.run()).state).toBe("stale");
  const rebound = bind(edit(), { ctx: env.ctx, subject: env.subject, args: { value: 12 } });
  env.moveRevision();
  expect((await rebound.run()).state).toBe("stale");
  expect(env.writes).toEqual([]);
});

test("drift while preparing cannot issue a usable review ticket", async () => {
  const env = environment("human");
  const verb = commandVerb(
    "takeoffs.initialize",
    {
      label: "initialize",
      input: z.object({ stage: z.string() }),
      review: "shown",
    },
    {
      prepare: async () => {
        await Promise.resolve();
        env.drift();
        return { preview: true };
      },
      intent: (_scope, input) => input,
    },
  );
  expect((await invoke(env.ctx, verb, null, { stage: "sheet" })).state).toBe("stale");
  expect(env.states).toEqual(["idle", "preparing", "stale"]);
  expect(transport.run).not.toHaveBeenCalled();
});

test("a host refusal and a transport failure retain distinct terminal evidence", async () => {
  const env = environment("human");
  const blocked: VerbContext<"human"> = {
    ...env.ctx,
    write: async () => ({
      ok: false,
      kind: "refused",
      code: "stale_revision",
      error: "Work moved",
      hint: "Read again",
    }),
  };
  expect((await invoke(blocked, edit(), env.subject, { value: 2 })).state).toBe("stale");
  transport.run.mockRejectedValueOnce(new Error("Transport disconnected"));
  expect(await invoke(env.ctx, command("none"), null, { stage: "sheet" })).toMatchObject({
    state: "failed",
    refusal: { message: "Transport disconnected" },
  });
  const receipt = succeededReceipt();
  if (receipt.state !== "succeeded") throw new Error("Expected succeeded fixture");
  const { result: _result, ...attempt } = receipt;
  const failedReceipt = actionReceiptSchema.parse({
    ...attempt,
    state: "failed",
    error: "Host declined",
    status: 409,
    refusal: { kind: "domain", code: "locked", message: "Host declined" },
  });
  transport.run.mockResolvedValueOnce(failedReceipt);
  expect(await invoke(env.ctx, command("none"), null, { stage: "sheet" })).toMatchObject({
    state: "refused",
    receipt: failedReceipt,
  });
});

test("reject uses unsuggest, and cell admission can refuse deletion", async () => {
  const env = environment("human");
  const { verbs, subjects } = kernelCellVerbs({ cells: [{ segment: "cells", groupOf: () => [] }] });
  const ctx = { ...env.ctx, subjects };
  const subject = { type: "cell:cells", id: "first", work: key, path: ["cells", "first"] };
  expect((await invoke(ctx, verbs["cell:cells.reject"]!, subject, undefined)).state).toBe("done");
  expect(env.doc().cells.first?.suggestion).toBeNull();
  const locked = kernelCellVerbs({
    cells: [
      {
        segment: "cells",
        groupOf: () => [],
        admit: () => ({ code: "locked", message: "This cell is locked" }),
      },
    ],
  });
  const bound = bind(locked.verbs["cell:cells.delete"]!, {
    ctx: { ...ctx, subjects: locked.subjects },
    subject,
    args: undefined,
  });
  expect(bound.refusal).toBe("This cell is locked");
  expect((await bound.run()).state).toBe("refused");
  expect(env.doc().cells.first).toBeDefined();
});

test("intent reads the evidence its review ticket froze, so an apply names the authentic preview", async () => {
  const env = environment("human");
  const verb = commandVerb(
    "takeoffs.initialize",
    { label: "initialize", input: z.object({ stage: z.string() }), review: "shown" },
    {
      prepare: () => ({ plan: { id: "plan-1" } }),
      intent: (_scope, input, _answers, ticket) => ({
        ...input,
        stage: (ticket!.evidence as { plan: { id: string } }).plan.id,
      }),
    },
  );
  const { ticket } = reviewed(await invoke(env.ctx, verb, null, { stage: "ignored" }));
  expect(ticket.evidence).toEqual({ plan: { id: "plan-1" } });
  expect(await commit(env.ctx, verb, ticket)).toMatchObject({ state: "done", kind: "command" });
  expect(transport.run.mock.calls[0]![1]).toEqual({ stage: "plan-1" });
});

test("a families read reaches the families client with the Work key and exact document", async () => {
  const env = environment("human");
  const filter = { categoryNames: [], familyNames: [], placementScope: "AllLoaded" as const };
  const readId = crypto.randomUUID();
  const verb = queryVerb(
    familiesQueries["families.read"],
    { label: "Read families", input: z.strictObject({}).default({}), review: "none" },
    { intent: () => ({ filter, readId }) },
  );
  transport.families.mockResolvedValue({ id: "observation" });
  expect(await invoke(env.ctx, verb, null, {})).toMatchObject({
    state: "done",
    kind: "query",
    receipt: { key: "families.read", value: { id: "observation" } },
  });
  expect(transport.families).toHaveBeenCalledWith(
    "families.read",
    { filter, readId },
    key,
    env.target.ref,
  );
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

test("a host refusal from a query reads refused; a server failure reads failed", async () => {
  const env = environment("human");
  const verb = queryVerb(scheduleQueries["schedule.grid.catalog"], {
    label: "Catalog",
    input: z.strictObject({}).default({}),
    review: "none",
  });
  transport.schedule.mockRejectedValueOnce(
    Object.assign(Error("Open a document"), { status: 409 }),
  );
  expect(await invoke(env.ctx, verb, null, {})).toMatchObject({
    state: "refused",
    refusal: { message: "Open a document" },
  });
  transport.schedule.mockRejectedValueOnce(Object.assign(Error("Host crashed"), { status: 500 }));
  expect(await invoke(env.ctx, verb, null, {})).toMatchObject({ state: "failed" });
});

test("K1.1: an unknown-to-kernel read owns its normalization and runner", async () => {
  const env = environment("human");
  const run = vi.fn(async (input) => ({ echo: input.n }));
  const verb = queryVerb(
    { key: "pod.future.read", input: z.object({ n: z.coerce.number() }), run },
    { label: "Read", input: z.object({ n: z.string() }), review: "none" },
  );
  expect(await invoke(env.ctx, verb, null, { n: "7" })).toMatchObject({
    state: "done",
    receipt: { value: { echo: 7 } },
  });
  expect(run).toHaveBeenCalledWith(
    { n: 7 },
    { target: env.target, work: env.ctx.snapshot().work!.handle },
  );
});

test("K1.2: a human-only RPC refuses agent binding and direct invocation before dispatch", async () => {
  const run = vi.fn(async () => ({ ok: true }));
  const verb = rpcVerb(
    { key: "page.bind", input: z.object({}), run },
    { label: "Bind", input: z.object({}), review: "none", caller: "human" },
    { intent: () => ({}) },
  );
  const agent = environment("agent");
  expect(bind(verb, { ctx: agent.ctx, subject: null, args: {} }).refusal).toContain(
    "Only a person",
  );
  expect(await invoke(agent.ctx, verb, null, {})).toMatchObject({ state: "refused" });
  expect(run).not.toHaveBeenCalled();
  expect(await invoke(environment("human").ctx, verb, null, {})).toMatchObject({
    state: "done",
    kind: "rpc",
  });
  expect(run).toHaveBeenCalledTimes(1);
});

test("K1.4: readiness sees current Reading values without cloning native view objects", async () => {
  const env = environment("human");
  let ready = false;
  const ctx = {
    ...env.ctx,
    readings: () => ({
      scene: {
        status: "ready" as const,
        current: true,
        complete: true,
        version: 1,
        basis: null,
        value: { ready, pixels: new Uint8Array([1]) },
      },
    }),
  };
  const verb = workVerb(
    { label: "Readiness", input: z.object({}) },
    {
      ready: (scope) =>
        (scope.readings.scene?.value as { ready: boolean } | undefined)?.ready
          ? null
          : "Scene not ready",
      patches: () => [{ path: ["rows", "slot", "value"], value: 5 }],
    },
  );
  expect(await invoke(ctx, verb, null, {})).toMatchObject({ state: "refused" });
  ready = true;
  expect(await invoke(ctx, verb, null, {})).toMatchObject({ state: "done" });
});

test("K1.5: command lands its result and fences late Page changes after A-B-A", async () => {
  const env = environment("human");
  let generation = 1;
  const ctx = { ...env.ctx, snapshot: () => ({ ...env.ctx.snapshot(), generation }) };
  const verb = commandVerb(
    "takeoffs.initialize",
    { label: "Initialize", input: z.object({}), review: "none" },
    {
      intent: () => ({ stage: "sheet" }),
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

test("K1.6: a sequence has one press, separate reviewed receipts, and stops at failure", async () => {
  const env = environment("human");
  const receipts = vi.fn();
  const ctx = { ...env.ctx, receipt: receipts };
  const verb = sequenceVerb(
    "takeoffs.initialize",
    { label: "Initialize all", input: z.object({}), review: "shown" },
    {
      intent: () => [{ stage: "first" }, { stage: "second" }, { stage: "third" }],
    },
  );
  const first = reviewed(await invoke(ctx, verb, null, {}));
  expect(first.ticket).toMatchObject({ step: 0, evidence: { stage: "first" } });
  expect(transport.run).not.toHaveBeenCalled();
  const second = reviewed(await commit(ctx, verb, first.ticket));
  expect(second.press).toBe(first.press);
  expect(second.ticket).toMatchObject({ step: 1, evidence: { stage: "second" } });
  expect(receipts).toHaveBeenCalledTimes(1);
  transport.run.mockResolvedValueOnce({
    ...succeededReceipt(),
    state: "failed",
    error: "Zone refused",
  });
  expect(await commit(ctx, verb, second.ticket)).toMatchObject({
    state: "failed",
    press: first.press,
  });
  expect(transport.run).toHaveBeenCalledTimes(2);
  expect(transport.run.mock.calls[0]![5]).not.toBe(transport.run.mock.calls[1]![5]);
});

test("K1.7: take-derived patches share the proposal's one write and inverse", async () => {
  const env = environment("human");
  const kernel = kernelCellVerbs({
    cells: [
      {
        segment: "cells",
        groupOf: (key) => [key],
        take: () => [{ path: ["rows", "slot", "note"], value: "first base" }],
      },
    ],
  });
  const subject: VerbSubject = {
    type: "cell:cells",
    id: "first",
    work: key,
    path: ["cells", "first"],
  };
  const result = await invoke(
    { ...env.ctx, subjects: kernel.subjects },
    kernel.verbs["cell:cells.take"]!,
    subject,
    {},
  );
  expect(result).toMatchObject({ state: "done", kind: "work" });
  expect(env.writes).toHaveLength(1);
  expect(env.doc().rows.slot!.note).toBe("first base");
  if (result.state !== "done" || result.kind !== "work") throw Error("missing ack");
  expect(result.acknowledgement.inverse).toContainEqual({
    path: ["rows", "slot", "note"],
    value: "before",
  });
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

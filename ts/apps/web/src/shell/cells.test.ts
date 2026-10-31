// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  applyPatches,
  draftCellSchema,
  routeDocDelta,
  type RouteGraph,
  type RouteStatePatch,
  type RouteStateSpec,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { createWorkJournal, type JournalWriter } from "./journal";
import { invoke, type VerbContext } from "./verbs";
import { kernelCellVerbs } from "./verbs-cells";

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: vi.fn(),
  cancelRunningAdmissions: vi.fn(async () => []),
}));

const key: WorkKey = { binding: "workspace", route: "cells-proof", target: null, work: "one" };
const schema = z.object({
  rules: z.record(z.string(), draftCellSchema(z.string())),
  scope: draftCellSchema(z.string()).nullable().default(null),
});
type Work = z.infer<typeof schema>;
const spec: RouteStateSpec<typeof schema> = {
  route: key.route,
  title: "Cells",
  description: "Kernel cell verbs",
  schema,
};
const graph = {
  verbs: {},
  work: schema,
  cells: [
    { segment: "rules", groupOf: (id: string) => [id], nouns: ["rule"], noun: "loss rules" },
    { segment: null, key: "scope", groupOf: () => [], noun: "scope" },
  ],
} as unknown as RouteGraph<Record<string, unknown>, Work>;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function environment() {
  const registry = makeAtomRegistry();
  const owner = createRouteOwner(key.route, registry);
  cleanups.push(() => {
    owner.dispose();
    registry.dispose();
  });
  let envelope = {
    version: 1 as const,
    revision: 1,
    doc: schema.parse({
      rules: { a: { suggestion: { value: "one" } }, b: { suggestion: { value: "two" } } },
      scope: { suggestion: { value: "wide" } },
    }),
  };
  const journal = createWorkJournal(key);
  const acks: WorkWriteAck[] = [];
  const { verbs, subjects, placement } = kernelCellVerbs(graph);
  const land = (
    patches: RouteStatePatch[],
    expectedRevision: number,
    press: string | null,
    restore: boolean,
  ): RouteStateWriteResult => {
    const before = envelope;
    const landed = applyPatches(
      spec,
      envelope,
      "human",
      patches,
      expectedRevision,
      restore,
      restore,
    );
    if (!landed.ok) return landed;
    envelope = landed.envelope;
    const write: WorkWriteAck = {
      key,
      kind: restore ? "restore" : "apply",
      by: "human",
      press,
      base: before.revision,
      revision: envelope.revision,
      patches: routeDocDelta(before.doc, envelope.doc),
      inverse: routeDocDelta(envelope.doc, before.doc),
      undoable: !restore,
    };
    acks.push(write);
    journal.observe(envelope);
    journal.accept(write, press ? { label: press } : undefined);
    return { ok: true, revision: envelope.revision, write };
  };
  const ctx: VerbContext<"human"> = {
    caller: "human",
    owner,
    snapshot: () => ({
      target: { kind: "document", ref: { session: "s", openId: "o" } },
      work: { handle: { key, revision: envelope.revision }, doc: envelope.doc },
      basis: null,
    }),
    subjects,
    write: async (_key, request) =>
      land(request.patches, request.expectedRevision, request.press, false),
  };
  const restorer: JournalWriter = async (request) =>
    land(request.patches, request.expectedRevision, null, true);
  // The journal needs its baseline revision before the first authored edit.
  journal.accept({
    key,
    kind: "restore",
    by: "human",
    press: null,
    base: 0,
    revision: 1,
    patches: [],
    inverse: [],
    undoable: false,
  });
  return {
    ctx,
    restorer,
    verbs,
    placement,
    journal,
    acks,
    doc: (): Work => envelope.doc,
    revision: () => envelope.revision,
  };
}

const row = (type: string, path: string[]) => ({
  type,
  id: path.at(-1)!,
  work: key,
  path,
});

test("the graph is the only authority: each family gets four ids, placed on its own row", () => {
  const { verbs, placement } = kernelCellVerbs(graph);
  expect(Object.keys(verbs)).toEqual([
    "cell:rules.take",
    "cell:rules.reject",
    "cell:rules.reopen",
    "cell:rules.delete",
    "cell:scope.take",
    "cell:scope.reject",
    "cell:scope.reopen",
    "cell:scope.delete",
  ]);
  expect(placement["cell:rules"]).toEqual(Object.keys(verbs).slice(0, 4));
  for (const verb of Object.values(verbs))
    expect(verb).toMatchObject({ kind: "work", review: "none" });
  expect(Object.values(verbs).some((verb) => verb.chord)).toBe(false);
  expect(kernelCellVerbs({}).verbs).toEqual({});
});

test("each verb lands one single-step journal entry whose undo restores the document", async () => {
  const env = environment();
  const rule = row("cell:rules", ["rules", "a"]);
  const before = structuredClone(env.doc());

  expect((await invoke(env.ctx, env.verbs["cell:rules.take"]!, rule, undefined)).state).toBe(
    "done",
  );
  expect(env.doc().rules.a).toMatchObject({ edit: { value: "one" }, suggestion: null });
  expect((await invoke(env.ctx, env.verbs["cell:rules.reopen"]!, rule, undefined)).state).toBe(
    "done",
  );
  expect(env.doc().rules.a?.edit).toBeNull();
  expect(
    (
      await invoke(
        env.ctx,
        env.verbs["cell:rules.reject"]!,
        row("cell:rules", ["rules", "b"]),
        undefined,
      )
    ).state,
  ).toBe("done");
  expect(env.doc().rules.b?.suggestion).toBeNull();
  expect((await invoke(env.ctx, env.verbs["cell:rules.delete"]!, rule, undefined)).state).toBe(
    "done",
  );
  expect(env.doc().rules.a).toBeUndefined();

  // Every acknowledgement carries patches and their inverse, and each press is one undo step.
  expect(env.acks).toHaveLength(4);
  for (const ack of env.acks) {
    expect(ack.patches.length).toBeGreaterThan(0);
    expect(ack.inverse.length).toBeGreaterThan(0);
  }
  expect(env.journal.read().undo.map((step) => step.transitions.length)).toEqual([1, 1, 1, 1]);

  for (let step = 0; step < 4; step++) expect((await env.journal.undo(env.restorer)).ok).toBe(true);
  expect(env.doc()).toEqual(before);
});

test("a root cell resolves only at its own key, and delete removes it", async () => {
  const env = environment();
  const scope = row("cell:scope", ["scope"]);
  expect(env.ctx.subjects["cell:scope"]!({}, scope)).toBe("scope");
  expect(env.ctx.subjects["cell:scope"]!({}, row("cell:scope", ["note"]))).toBeNull();
  expect((await invoke(env.ctx, env.verbs["cell:scope.take"]!, scope, undefined)).state).toBe(
    "done",
  );
  expect(env.doc().scope).toMatchObject({ edit: { value: "wide" } });
  expect((await invoke(env.ctx, env.verbs["cell:scope.delete"]!, scope, undefined)).state).toBe(
    "done",
  );
  expect(env.doc().scope).toBeNull();
  expect(env.journal.read().undo).toHaveLength(2);
});

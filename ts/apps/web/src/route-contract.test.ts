import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { createLegacyRouteRegistry, legacyRouteDiscovery } from "./shell/legacy-route-door";
import { ductLossGraph as ductLoss } from "./duct-loss/graph.ts";
import { indexGraph } from "./index/graph";
import { roomsGraph, roomsPageSchema } from "./rooms/graph";
import {
  cellVerbId,
  gate,
  graphFieldPolicy,
  pane,
  projectRouteGraph,
  routeGraphHash,
  SALVAGE_VERB,
  START_FRESH_VERB,
  validateRouteGraph,
  type CellsDecl,
  type FieldRole,
  type RouteGraph,
  type VerbDecl,
} from "../../../packages/agent-contracts/src/route-graph.ts";

const fields = ductLoss.fields;

test("Page verbs validate without Work or review and reject command semantics", () => {
  const close: VerbDecl = {
    kind: "page",
    label: "Close",
    input: z.object({}),
    review: "none",
    chord: "Escape",
  };
  const graph = (patch: Partial<VerbDecl> = {}) => ({
    ...ductLoss,
    verbs: { close: { ...close, ...patch } },
  });
  expect(validateRouteGraph(graph())).toEqual([]);
  expect(projectRouteGraph(graph()).verbs.close).toMatchObject({ kind: "page", chord: "Escape" });
  for (const patch of [{ review: "shown" as const }, { subject: "cell" }, { does: "apply" }])
    expect(validateRouteGraph(graph(patch))).toContainEqual({
      code: "invalid-graph",
      path: "verbs.close",
      message: "A Page verb has no Work subject, command, or review",
    });
});

const verb = (label: string, chord = "Mod+Enter"): VerbDecl => ({
  kind: "command",
  label,
  input: z.object({ id: z.string() }),
  review: "shown",
  chord,
});

test("projection is plain JSON, recursively key-sorted, stable, and hashed as canonical UTF-8 SHA-256", async () => {
  const first = projectRouteGraph(ductLoss);
  const second = projectRouteGraph(ductLoss);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  const reverse = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).reverse());
  const reordered = projectRouteGraph({
    ...ductLoss,
    fields: reverse(ductLoss.fields) as typeof ductLoss.fields,
    panes: reverse(ductLoss.panes),
  });
  expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));
  expect(first.fields.shape?.schema).toEqual(z.toJSONSchema(fields.shape.schema, { io: "input" }));
  expect(first.readings.result?.args).toEqual({ runtime: true });
  const hash = await routeGraphHash(first);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).toBe(await routeGraphHash(second));
  expect(hash).toBe(createHash("sha256").update(JSON.stringify(first), "utf8").digest("hex"));
  expect(await routeGraphHash({ ...first, name: "Changed" })).not.toBe(hash);
});

test("field roles supply defaults and every explicit policy wins, including false and share true", () => {
  const roles: FieldRole[] = [
    "subject",
    "stage",
    "selection",
    "pose",
    "query",
    "draft",
    "device",
    "transient",
  ];
  expect(roles.map((role) => graphFieldPolicy({ role }))).toEqual([
    { url: "push", share: true, agent: "set" },
    { url: "push", share: true, agent: "set" },
    { url: "replace", share: true, agent: "set" },
    { url: "replace", share: true, agent: "set" },
    { url: "replace", share: true, agent: "set" },
    { url: "replace", share: false, agent: "set" },
    { url: false, share: false, agent: "read" },
    { url: false, share: false, agent: false },
  ]);
  expect(graphFieldPolicy({ role: "subject", url: false, share: false, agent: false })).toEqual({
    url: false,
    share: false,
    agent: false,
  });
  expect(graphFieldPolicy({ role: "device", url: "push", share: true, agent: "set" })).toEqual({
    url: "push",
    share: true,
    agent: "set",
  });
  // Existing explicit push selection policy remains legal despite the replace default.
  expect(
    projectRouteGraph({
      ...ductLoss,
      fields: { ...ductLoss.fields, face: { ...fields.face, role: "selection" } },
    }).fields.face?.url,
  ).toBe("push");
});

test("changing the production Rooms view clears stale selection but honors an explicit selection", () => {
  const current = roomsPageSchema.parse({
    view: "A",
    selected: ["42"],
    viewport: { kind: "plane", scale: 2, tx: 1, ty: 3 },
  });
  expect(roomsGraph.transition?.(current, { view: "B" }, "pea")).toEqual({
    patch: { view: "B", selected: [], viewport: null },
  });
  expect(roomsGraph.transition?.(current, { view: "B", selected: ["43"] }, "page")).toEqual({
    patch: { view: "B", selected: ["43"] },
  });
  expect(roomsGraph.transition?.(current, { view: "A" }, "page")).toEqual({ patch: { view: "A" } });
});

test("singleton catalogue keys cannot become an undeclared subject picker", () => {
  const broken = {
    ...indexGraph,
    subjectField: { ...indexGraph.subjectField!, cardinality: "many" as const },
  };
  expect(validateRouteGraph(broken)).toContainEqual(
    expect.objectContaining({ message: "A singleton subject requires one fixed named key" }),
  );
});

test("a missing reading and two verbs sharing one chord both refuse admission", () => {
  const broken = {
    ...ductLoss,
    panes: { ...ductLoss.panes, wheel: { ...ductLoss.panes.wheel!, draws: ["missing"] } },
    verbs: { apply: verb("Apply"), reset: verb("Reset") },
    stages: { calculate: { ...ductLoss.stages.calculate!, verbs: ["apply", "reset"] } },
  };
  expect(validateRouteGraph(broken)).toEqual([
    { code: "missing-reading", path: "panes.wheel.draws", message: "Unknown reading 'missing'" },
    { code: "missing-reading", path: "stages.calculate", message: "Unknown reading 'missing'" },
    {
      code: "chord-conflict",
      path: "stages.calculate.chords",
      message: "'apply' and 'reset' share 'Mod+Enter'",
    },
  ]);
});

test("stage panes, layout panes, gate predicates, and placed verb ids must exist", () => {
  const broken = {
    ...ductLoss,
    panes: { ...ductLoss.panes, inputs: { ...ductLoss.panes.inputs!, verbs: ["missing-verb"] } },
    layout: gate("missing-condition", pane("missing-layout-pane")),
    stages: { calculate: { word: "Calculating", panes: ["missing-stage-pane"], verbs: [] } },
  };
  expect(validateRouteGraph(broken).map((refusal) => refusal.code)).toEqual([
    "missing-verb",
    "missing-pane",
    "unknown-gate",
    "missing-pane",
  ]);
  expect(validateRouteGraph({ ...ductLoss, layout: gate("calculate", ductLoss.layout) })).toEqual(
    [],
  );
});

test("an ordered route retains semantic stage order in its sorted descriptor and refuses invalid orders", async () => {
  const first = ductLoss.stages.calculate!;
  const graph = { ...ductLoss, stages: { z: first, a: first } };
  const json = projectRouteGraph(graph);
  expect(Object.keys(json.stages)).toEqual(["a", "z"]);
  expect(json.stageOrder).toEqual(["z", "a"]);
  expect(validateRouteGraph(graph)).toEqual([]);
  for (const stageOrder of [[], ["z"], ["z", "z"], ["z", "unknown"]])
    expect(validateRouteGraph({ ...graph, stageOrder }).map((refusal) => refusal.code)).toContain(
      "stage-order",
    );
  expect(validateRouteGraph({ ...ductLoss, stages: {} })).toEqual([]);
  const reordered = { ...graph, stages: { a: first, z: first }, stageOrder: ["z", "a"] };
  expect(projectRouteGraph(reordered)).toEqual(json);
  expect(await routeGraphHash(projectRouteGraph({ ...graph, stageOrder: ["a", "z"] }))).not.toBe(
    await routeGraphHash(json),
  );
});

test("dynamic row placements declare candidate ids and are never executed by projection or validation", () => {
  const placement = Object.assign(
    (_row: { id: string }): string[] => {
      throw Error("needs a live row");
    },
    { ids: ["edit"] },
  );
  const graph = {
    ...ductLoss,
    verbs: { edit: { ...verb("Edit"), kind: "work" as const, subject: "cell" } },
    panes: { ...ductLoss.panes, inputs: { ...ductLoss.panes.inputs!, verbs: placement } },
  };
  expect(validateRouteGraph(graph)).toEqual([]);
  expect(projectRouteGraph(graph).panes.inputs?.verbs).toEqual({ ids: ["edit"], runtime: true });
  expect(validateRouteGraph({ ...graph, verbs: {} }).map((refusal) => refusal.code)).toContain(
    "missing-verb",
  );
});

test("pane placements and chord maps participate in the stage's chord conflict check", () => {
  const graph = {
    ...ductLoss,
    verbs: { apply: verb("Apply", "Mod+Shift+Enter"), reset: verb("Reset", "shift+mod+enter") },
    panes: { ...ductLoss.panes, inputs: { ...ductLoss.panes.inputs!, verbs: ["reset"] } },
    stages: { calculate: { ...ductLoss.stages.calculate!, verbs: ["apply"] } },
  };
  expect(validateRouteGraph(graph).map((refusal) => refusal.code)).toContain("chord-conflict");
  expect(
    validateRouteGraph({
      ...ductLoss,
      stages: { calculate: { ...ductLoss.stages.calculate!, chords: { missing: "F" } } },
    }).map((refusal) => refusal.code),
  ).toContain("missing-verb");
});

test("sibling panes may bind the same chord; a pane's own duplicate or a stage collision refuses", () => {
  const graph = {
    ...ductLoss,
    verbs: { a: verb("A", "E"), b: verb("B", "e"), c: verb("C", "F"), d: verb("D", "Alt+D") },
    panes: {
      ...ductLoss.panes,
      wheel: { ...ductLoss.panes.wheel!, verbs: ["a"] },
      inputs: { ...ductLoss.panes.inputs!, verbs: ["b"] },
    },
  };
  expect(validateRouteGraph(graph)).toEqual([]);
  // The same chord twice inside one pane, from a verb's own chord and a pane chord map.
  const duplicated = {
    ...graph,
    panes: {
      ...graph.panes,
      inputs: { ...graph.panes.inputs, verbs: ["b", "c"], chords: { c: "E" } },
    },
  };
  expect(validateRouteGraph(duplicated)).toEqual([
    { code: "chord-conflict", path: "panes.inputs.chords", message: "'b' and 'c' share 'E'" },
  ]);
  // A stage chord is in scope for every pane under it.
  const shadowed = {
    ...graph,
    stages: { calculate: { ...graph.stages.calculate!, verbs: ["d"], chords: { d: "E" } } },
  };
  expect(validateRouteGraph(shadowed).map((refusal) => refusal.path)).toEqual([
    "panes.wheel.chords",
    "panes.inputs.chords",
  ]);
});

test("malformed runtime data refuses instead of throwing", () => {
  expect(validateRouteGraph(null as unknown as RouteGraph).map((refusal) => refusal.code)).toEqual([
    "invalid-graph",
  ]);
});

const workSchema = z.object({
  rules: z.record(z.string(), z.object({ edit: z.unknown() })).default({}),
  scope: z.object({ edit: z.unknown() }).nullable(),
  note: z.string(),
});
type Work = z.infer<typeof workSchema>;
const rules: CellsDecl<Work> = {
  segment: "rules",
  groupOf: (key) => [key],
  nouns: ["rule"],
  noun: "loss rules",
  show: () => "rule",
};
const withCells = (...cells: CellsDecl<Work>[]): RouteGraph =>
  ({ ...ductLoss, needs: "document", work: workSchema, cells }) as unknown as RouteGraph;

test("cells project with executable bindings marked, and the hash covers them and the Work schema", async () => {
  const graph = withCells(rules);
  expect(validateRouteGraph(graph)).toEqual([]);
  const json = projectRouteGraph(graph);
  expect(json.cells?.[0]).toMatchObject({ groupOf: { runtime: true }, show: { runtime: true } });
  expect(json.work).toMatchObject({ type: "object", required: expect.arrayContaining(["note"]) });
  expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  const base = await routeGraphHash(projectRouteGraph(ductLoss));
  const hashed = await routeGraphHash(json);
  expect(hashed).not.toBe(base);
  const renamed = withCells({ ...rules, noun: "other" });
  expect(await routeGraphHash(projectRouteGraph(renamed))).not.toBe(hashed);
});

test("a cell segment must be in the Work schema, as a record unless it is a root cell", () => {
  expect(validateRouteGraph(withCells({ ...rules, segment: "ghost" }))).toMatchObject([
    { code: "missing-segment", path: "cells.0" },
  ]);
  expect(validateRouteGraph(withCells({ ...rules, segment: "note" }))).toMatchObject([
    { code: "missing-segment", message: "Work 'note' must be a keyed record of cells" },
  ]);
  expect(validateRouteGraph(withCells({ ...rules, segment: null, key: "scope" }))).toEqual([]);
  expect(validateRouteGraph(withCells({ ...rules, segment: null }))[0]?.code).toBe("invalid-graph");
  const noSchema = { ...withCells(rules), work: undefined } as RouteGraph;
  expect(validateRouteGraph(noSchema).map((refusal) => refusal.code)).toEqual(["missing-segment"]);
});

test("kernel cell verb ids are reserved and a family may be declared once", () => {
  const id = cellVerbId(rules, "clear");
  expect(id).toBe("cell:rules.clear");
  const collided = { ...withCells(rules), verbs: { [id]: verb("Take") } };
  expect(validateRouteGraph(collided)).toEqual([
    { code: "reserved-verb", path: `verbs.${id}`, message: `'${id}' is a kernel cell verb id` },
  ]);
  expect(validateRouteGraph(withCells(rules, rules)).map((refusal) => refusal.code)).toEqual([
    "invalid-graph",
  ]);
});

test("host-owned Work needs no Target; required and optional Targets are projected and hashed", async () => {
  const unscoped = { ...withCells(rules), needs: undefined } as RouteGraph;
  expect(validateRouteGraph(unscoped)).toEqual([]);
  const json = projectRouteGraph(withCells(rules));
  expect(json.needs).toBe("document");
  const project = projectRouteGraph({ ...withCells(rules), needs: "project" } as RouteGraph);
  expect(await routeGraphHash(project)).not.toBe(await routeGraphHash(json));
  expect(projectRouteGraph(ductLoss).needs).toBeUndefined();
  const optional = projectRouteGraph({ ...unscoped, optionalTarget: "session" });
  expect(optional.optionalTarget).toBe("session");
  expect(await routeGraphHash(optional)).not.toBe(
    await routeGraphHash(projectRouteGraph(unscoped)),
  );
});

test("automatic observation declares a review-free Work verb and is projected", () => {
  const graph = {
    ...withCells(rules),
    verbs: { read: { ...verb("Read"), review: "none" as const } },
    observe: ["read"],
  };
  expect(validateRouteGraph(graph)).toEqual([]);
  expect(projectRouteGraph(graph).observe).toEqual(["read"]);
  for (const invalid of [
    { ...graph, work: undefined },
    { ...graph, observe: ["missing"] },
    { ...graph, verbs: { read: { ...verb("Read"), review: "shown" as const } } },
  ])
    expect(validateRouteGraph(invalid).some((refusal) => refusal.path === "observe")).toBe(true);
});

test("workSubject names a Page field of a graph with Work; it is projected and hashed", async () => {
  const subject = Object.keys(ductLoss.fields)[0]!;
  const graph = { ...withCells(rules), workSubject: subject } as RouteGraph;
  expect(validateRouteGraph(graph)).toEqual([]);
  const json = projectRouteGraph(graph);
  expect(json.workSubject).toBe(subject);
  expect(await routeGraphHash(json)).not.toBe(
    await routeGraphHash(projectRouteGraph(withCells(rules))),
  );
  expect(validateRouteGraph({ ...graph, workSubject: "ghost" } as RouteGraph)).toEqual([
    { code: "invalid-graph", path: "workSubject", message: "Unknown Page field 'ghost'" },
  ]);
  expect(
    validateRouteGraph({ ...ductLoss, workSubject: subject } as RouteGraph).map((r) => r.path),
  ).toEqual(["workSubject"]);
});

test("a query verb projects its read identity; selecting Work requires workSubject", async () => {
  const read: VerbDecl = {
    kind: "query",
    does: "schedule.grid.snapshot",
    selects: "work",
    effect: "query",
    label: "Read",
    review: "none",
    input: z.strictObject({ id: z.number().optional() }),
  };
  const graph = { ...withCells(rules), verbs: { read } } as RouteGraph;
  expect(validateRouteGraph(graph)).toEqual([
    {
      code: "invalid-graph",
      path: "verbs.read",
      message: "A query that selects Work needs `workSubject`",
    },
  ]);
  const subject = Object.keys(ductLoss.fields)[0]!;
  const admitted = { ...graph, workSubject: subject } as RouteGraph;
  expect(validateRouteGraph(admitted)).toEqual([]);
  const json = projectRouteGraph(admitted);
  expect(json.verbs.read).toMatchObject({
    kind: "query",
    does: "schedule.grid.snapshot",
    selects: "work",
    effect: "query",
  });
  const unselecting = { ...admitted, verbs: { read: { ...read, selects: undefined } } };
  expect(await routeGraphHash(projectRouteGraph(unselecting as RouteGraph))).not.toBe(
    await routeGraphHash(json),
  );
});

test("every graph with Work projects the kernel's start-fresh recovery; its id and kind are reserved", () => {
  const json = projectRouteGraph(withCells(rules));
  expect(json.verbs[START_FRESH_VERB]).toEqual({
    kind: "recovery",
    label: "Start fresh",
    review: "shown",
    says: expect.any(String),
    input: expect.objectContaining({ type: "object", additionalProperties: false }),
  });
  expect(projectRouteGraph(ductLoss).verbs).toEqual({});
  const collided = { ...withCells(rules), verbs: { [START_FRESH_VERB]: verb("Fresh") } };
  expect(validateRouteGraph(collided)).toEqual([
    {
      code: "reserved-verb",
      path: `verbs.${START_FRESH_VERB}`,
      message: `'${START_FRESH_VERB}' is a kernel verb id`,
    },
  ]);
  const own = { ...withCells(rules), verbs: { mine: { ...verb("Mine"), kind: "recovery" } } };
  expect(validateRouteGraph(own as RouteGraph)).toEqual([
    { code: "reserved-verb", path: "verbs.mine", message: "Recovery verbs are kernel-owned" },
  ]);
});

test("a graph's salvage hook projects the carry-over recovery; its id is reserved and it needs Work", () => {
  const salvaging = { ...withCells(rules), salvage: () => [] } as RouteGraph;
  expect(validateRouteGraph(salvaging)).toEqual([]);
  expect(projectRouteGraph(salvaging).verbs[SALVAGE_VERB]).toMatchObject({
    kind: "recovery",
    review: "shown",
  });
  // Without the hook there is nothing to carry over, so Pea is not offered the verb.
  expect(projectRouteGraph(withCells(rules)).verbs[SALVAGE_VERB]).toBeUndefined();
  expect(
    validateRouteGraph({ ...withCells(rules), verbs: { [SALVAGE_VERB]: verb("Mine") } }),
  ).toEqual([
    {
      code: "reserved-verb",
      path: `verbs.${SALVAGE_VERB}`,
      message: `'${SALVAGE_VERB}' is a kernel verb id`,
    },
  ]);
  expect(validateRouteGraph({ ...ductLoss, salvage: () => [] } as unknown as RouteGraph)).toEqual([
    {
      code: "invalid-graph",
      path: "salvage",
      message: "Only a graph with Work can carry salvage over",
    },
  ]);
});

test("public legacy discovery has no registration door and new builtin keys refuse", () => {
  expect(Object.isFrozen(legacyRouteDiscovery)).toBe(true);
  expect("register" in legacyRouteDiscovery).toBe(false);
  expect("registerGraph" in legacyRouteDiscovery).toBe(false);
  expect("registerModule" in legacyRouteDiscovery).toBe(false);
  const registry = createLegacyRouteRegistry();
  expect(() => registry.registerGraph({ ...ductLoss, key: "new-offender" }, () => null)).toThrow(
    /Unenumerated legacy route/,
  );
  expect(registry.keys()).toEqual([]);
});

// COMMON 25: discovery does not carry a second copy of the closure pin.
test("a builtin can re-enter registerModule without a directory hash", () => {
  const registry = createLegacyRouteRegistry();
  const graph = { ...ductLoss, moduleHash: "a".repeat(64) };
  const remove = registry.registerModule({
    version: 1,
    namespace: "builtin",
    key: `builtin:${graph.key}`,
    moduleHash: graph.moduleHash,
    graph,
    bodies: () => null,
  });
  expect(registry.get(graph.key)?.graph).toBe(graph);
  remove();
  expect(registry.get(graph.key)).toBeUndefined();
});

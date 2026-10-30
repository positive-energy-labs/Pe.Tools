import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { createRouteRegistry } from "../../kit/src/route-registry.ts";
import { ductLossGraph as ductLoss } from "../../../apps/web/src/duct-loss/graph.ts";
import { field, text } from "../src/route-field.ts";
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
} from "../src/route-graph.ts";

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
  for (const patch of [{ review: "required" as const }, { subject: "cell" }, { does: "apply" }])
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
  review: "required",
  chord,
});

test("duct-loss's three panes and page-derived reading register as a discoverable graph", () => {
  expect(validateRouteGraph(ductLoss)).toEqual([]);
  const json = projectRouteGraph(ductLoss);
  expect(json.stageOrder).toEqual(["calculate"]);
  expect(json.readings.result).toMatchObject({
    kind: "derive",
    source: "duct-loss.solve",
    deps: ["page"],
  });
  expect(Object.keys(json.panes)).toEqual(["charts", "inputs", "wheel"]);
  expect(json.verbs).toEqual({});
  const registry = createRouteRegistry();
  const remove = registry.register({
    manifest: { key: ductLoss.key, name: ductLoss.name, graph: json },
    hosted: () => null,
  });
  expect(registry.get("duct-loss")?.manifest.graph).toEqual(json);
  remove();
  expect(registry.get("duct-loss")).toBeUndefined();
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

test("a declared transition clears selection atomically when the subject changes", () => {
  const graph: RouteGraph<{ system: string; selected: string }, { ready: boolean }> = {
    key: "ducts",
    address: "ducts",
    name: "Ducts",
    fields: {
      system: { ...field(text(), {}), role: "subject" },
      selected: { ...field(text(), {}), role: "selection" },
    },
    readings: {},
    verbs: {},
    panes: { picture: { label: "Picture", purpose: "See the system", draws: [], verbs: [] } },
    layout: gate("hasSystem", pane("picture")),
    predicates: { hasSystem: (page, work) => page.system !== "" && work?.ready === true },
    stages: { walk: { word: "Pricing", panes: ["picture"], verbs: [] } },
    transition: (current, patch) => ({
      patch:
        patch.system !== undefined && patch.system !== current.system
          ? { ...patch, selected: "" }
          : patch,
    }),
  };
  expect(validateRouteGraph(graph)).toEqual([]);
  expect(graph.transition?.({ system: "A", selected: "42" }, { system: "B" }, "pea")).toEqual({
    patch: { system: "B", selected: "" },
  });
  expect(graph.transition?.({ system: "A", selected: "42" }, { selected: "43" }, "page")).toEqual({
    patch: { selected: "43" },
  });
  expect(projectRouteGraph(graph).transition).toEqual({ runtime: true });
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
    {
      code: "chord-conflict",
      path: "stages.calculate.chords",
      message: "'apply' and 'reset' share 'Mod+Enter'",
    },
  ]);
  expect(projectRouteGraph(broken).verbs.apply?.input).toEqual(
    z.toJSONSchema(broken.verbs.apply.input, { io: "input" }),
  );
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
  expect(validateRouteGraph({ ...ductLoss, stages: {} }).map((refusal) => refusal.code)).toContain(
    "stage-order",
  );
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
  rules: z.record(z.string(), z.object({ suggestion: z.unknown() })).default({}),
  scope: z.object({ suggestion: z.unknown() }).nullable(),
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
  expect(json.cells).toEqual([
    {
      groupOf: { runtime: true },
      noun: "loss rules",
      nouns: ["rule"],
      segment: "rules",
      show: { runtime: true },
    },
  ]);
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
  const id = cellVerbId(rules, "take");
  expect(id).toBe("cell:rules.take");
  const collided = { ...withCells(rules), verbs: { [id]: verb("Take") } };
  expect(validateRouteGraph(collided)).toEqual([
    { code: "reserved-verb", path: `verbs.${id}`, message: `'${id}' is a kernel cell verb id` },
  ]);
  expect(validateRouteGraph(withCells(rules, rules)).map((refusal) => refusal.code)).toEqual([
    "invalid-graph",
  ]);
});

test("a graph with Work declares the Target it needs; needs is projected and hashed", async () => {
  const unscoped = { ...withCells(rules), needs: undefined } as RouteGraph;
  expect(validateRouteGraph(unscoped)).toEqual([
    {
      code: "invalid-graph",
      path: "needs",
      message: "A graph with Work must declare the Target it needs",
    },
  ]);
  const json = projectRouteGraph(withCells(rules));
  expect(json.needs).toBe("document");
  const project = projectRouteGraph({ ...withCells(rules), needs: "project" } as RouteGraph);
  expect(await routeGraphHash(project)).not.toBe(await routeGraphHash(json));
  expect(projectRouteGraph(ductLoss).needs).toBeUndefined();
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
    review: "required",
    says: expect.any(String),
    input: expect.objectContaining({ type: "object", additionalProperties: false }),
    answers: expect.objectContaining({
      properties: { confirm: { type: "boolean", const: true } },
      required: ["confirm"],
    }),
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
    review: "required",
    answers: expect.objectContaining({ required: ["confirm"] }),
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

test("a verb's review answers project as JSON Schema; one that cannot convert refuses the projection", () => {
  const answered = (answers: z.ZodType): RouteGraph => ({
    ...withCells(rules),
    verbs: { go: { ...verb("Go", "Mod+G"), answers } },
  });
  expect(
    projectRouteGraph(answered(z.strictObject({ confirm: z.literal(true) }))).verbs.go,
  ).toMatchObject({ answers: { required: ["confirm"] } });
  expect(() => projectRouteGraph(answered(z.custom<string>(() => true)))).toThrow();
});

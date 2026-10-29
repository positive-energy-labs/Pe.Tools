import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { createRouteRegistry } from "../../kit/src/route-registry.ts";
import { ductLossAddress } from "../src/routes/duct-loss.ts";
import { field, text } from "../src/route-field.ts";
import {
  gate,
  graphFieldPolicy,
  pane,
  projectRouteGraph,
  routeGraphHash,
  split,
  validateRouteGraph,
  type FieldRole,
  type RouteGraph,
  type VerbDecl,
} from "../src/route-graph.ts";

type DuctLossPage = {
  [K in keyof typeof ductLossAddress.fields]: z.output<
    (typeof ductLossAddress.fields)[K]["schema"]
  >;
};
const fields = ductLossAddress.fields;
const ductLoss: RouteGraph<DuctLossPage, null> = {
  key: "duct-loss",
  address: "duct-loss",
  name: "Duct Loss",
  fields: {
    shape: { ...fields.shape, role: "subject" },
    a: { ...fields.a, role: "query" },
    b: { ...fields.b, role: "query" },
    cfm: { ...fields.cfm, role: "query" },
    length: { ...fields.length, role: "query" },
    roughness: { ...fields.roughness, role: "query" },
    density: { ...fields.density, role: "query" },
    face: { ...fields.face, role: "pose" },
  },
  readings: {
    result: {
      kind: "derive",
      source: "duct-loss.solve",
      args: (page) => page,
      deps: ["page"],
      retire: "page",
    },
  },
  verbs: {},
  panes: {
    wheel: { label: "Wheel", purpose: "Drag diameter or airflow", draws: ["result"], verbs: [] },
    inputs: {
      label: "Inputs",
      purpose: "Type the duct and read its loss",
      draws: ["result"],
      verbs: [],
    },
    charts: {
      label: "Charts",
      purpose: "Four lenses on the same law",
      draws: ["result"],
      verbs: [],
    },
  },
  layout: split(
    "calc",
    { axis: "v", sized: "end", size: 360 },
    split("top", { axis: "h", sized: "end", size: 320 }, pane("wheel"), pane("inputs")),
    pane("charts"),
  ),
  stages: { calculate: { word: "Calculating", panes: ["wheel", "inputs", "charts"], verbs: [] } },
  pick: false,
};

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

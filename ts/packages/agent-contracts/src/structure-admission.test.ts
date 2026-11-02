import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { field, text, manyField } from "./route-field.ts";
import { validateRouteGraph, type RouteGraph } from "./route-graph.ts";
import { validateExecutableRouteModule } from "./route-module.ts";

const graph = (): RouteGraph<any, any> => ({
  key: "pod.test.items",
  name: "Items",
  address: "items",
  directory: {
    path: "/items",
    title: "Items",
    label: "Items",
    exposure: "Preview",
    runtimeNeed: "none",
    icon: "Box",
    category: "Coordinate model data",
    blurb: "Items",
    aliases: [],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
  } as any,
  subjectField: {
    field: "subject",
    noun: "item",
    keyKind: "name",
    cardinality: "one",
    roster: "items",
    detail: "items",
    pane: "main",
    show: (id) => id,
  },
  fields: {
    subject: { ...field(text(), {}), role: "subject" },
    selected: { ...manyField("name", {}), role: "selection" },
  },
  readings: { items: { kind: "use", source: "items", retire: "never" } },
  verbs: {},
  panes: { main: { label: "Items", purpose: "Items", draws: ["items"], verbs: [] } },
  layout: { kind: "pane", id: "main" },
  stages: { main: { word: "Items", panes: ["main"], verbs: [] } },
});
const messages = (value: RouteGraph<any, any>) =>
  validateRouteGraph(value)
    .map((r) => r.message)
    .join("; ");
test("missing subject, duplicate selection and handwritten arrays refuse admission", () => {
  const good = graph();
  expect(messages(good)).toBe("");
  expect(messages({ ...good, subjectField: undefined } as any)).toContain("Every route");
  expect(messages({ ...good, fields: { ...good.fields, other: good.fields.selected! } })).toContain(
    "exactly one kernel-owned selection",
  );
  expect(
    messages({
      ...good,
      fields: {
        ...good.fields,
        selected: { ...field(z.array(z.string()).default([]), {}), role: "selection" },
      },
    }),
  ).toContain("kernel manyField");
});
test("Pod admission links axes and refuses missing declarations", () => {
  const axes = {
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Cheap",
    cardinality: "One",
  };
  const module: any = {
    version: 1,
    namespace: "test",
    key: "test:pod.test.items",
    moduleHash: "a".repeat(64),
    graph: graph(),
    work: { route: "pod.test.items" },
    bodies: { "pod.test.read": () => null },
    entries: {
      "pod.test.read": {
        says: "Read",
        needs: "nothing",
        effect: "query",
        dirties: [],
        input: z.object({}),
        axes,
      },
    },
  };
  expect(() => validateExecutableRouteModule(module, module.moduleHash)).not.toThrow();
  delete module.entries["pod.test.read"].axes;
  expect(() => validateExecutableRouteModule(module, module.moduleHash)).toThrow(
    "missing or invalid subject",
  );
});

test("verb prerequisites must be demanded transitively in every placement stage", () => {
  const g = graph();
  g.readings = {
    ...g.readings,
    derived: { kind: "derive", source: "derive", deps: ["items"], retire: "never" },
  };
  g.verbs = { apply: { kind: "command", input: z.object({}), label: "Apply", review: "shown" } };
  g.stages = { main: { word: "Main", panes: ["main"], verbs: ["apply"] } };
  const edges = { verbDepends: { apply: ["derived"] } };
  expect(validateRouteGraph(g, edges).map((r) => r.message)).toContain(
    "Verb apply depends on reading derived, which stage main never demands",
  );
  expect(validateRouteGraph(g, { ...edges, verbReadings: { apply: ["derived"] } })).not.toEqual([]);
  g.panes = { main: { ...g.panes.main!, draws: ["derived"] } };
  expect(validateRouteGraph(g, edges)).toEqual([]);
  expect(
    validateRouteGraph(g, { verbDepends: { missing: ["absent"] } }).map((r) => r.code),
  ).toEqual(["missing-verb", "missing-reading"]);
  g.readings = { ...g.readings, items: { ...g.readings.items!, deps: ["derived"] } };
  expect(validateRouteGraph(g, edges).some((r) => r.message.includes("cycle"))).toBe(true);
});
test.each(["ElementId", "fan-mark", "label", "display-name"])(
  "display identity %s refuses admission",
  (keyKind) => {
    const g = graph();
    g.subjectField = { ...g.subjectField, keyKind } as any;
    expect(messages(g)).toContain("never ElementId or display fields");
  },
);

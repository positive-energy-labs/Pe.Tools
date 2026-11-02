import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { field } from "./route-field.ts";
import { defineRouteGraph, pane, projectRouteGraph, validateRouteGraph } from "./route-graph.ts";

const declaration = {
  key: "example", address: "example", name: "Example",
  subjectField: { field: "item", noun: "item", keyKind: "name", roster: "items", detail: "item", pane: "detail" },
  fields: { viewport: field(z.string().default(""), {}), selected: { ...field(z.string().default(""), {}), role: "selection" }, item: { ...field(z.string().default(""), {}),  } },
  readings: {}, verbs: {},
  panes: { detail: { label: "Detail", purpose: "Inspect the item", draws: ["item"] } },
  layout: pane("detail"), stages: { inspect: { word: "Inspecting" } },
} as const;

test("a subject supplies roster/detail reads and empty placements before admission and projection", () => {
  const graph = defineRouteGraph<{ item: string; selected: string; viewport: string }>(declaration);
  expect(validateRouteGraph(graph)).toEqual([]);
  expect(graph.readings.items).toEqual({ kind: "use", source: "example.items", retire: "target" });
  expect(graph.readings.item!.args!({ item: "A", selected: "", viewport: "" })).toBe("A");
  expect(graph.readings.item!.retire).toBe("page");
  expect(graph.subjectField.show("A")).toBe("A");
  expect(graph.fields.item.role).toBe("subject");
  expect(graph.fields.viewport.role).toBe("pose");
  expect(graph.fields.selected.role).toBe("selection");
  expect(graph.stages.inspect).toEqual({ word: "Inspecting", panes: ["detail"], verbs: [] });
  expect(graph.panes.detail!.verbs).toEqual([]);
  expect(projectRouteGraph(defineRouteGraph(graph))).toEqual(projectRouteGraph(graph));
});

test("explicit lifetimes, sources, cardinality, labels and empty stages survive defaults", () => {
  const graph = defineRouteGraph<{ item: string; selected: string; viewport: string }>({
    ...declaration,
    subjectField: { ...declaration.subjectField, show: (id) => `Item ${id}` },
    readings: { item: { kind: "derive", source: "custom", retire: "never", deps: ["items"] }, extra: { args: (p) => p.item } },
    stages: { inspect: { word: "Inspecting", panes: [] } },
  });
  expect(graph.readings.item).toEqual({ kind: "derive", source: "custom", retire: "never", deps: ["items"] });
  expect(graph.readings.extra!.source).toBe("example.extra");
  expect(graph.readings.extra!.retire).toBe("page");
  expect(graph.stages.inspect!.panes).toEqual([]);
  expect(graph.subjectField.show("A")).toBe("Item A");
});

test("a shared roster and detail is one target read", () => {
  const graph = defineRouteGraph<{ item: string; selected: string; viewport: string }>({ ...declaration, subjectField: { ...declaration.subjectField, roster: "item" } });
  expect(Object.keys(graph.readings)).toEqual(["item"]);
  expect(graph.readings.item).toEqual({ kind: "use", source: "example.item", retire: "target" });
});

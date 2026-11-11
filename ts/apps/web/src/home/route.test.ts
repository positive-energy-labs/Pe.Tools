import { expect, test } from "vite-plus/test";
import { module, query } from "./route";

/*
 * Slice 10 (MAP row 10), index: home sits on the slot declaration alone. No subject, no sheet,
 * picture or goal; every Page field is route-owned `query` (ADR 0035 rule 1), so `fields` is gone,
 * and the layout is one pane. The old `index/graph.ts` RouteGraph went with it.
 */
test("slice 10 index: home declares only query and one pane, no subject and no slot data", () => {
  expect(Object.keys(query)).toEqual(["threadSearch", "threadSort", "query", "exposure", "sort", "folded"]);
  expect(Object.values(query).every((f) => f.role === "query")).toBe(true);
  const { data, spec } = module;
  expect(spec.subject).toBeUndefined();
  expect([spec.sheet, spec.picture, spec.goal]).toEqual([undefined, undefined, undefined]);
  expect(spec.layout).toEqual({ kind: "pane", id: "main" });
  expect(Object.keys(spec.panes)).toEqual(["main"]);
  // `query` folds into the one Page: discovery projects each as a query field, plus the kernel's selection.
  expect(Object.fromEntries(Object.entries(data.fields).map(([k, f]) => [k, f.role]))).toEqual({
    threadSearch: "query", threadSort: "query", query: "query", exposure: "query", sort: "query", folded: "query",
    selected: "selection",
  });
  expect(data.subject).toBeUndefined();
});

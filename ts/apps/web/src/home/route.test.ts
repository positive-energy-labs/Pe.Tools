import { expect, test } from "vite-plus/test";
import { module, query } from "./route";
import { module as chat } from "../chat/route";
import { module as takeoff } from "../takeoff/route";
import { decodeField, encodeField } from "@pe/web-kernel/route/field-codec";
import { routeAddress, routeKeys, threadListFields } from "@pe/agent-contracts";

/*
 * Slice 10 (MAP row 10), index: home sits on the slot declaration alone. No subject, no sheet,
 * picture or goal; every Page field is route-owned `query` (ADR 0035 rule 1), so `fields` is empty,
 * and the layout is one pane. The old `index/graph.ts` RouteGraph went with it.
 */
test("slice 10 index: home declares only query and one pane, no subject and no slot data", () => {
  expect(Object.keys(query)).toEqual([
    "threadSearch",
    "threadSort",
    "query",
    "exposure",
    "sort",
    "folded",
  ]);
  expect(Object.values(query).every((f) => f.role === "query")).toBe(true);
  const { data, spec } = module;
  expect(spec.subject).toBeUndefined();
  expect([spec.sheet, spec.picture, spec.goal]).toEqual([undefined, undefined, undefined]);
  expect(spec.layout).toEqual({ kind: "pane", id: "main" });
  expect(Object.keys(spec.panes)).toEqual(["main"]);
  // `query` folds into the one Page: discovery projects each as a query field, plus the kernel's selection.
  expect(Object.fromEntries(Object.entries(data.fields).map(([k, f]) => [k, f.role]))).toEqual({
    threadSearch: "query",
    threadSort: "query",
    query: "query",
    exposure: "query",
    sort: "query",
    folded: "query",
    selected: "selection",
  });
  expect(data.subject).toBeUndefined();
});

test("every thread-list Page uses the shared fields and one encoding", () => {
  for (const route of [module, chat, takeoff]) {
    const fields = route.spec.fields;
    expect(fields.threadSort, route.data.key).toBe(threadListFields.threadSort);
    expect(fields.threadSearch, route.data.key).toBe(threadListFields.threadSearch);
    expect(encodeField(fields.threadSort, "title"), route.data.key).toBe("title");
    expect(decodeField(fields.threadSort, '"title"'), route.data.key).toBe("");
    expect(decodeField(fields.threadSearch, "broken"), route.data.key).toEqual({
      v: 0, keywords: "broken", pills: [],
    });
  }
});

test("all thread-list address projections use the shared codec for malformed input", () => {
  for (const key of routeKeys) {
    const at = routeAddress(key);
    expect(at.read({ threadSort: '"title"' }).page.threadSort, key).toBe("");
    expect(at.read({ threadSearch: "broken" }).page.threadSearch, key).toEqual({
      v: 0, keywords: "broken", pills: [],
    });
    expect(at.write({ threadSort: "title" }).threadSort, key).toBe("title");
  }
});

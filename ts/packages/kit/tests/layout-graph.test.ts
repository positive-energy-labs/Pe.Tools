import { gate, pane, split, type LayoutNode } from "@pe/agent-contracts";
import { expect, test, vi } from "vite-plus/test";
import { reduceLayout, sidebars, withDoc } from "../src/components/lang/layout-graph";

const h = (id: string, a: LayoutNode, b: LayoutNode) =>
  split(id, { axis: "h", sized: "start", size: 320 }, a, b);
const v = (id: string, a: LayoutNode, b: LayoutNode) =>
  split(id, { axis: "v", sized: "start", size: 200 }, a, b);
// X1 G row: the review inbox shares a branch with regions; History empties that branch.
const working = h(
  "working",
  gate("notHistory", pane("plan")),
  v("review", gate("review", pane("inbox")), gate("notHistory", pane("regions"))),
);
const rooms = h("rooms", working, gate("history", pane("receipts")));

test("rooms partition collapses the inbox split and the History branch", () => {
  expect(reduceLayout(rooms, (when) => when === "notHistory")).toEqual(
    h("working", pane("plan"), pane("regions")),
  );
});

test("rooms review retains the declared nested geometry and stable pane ids", () => {
  expect(reduceLayout(rooms, (when) => when !== "history")).toEqual(
    h("working", pane("plan"), v("review", pane("inbox"), pane("regions"))),
  );
});

test("rooms History recursively removes the empty working branch", () => {
  expect(reduceLayout(rooms, (when) => when === "history")).toEqual(pane("receipts"));
});

test("takeoffs cursor detail gates independently of stage", () => {
  const takeoffs = h("takeoffs", pane("table"), gate("hasCursor", pane("room")));
  expect(reduceLayout(takeoffs, () => false)).toEqual(pane("table"));
  expect(reduceLayout(takeoffs, () => true)).toEqual(h("takeoffs", pane("table"), pane("room")));
});

test("all-empty and nested gates reduce to null without evaluating a closed child", () => {
  const active = vi.fn((_when: string) => false);
  expect(reduceLayout(gate("outer", gate("inner", rooms)), active)).toBeNull();
  expect(active.mock.calls).toEqual([["outer"]]);
  expect(reduceLayout(rooms, () => false)).toBeNull();
});

test("reduction preserves declaration data, order and input without mutation", () => {
  const tree = split(
    "many",
    { axis: "v", sized: "end", size: 123 },
    pane("a"),
    gate("off", pane("b")),
    pane("c"),
  );
  const before = structuredClone(tree);
  expect(reduceLayout(tree, () => false)).toEqual({
    kind: "split",
    id: "many",
    axis: "v",
    sized: "end",
    size: 123,
    children: [pane("a"), pane("c")],
  });
  expect(tree).toEqual(before);
});

test("presets declare ordinary layouts and keep optional sidebars optional", () => {
  const main = pane("main");
  expect(sidebars({ main })).toBe(main);
  expect(sidebars({ main, start: pane("nav") })).toMatchObject({
    axis: "h",
    sized: "start",
    children: [pane("nav"), main],
  });
  expect(withDoc(main, "doc")).toEqual(sidebars({ main, end: pane("doc") }));
  const both = sidebars({ start: pane("nav"), main, end: pane("doc") });
  expect(both).toMatchObject({
    children: [pane("nav"), { children: [main, pane("doc")] }],
  });
  const nested = withDoc(both, "reference");
  expect(nested.kind === "split" && both.kind === "split" && nested.id !== both.id).toBe(true);
});

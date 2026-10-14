// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vite-plus/test";

import { filterItems, useCollection } from "@pe/kit/lang/collection";

const items = ["alpha", "beta"];
const options = {
  items,
  keyOf: (item: string) => item,
  labelOf: (item: string) => item,
  target: null,
};

test("a list whose query an input owns opens with its top row cursored, so Enter picks it", () => {
  const owned = renderHook(() => useCollection({ ...options, query: "" }));
  expect(owned.result.current.cursor).toBe("alpha");
  // Free-text suggestions keep Enter for the typed text.
  const suggestions = renderHook(() => useCollection({ ...options, query: "", autoCursor: false }));
  expect(suggestions.result.current.cursor).toBeNull();
  // A list that owns its own query waits for typing.
  const own = renderHook(() => useCollection(options));
  expect(own.result.current.cursor).toBeNull();
});

test("a capped group shows its first rows and one 'more' row that opens the rest in place", () => {
  const letters = ["a1", "a2", "a3", "b1"];
  const list = renderHook(() =>
    useCollection({
      ...options,
      items: letters,
      groupOf: (item: string) => item[0],
      groupCap: 2,
      query: "",
    }),
  );
  const keys = () => list.result.current.visible.map((row) => row.key);
  expect(keys()).toEqual(["head:a", "a1", "a2", "more:a", "head:b", "b1"]);
  expect(list.result.current.visible[3]).toMatchObject({ kind: "more", count: 1, next: "a3" });
  // The more row is a pick like any other: it opens the group and the cursor lands on what it hid.
  act(() => list.result.current.pick("more:a"));
  expect(keys()).toEqual(["head:a", "a1", "a2", "a3", "head:b", "b1"]);
  expect(list.result.current.cursor).toBe("a3");
});

test("leading groups stay first while a query ranks the rest", () => {
  const rows = ["tool:duct loss", "waits:check duct sizing"];
  const ranked = (leadingGroups?: readonly string[]) =>
    renderHook(() =>
      useCollection({
        ...options,
        items: rows,
        labelOf: (item: string) => item.split(":")[1]!,
        groupOf: (item: string) => item.split(":")[0],
        filter: "fuzzy",
        query: "duct",
        leadingGroups,
      }),
    )
      .result.current.visible.filter((row) => row.kind === "head")
      .map((row) => row.key);
  expect(ranked()).toEqual(["head:tool", "head:waits"]);
  expect(ranked(["waits"])).toEqual(["head:waits", "head:tool"]);
});

test("words mode: a query word starts a name word, sits in the name, or starts a detail word", () => {
  const tools = [
    { name: "Doc Lab", detail: "grounded-document engine" },
    { name: "Identity and instruction first sentence", detail: "Codex" },
    { name: "Pods", detail: "edit a duct spec" },
    { name: "Duct Loss", detail: "friction" },
  ];
  const hits = filterItems(
    tools,
    (tool) => tool.name,
    "words",
    "duct",
    (tool) => tool.detail,
  ).map((tool) => tool.name);
  expect(hits).toEqual(["Duct Loss", "Pods"]);
});

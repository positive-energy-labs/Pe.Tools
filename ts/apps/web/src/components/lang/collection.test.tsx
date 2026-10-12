// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vite-plus/test";

import { useCollection } from "./collection";

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

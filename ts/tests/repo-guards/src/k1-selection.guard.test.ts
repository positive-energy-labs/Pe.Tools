import { expect, test } from "vite-plus/test";
import { census } from "./unification-2-census.ts";

test("production selection must belong to Page, not React", () => {
  const copies = census().reactSelection!.filter(
    (path) => !/\/(design-system|prototypes)\//.test(path),
  );
  expect(copies, copies.join("\n")).toEqual([]);
});

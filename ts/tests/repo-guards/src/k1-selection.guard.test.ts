import { expect, test } from "vite-plus/test";
import { census } from "./unification-2-census.ts";

// TODO: Move these selections into the Page owner; this guard remains red until every copy is gone.
test("kernel gap: production selection must belong to Page, not React", () => {
  const copies = census().reactSelection!.filter(
    (path) => !/\/(design-system|prototypes)\//.test(path),
  );
  expect(copies, copies.join("\n")).toEqual([]);
});

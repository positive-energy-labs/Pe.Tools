import { expect, test } from "vite-plus/test";
import { census } from "./unification-2-census.ts";

test("geometry census reads current Subject and Touches, not retired Scope", () => {
  const offenders = census().unscopedGeometry!;
  expect(
    offenders.filter((row) =>
      /(?:takeoffs\.snapshot|revit\.detail\.space-(?:rows|tree)|rooms\.snapshot) \(/.test(row),
    ),
  ).toEqual([]);
  console.log("Current unscoped geometry:", offenders);
});

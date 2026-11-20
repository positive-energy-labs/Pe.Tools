/**
 * /settings' slots (routes MAP row 10; homes MAP slice 6b; ADR 0035 rules 1 and 3 as amended by
 * ADR 0037 rule 8): no subject, `section` is the route's one query, and the sheet holds only
 * `setting` bindings. A tiered value is saved at a home, never staged in Work, so this test turns
 * red the day a Work-staging kind, a subject or a second query appears here.
 */
import { expect, test } from "vite-plus/test";
import { module } from "./route.ts";

test("/settings declares no subject, a sheet of tiered settings only, and `section` as its query", () => {
  const { spec, data } = module;
  expect(spec.subject).toBeUndefined();
  expect(Object.values(spec.sheet!.bindings).map((binding) => binding.home.at)).toContain(
    "setting",
  );
  expect(
    Object.values(spec.sheet!.bindings).every((binding) => binding.home.at === "setting"),
  ).toBe(true);
  expect(spec.goal).toBeUndefined();
  expect(Object.keys(spec.query ?? {})).toEqual(["section"]);
  expect(data.fields.section).toMatchObject({ role: "query", url: "push" });
  expect(
    Object.values(data.sheet!.bindings).every((binding) => binding.home.at === "setting"),
  ).toBe(true);
  // The route's own pane holds acts on this machine; values in a home are the kernel sheet's.
  expect(Object.keys(spec.panes)).toEqual(["settings", "sheet"]);
});

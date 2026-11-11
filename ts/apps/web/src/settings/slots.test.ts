/**
 * Slice 10 falsifier for /settings (routes MAP row 10, ADR 0035 rules 1 and 3): no subject, `section`
 * is the route's one query, and the sheet slot stays empty, because the per-user setting fields have
 * no binding kind and rule 3 is closed. The settings pane is the route's own drawing until a kind is
 * ruled; this test turns red the day a sheet, subject or second query appears without that ruling.
 */
import { expect, test } from "vite-plus/test";
import { module } from "./route.ts";

test("/settings declares no subject and no sheet, and `section` as its query", () => {
  const { spec, data } = module;
  expect(spec.subject).toBeUndefined();
  expect(spec.sheet).toBeUndefined();
  expect(spec.goal).toBeUndefined();
  expect(Object.keys(spec.query ?? {})).toEqual(["section"]);
  expect(data.fields.section).toMatchObject({ role: "query", url: "push" });
  expect(data.sheet).toBeUndefined();
  // The one pane is the route's own: no kernel slot holds a per-user setting.
  expect(Object.keys(spec.panes)).toEqual(["settings"]);
});

/**
 * Slice 6b falsifier (homes MAP row 6b, JOURNEYS FS, end-gate target 8): on every FS step that needs
 * no Revit, the tier label the sheet draws equals the home the host served, and a firm home that is
 * not found never yields "firm".
 */
import { expect, test } from "vite-plus/test";
import { resolveCriteria } from "@pe/ducts-domain/sheet/index";
import { firmLayer } from "../../../host/src/ducts-inputs.ts";

test("FS step 7 at the resolver: a refused firm read never serves a value as firm", () => {
  const criteria = resolveCriteria(null, null, firmLayer({ refused: "no-shared-root" }));
  expect(criteria.terminalDropInWg).toMatchObject({ value: 0.03, source: "default" });
  expect(JSON.stringify(criteria)).not.toContain('"firm"');
});
